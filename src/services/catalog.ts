import { z } from "zod";
import { one, q, tx, type Db } from "../db.js";
import { ApiError, notFound } from "../lib/http.js";
import { courseCodeFromSlug } from "../lib/ids.js";

/* ───────────── serialisation (keeps the legacy `Track` response shape the public site expects) ───────────── */
export function serializePlan(p: any) {
  return {
    id: p.id, duration: p.code, days: p.days, label: p.label, tierName: p.tier_name ?? "", sessions: p.sessions,
    labHours: p.lab_hours, priceINR: Number(p.price_inr), originalPriceINR: Number(p.original_price_inr),
    discountPercent: p.discount_percent, academicSupportEligible: p.academic_support_eligible,
    lorEligible: p.lor_eligible, ppoEligible: p.ppo_eligible, features: p.features ?? [],
    synopsisPages: p.synopsis_pages, isActive: p.is_active,
  };
}

export function serializeCourse(c: any, plans: any[], opts: { curriculum?: boolean; admin?: boolean } = {}) {
  const visible = plans.filter((p) => opts.admin || p.is_active);
  const durationOptions = Object.fromEntries(visible.map((p) => [p.code, serializePlan(p)]));
  const active = visible.filter((p) => p.is_active);
  const out: Record<string, any> = {
    slug: c.slug, name: c.name, shortName: c.short_name || c.name, domain: c.domain, domainLabel: c.domain_label ?? "",
    summary: c.summary, detailedDescription: c.detailed_description ?? "", technologies: c.technologies,
    primaryStack: c.primary_stack, targetDegrees: c.target_degrees, featured: c.featured,
    availableBatches: c.available_timings, startingPriceINR: active.length ? Math.min(...active.map((p) => Number(p.price_inr))) : 0,
    durationOptions, capstone: c.capstone,
  };
  if (opts.curriculum) out.curriculum = c.curriculum;
  if (opts.admin) Object.assign(out, { id: c.id, code: c.code, status: c.status, thumbnailUrl: c.thumbnail_url, updatedAt: c.updated_at, createdAt: c.created_at });
  return out;
}

export async function loadCourses(where = "TRUE", params: any[] = [], db: Db = undefined as any) {
  const courses = await q(
    `SELECT c.*, d.label AS domain_label FROM courses c JOIN domains d ON d.slug = c.domain
     WHERE ${where} ORDER BY c.featured DESC, c.created_at ASC, c.id ASC`, params, db);
  if (!courses.length) return [];
  const plans = await q(`SELECT * FROM course_plans WHERE course_id = ANY($1) ORDER BY sort_order, days`, [courses.map((c) => c.id)], db);
  return courses.map((c) => ({ row: c, plans: plans.filter((p) => p.course_id === c.id) }));
}

/* ───────────── admin write model (same JSON shape the existing CourseForm already posts) ───────────── */
const planSchema = z.object({
  label: z.string().trim().min(1), tierName: z.string().optional().nullable(), days: z.coerce.number().int().positive(),
  sessions: z.coerce.number().int().min(0).default(0), labHours: z.coerce.number().int().min(0).default(0),
  priceINR: z.coerce.number().min(0), originalPriceINR: z.coerce.number().min(0).default(0),
  discountPercent: z.coerce.number().int().min(0).max(100).optional(),
  academicSupportEligible: z.boolean().default(false), lorEligible: z.boolean().default(false), ppoEligible: z.boolean().default(false),
  synopsisPages: z.coerce.number().int().min(0).default(0), features: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
}).passthrough();

export const courseSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug may only contain lowercase letters, numbers and hyphens."),
  code: z.string().trim().toUpperCase().max(8).optional(),
  name: z.string().trim().min(2), shortName: z.string().trim().optional().nullable(),
  domain: z.string().trim().min(1), summary: z.string().trim().min(1),
  detailedDescription: z.string().optional().nullable(),
  technologies: z.array(z.string()).default([]), primaryStack: z.array(z.string()).default([]),
  targetDegrees: z.array(z.string()).default([]), availableBatches: z.array(z.string()).default([]),
  featured: z.boolean().default(false), status: z.enum(["draft", "active", "archived"]).default("draft"),
  thumbnailUrl: z.string().url().optional().nullable(),
  durationOptions: z.record(z.string(), planSchema).default({}),
  capstone: z.record(z.string(), z.any()).default({}),
  curriculum: z.record(z.string(), z.any()).default({}),
});
export type CourseInput = z.infer<typeof courseSchema>;

