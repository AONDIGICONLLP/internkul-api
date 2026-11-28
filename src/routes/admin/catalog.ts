import { Router } from "express";
import { z } from "zod";
import { one, q, tx } from "../../db.js";
import { conflict, idParam, notFound, ok, parse, qs, zUrl } from "../../lib/http.js";
import { logReq } from "../../lib/activity.js";
import { loadCourses, saveCourse, serializeCourse, courseSchema } from "../../services/catalog.js";
import { assignToBatch } from "../../services/enrollment.js";
import { BATCH_SELECT } from "../tutor.js";

export const adminCatalog = Router();

/* ───────────── courses (also reachable as /admin/tracks for the legacy UI) ───────────── */
const getCourse = async (slug: string) => {
  const [x] = await loadCourses("c.slug=$1", [slug]);
  if (!x) throw notFound("Course not found.");
  return serializeCourse(x.row, x.plans, { admin: true, curriculum: true });
};
for (const base of ["/courses", "/tracks"]) {
  adminCatalog.get(base, async (req, res) => {
    const list = await loadCourses(qs(req, "status") ? "c.status=$1" : "TRUE", qs(req, "status") ? [qs(req, "status")] : []);
    const counts = await q(`SELECT course_id, count(*) FILTER (WHERE status IN ('active','completed'))::int AS students FROM enrollments GROUP BY course_id`);
    ok(res, list.map((x) => ({ ...serializeCourse(x.row, x.plans, { admin: true, curriculum: req.query.include_curriculum === "1" }), enrolledStudents: counts.find((c) => c.course_id === x.row.id)?.students ?? 0 })));
  });
  adminCatalog.get(`${base}/:slug`, async (req, res) => ok(res, await getCourse(String(req.params.slug))));
  adminCatalog.post(base, async (req, res) => {
    const slug = await saveCourse(parse(courseSchema, req.body), { userId: req.user!.id });
    await logReq(req, "course.created", { entityType: "course", entityId: slug });
    ok(res, await getCourse(slug), {}, 201);
  });
  adminCatalog.put(`${base}/:slug`, async (req, res) => {
    const cur = await one(`SELECT id FROM courses WHERE slug=$1`, [req.params.slug]);
    if (!cur) throw notFound("Course not found.");
    const slug = await saveCourse(parse(courseSchema, { slug: req.params.slug, ...req.body }), { id: cur.id, userId: req.user!.id });
    await logReq(req, "course.updated", { entityType: "course", entityId: slug });
    ok(res, await getCourse(slug));
  });
  adminCatalog.patch(`${base}/:slug/status`, async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(["draft", "active", "archived"]) }), req.body);
    const r = await q(`UPDATE courses SET status=$2 WHERE slug=$1 RETURNING slug`, [req.params.slug, status]);
    if (!r.length) throw notFound("Course not found.");
    await logReq(req, "course.status", { entityType: "course", entityId: req.params.slug as string, meta: { status } });
    ok(res, await getCourse(String(req.params.slug)));
  });
  adminCatalog.delete(`${base}/:slug`, async (req, res) => {
    const c = await one(`SELECT id FROM courses WHERE slug=$1`, [req.params.slug]);
    if (!c) throw notFound("Course not found.");
    const used = await one(`SELECT count(*)::int n FROM enrollments WHERE course_id=$1`, [c.id]);
    if (used!.n > 0) {            // never destroy history: archive instead
      await q(`UPDATE courses SET status='archived' WHERE id=$1`, [c.id]);
      return void res.json({ message: "This course has enrolments, so it was archived instead of deleted.", archived: true });
    }
    await q(`DELETE FROM courses WHERE id=$1`, [c.id]);
    await logReq(req, "course.deleted", { entityType: "course", entityId: req.params.slug as string });
    res.json({ message: "Course deleted." });
  });
}

