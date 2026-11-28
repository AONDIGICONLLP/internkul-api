import fs from "node:fs";
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { one, q, tx } from "../db.js";
import { ApiError, forbidden, idParam, notFound, ok, parse, zUrl } from "../lib/http.js";
import { logReq } from "../lib/activity.js";
import { notifyMany } from "../lib/notify.js";
import { upload, relativePath, removeFile } from "../middleware/upload.js";
import { enrollmentTrack, setEnrollmentStatus } from "../services/enrollment.js";

/**
 * Teaching operations on ONE batch. Mounted under /tutor/batches/:batchId and /admin/batches/:batchId.
 * Admins may touch any batch; a tutor only the batches assigned to them.
 */
export const batchOps = Router({ mergeParams: true });

async function loadBatch(req: Request, res: Response, next: NextFunction) {
  const b = await one(`SELECT b.*, c.name AS course_name FROM batches b JOIN courses c ON c.id=b.course_id WHERE b.id=$1`, [idParam(req, "batchId")]);
  if (!b) throw notFound("Batch not found.");
  if (req.user!.role === "tutor" && b.tutor_id !== req.user!.id) throw forbidden("This batch is not assigned to you.");
  res.locals.batch = b;
  next();
}
batchOps.use(loadBatch);
const batchOf = (res: Response) => res.locals.batch as any;

async function enrollmentInBatch(batchId: number, eid: number) {
  const e = await one(`SELECT * FROM enrollments WHERE id=$1 AND batch_id=$2`, [eid, batchId]);
  if (!e) throw notFound("That student is not in this batch.");
  return e;
}