export async function saveCourse(input: CourseInput, opts: { id?: number; userId: number }): Promise<string> {
  return tx(async (c) => {
    if (!(await one(`SELECT 1 FROM domains WHERE slug=$1`, [input.domain], c))) throw new ApiError(422, `Unknown domain "${input.domain}".`);
    const code = input.code || courseCodeFromSlug(input.slug);
    const vals = [input.slug, code, input.name, input.shortName ?? null, input.domain, input.summary, input.detailedDescription ?? null,
      JSON.stringify(input.technologies), JSON.stringify(input.primaryStack), JSON.stringify(input.targetDegrees),
      JSON.stringify(input.availableBatches), JSON.stringify(input.capstone), JSON.stringify(input.curriculum),
      input.featured, input.status, input.thumbnailUrl ?? null];
    let courseId = opts.id;
    if (courseId) {
      const r = await q(`UPDATE courses SET slug=$1,code=$2,name=$3,short_name=$4,domain=$5,summary=$6,detailed_description=$7,
        technologies=$8,primary_stack=$9,target_degrees=$10,available_timings=$11,capstone=$12,curriculum=$13,featured=$14,
        status=$15,thumbnail_url=$16 WHERE id=$17 RETURNING id`, [...vals, courseId], c);
      if (!r.length) throw notFound("Course not found.");
    } else {
      const r = await q(`INSERT INTO courses(slug,code,name,short_name,domain,summary,detailed_description,technologies,primary_stack,
        target_degrees,available_timings,capstone,curriculum,featured,status,thumbnail_url,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`, [...vals, opts.userId], c);
      courseId = r[0].id;
    }
    // plans: upsert the posted ones, deactivate (never hard-delete) those removed so history & enrolments stay intact
    const codes = Object.keys(input.durationOptions);
    let order = 0;
    for (const [pcode, p] of Object.entries(input.durationOptions)) {
      const discount = p.discountPercent ?? (p.originalPriceINR > 0 ? Math.max(0, Math.round(100 - (p.priceINR / p.originalPriceINR) * 100)) : 0);
      await q(`INSERT INTO course_plans(course_id,code,label,tier_name,days,sessions,lab_hours,price_inr,original_price_inr,discount_percent,
          academic_support_eligible,lor_eligible,ppo_eligible,synopsis_pages,features,is_active,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (course_id,code) DO UPDATE SET label=EXCLUDED.label,tier_name=EXCLUDED.tier_name,days=EXCLUDED.days,
          sessions=EXCLUDED.sessions,lab_hours=EXCLUDED.lab_hours,price_inr=EXCLUDED.price_inr,original_price_inr=EXCLUDED.original_price_inr,
          discount_percent=EXCLUDED.discount_percent,academic_support_eligible=EXCLUDED.academic_support_eligible,
          lor_eligible=EXCLUDED.lor_eligible,ppo_eligible=EXCLUDED.ppo_eligible,synopsis_pages=EXCLUDED.synopsis_pages,
          features=EXCLUDED.features,is_active=EXCLUDED.is_active,sort_order=EXCLUDED.sort_order`,
        [courseId, pcode, p.label, p.tierName ?? null, p.days, p.sessions, p.labHours, p.priceINR, p.originalPriceINR, discount,
         p.academicSupportEligible, p.lorEligible, p.ppoEligible, p.synopsisPages, JSON.stringify(p.features), p.isActive, order++], c);
    }
    await q(`UPDATE course_plans SET is_active=false WHERE course_id=$1 AND NOT (code = ANY($2))`, [courseId, codes], c);
    const slug = await one<{ slug: string }>(`SELECT slug FROM courses WHERE id=$1`, [courseId], c);
    return slug!.slug;
  });
}
