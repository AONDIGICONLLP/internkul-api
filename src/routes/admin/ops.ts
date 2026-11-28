import { Router } from "express";
import { z } from "zod";
import { one, q, tx } from "../../db.js";
import { ApiError, conflict, idParam, notFound, ok, pageOf, paged, parse, qs, zUrl } from "../../lib/http.js";
import { logReq } from "../../lib/activity.js";
import { receiptNo, settingsGet } from "../../lib/ids.js";
import { notify, notifyMany } from "../../lib/notify.js";
import { upload, relativePath, removeFile } from "../../middleware/upload.js";
import { assignToBatch, autoAssign, enrollmentTrack, setEnrollmentStatus } from "../../services/enrollment.js";
import { refundPayment } from "../../services/payments.js";
import { issueCredential, rejectRequest } from "../../services/certificates.js";

export const adminOps = Router();

/* ───────────── dashboard ───────────── */
adminOps.get("/dashboard", async (_req, res) => {
  const [stats, byMonth, byCourse, recentPayments, recentEnrollments, unassigned, inquiries] = await Promise.all([
    one(`SELECT
      (SELECT count(*)::int FROM users WHERE role='student') AS students,
      (SELECT count(*)::int FROM users WHERE role='student' AND last_active_at > now() - interval '7 days') AS active_students_7d,
      (SELECT count(*)::int FROM users WHERE role='tutor' AND is_active) AS tutors,
      (SELECT count(*)::int FROM courses WHERE status='active') AS courses_active, (SELECT count(*)::int FROM courses WHERE status='draft') AS courses_draft,
      (SELECT count(*)::int FROM batches WHERE NOT archived AND status IN ('open','upcoming','ongoing')) AS batches_running,
      (SELECT count(*)::int FROM enrollments WHERE status='active') AS enrollments_active, (SELECT count(*)::int FROM enrollments WHERE status='completed') AS enrollments_completed,
      (SELECT COALESCE(sum(amount-refunded_amount),0) FROM payments WHERE status IN ('paid','partially_refunded')) AS revenue_total,
      (SELECT COALESCE(sum(amount-refunded_amount),0) FROM payments WHERE status IN ('paid','partially_refunded') AND paid_at >= date_trunc('month', now())) AS revenue_month,
      (SELECT COALESCE(sum(refunded_amount),0) FROM payments) AS refunded_total,
      (SELECT count(*)::int FROM certificate_requests WHERE status IN ('submitted','under_review')) AS pending_certificates,
      (SELECT count(*)::int FROM credentials WHERE verification_status='VERIFIED') AS certificates_issued,
      (SELECT count(*)::int FROM inquiries WHERE status='new') AS new_inquiries`),
    q(`SELECT to_char(m,'Mon YY') AS label, to_char(m,'YYYY-MM') AS month,
       COALESCE((SELECT sum(amount-refunded_amount) FROM payments WHERE status IN ('paid','partially_refunded') AND date_trunc('month',paid_at)=m),0) AS revenue,
       (SELECT count(*)::int FROM enrollments WHERE date_trunc('month',enrolled_at)=m AND status<>'pending_payment') AS enrollments
       FROM generate_series(date_trunc('month',now()) - interval '5 months', date_trunc('month',now()), interval '1 month') m ORDER BY m`),
    q(`SELECT c.name, count(e.id)::int AS students, COALESCE(sum(p.amount-p.refunded_amount),0) AS revenue FROM courses c
       LEFT JOIN enrollments e ON e.course_id=c.id AND e.status IN ('active','completed')
       LEFT JOIN payments p ON p.enrollment_id=e.id AND p.status IN ('paid','partially_refunded')
       GROUP BY c.id HAVING count(e.id)>0 ORDER BY students DESC LIMIT 6`),
    q(`SELECT p.id,p.receipt_no,p.amount,p.status,p.paid_at,u.name AS student_name,c.name AS course_name FROM payments p JOIN users u ON u.id=p.student_id
       LEFT JOIN enrollments e ON e.id=p.enrollment_id LEFT JOIN courses c ON c.id=e.course_id WHERE p.status IN ('paid','partially_refunded','refunded') ORDER BY p.paid_at DESC NULLS LAST LIMIT 6`),
    q(`SELECT e.id,e.status,e.enrolled_at,u.name AS student_name,c.name AS course_name,b.code AS batch_code FROM enrollments e JOIN users u ON u.id=e.student_id JOIN courses c ON c.id=e.course_id
       LEFT JOIN batches b ON b.id=e.batch_id WHERE e.status<>'pending_payment' ORDER BY e.enrolled_at DESC LIMIT 6`),
    one(`SELECT count(*)::int n FROM enrollments WHERE status='active' AND batch_id IS NULL`),
    q(`SELECT id,type,name,email,interested_course,status,created_at FROM inquiries WHERE status='new' ORDER BY created_at DESC LIMIT 4`),
  ]);
  ok(res, { stats: { ...stats, unassigned_enrollments: unassigned!.n }, revenueByMonth: byMonth, topCourses: byCourse, recentPayments, recentEnrollments, newInquiries: inquiries });
});

