import { Router } from "express";
import { z } from "zod";
import { one, q } from "../db.js";
import { notFound, ok, parse, qs, zEmail } from "../lib/http.js";
import { formLimiter } from "../lib/limits.js";
import { loadCourses, serializeCourse } from "../services/catalog.js";

export const publicRouter = Router();

publicRouter.get("/health", async (_req, res) => {
  const t = await one(`SELECT now() AS time`);
  res.json({ status: "ok", database: "connected", time: t!.time });
});

publicRouter.get("/tracks", async (req, res) => {
  const full = req.query.include_curriculum === "1";
  const list = await loadCourses("c.status='active'");
  ok(res, list.map((x) => serializeCourse(x.row, x.plans, { curriculum: full })));
});
publicRouter.get("/tracks/:slug", async (req, res) => {
  const [x] = await loadCourses("c.slug=$1 AND c.status='active'", [req.params.slug]);
  if (!x) throw notFound("Course not found.");
  ok(res, serializeCourse(x.row, x.plans, { curriculum: true }));
});

publicRouter.get("/domains", async (_req, res) => {
  const rows = await q(`SELECT d.slug AS id, d.label, count(c.id)::int AS track_count FROM domains d
                        LEFT JOIN courses c ON c.domain=d.slug AND c.status='active' GROUP BY d.id ORDER BY d.sort_order, d.id`);
  ok(res, rows.map((r) => ({ ...r, count_text: `${r.track_count} ${r.track_count === 1 ? "Course" : "Courses"}` })));
});

/** Daily time-slots (legacy "batches" endpoint used by the course page). */
publicRouter.get("/batches", async (_req, res) => {
  const rows = await q(`SELECT timing_id AS id, time_label, name, status, suitable_for FROM batch_timings ORDER BY id`);
  ok(res, rows);
});

/** Open, scheduled batches for a course – lets students see real start dates and free seats before paying. */
publicRouter.get("/courses/:slug/batches", async (req, res) => {
  const rows = await q(
    `SELECT b.id, b.code, b.timing_id, bt.time_label, b.start_date, b.end_date, b.schedule_days, b.status, b.seat_limit,
            GREATEST(b.seat_limit - (SELECT count(*) FROM enrollments e WHERE e.batch_id=b.id AND e.status IN ('active','completed','suspended')),0)::int AS seats_left
     FROM batches b JOIN courses c ON c.id=b.course_id JOIN batch_timings bt ON bt.timing_id=b.timing_id
     WHERE c.slug=$1 AND NOT b.archived AND b.status IN ('open','upcoming') ORDER BY b.start_date NULLS LAST, b.id`, [req.params.slug]);
  ok(res, rows);
});

publicRouter.get("/credentials/verify/:id", async (req, res) => {
  const c = await one(`SELECT * FROM credentials WHERE credential_id=$1`, [req.params.id.trim().toUpperCase()]);
  if (!c) return void res.status(404).json({ verified: false, message: "No credential found with this ID." });
  const revoked = c.verification_status === "REVOKED";
  res.json({
    verified: true,
    message: revoked ? "This credential has been revoked." : "Credential verified.",
    data: {
      id: c.credential_id, studentName: c.student_name, studentInitials: c.student_initials ?? "", degree: c.degree ?? "",
      collegeName: c.college_name ?? "", trackSlug: c.track_slug ?? "", trackName: c.track_name ?? "", duration: c.duration,
      durationDays: c.duration_days, issueDate: c.issue_date ?? "", verificationStatus: c.verification_status,
      verifiedAt: c.verified_at ?? "", skills: c.skills ?? [], githubUrl: c.github_url ?? "", liveDeploymentUrl: c.live_deployment_url ?? "",
      capstoneTitle: c.capstone_title ?? "", capstoneDescription: c.capstone_description ?? undefined, lorQualified: c.lor_qualified,
      ppoQualified: c.ppo_qualified,
      scoreBreakdown: { codeQuality: c.code_quality, milestoneSprints: c.milestone_sprints, technicalInterview: c.technical_interview, totalScore: c.total_score },
      verifiedBy: c.verified_by ?? "",
    },
  });
});

const contactSchema = z.object({
  fullName: z.string().trim().min(2).max(255), mobileNumber: z.string().trim().min(6).max(30), email: zEmail,
  interestedCourse: z.string().trim().max(255).optional().nullable(), message: z.string().trim().max(3000).optional().nullable(),
  enquiryCategory: z.enum(["course", "internship", "enrollment"]).optional().nullable(),
});
publicRouter.post("/inquiries/contact", formLimiter, async (req, res) => {
  const b = parse(contactSchema, req.body);
  await q(`INSERT INTO inquiries(type,name,email,phone,enquiry_category,interested_course,message) VALUES ('contact',$1,$2,$3,$4,$5,$6)`,
    [b.fullName, b.email, b.mobileNumber, b.enquiryCategory ?? null, b.interestedCourse ?? null, b.message ?? null]);
  res.status(201).json({ message: "Thanks! Our team will reach out shortly." });
});

const collegeSchema = z.object({
  institutionName: z.string().trim().min(2).max(255), contactPerson: z.string().trim().min(2).max(255), designation: z.string().trim().max(255),
  officialEmail: zEmail, phone: z.string().trim().min(6).max(30), numberOfStudents: z.string().trim().max(50),
  preferredTechnology: z.string().trim().max(255), preferredDuration: z.string().trim().max(50),
  preferredTrainingWindow: z.string().trim().max(255), message: z.string().trim().max(3000).optional().nullable(),
});
publicRouter.post("/inquiries/college", formLimiter, async (req, res) => {
  const b = parse(collegeSchema, req.body);
  await q(`INSERT INTO inquiries(type,name,email,phone,interested_course,institution_name,designation,number_of_students,preferred_duration,preferred_training_window,message)
           VALUES ('college',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [b.contactPerson, b.officialEmail, b.phone, b.preferredTechnology, b.institutionName, b.designation, b.numberOfStudents, b.preferredDuration, b.preferredTrainingWindow, b.message ?? null]);
  res.status(201).json({ message: "Thanks! Our partnerships team will contact you." });
});
export { qs };