/* ── students ── */
batchOps.get("/students", async (_req, res) => {
  ok(res, await q(
    `SELECT e.id AS enrollment_id, e.status, e.progress_percent, e.tutor_remarks, e.enrolled_at, e.completed_at, u.id AS user_id, u.name, u.email, u.phone,
            u.last_active_at, sp.student_code, va.attendance_percent, va.attended_sessions, va.counted_sessions,
            (SELECT status FROM certificate_requests r WHERE r.enrollment_id=e.id ORDER BY r.created_at DESC LIMIT 1) AS certificate_status
     FROM enrollments e JOIN users u ON u.id=e.student_id LEFT JOIN student_profiles sp ON sp.user_id=u.id
     LEFT JOIN v_enrollment_attendance va ON va.enrollment_id=e.id
     WHERE e.batch_id=$1 AND e.status NOT IN ('pending_payment','cancelled') ORDER BY u.name`, [batchOf(res).id]));
});
batchOps.get("/students/:eid", async (req, res) => {
  await enrollmentInBatch(batchOf(res).id, idParam(req, "eid"));
  ok(res, await enrollmentTrack(idParam(req, "eid")));
});
const statusSchema = z.object({
  status: z.enum(["active", "completed", "suspended", "dropped"]).optional(),
  progressPercent: z.coerce.number().int().min(0).max(100).optional(),
  tutorRemarks: z.string().trim().max(2000).nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, "Nothing to update.");
batchOps.patch("/students/:eid", async (req, res) => {
  const eid = idParam(req, "eid");
  await enrollmentInBatch(batchOf(res).id, eid);
  const b = parse(statusSchema, req.body);
  await tx(async (c) => {
    if (b.progressPercent !== undefined) await q(`UPDATE enrollments SET progress_percent=$2 WHERE id=$1`, [eid, b.progressPercent], c);
    if (b.tutorRemarks !== undefined) await q(`UPDATE enrollments SET tutor_remarks=$2 WHERE id=$1`, [eid, b.tutorRemarks], c);
    if (b.status) await setEnrollmentStatus(eid, b.status, c);
  });
  await logReq(req, "enrollment.updated", { enrollmentId: eid, entityType: "enrollment", entityId: eid, meta: b });
  ok(res, await one(`SELECT id, status, progress_percent, tutor_remarks, completed_at FROM enrollments WHERE id=$1`, [eid]));
});

/* ── sessions & attendance ── */
const sessionSchema = z.object({
  title: z.string().trim().min(2).max(200), description: z.string().trim().max(2000).nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).or(z.string().datetime()), durationMinutes: z.coerce.number().int().min(5).max(600).default(60),
  meetingUrl: zUrl, status: z.enum(["scheduled", "completed", "cancelled"]).optional(),
});
batchOps.get("/sessions", async (_req, res) => {
  ok(res, await q(`SELECT s.*, (SELECT count(*)::int FROM attendance a WHERE a.session_id=s.id AND a.status IN ('present','late')) AS present_count
                   FROM class_sessions s WHERE s.batch_id=$1 ORDER BY s.starts_at DESC`, [batchOf(res).id]));
});
batchOps.post("/sessions", async (req, res) => {
  const b = parse(sessionSchema, req.body), batch = batchOf(res);
  const s = await one(`INSERT INTO class_sessions(batch_id,title,description,starts_at,duration_minutes,meeting_url,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [batch.id, b.title, b.description ?? null, b.startsAt, b.durationMinutes, b.meetingUrl ?? batch.meeting_url, req.user!.id]);
  const ids = (await q<{ student_id: number }>(`SELECT student_id FROM enrollments WHERE batch_id=$1 AND status='active'`, [batch.id])).map((r) => r.student_id);
  await notifyMany(ids, { type: "info", title: `New class: ${b.title}`, body: `${batch.course_name} · ${new Date(b.startsAt).toLocaleString("en-IN")}`, link: "/student" });
  ok(res, s, {}, 201);
});
batchOps.patch("/sessions/:sid", async (req, res) => {
  const b = parse(sessionSchema.partial(), req.body);
  const s = await one(`UPDATE class_sessions SET title=COALESCE($3,title), description=COALESCE($4,description), starts_at=COALESCE($5,starts_at),
      duration_minutes=COALESCE($6,duration_minutes), meeting_url=COALESCE($7,meeting_url), status=COALESCE($8,status) WHERE id=$1 AND batch_id=$2 RETURNING *`,
    [idParam(req, "sid"), batchOf(res).id, b.title ?? null, b.description ?? null, b.startsAt ?? null, b.durationMinutes ?? null, b.meetingUrl ?? null, b.status ?? null]);
  if (!s) throw notFound("Session not found.");
  ok(res, s);
});
batchOps.delete("/sessions/:sid", async (req, res) => {
  const r = await q(`DELETE FROM class_sessions WHERE id=$1 AND batch_id=$2 RETURNING id`, [idParam(req, "sid"), batchOf(res).id]);
  if (!r.length) throw notFound("Session not found.");
  res.json({ message: "Session deleted." });
});
batchOps.get("/sessions/:sid/attendance", async (req, res) => {
  const sid = idParam(req, "sid");
  if (!(await one(`SELECT 1 FROM class_sessions WHERE id=$1 AND batch_id=$2`, [sid, batchOf(res).id]))) throw notFound("Session not found.");
  ok(res, await q(`SELECT e.id AS enrollment_id, u.name, sp.student_code, a.status, a.note FROM enrollments e JOIN users u ON u.id=e.student_id
                   LEFT JOIN student_profiles sp ON sp.user_id=u.id LEFT JOIN attendance a ON a.session_id=$1 AND a.enrollment_id=e.id
                   WHERE e.batch_id=$2 AND e.status IN ('active','completed','suspended') ORDER BY u.name`, [sid, batchOf(res).id]));
});
batchOps.put("/sessions/:sid/attendance", async (req, res) => {
  const sid = idParam(req, "sid");
  const b = parse(z.object({ records: z.array(z.object({ enrollmentId: z.coerce.number().int(), status: z.enum(["present", "absent", "late", "excused"]), note: z.string().max(300).nullable().optional() })).min(1).max(500) }), req.body);
  if (!(await one(`SELECT 1 FROM class_sessions WHERE id=$1 AND batch_id=$2`, [sid, batchOf(res).id]))) throw notFound("Session not found.");
  await tx(async (c) => {
    const valid = new Set((await q<{ id: number }>(`SELECT id FROM enrollments WHERE batch_id=$1`, [batchOf(res).id], c)).map((r) => r.id));
    for (const r of b.records) {
      if (!valid.has(r.enrollmentId)) throw new ApiError(422, `Enrollment ${r.enrollmentId} is not in this batch.`);
      await q(`INSERT INTO attendance(session_id,enrollment_id,status,note,marked_by) VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (session_id,enrollment_id) DO UPDATE SET status=EXCLUDED.status, note=EXCLUDED.note, marked_by=EXCLUDED.marked_by, marked_at=now()`,
        [sid, r.enrollmentId, r.status, r.note ?? null, req.user!.id], c);
    }
    await q(`UPDATE class_sessions SET status='completed' WHERE id=$1 AND status='scheduled'`, [sid], c);
  });
  await logReq(req, "attendance.marked", { entityType: "session", entityId: sid, meta: { count: b.records.length } });
  res.json({ message: "Attendance saved." });
});

/* ── documents shared with the batch or with chosen students ── */
batchOps.get("/documents", async (_req, res) => {
  ok(res, await q(`SELECT d.id,d.title,d.description,d.kind,d.scope,d.file_name,d.file_size,d.external_url,d.is_published,d.created_at,u.name AS uploaded_by_name,
                   (SELECT count(*)::int FROM document_recipients r WHERE r.document_id=d.id) AS recipient_count
                   FROM documents d LEFT JOIN users u ON u.id=d.uploaded_by WHERE d.batch_id=$1 ORDER BY d.created_at DESC`, [batchOf(res).id]));
});
batchOps.post("/documents", upload.single("file"), async (req, res) => {
  const batch = batchOf(res);
  const fail = (m: string) => { if (req.file) removeFile(relativePath(req.file.path)); return new ApiError(422, m); };
  let b;
  try {
    b = parse(z.object({
      title: z.string().trim().min(2).max(200), description: z.string().trim().max(2000).optional(),
      kind: z.enum(["document", "video", "link", "assignment", "other"]).default("document"),
      externalUrl: z.string().url().optional().or(z.literal("")),
      recipientIds: z.string().optional(),   // CSV of enrollment ids => scope 'student'
    }), req.body);
  } catch (e) { if (req.file) removeFile(relativePath(req.file.path)); throw e; }
  if (!req.file && !b.externalUrl) throw fail("Attach a file or provide a link.");
  const rec = (b.recipientIds ?? "").split(",").map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  const id = await tx(async (c) => {
    if (rec.length) {
      const ok2 = await q(`SELECT id FROM enrollments WHERE batch_id=$1 AND id = ANY($2)`, [batch.id, rec], c);
      if (ok2.length !== rec.length) throw fail("Some selected students are not in this batch.");
    }
    const d = await one(`INSERT INTO documents(title,description,kind,scope,course_id,batch_id,file_path,file_name,mime_type,file_size,external_url,uploaded_by)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [b.title, b.description ?? null, req.file ? b.kind : "link", rec.length ? "student" : "batch", batch.course_id, batch.id,
       req.file ? relativePath(req.file.path) : null, req.file?.originalname ?? null, req.file?.mimetype ?? null, req.file?.size ?? null, b.externalUrl || null, req.user!.id], c);
    for (const e of rec) await q(`INSERT INTO document_recipients(document_id,enrollment_id) VALUES ($1,$2)`, [d.id, e], c);
    const targets = rec.length ? await q<{ student_id: number }>(`SELECT student_id FROM enrollments WHERE id = ANY($1)`, [rec], c)
      : await q<{ student_id: number }>(`SELECT student_id FROM enrollments WHERE batch_id=$1 AND status IN ('active','completed')`, [batch.id], c);
    await notifyMany(targets.map((t) => t.student_id), { type: "info", title: `New material: ${b.title}`, body: batch.course_name, link: "/student/documents" }, c);
    return d.id;
  });
  await logReq(req, "document.shared", { entityType: "document", entityId: id });
  ok(res, { id }, {}, 201);
});
batchOps.delete("/documents/:did", async (req, res) => {
  const d = await one(`SELECT * FROM documents WHERE id=$1 AND batch_id=$2`, [idParam(req, "did"), batchOf(res).id]);
  if (!d) throw notFound("Document not found.");
  if (req.user!.role === "tutor" && d.uploaded_by !== req.user!.id) throw forbidden("You can only delete documents you uploaded.");
  await q(`DELETE FROM documents WHERE id=$1`, [d.id]);
  removeFile(d.file_path);
  res.json({ message: "Document removed." });
});

