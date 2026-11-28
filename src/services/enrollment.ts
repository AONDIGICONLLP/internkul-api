import type { PoolClient } from "pg";
import { one, q, type Db } from "../db.js";
import { conflict, notFound } from "../lib/http.js";
import { notify } from "../lib/notify.js";
import { settingsGet } from "../lib/ids.js";

/** Statuses that occupy a seat in a batch. */
export const SEAT_STATUSES = ["active", "completed", "suspended"];
export const seatsTakenSql = `(SELECT count(*)::int FROM enrollments e WHERE e.batch_id = b.id AND e.status IN ('active','completed','suspended'))`;

export async function assignToBatch(enrollmentId: number, batchId: number, c: PoolClient, opts: { force?: boolean; selfService?: boolean } = {}) {
  const b = await one(`SELECT * FROM batches WHERE id=$1 FOR UPDATE`, [batchId], c);   // lock => no overbooking under concurrency
  if (!b || b.archived) throw notFound("Batch not found.");
  const e = await one(`SELECT * FROM enrollments WHERE id=$1 FOR UPDATE`, [enrollmentId], c);
  if (!e) throw notFound("Enrollment not found.");
  if (e.course_id !== b.course_id) throw conflict("This batch belongs to a different course.");
  if (b.plan_id && e.plan_id && b.plan_id !== e.plan_id) throw conflict("This batch is for a different course duration.");
  if (opts.selfService && !["open", "upcoming"].includes(b.status)) throw conflict("This batch is no longer accepting students.");
  if (["completed", "cancelled"].includes(b.status)) throw conflict(`Cannot join a ${b.status} batch.`);
  if (e.batch_id === batchId) return b;
  if (!opts.force) {
    const taken = (await one<{ n: number }>(`SELECT count(*)::int n FROM enrollments WHERE batch_id=$1 AND status IN ('active','completed','suspended') AND id<>$2`, [batchId, enrollmentId], c))!.n;
    if (taken >= b.seat_limit) throw conflict("This batch is full.");
  }
  await q(`UPDATE enrollments SET batch_id=$1, timing_id=$2 WHERE id=$3`, [batchId, b.timing_id, enrollmentId], c);
  return b;
}

/** Picks the earliest open batch (same course + time slot, compatible duration, free seat). Returns batch id or null. */
export async function autoAssign(enrollmentId: number, c: PoolClient): Promise<number | null> {
  if (!(await settingsGet<boolean>("auto_assign_batch", true, c))) return null;
  const e = await one(`SELECT * FROM enrollments WHERE id=$1`, [enrollmentId], c);
  if (!e || e.batch_id || !e.timing_id) return null;
  const candidates = await q<{ id: number }>(
    `SELECT b.id FROM batches b
     WHERE b.course_id=$1 AND b.timing_id=$2 AND NOT b.archived AND b.status IN ('open','upcoming')
       AND (b.plan_id IS NULL OR b.plan_id = $3) AND ${seatsTakenSql} < b.seat_limit
     ORDER BY b.start_date NULLS LAST, b.id LIMIT 5`, [e.course_id, e.timing_id, e.plan_id], c);
  for (const cand of candidates) {
    try { await assignToBatch(enrollmentId, cand.id, c); return cand.id; } catch { /* full / mismatch – try next */ }
  }
  return null;
}

/** Tutor/admin status transitions with side-effects (completion date, notifications). */
export async function setEnrollmentStatus(enrollmentId: number, status: string, db: Db) {
  const e = await one(`SELECT e.*, c.name AS course_name FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.id=$1`, [enrollmentId], db);
  if (!e) throw notFound("Enrollment not found.");
  if (e.status === "pending_payment" && status !== "cancelled") throw conflict("This enrollment has not been paid yet.");
  await q(`UPDATE enrollments SET status=$1, completed_at = CASE WHEN $1='completed' THEN COALESCE(completed_at, now()) ELSE completed_at END,
           progress_percent = CASE WHEN $1='completed' THEN 100 ELSE progress_percent END WHERE id=$2`, [status, enrollmentId], db);
  if (status === "completed" && e.status !== "completed") {
    await notify(e.student_id, { type: "success", title: `Course completed: ${e.course_name}`,
      body: "Congratulations! You can now fill the completion form to apply for your certificate.", link: `/student/courses/${e.id}` }, db);
  } else if (status !== e.status && ["suspended", "dropped"].includes(status)) {
    await notify(e.student_id, { type: "warning", title: `Your enrollment status changed to ${status}`, body: e.course_name, link: `/student/courses/${e.id}` }, db);
  }
  return e.status as string;
}

/** Everything a tutor / admin needs to follow one student's journey in a course. */
export async function enrollmentTrack(enrollmentId: number) {
  const e = await one(
    `SELECT e.*, c.name AS course_name, c.slug AS course_slug, c.code AS course_code, p.label AS plan_label, p.days AS plan_days,
            b.code AS batch_code, b.status AS batch_status, b.start_date, b.end_date, t.name AS tutor_name,
            u.name AS student_name, u.email AS student_email, u.phone AS student_phone, u.last_active_at, u.is_active AS student_active,
            sp.student_code, sp.college, sp.degree,
            va.attendance_percent, va.attended_sessions, va.counted_sessions
     FROM enrollments e
     JOIN courses c ON c.id=e.course_id JOIN users u ON u.id=e.student_id
     LEFT JOIN student_profiles sp ON sp.user_id=u.id
     LEFT JOIN course_plans p ON p.id=e.plan_id
     LEFT JOIN batches b ON b.id=e.batch_id LEFT JOIN users t ON t.id=b.tutor_id
     LEFT JOIN v_enrollment_attendance va ON va.enrollment_id=e.id
     WHERE e.id=$1`, [enrollmentId]);
  if (!e) throw notFound("Enrollment not found.");
  const [attendance, activity, payments, request, credential, docs] = await Promise.all([
    q(`SELECT s.id AS session_id, s.title, s.starts_at, s.status AS session_status, a.status, a.note
       FROM class_sessions s LEFT JOIN attendance a ON a.session_id=s.id AND a.enrollment_id=$1
       WHERE s.batch_id=$2 AND s.status<>'cancelled' ORDER BY s.starts_at DESC LIMIT 60`, [enrollmentId, e.batch_id ?? 0]),
    q(`SELECT id, action, entity_type, entity_id, meta, created_at FROM activity_logs
       WHERE user_id=$1 AND (enrollment_id=$2 OR enrollment_id IS NULL) AND actor_role='student' ORDER BY created_at DESC LIMIT 40`, [e.student_id, enrollmentId]),
    q(`SELECT id, receipt_no, status, amount, refunded_amount, method, paid_at, provider FROM payments WHERE enrollment_id=$1 ORDER BY created_at DESC`, [enrollmentId]),
    q(`SELECT * FROM certificate_requests WHERE enrollment_id=$1 ORDER BY created_at DESC LIMIT 1`, [enrollmentId]),
    one(`SELECT credential_id, verification_status, issue_date FROM credentials WHERE enrollment_id=$1`, [enrollmentId]),
    one(`SELECT count(*)::int n FROM documents d WHERE d.is_published AND ((d.scope='course' AND d.course_id=$1) OR (d.scope='batch' AND d.batch_id=$2)
         OR (d.scope='student' AND EXISTS (SELECT 1 FROM document_recipients r WHERE r.document_id=d.id AND r.enrollment_id=$3)))`, [e.course_id, e.batch_id ?? 0, enrollmentId]),
  ]);
  return { enrollment: e, attendance, activity, payments, certificateRequest: request[0] ?? null, credential, documentCount: docs!.n };
}
