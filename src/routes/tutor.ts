import { Router } from "express";
import { z } from "zod";
import { one, q } from "../db.js";
import { conflict, idParam, notFound, ok, pageOf, paged, parse, qs, zUrl } from "../lib/http.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { logReq } from "../lib/activity.js";
import { batchOps } from "./batchOps.js";
import { seatsTakenSql } from "../services/enrollment.js";

export const tutorRouter = Router();
tutorRouter.use(authenticate, requireRole("tutor"));

export const BATCH_SELECT = `
  SELECT b.id, b.code, b.name, b.status, b.start_date, b.end_date, b.schedule_days, b.seat_limit, b.meeting_url, b.notes, b.timing_id, b.archived,
         bt.time_label, c.id AS course_id, c.name AS course_name, c.slug AS course_slug, b.plan_id, p.label AS plan_label, b.tutor_id, t.name AS tutor_name,
         ${seatsTakenSql} AS enrolled,
         (SELECT count(*)::int FROM class_sessions s WHERE s.batch_id=b.id AND s.status='completed') AS sessions_done,
         (SELECT count(*)::int FROM class_sessions s WHERE s.batch_id=b.id) AS sessions_total
  FROM batches b JOIN courses c ON c.id=b.course_id JOIN batch_timings bt ON bt.timing_id=b.timing_id
  LEFT JOIN course_plans p ON p.id=b.plan_id LEFT JOIN users t ON t.id=b.tutor_id`;

tutorRouter.get("/dashboard", async (req, res) => {
  const id = req.user!.id;
  const [stats, upcoming, attention, batches] = await Promise.all([
    one(`SELECT (SELECT count(*)::int FROM batches WHERE tutor_id=$1 AND NOT archived AND status IN ('open','upcoming','ongoing')) AS active_batches,
                (SELECT count(*)::int FROM enrollments e JOIN batches b ON b.id=e.batch_id WHERE b.tutor_id=$1 AND e.status='active') AS active_students,
                (SELECT count(*)::int FROM enrollments e JOIN batches b ON b.id=e.batch_id WHERE b.tutor_id=$1 AND e.status='completed') AS completed_students,
                (SELECT count(*)::int FROM class_sessions s JOIN batches b ON b.id=s.batch_id WHERE b.tutor_id=$1 AND s.status='scheduled' AND s.starts_at>now()) AS upcoming_sessions`, [id]),
    q(`SELECT s.id, s.title, s.starts_at, s.duration_minutes, s.meeting_url, b.id AS batch_id, b.code AS batch_code, c.name AS course_name
       FROM class_sessions s JOIN batches b ON b.id=s.batch_id JOIN courses c ON c.id=b.course_id
       WHERE b.tutor_id=$1 AND s.status='scheduled' AND s.starts_at>now() - interval '1 hour' ORDER BY s.starts_at LIMIT 6`, [id]),
    // students who may need a nudge: low attendance or inactive for a week
    q(`SELECT e.id AS enrollment_id, u.name, b.id AS batch_id, b.code AS batch_code, va.attendance_percent, u.last_active_at
       FROM enrollments e JOIN batches b ON b.id=e.batch_id JOIN users u ON u.id=e.student_id LEFT JOIN v_enrollment_attendance va ON va.enrollment_id=e.id
       WHERE b.tutor_id=$1 AND e.status='active' AND ((va.attendance_percent IS NOT NULL AND va.attendance_percent<60) OR u.last_active_at IS NULL OR u.last_active_at < now() - interval '7 days')
       ORDER BY va.attendance_percent NULLS LAST LIMIT 8`, [id]),
    q(`${BATCH_SELECT} WHERE b.tutor_id=$1 AND NOT b.archived AND b.status IN ('open','upcoming','ongoing') ORDER BY b.start_date NULLS LAST LIMIT 6`, [id]),
  ]);
  ok(res, { stats, upcomingSessions: upcoming, needsAttention: attention, batches });
});

