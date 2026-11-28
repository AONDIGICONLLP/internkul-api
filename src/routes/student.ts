import { Router } from "express";
import { z } from "zod";
import { one, q, tx } from "../db.js";
import { ApiError, conflict, idParam, notFound, ok, parse, qs, zUrl } from "../lib/http.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { logReq } from "../lib/activity.js";
import { notify } from "../lib/notify.js";
import { assignToBatch, seatsTakenSql } from "../services/enrollment.js";
import { eligibility } from "../services/certificates.js";
import { listStudentDocuments } from "../services/documents.js";
import { buildStudentProfile } from "../services/profile.js";

export const studentRouter = Router();
studentRouter.use(authenticate, requireRole("student"));

const ENROLL_SELECT = `
  SELECT e.id, e.status, e.progress_percent, e.tutor_remarks, e.enrolled_at, e.completed_at, e.timing_id, e.amount_due,
         c.id AS course_id, c.name AS course_name, c.slug AS course_slug, c.code AS course_code, c.thumbnail_url,
         p.label AS plan_label, p.days AS plan_days, p.features AS plan_features, bt.time_label,
         b.id AS batch_id, b.code AS batch_code, b.status AS batch_status, b.start_date, b.end_date, b.schedule_days, b.meeting_url, t.name AS tutor_name,
         va.attendance_percent, va.attended_sessions, va.counted_sessions,
         (SELECT status FROM certificate_requests r WHERE r.enrollment_id=e.id ORDER BY r.created_at DESC LIMIT 1) AS certificate_status,
         cr.credential_id
  FROM enrollments e JOIN courses c ON c.id=e.course_id LEFT JOIN course_plans p ON p.id=e.plan_id
  LEFT JOIN batch_timings bt ON bt.timing_id=e.timing_id LEFT JOIN batches b ON b.id=e.batch_id LEFT JOIN users t ON t.id=b.tutor_id
  LEFT JOIN v_enrollment_attendance va ON va.enrollment_id=e.id LEFT JOIN credentials cr ON cr.enrollment_id=e.id`;

async function myEnrollment(studentId: number, id: number) {
  const e = await one(`${ENROLL_SELECT} WHERE e.id=$1 AND e.student_id=$2`, [id, studentId]);
  if (!e) throw notFound("Course not found.");
  return e;
}

studentRouter.get("/dashboard", async (req, res) => {
  const uid = req.user!.id;
  const [courses, sessions, announcements, notices, unread] = await Promise.all([
    q(`${ENROLL_SELECT} WHERE e.student_id=$1 AND e.status IN ('active','completed','suspended') ORDER BY e.enrolled_at DESC`, [uid]),
    q(`SELECT s.id, s.title, s.starts_at, s.duration_minutes, COALESCE(s.meeting_url,b.meeting_url) AS meeting_url, c.name AS course_name, b.code AS batch_code
       FROM class_sessions s JOIN batches b ON b.id=s.batch_id JOIN courses c ON c.id=b.course_id
       WHERE s.status='scheduled' AND s.starts_at>now() - interval '1 hour' AND EXISTS (SELECT 1 FROM enrollments e WHERE e.batch_id=b.id AND e.student_id=$1 AND e.status='active')
       ORDER BY s.starts_at LIMIT 5`, [uid]),
    q(`SELECT a.id, a.title, a.body, a.created_at, a.pinned, b.code AS batch_code, u.name AS author_name FROM announcements a JOIN batches b ON b.id=a.batch_id LEFT JOIN users u ON u.id=a.author_id
       WHERE EXISTS (SELECT 1 FROM enrollments e WHERE e.batch_id=b.id AND e.student_id=$1 AND e.status IN ('active','completed')) ORDER BY a.pinned DESC, a.created_at DESC LIMIT 5`, [uid]),
    q(`SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5`, [uid]),
    one(`SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND read_at IS NULL`, [uid]),
  ]);
  const pending = await q(`SELECT e.id, c.name AS course_name, e.amount_due FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.student_id=$1 AND e.status='pending_payment'`, [uid]);
  ok(res, { courses, upcomingSessions: sessions, announcements, notifications: notices, unreadCount: unread!.n, pendingPayments: pending,
            awaitingBatch: courses.filter((c) => c.status === "active" && !c.batch_id).length });
});

studentRouter.get("/enrollments", async (req, res) => {
  ok(res, await q(`${ENROLL_SELECT} WHERE e.student_id=$1 AND e.status NOT IN ('pending_payment') ORDER BY e.enrolled_at DESC`, [req.user!.id]));
});