/* ───────────── enrollments ───────────── */
adminOps.get("/enrollments", async (req, res) => {
  const p = pageOf(req), params: any[] = [], w: string[] = ["TRUE"];
  const add = (c: string, v: any) => { params.push(v); w.push(c.replace("?", `$${params.length}`)); };
  if (qs(req, "status")) add("e.status=?", qs(req, "status")); else w.push("e.status<>'pending_payment'");
  if (qs(req, "course_id")) add("e.course_id=?", Number(qs(req, "course_id")));
  if (qs(req, "batch_id")) add("e.batch_id=?", Number(qs(req, "batch_id")));
  if (qs(req, "unassigned") === "1") w.push("e.batch_id IS NULL AND e.status='active'");
  if (qs(req, "search")) add("(u.name ILIKE ? OR u.email ILIKE ? OR sp.student_code ILIKE ?)".replace(/\?/g, "$" + (params.length + 1)), `%${qs(req, "search")}%`);
  const from = `FROM enrollments e JOIN users u ON u.id=e.student_id LEFT JOIN student_profiles sp ON sp.user_id=u.id JOIN courses c ON c.id=e.course_id
                LEFT JOIN course_plans pl ON pl.id=e.plan_id LEFT JOIN batches b ON b.id=e.batch_id LEFT JOIN users t ON t.id=b.tutor_id
                LEFT JOIN v_enrollment_attendance va ON va.enrollment_id=e.id WHERE ${w.join(" AND ")}`;
  const total = (await one<{ n: number }>(`SELECT count(*)::int n ${from}`, params))!.n;
  paged(res, await q(`SELECT e.id,e.status,e.progress_percent,e.enrolled_at,e.timing_id,e.course_id,u.id AS student_id,u.name AS student_name,u.email,sp.student_code,c.name AS course_name,pl.label AS plan_label,
      b.id AS batch_id,b.code AS batch_code,t.name AS tutor_name,va.attendance_percent,
      (SELECT COALESCE(sum(amount-refunded_amount),0) FROM payments pm WHERE pm.enrollment_id=e.id AND pm.status IN ('paid','partially_refunded')) AS paid,e.amount_due
      ${from} ORDER BY e.enrolled_at DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params), total, p);
});
adminOps.get("/enrollments/:id", async (req, res) => ok(res, await enrollmentTrack(idParam(req))));
adminOps.post("/enrollments", async (req, res) => {
  const b = parse(z.object({
    studentId: z.coerce.number().int(), courseId: z.coerce.number().int(), planId: z.coerce.number().int(), timingId: z.string().optional().nullable(), batchId: z.coerce.number().int().optional().nullable(),
    payment: z.object({ amount: z.coerce.number().min(0), method: z.enum(["cash", "upi", "bank_transfer", "cheque", "other"]), notes: z.string().max(500).optional() }).optional(),
  }), req.body);
  const plan = await one(`SELECT * FROM course_plans WHERE id=$1 AND course_id=$2`, [b.planId, b.courseId]);
  if (!plan) throw notFound("That plan does not belong to the course.");
  if (!(await one(`SELECT 1 FROM users WHERE id=$1 AND role='student' AND is_active`, [b.studentId]))) throw notFound("Active student not found.");
  const id = await tx(async (c) => {
    const e = await one(`INSERT INTO enrollments(student_id,course_id,plan_id,timing_id,status,amount_due) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [b.studentId, b.courseId, b.planId, b.timingId ?? null, b.payment ? "active" : "pending_payment", plan.price_inr], c);
    if (b.payment) await q(`INSERT INTO payments(enrollment_id,student_id,provider,status,amount,receipt_no,method,paid_at,notes,recorded_by) VALUES ($1,$2,'manual','paid',$3,$4,$5,now(),$6,$7)`,
      [e.id, b.studentId, b.payment.amount, await receiptNo(c), b.payment.method, b.payment.notes ?? null, req.user!.id], c);
    if (b.batchId) await assignToBatch(e.id, b.batchId, c); else if (b.payment) await autoAssign(e.id, c);
    await notify(b.studentId, { type: "success", title: "You have been enrolled in a course", link: `/student/courses/${e.id}` }, c);
    return e.id as number;
  });
  await logReq(req, "enrollment.created", { enrollmentId: id, entityType: "enrollment", entityId: id });
  ok(res, await enrollmentTrack(id), {}, 201);
});
adminOps.patch("/enrollments/:id", async (req, res) => {
  const id = idParam(req);
  const b = parse(z.object({
    status: z.enum(["active", "completed", "suspended", "dropped", "cancelled"]).optional(), batchId: z.coerce.number().int().nullable().optional(), force: z.boolean().default(false),
    progressPercent: z.coerce.number().int().min(0).max(100).optional(), tutorRemarks: z.string().max(2000).nullable().optional(),
  }), req.body);
  await tx(async (c) => {
    if (b.batchId !== undefined) {
      if (b.batchId === null) await q(`UPDATE enrollments SET batch_id=NULL WHERE id=$1`, [id], c);
      else await assignToBatch(id, b.batchId, c, { force: b.force });
    }
    if (b.progressPercent !== undefined) await q(`UPDATE enrollments SET progress_percent=$2 WHERE id=$1`, [id, b.progressPercent], c);
    if (b.tutorRemarks !== undefined) await q(`UPDATE enrollments SET tutor_remarks=$2 WHERE id=$1`, [id, b.tutorRemarks], c);
    if (b.status) await setEnrollmentStatus(id, b.status, c);
  });
  await logReq(req, "enrollment.updated", { enrollmentId: id, entityType: "enrollment", entityId: id, meta: b });
  ok(res, await enrollmentTrack(id));
});