/* ── announcements ── */
batchOps.get("/announcements", async (_req, res) => {
  ok(res, await q(`SELECT a.*, u.name AS author_name FROM announcements a LEFT JOIN users u ON u.id=a.author_id WHERE a.batch_id=$1 ORDER BY a.pinned DESC, a.created_at DESC`, [batchOf(res).id]));
});
batchOps.post("/announcements", async (req, res) => {
  const b = parse(z.object({ title: z.string().trim().min(2).max(200), body: z.string().trim().min(2).max(5000), pinned: z.boolean().default(false) }), req.body);
  const batch = batchOf(res);
  const a = await one(`INSERT INTO announcements(title,body,batch_id,author_id,pinned) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [b.title, b.body, batch.id, req.user!.id, b.pinned]);
  const ids = (await q<{ student_id: number }>(`SELECT student_id FROM enrollments WHERE batch_id=$1 AND status IN ('active','completed')`, [batch.id])).map((r) => r.student_id);
  await notifyMany(ids, { type: "info", title: b.title, body: b.body.slice(0, 140), link: "/student" });
  ok(res, a, {}, 201);
});
batchOps.delete("/announcements/:aid", async (req, res) => {
  const r = await q(`DELETE FROM announcements WHERE id=$1 AND batch_id=$2 RETURNING id`, [idParam(req, "aid"), batchOf(res).id]);
  if (!r.length) throw notFound("Announcement not found.");
  res.json({ message: "Announcement removed." });
});
void fs;