/* ───────────── time-slots & domains ───────────── */
const timingSchema = z.object({
  timingId: z.string().trim().regex(/^\d{2}:\d{2}_(AM|PM)$/, "Use the format 07:30_AM."), timeLabel: z.string().trim().min(1), name: z.string().trim().min(1),
  status: z.enum(["OPEN", "FILLING_FAST", "CLOSED"]).default("OPEN"), suitableFor: z.string().trim().optional().nullable(),
});
adminCatalog.get("/timings", async (_req, res) => ok(res, await q(`SELECT * FROM batch_timings ORDER BY id`)));
adminCatalog.post("/timings", async (req, res) => {
  const b = parse(timingSchema, req.body);
  ok(res, await one(`INSERT INTO batch_timings(timing_id,time_label,name,status,suitable_for) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [b.timingId, b.timeLabel, b.name, b.status, b.suitableFor ?? null]), {}, 201);
});
adminCatalog.put("/timings/:id", async (req, res) => {
  const b = parse(timingSchema.partial(), req.body);
  const r = await one(`UPDATE batch_timings SET time_label=COALESCE($2,time_label), name=COALESCE($3,name), status=COALESCE($4,status), suitable_for=COALESCE($5,suitable_for) WHERE id=$1 RETURNING *`,
    [idParam(req), b.timeLabel ?? null, b.name ?? null, b.status ?? null, b.suitableFor ?? null]);
  if (!r) throw notFound("Time-slot not found."); ok(res, r);
});
adminCatalog.delete("/timings/:id", async (req, res) => {
  await q(`DELETE FROM batch_timings WHERE id=$1`, [idParam(req)]); res.json({ message: "Time-slot deleted." });
});
adminCatalog.get("/domains", async (_req, res) => ok(res, await q(`SELECT d.*, (SELECT count(*)::int FROM courses c WHERE c.domain=d.slug) AS course_count FROM domains d ORDER BY sort_order, id`)));
adminCatalog.post("/domains", async (req, res) => {
  const b = parse(z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/), label: z.string().trim().min(2), sortOrder: z.coerce.number().int().default(0) }), req.body);
  ok(res, await one(`INSERT INTO domains(slug,label,sort_order) VALUES ($1,$2,$3) RETURNING *`, [b.slug, b.label, b.sortOrder]), {}, 201);
});
adminCatalog.put("/domains/:id", async (req, res) => {
  const b = parse(z.object({ label: z.string().trim().min(2).optional(), sortOrder: z.coerce.number().int().optional() }), req.body);
  const r = await one(`UPDATE domains SET label=COALESCE($2,label), sort_order=COALESCE($3,sort_order) WHERE id=$1 RETURNING *`, [idParam(req), b.label ?? null, b.sortOrder ?? null]);
  if (!r) throw notFound("Domain not found."); ok(res, r);
});
adminCatalog.delete("/domains/:id", async (req, res) => { await q(`DELETE FROM domains WHERE id=$1`, [idParam(req)]); res.json({ message: "Domain deleted." }); });

/* ───────────── batches ───────────── */
const batchSchema = z.object({
  courseId: z.coerce.number().int().positive(), planId: z.coerce.number().int().positive().nullable().optional(), timingId: z.string().min(1),
  tutorId: z.coerce.number().int().positive().nullable().optional(), name: z.string().trim().max(120).nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal("").transform(() => null)),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal("").transform(() => null)),
  scheduleDays: z.array(z.coerce.number().int().min(1).max(7)).min(1).default([1, 2, 3, 4, 5]), seatLimit: z.coerce.number().int().min(1).max(1000).default(30),
  status: z.enum(["upcoming", "open", "ongoing", "completed", "cancelled"]).default("open"), meetingUrl: zUrl, notes: z.string().max(2000).nullable().optional(), archived: z.boolean().optional(),
});

async function validateBatchRefs(b: z.infer<typeof batchSchema>) {
  const c = await one(`SELECT code FROM courses WHERE id=$1`, [b.courseId]);
  if (!c) throw notFound("Course not found.");
  if (!(await one(`SELECT 1 FROM batch_timings WHERE timing_id=$1`, [b.timingId]))) throw notFound("Time-slot not found.");
  if (b.planId && !(await one(`SELECT 1 FROM course_plans WHERE id=$1 AND course_id=$2`, [b.planId, b.courseId]))) throw conflict("That duration plan does not belong to this course.");
  if (b.tutorId && !(await one(`SELECT 1 FROM users WHERE id=$1 AND role='tutor' AND is_active`, [b.tutorId]))) throw conflict("Selected tutor is not an active tutor.");
  return c.code as string;
}
async function uniqueBatchCode(courseCode: string, timingId: string, start?: string | null) {
  const base = `${courseCode}-${timingId.replace(/\D/g, "").slice(0, 4)}${timingId.slice(-2)}-${start ? start.replace(/-/g, "").slice(2) : "TBD"}`;
  let code = base, n = 1;
  while (await one(`SELECT 1 FROM batches WHERE code=$1`, [code])) code = `${base}-${++n}`;
  return code;
}

adminCatalog.get("/batches", async (req, res) => {
  const w: string[] = ["TRUE"], p: any[] = [];
  const add = (cond: string, v: any) => { p.push(v); w.push(cond.replace("?", `$${p.length}`)); };
  if (qs(req, "course_id")) add("b.course_id=?", Number(qs(req, "course_id")));
  if (qs(req, "tutor_id")) add("b.tutor_id=?", Number(qs(req, "tutor_id")));
  if (qs(req, "status")) add("b.status=?", qs(req, "status"));
  if (qs(req, "archived") !== "1") w.push("NOT b.archived");
  ok(res, await q(`${BATCH_SELECT} WHERE ${w.join(" AND ")} ORDER BY b.start_date DESC NULLS LAST, b.id DESC`, p));
});
adminCatalog.get("/batches/:id", async (req, res) => {
  const b = await one(`${BATCH_SELECT} WHERE b.id=$1`, [idParam(req)]);
  if (!b) throw notFound("Batch not found."); ok(res, b);
});
adminCatalog.post("/batches", async (req, res) => {
  const b = parse(batchSchema, req.body), code = await validateBatchRefs(b);
  const r = await one(`INSERT INTO batches(code,name,course_id,plan_id,timing_id,tutor_id,start_date,end_date,schedule_days,seat_limit,status,meeting_url,notes,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [await uniqueBatchCode(code, b.timingId, b.startDate), b.name ?? null, b.courseId, b.planId ?? null, b.timingId, b.tutorId ?? null, b.startDate ?? null, b.endDate ?? null,
     b.scheduleDays, b.seatLimit, b.status, b.meetingUrl ?? null, b.notes ?? null, req.user!.id]);
  await logReq(req, "batch.created", { entityType: "batch", entityId: r.id });
  ok(res, await one(`${BATCH_SELECT} WHERE b.id=$1`, [r.id]), {}, 201);
});
adminCatalog.put("/batches/:id", async (req, res) => {
  const id = idParam(req), cur = await one(`SELECT * FROM batches WHERE id=$1`, [id]);
  if (!cur) throw notFound("Batch not found.");
  const b = parse(batchSchema, { courseId: cur.course_id, timingId: cur.timing_id, ...req.body });
  if (b.courseId !== cur.course_id && (await one(`SELECT 1 FROM enrollments WHERE batch_id=$1`, [id]))) throw conflict("The course cannot be changed once students are in the batch.");
  await validateBatchRefs(b);
  const taken = (await one<{ n: number }>(`SELECT count(*)::int n FROM enrollments WHERE batch_id=$1 AND status IN ('active','completed','suspended')`, [id]))!.n;
  if (b.seatLimit < taken) throw conflict(`Seat limit cannot be below the ${taken} students already enrolled.`);
  await q(`UPDATE batches SET name=$2,course_id=$3,plan_id=$4,timing_id=$5,tutor_id=$6,start_date=$7,end_date=$8,schedule_days=$9,seat_limit=$10,status=$11,meeting_url=$12,notes=$13,archived=COALESCE($14,archived) WHERE id=$1`,
    [id, b.name ?? null, b.courseId, b.planId ?? null, b.timingId, b.tutorId ?? null, b.startDate ?? null, b.endDate ?? null, b.scheduleDays, b.seatLimit, b.status, b.meetingUrl ?? null, b.notes ?? null, b.archived ?? null]);
  await logReq(req, "batch.updated", { entityType: "batch", entityId: id });
  ok(res, await one(`${BATCH_SELECT} WHERE b.id=$1`, [id]));
});
adminCatalog.delete("/batches/:id", async (req, res) => {
  const id = idParam(req);
  if ((await one(`SELECT 1 FROM enrollments WHERE batch_id=$1`, [id]))) {
    await q(`UPDATE batches SET archived=true WHERE id=$1`, [id]);
    return void res.json({ message: "The batch has students, so it was archived instead of deleted.", archived: true });
  }
  await q(`DELETE FROM batches WHERE id=$1`, [id]); res.json({ message: "Batch deleted." });
});
adminCatalog.post("/batches/:id/assign", async (req, res) => {
  const id = idParam(req), b = parse(z.object({ enrollmentId: z.coerce.number().int(), force: z.boolean().default(false) }), req.body);
  await tx((c) => assignToBatch(b.enrollmentId, id, c, { force: b.force }));
  await logReq(req, "batch.assigned", { enrollmentId: b.enrollmentId, entityType: "batch", entityId: id });
  res.json({ message: "Student assigned to batch." });
});
adminCatalog.post("/batches/:id/unassign", async (req, res) => {
  const b = parse(z.object({ enrollmentId: z.coerce.number().int() }), req.body);
  await q(`UPDATE enrollments SET batch_id=NULL WHERE id=$1 AND batch_id=$2`, [b.enrollmentId, idParam(req)]);
  res.json({ message: "Student removed from batch." });
});