/* ───────────── payments ───────────── */
adminOps.get("/payments", async (req, res) => {
  const p = pageOf(req), params: any[] = [], w: string[] = ["TRUE"];
  const add = (c: string, v: any) => { params.push(v); w.push(c.replace(/\?/g, `$${params.length}`)); };
  if (qs(req, "status")) add("p.status=?", qs(req, "status")); else w.push("p.status<>'created'");
  if (qs(req, "from")) add("COALESCE(p.paid_at,p.created_at) >= ?::date", qs(req, "from"));
  if (qs(req, "to")) add("COALESCE(p.paid_at,p.created_at) < (?::date + 1)", qs(req, "to"));
  if (qs(req, "course_id")) add("e.course_id=?", Number(qs(req, "course_id")));
  if (qs(req, "provider")) add("p.provider=?", qs(req, "provider"));
  if (qs(req, "search")) add("(u.name ILIKE ? OR u.email ILIKE ? OR p.receipt_no ILIKE ? OR p.razorpay_payment_id ILIKE ?)", `%${qs(req, "search")}%`);
  const from = `FROM payments p JOIN users u ON u.id=p.student_id LEFT JOIN enrollments e ON e.id=p.enrollment_id LEFT JOIN courses c ON c.id=e.course_id LEFT JOIN course_plans pl ON pl.id=e.plan_id WHERE ${w.join(" AND ")}`;
  const total = await one<{ n: number }>(`SELECT count(*)::int n ${from}`, params);
  const rows = await q(`SELECT p.id,p.receipt_no,p.status,p.provider,p.amount,p.refunded_amount,p.method,p.paid_at,p.created_at,p.razorpay_order_id,p.razorpay_payment_id,p.failure_reason,p.notes,
      u.id AS student_id,u.name AS student_name,u.email,c.name AS course_name,pl.label AS plan_label,p.enrollment_id ${from} ORDER BY COALESCE(p.paid_at,p.created_at) DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params);
  paged(res, rows, total!.n, p);
});
adminOps.get("/payments/summary", async (req, res) => {
  const f = qs(req, "from"), t = qs(req, "to");
  ok(res, await one(`SELECT COALESCE(sum(amount) FILTER (WHERE status IN ('paid','partially_refunded','refunded')),0) AS gross, COALESCE(sum(refunded_amount),0) AS refunded,
    COALESCE(sum(amount-refunded_amount) FILTER (WHERE status IN ('paid','partially_refunded')),0) AS net, count(*) FILTER (WHERE status IN ('paid','partially_refunded'))::int AS successful,
    count(*) FILTER (WHERE status='failed')::int AS failed, count(*) FILTER (WHERE status='created')::int AS abandoned
    FROM payments WHERE ($1::date IS NULL OR COALESCE(paid_at,created_at) >= $1::date) AND ($2::date IS NULL OR COALESCE(paid_at,created_at) < $2::date + 1)`, [f ?? null, t ?? null]));
});
adminOps.get("/payments/:id", async (req, res) => {
  const p = await one(`SELECT p.*, u.name AS student_name, u.email, c.name AS course_name, pl.label AS plan_label, rb.name AS recorded_by_name FROM payments p JOIN users u ON u.id=p.student_id
    LEFT JOIN enrollments e ON e.id=p.enrollment_id LEFT JOIN courses c ON c.id=e.course_id LEFT JOIN course_plans pl ON pl.id=e.plan_id LEFT JOIN users rb ON rb.id=p.recorded_by WHERE p.id=$1`, [idParam(req)]);
  if (!p) throw notFound("Payment not found."); ok(res, p);
});
adminOps.post("/payments/manual", async (req, res) => {
  const b = parse(z.object({ enrollmentId: z.coerce.number().int(), amount: z.coerce.number().positive(), method: z.enum(["cash", "upi", "bank_transfer", "cheque", "other"]), notes: z.string().max(500).optional() }), req.body);
  const id = await tx(async (c) => {
    const e = await one(`SELECT * FROM enrollments WHERE id=$1 FOR UPDATE`, [b.enrollmentId], c);
    if (!e) throw notFound("Enrollment not found.");
    const p = await one(`INSERT INTO payments(enrollment_id,student_id,provider,status,amount,receipt_no,method,paid_at,notes,recorded_by) VALUES ($1,$2,'manual','paid',$3,$4,$5,now(),$6,$7) RETURNING id`,
      [e.id, e.student_id, b.amount, await receiptNo(c), b.method, b.notes ?? null, req.user!.id], c);
    if (e.status === "pending_payment") { await q(`UPDATE enrollments SET status='active' WHERE id=$1`, [e.id], c); await autoAssign(e.id, c); }
    await notify(e.student_id, { type: "success", title: "Payment recorded", body: `₹${b.amount} received (${b.method})`, link: "/student/payments" }, c);
    return p.id as number;
  });
  await logReq(req, "payment.manual", { entityType: "payment", entityId: id, meta: b });
  ok(res, await one(`SELECT * FROM payments WHERE id=$1`, [id]), {}, 201);
});
adminOps.post("/payments/:id/refund", async (req, res) => {
  const b = parse(z.object({ amount: z.coerce.number().positive(), reason: z.string().trim().min(3).max(300) }), req.body);
  const r = await refundPayment(idParam(req), b.amount, b.reason, req.user!.id);
  await logReq(req, "payment.refunded", { entityType: "payment", entityId: idParam(req), meta: { ...b, ...r } });
  ok(res, r);
});

/* ───────────── documents (course-wide, batch or individual students) ───────────── */
adminOps.get("/documents", async (req, res) => {
  const params: any[] = [], w: string[] = ["TRUE"];
  if (qs(req, "course_id")) { params.push(Number(qs(req, "course_id"))); w.push(`d.course_id=$${params.length}`); }
  if (qs(req, "batch_id")) { params.push(Number(qs(req, "batch_id"))); w.push(`d.batch_id=$${params.length}`); }
  if (qs(req, "scope")) { params.push(qs(req, "scope")); w.push(`d.scope=$${params.length}`); }
  ok(res, await q(`SELECT d.id,d.title,d.description,d.kind,d.scope,d.file_name,d.file_size,d.external_url,d.is_published,d.created_at,c.name AS course_name,b.code AS batch_code,u.name AS uploaded_by_name,
    (SELECT count(*)::int FROM document_recipients r WHERE r.document_id=d.id) AS recipient_count FROM documents d JOIN courses c ON c.id=d.course_id LEFT JOIN batches b ON b.id=d.batch_id LEFT JOIN users u ON u.id=d.uploaded_by
    WHERE ${w.join(" AND ")} ORDER BY d.created_at DESC LIMIT 300`, params));
});
adminOps.post("/documents", upload.single("file"), async (req, res) => {
  const cleanup = () => { if (req.file) removeFile(relativePath(req.file.path)); };
  try {
    const b = parse(z.object({
      title: z.string().trim().min(2).max(200), description: z.string().trim().max(2000).optional(), kind: z.enum(["document", "video", "link", "assignment", "certificate", "other"]).default("document"),
      scope: z.enum(["course", "batch", "student"]), courseId: z.coerce.number().int(), batchId: z.coerce.number().int().optional(), recipientIds: z.string().optional(), externalUrl: z.string().url().optional().or(z.literal("")),
    }), req.body);
    if (!req.file && !b.externalUrl) throw new ApiError(422, "Attach a file or provide a link.");
    const rec = (b.recipientIds ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (b.scope === "batch" && !b.batchId) throw new ApiError(422, "Choose a batch.");
    if (b.scope === "student" && !rec.length) throw new ApiError(422, "Choose at least one student.");
    const id = await tx(async (c) => {
      if (b.batchId && !(await one(`SELECT 1 FROM batches WHERE id=$1 AND course_id=$2`, [b.batchId, b.courseId], c))) throw conflict("That batch is not part of the course.");
      const d = await one(`INSERT INTO documents(title,description,kind,scope,course_id,batch_id,file_path,file_name,mime_type,file_size,external_url,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [b.title, b.description ?? null, req.file ? b.kind : "link", b.scope, b.courseId, b.scope === "batch" ? b.batchId : null, req.file ? relativePath(req.file.path) : null, req.file?.originalname ?? null, req.file?.mimetype ?? null, req.file?.size ?? null, b.externalUrl || null, req.user!.id], c);
      let targets: { student_id: number }[];
      if (b.scope === "student") {
        const valid = await q<{ id: number; student_id: number }>(`SELECT id, student_id FROM enrollments WHERE course_id=$1 AND id = ANY($2)`, [b.courseId, rec], c);
        if (valid.length !== rec.length) throw conflict("Some selected enrollments are not in this course.");
        for (const v of valid) await q(`INSERT INTO document_recipients(document_id,enrollment_id) VALUES ($1,$2)`, [d.id, v.id], c);
        targets = valid;
      } else targets = await q(`SELECT student_id FROM enrollments WHERE status IN ('active','completed') AND ${b.scope === "batch" ? "batch_id=$1" : "course_id=$1"}`, [b.scope === "batch" ? b.batchId : b.courseId], c);
      await notifyMany(targets.map((t) => t.student_id), { type: "info", title: `New material: ${b.title}`, link: "/student/documents" }, c);
      return d.id as number;
    });
    await logReq(req, "document.shared", { entityType: "document", entityId: id });
    ok(res, { id }, {}, 201);
  } catch (e) { cleanup(); throw e; }
});
adminOps.patch("/documents/:id", async (req, res) => {
  const b = parse(z.object({ title: z.string().trim().min(2).optional(), description: z.string().max(2000).nullable().optional(), isPublished: z.boolean().optional() }), req.body);
  const r = await one(`UPDATE documents SET title=COALESCE($2,title), description=COALESCE($3,description), is_published=COALESCE($4,is_published) WHERE id=$1 RETURNING id,title,is_published`, [idParam(req), b.title ?? null, b.description ?? null, b.isPublished ?? null]);
  if (!r) throw notFound("Document not found."); ok(res, r);
});
adminOps.delete("/documents/:id", async (req, res) => {
  const d = await one(`DELETE FROM documents WHERE id=$1 RETURNING file_path`, [idParam(req)]);
  if (!d) throw notFound("Document not found.");
  removeFile(d.file_path); res.json({ message: "Document deleted." });
});