tutorRouter.get("/batches", async (req, res) => {
  const status = qs(req, "status");
  ok(res, await q(`${BATCH_SELECT} WHERE b.tutor_id=$1 AND NOT b.archived ${status ? "AND b.status=$2" : ""} ORDER BY b.start_date DESC NULLS LAST, b.id DESC`, status ? [req.user!.id, status] : [req.user!.id]));
});
tutorRouter.get("/batches/:id", async (req, res) => {
  const b = await one(`${BATCH_SELECT} WHERE b.id=$1 AND b.tutor_id=$2`, [idParam(req), req.user!.id]);
  if (!b) throw notFound("Batch not found.");
  ok(res, b);
});
tutorRouter.patch("/batches/:id", async (req, res) => {
  const b = parse(z.object({ status: z.enum(["upcoming", "open", "ongoing", "completed"]).optional(), meetingUrl: zUrl, notes: z.string().max(2000).nullable().optional() }), req.body);
  const cur = await one(`SELECT * FROM batches WHERE id=$1 AND tutor_id=$2`, [idParam(req), req.user!.id]);
  if (!cur) throw notFound("Batch not found.");
  if (cur.status === "cancelled") throw conflict("A cancelled batch cannot be changed.");
  await q(`UPDATE batches SET status=COALESCE($2,status), meeting_url=COALESCE($3,meeting_url), notes=COALESCE($4,notes) WHERE id=$1`, [cur.id, b.status ?? null, b.meetingUrl ?? null, b.notes ?? null]);
  await logReq(req, "batch.updated", { entityType: "batch", entityId: cur.id, meta: b });
  ok(res, await one(`${BATCH_SELECT} WHERE b.id=$1`, [cur.id]));
});

/** Every student across the tutor's batches – with filters for quick tracking. */
tutorRouter.get("/students", async (req, res) => {
  const p = pageOf(req), params: any[] = [req.user!.id];
  let where = `b.tutor_id=$1 AND e.status NOT IN ('pending_payment','cancelled')`;
  const s = qs(req, "search"), st = qs(req, "status"), batch = qs(req, "batch_id");
  if (s) { params.push(`%${s}%`); where += ` AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR sp.student_code ILIKE $${params.length})`; }
  if (st) { params.push(st); where += ` AND e.status=$${params.length}`; }
  if (batch) { params.push(Number(batch)); where += ` AND b.id=$${params.length}`; }
  const from = `FROM enrollments e JOIN batches b ON b.id=e.batch_id JOIN users u ON u.id=e.student_id LEFT JOIN student_profiles sp ON sp.user_id=u.id
                JOIN courses c ON c.id=e.course_id LEFT JOIN v_enrollment_attendance va ON va.enrollment_id=e.id WHERE ${where}`;
  const total = (await one<{ n: number }>(`SELECT count(*)::int n ${from}`, params))!.n;
  const rows = await q(`SELECT e.id AS enrollment_id, e.status, e.progress_percent, u.name, u.email, u.phone, u.last_active_at, sp.student_code, b.id AS batch_id, b.code AS batch_code,
                        c.name AS course_name, va.attendance_percent ${from} ORDER BY u.name LIMIT ${p.perPage} OFFSET ${p.offset}`, params);
  paged(res, rows, total, p);
});

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(), phone: z.string().trim().max(20).optional().nullable(), headline: z.string().trim().max(160).optional().nullable(),
  bio: z.string().trim().max(2000).optional().nullable(), qualification: z.string().trim().max(200).optional().nullable(),
  expertise: z.array(z.string().trim().max(40)).max(20).optional(), experienceYears: z.coerce.number().int().min(0).max(60).optional(), linkedinUrl: zUrl,
});
export const tutorProfileQuery = `SELECT u.id, u.name, u.email, u.phone, u.avatar_url, u.is_active, u.last_login_at, tp.tutor_code, tp.headline, tp.bio, tp.expertise, tp.qualification, tp.experience_years, tp.linkedin_url, tp.status
  FROM users u JOIN tutor_profiles tp ON tp.user_id=u.id`;
tutorRouter.get("/profile", async (req, res) => ok(res, await one(`${tutorProfileQuery} WHERE u.id=$1`, [req.user!.id])));
tutorRouter.put("/profile", async (req, res) => {
  const b = parse(profileSchema, req.body), id = req.user!.id;
  await q(`UPDATE users SET name=COALESCE($2,name), phone=COALESCE($3,phone) WHERE id=$1`, [id, b.name ?? null, b.phone ?? null]);
  await q(`UPDATE tutor_profiles SET headline=COALESCE($2,headline), bio=COALESCE($3,bio), qualification=COALESCE($4,qualification),
           expertise=COALESCE($5,expertise), experience_years=COALESCE($6,experience_years), linkedin_url=COALESCE($7,linkedin_url) WHERE user_id=$1`,
    [id, b.headline ?? null, b.bio ?? null, b.qualification ?? null, b.expertise ? JSON.stringify(b.expertise) : null, b.experienceYears ?? null, b.linkedinUrl ?? null]);
  ok(res, await one(`${tutorProfileQuery} WHERE u.id=$1`, [id]));
});

tutorRouter.use("/batches/:batchId", batchOps);