studentRouter.get("/enrollments/:id", async (req, res) => {
  const uid = req.user!.id, id = idParam(req), e = await myEnrollment(uid, id);
  const [course, sessions, attendance, documents, announcements, payments, request, cert, elig] = await Promise.all([
    one(`SELECT summary, detailed_description, technologies, capstone, curriculum FROM courses WHERE id=$1`, [e.course_id]),
    e.batch_id ? q(`SELECT id,title,description,starts_at,duration_minutes,COALESCE(meeting_url,$2) AS meeting_url,status FROM class_sessions WHERE batch_id=$1 AND status<>'cancelled' ORDER BY starts_at`, [e.batch_id, e.meeting_url]) : [],
    q(`SELECT session_id, status, note FROM attendance WHERE enrollment_id=$1`, [id]),
    listStudentDocuments(uid, { enrollmentId: id }),
    e.batch_id ? q(`SELECT a.id,a.title,a.body,a.pinned,a.created_at,u.name AS author_name FROM announcements a LEFT JOIN users u ON u.id=a.author_id WHERE a.batch_id=$1 ORDER BY a.pinned DESC,a.created_at DESC LIMIT 20`, [e.batch_id]) : [],
    q(`SELECT id,receipt_no,status,amount,refunded_amount,method,paid_at FROM payments WHERE enrollment_id=$1 ORDER BY created_at DESC`, [id]),
    one(`SELECT * FROM certificate_requests WHERE enrollment_id=$1 ORDER BY created_at DESC LIMIT 1`, [id]),
    one(`SELECT credential_id, issue_date, verification_status FROM credentials WHERE enrollment_id=$1`, [id]),
    eligibility(id),
  ]);
  await logReq(req, "course.viewed", { enrollmentId: id, entityType: "course", entityId: e.course_slug });
  ok(res, { enrollment: e, course, sessions, attendance, documents, announcements, payments, certificateRequest: request, credential: cert, certificateEligibility: elig });
});

/** Students without a batch yet (or with the seat still flexible) can choose from open batches of their course. */
studentRouter.get("/enrollments/:id/batch-options", async (req, res) => {
  const e = await myEnrollment(req.user!.id, idParam(req));
  ok(res, await q(
    `SELECT b.id, b.code, b.timing_id, bt.time_label, b.start_date, b.end_date, b.schedule_days, b.status, b.seat_limit, t.name AS tutor_name,
            GREATEST(b.seat_limit - ${seatsTakenSql}, 0)::int AS seats_left
     FROM batches b JOIN batch_timings bt ON bt.timing_id=b.timing_id LEFT JOIN users t ON t.id=b.tutor_id
     WHERE b.course_id=$1 AND NOT b.archived AND b.status IN ('open','upcoming') AND (b.plan_id IS NULL OR b.plan_id=$2)
     ORDER BY (b.timing_id = $3) DESC, b.start_date NULLS LAST`, [e.course_id, (await one(`SELECT plan_id FROM enrollments WHERE id=$1`, [e.id]))!.plan_id, e.timing_id]));
});
studentRouter.post("/enrollments/:id/select-batch", async (req, res) => {
  const id = idParam(req), { batchId } = parse(z.object({ batchId: z.coerce.number().int().positive() }), req.body);
  const e = await myEnrollment(req.user!.id, id);
  if (e.status !== "active") throw conflict("Only active enrollments can choose a batch.");
  if (e.batch_id) throw conflict("You are already in a batch. Contact support to request a change.");
  await tx((c) => assignToBatch(id, batchId, c, { selfService: true }));
  await logReq(req, "batch.selected", { enrollmentId: id, entityType: "batch", entityId: batchId });
  ok(res, await myEnrollment(req.user!.id, id));
});

studentRouter.get("/documents", async (req, res) => ok(res, await listStudentDocuments(req.user!.id, { search: qs(req, "search") })));