/* ───────────── certificates ───────────── */
adminOps.get("/certificate-requests", async (req, res) => {
  const st = qs(req, "status");
  ok(res, await q(`SELECT r.id,r.status,r.name_on_certificate,r.created_at,r.reviewed_at,r.review_notes,r.enrollment_id,r.feedback_rating,u.name AS student_name,u.email,c.name AS course_name,
    va.attendance_percent,e.progress_percent,cr.credential_id FROM certificate_requests r JOIN enrollments e ON e.id=r.enrollment_id JOIN users u ON u.id=r.student_id JOIN courses c ON c.id=e.course_id
    LEFT JOIN v_enrollment_attendance va ON va.enrollment_id=e.id LEFT JOIN credentials cr ON cr.id=r.credential_id ${st ? "WHERE r.status=$1" : ""} ORDER BY (r.status='submitted') DESC, r.created_at DESC LIMIT 300`, st ? [st] : []));
});
adminOps.get("/certificate-requests/:id", async (req, res) => {
  const r = await one(`SELECT * FROM certificate_requests WHERE id=$1`, [idParam(req)]);
  if (!r) throw notFound("Request not found.");
  ok(res, { request: r, track: await enrollmentTrack(r.enrollment_id) });
});
const scoreSchema = z.object({ codeQuality: z.coerce.number().int().min(0).max(40).optional(), milestoneSprints: z.coerce.number().int().min(0).max(30).optional(), technicalInterview: z.coerce.number().int().min(0).max(30).optional(), lorQualified: z.boolean().optional(), ppoQualified: z.boolean().optional(), notes: z.string().max(1000).optional() });
adminOps.post("/certificate-requests/:id/approve", async (req, res) => {
  const id = idParam(req), b = parse(scoreSchema, req.body);
  const r = await one(`SELECT * FROM certificate_requests WHERE id=$1`, [id]);
  if (!r) throw notFound("Request not found.");
  if (r.status === "rejected") throw conflict("This request was rejected. Ask the student to submit a new one.");
  const cred = await issueCredential(r.enrollment_id, req.user!, { requestId: id, overrides: b, reviewNotes: b.notes });
  ok(res, cred);
});
adminOps.post("/certificate-requests/:id/reject", async (req, res) => {
  const b = parse(z.object({ notes: z.string().trim().min(3, "Tell the student what to fix.").max(1000) }), req.body);
  ok(res, await rejectRequest(idParam(req), req.user!, b.notes));
});
adminOps.post("/certificates/issue", async (req, res) => {   // direct issue without a student request
  const b = parse(scoreSchema.extend({ enrollmentId: z.coerce.number().int() }), req.body);
  ok(res, await issueCredential(b.enrollmentId, req.user!, { overrides: b }), {}, 201);
});
adminOps.get("/credentials", async (req, res) => {
  const p = pageOf(req), params: any[] = [], w: string[] = ["TRUE"];
  if (qs(req, "status")) { params.push(qs(req, "status")); w.push(`verification_status=$${params.length}`); }
  if (qs(req, "search")) { params.push(`%${qs(req, "search")}%`); w.push(`(student_name ILIKE $${params.length} OR credential_id ILIKE $${params.length} OR track_name ILIKE $${params.length})`); }
  const total = (await one<{ n: number }>(`SELECT count(*)::int n FROM credentials WHERE ${w.join(" AND ")}`, params))!.n;
  paged(res, await q(`SELECT * FROM credentials WHERE ${w.join(" AND ")} ORDER BY created_at DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params), total, p);
});
adminOps.patch("/credentials/:credentialId", async (req, res) => {
  const b = parse(z.object({ status: z.enum(["VERIFIED", "REVOKED"]).optional(), reason: z.string().max(500).optional(), ...Object.fromEntries(["codeQuality:40", "milestoneSprints:30", "technicalInterview:30"].map((x) => [x.split(":")[0], z.coerce.number().int().min(0).max(+x.split(":")[1]).optional()])), lorQualified: z.boolean().optional(), ppoQualified: z.boolean().optional() }), req.body) as any;
  const cur = await one(`SELECT * FROM credentials WHERE credential_id=$1`, [req.params.credentialId]);
  if (!cur) throw notFound("Credential not found.");
  const cq = b.codeQuality ?? cur.code_quality, ms = b.milestoneSprints ?? cur.milestone_sprints, ti = b.technicalInterview ?? cur.technical_interview;
  const r = await one(`UPDATE credentials SET verification_status=COALESCE($2,verification_status), revoked_at=CASE WHEN $2='REVOKED' THEN now() WHEN $2='VERIFIED' THEN NULL ELSE revoked_at END,
    revoked_reason=CASE WHEN $2='REVOKED' THEN $3 WHEN $2='VERIFIED' THEN NULL ELSE revoked_reason END, code_quality=$4, milestone_sprints=$5, technical_interview=$6, total_score=$7,
    lor_qualified=COALESCE($8,lor_qualified), ppo_qualified=COALESCE($9,ppo_qualified) WHERE credential_id=$1 RETURNING *`,
    [req.params.credentialId, b.status ?? null, b.reason ?? null, cq, ms, ti, cq + ms + ti, b.lorQualified ?? null, b.ppoQualified ?? null]);
  await logReq(req, "credential.updated", { entityType: "credential", entityId: req.params.credentialId as string, meta: b });
  ok(res, r);
});

/* ───────────── inquiries ───────────── */
adminOps.get("/inquiries", async (req, res) => {
  const p = pageOf(req), params: any[] = [], w: string[] = ["TRUE"];
  for (const k of ["status", "type"]) if (qs(req, k)) { params.push(qs(req, k)); w.push(`${k}=$${params.length}`); }
  if (qs(req, "search")) { params.push(`%${qs(req, "search")}%`); w.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length} OR institution_name ILIKE $${params.length})`); }
  const total = (await one<{ n: number }>(`SELECT count(*)::int n FROM inquiries WHERE ${w.join(" AND ")}`, params))!.n;
  paged(res, await q(`SELECT * FROM inquiries WHERE ${w.join(" AND ")} ORDER BY created_at DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params), total, p);
});
adminOps.put("/inquiries/:id", async (req, res) => {
  const b = parse(z.object({ status: z.enum(["new", "contacted", "closed"]).optional(), adminNotes: z.string().max(3000).nullable().optional() }), req.body);
  const r = await one(`UPDATE inquiries SET status=COALESCE($2,status), admin_notes=CASE WHEN $3::boolean THEN $4 ELSE admin_notes END WHERE id=$1 RETURNING *`, [idParam(req), b.status ?? null, b.adminNotes !== undefined, b.adminNotes ?? null]);
  if (!r) throw notFound("Inquiry not found."); ok(res, r);
});
adminOps.delete("/inquiries/:id", async (req, res) => { await q(`DELETE FROM inquiries WHERE id=$1`, [idParam(req)]); res.json({ message: "Inquiry deleted." }); });

/* ───────────── activity tracking, announcements, settings ───────────── */
adminOps.get("/activity", async (req, res) => {
  const p = pageOf(req, 30), params: any[] = [], w: string[] = ["TRUE"];
  if (qs(req, "user_id")) { params.push(Number(qs(req, "user_id"))); w.push(`a.user_id=$${params.length}`); }
  if (qs(req, "role")) { params.push(qs(req, "role")); w.push(`a.actor_role=$${params.length}`); }
  if (qs(req, "action")) { params.push(`${qs(req, "action")}%`); w.push(`a.action ILIKE $${params.length}`); }
  if (qs(req, "enrollment_id")) { params.push(Number(qs(req, "enrollment_id"))); w.push(`a.enrollment_id=$${params.length}`); }
  const total = (await one<{ n: number }>(`SELECT count(*)::int n FROM activity_logs a WHERE ${w.join(" AND ")}`, params))!.n;
  paged(res, await q(`SELECT a.id,a.action,a.actor_role,a.entity_type,a.entity_id,a.meta,a.ip,a.created_at,u.name AS user_name,u.email FROM activity_logs a LEFT JOIN users u ON u.id=a.user_id
    WHERE ${w.join(" AND ")} ORDER BY a.created_at DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params), total, p);
});
adminOps.get("/announcements", async (_req, res) => ok(res, await q(`SELECT a.*, c.name AS course_name, b.code AS batch_code, u.name AS author_name FROM announcements a LEFT JOIN courses c ON c.id=a.course_id LEFT JOIN batches b ON b.id=a.batch_id LEFT JOIN users u ON u.id=a.author_id ORDER BY a.created_at DESC LIMIT 100`)));
adminOps.post("/announcements", async (req, res) => {
  const b = parse(z.object({ title: z.string().trim().min(2).max(200), body: z.string().trim().min(2).max(5000), courseId: z.coerce.number().int().optional(), batchId: z.coerce.number().int().optional(), pinned: z.boolean().default(false) }).refine((v) => v.courseId || v.batchId, "Choose a course or a batch."), req.body);
  const a = await one(`INSERT INTO announcements(title,body,course_id,batch_id,author_id,pinned) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [b.title, b.body, b.courseId ?? null, b.batchId ?? null, req.user!.id, b.pinned]);
  const t = await q<{ student_id: number }>(`SELECT student_id FROM enrollments WHERE status IN ('active','completed') AND ${b.batchId ? "batch_id=$1" : "course_id=$1"}`, [b.batchId ?? b.courseId]);
  await notifyMany(t.map((x) => x.student_id), { type: "info", title: b.title, body: b.body.slice(0, 140), link: "/student" });
  ok(res, a, {}, 201);
});
adminOps.delete("/announcements/:id", async (req, res) => { await q(`DELETE FROM announcements WHERE id=$1`, [idParam(req)]); res.json({ message: "Announcement removed." }); });

adminOps.get("/settings", async (_req, res) => ok(res, await q(`SELECT key, value, description, updated_at FROM app_settings ORDER BY key`)));
adminOps.put("/settings", async (req, res) => {
  const b = parse(z.object({ certificate_min_attendance: z.coerce.number().min(0).max(100).optional(), certificate_prefix: z.string().trim().min(1).max(6).optional(), issuer_name: z.string().trim().min(1).max(100).optional(),
    authorised_signatory: z.string().trim().min(1).max(100).optional(), auto_assign_batch: z.boolean().optional(), support_email: z.string().email().optional() }), req.body);
  for (const [k, v] of Object.entries(b)) await q(`UPDATE app_settings SET value=$2, updated_by=$3, updated_at=now() WHERE key=$1`, [k, JSON.stringify(v), req.user!.id]);
  await logReq(req, "settings.updated", { meta: b });
  ok(res, await q(`SELECT key, value, description, updated_at FROM app_settings ORDER BY key`));
});
void settingsGet; void zUrl;