/* ── certificate: completion form ── */
const completionSchema = z.object({
  nameOnCertificate: z.string().trim().min(2, "Enter the name as it should appear.").max(120), collegeName: z.string().trim().max(255).optional().nullable(),
  degree: z.string().trim().max(120).optional().nullable(), githubUrl: zUrl, liveDeploymentUrl: zUrl,
  capstoneTitle: z.string().trim().max(255).optional().nullable(), capstoneDescription: z.string().trim().max(3000).optional().nullable(),
  skills: z.array(z.string().trim().min(1).max(40)).max(25).default([]),
  feedbackRating: z.coerce.number().int().min(1).max(5), feedbackText: z.string().trim().max(2000).optional().nullable(),
  declarationAccepted: z.literal(true, { message: "Please accept the declaration." }),
});
studentRouter.post("/enrollments/:id/certificate-request", async (req, res) => {
  const id = idParam(req), uid = req.user!.id;
  await myEnrollment(uid, id);
  const b = parse(completionSchema, req.body);
  const el = await eligibility(id);
  if (!el.eligible) throw new ApiError(409, el.reasons[0]);
  const r = await one(`INSERT INTO certificate_requests(enrollment_id,student_id,name_on_certificate,college_name,degree,github_url,live_deployment_url,capstone_title,capstone_description,skills,feedback_rating,feedback_text,declaration_accepted)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) RETURNING *`,
    [id, uid, b.nameOnCertificate, b.collegeName ?? null, b.degree ?? null, b.githubUrl ?? null, b.liveDeploymentUrl ?? null, b.capstoneTitle ?? null, b.capstoneDescription ?? null, JSON.stringify(b.skills), b.feedbackRating, b.feedbackText ?? null]);
  if (b.collegeName || b.degree) await q(`UPDATE student_profiles SET college=COALESCE($2,college), degree=COALESCE($3,degree) WHERE user_id=$1`, [uid, b.collegeName ?? null, b.degree ?? null]);
  const admins = await q<{ id: number }>(`SELECT id FROM users WHERE role='admin' AND is_active`);
  for (const a of admins) await notify(a.id, { type: "action", title: "New certificate request", body: `${b.nameOnCertificate} submitted the completion form`, link: "/admin/certificates" });
  await logReq(req, "certificate.requested", { enrollmentId: id, entityType: "certificate_request", entityId: r.id });
  ok(res, r, {}, 201);
});
studentRouter.get("/certificates", async (req, res) => {
  const uid = req.user!.id;
  const [requests, credentials] = await Promise.all([
    q(`SELECT r.id, r.status, r.review_notes, r.created_at, r.reviewed_at, c.name AS course_name, r.enrollment_id FROM certificate_requests r JOIN enrollments e ON e.id=r.enrollment_id JOIN courses c ON c.id=e.course_id WHERE r.student_id=$1 ORDER BY r.created_at DESC`, [uid]),
    q(`SELECT credential_id, track_name, duration_days, issue_date, verification_status, total_score FROM credentials WHERE user_id=$1 ORDER BY issue_date DESC`, [uid]),
  ]);
  ok(res, { requests, credentials });
});

studentRouter.get("/payments", async (req, res) => {
  ok(res, await q(`SELECT p.id,p.receipt_no,p.status,p.amount,p.refunded_amount,p.method,p.paid_at,p.created_at,p.razorpay_payment_id,c.name AS course_name,pl.label AS plan_label
                   FROM payments p LEFT JOIN enrollments e ON e.id=p.enrollment_id LEFT JOIN courses c ON c.id=e.course_id LEFT JOIN course_plans pl ON pl.id=e.plan_id
                   WHERE p.student_id=$1 AND p.status<>'created' ORDER BY COALESCE(p.paid_at,p.created_at) DESC`, [req.user!.id]));
});

studentRouter.get("/profile", async (req, res) => ok(res, await buildStudentProfile(req.user!.id)));
studentRouter.put("/profile", async (req, res) => {
  const uid = req.user!.id;
  const b = parse(z.object({
    firstName: z.string().trim().min(1).max(100).optional(), lastName: z.string().trim().max(100).optional().nullable(), phone: z.string().trim().min(6).max(20).optional(),
    college: z.string().trim().max(255).optional().nullable(), degree: z.string().trim().max(120).optional().nullable(),
    permanentAddress: z.string().trim().max(1000).optional().nullable(), interestedTopics: z.array(z.string().max(60)).max(40).optional(),
  }), req.body);
  await tx(async (c) => {
    await q(`UPDATE student_profiles SET first_name=COALESCE($2,first_name), last_name=CASE WHEN $3::boolean THEN $4 ELSE last_name END, college=COALESCE($5,college),
             degree=COALESCE($6,degree), permanent_address=COALESCE($7,permanent_address), interested_topics=COALESCE($8,interested_topics) WHERE user_id=$1`,
      [uid, b.firstName ?? null, b.lastName !== undefined, b.lastName ?? null, b.college ?? null, b.degree ?? null, b.permanentAddress ?? null, b.interestedTopics ? JSON.stringify(b.interestedTopics) : null], c);
    await q(`UPDATE users u SET phone=COALESCE($2,u.phone), name=(SELECT trim(first_name||' '||COALESCE(last_name,'')) FROM student_profiles WHERE user_id=u.id) WHERE u.id=$1`, [uid, b.phone ?? null], c);
  });
  ok(res, await buildStudentProfile(uid));
});
