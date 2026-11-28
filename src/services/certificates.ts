import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { one, q, tx } from "../db.js";
import { ApiError, conflict, notFound } from "../lib/http.js";
import { credentialId, initials, settingsGet } from "../lib/ids.js";
import { appUrl, esc, sendMail } from "../lib/mail.js";
import { notify } from "../lib/notify.js";
import { logActivity } from "../lib/activity.js";

/** Can this enrollment apply for a certificate right now? Returns human-readable reasons when not. */
export async function eligibility(enrollmentId: number) {
  const e = await one(
    `SELECT e.id, e.status, va.attendance_percent FROM enrollments e
     LEFT JOIN v_enrollment_attendance va ON va.enrollment_id=e.id WHERE e.id=$1`, [enrollmentId]);
  if (!e) throw notFound("Enrollment not found.");
  const minAttendance = await settingsGet<number>("certificate_min_attendance", 75);
  const reasons: string[] = [];
  if (e.status !== "completed") reasons.push("Your tutor needs to mark the course as completed first.");
  if (e.attendance_percent != null && e.attendance_percent < minAttendance)
    reasons.push(`Attendance is ${e.attendance_percent}% – at least ${minAttendance}% is required.`);
  const open = await one(`SELECT id, status FROM certificate_requests WHERE enrollment_id=$1 AND status IN ('submitted','under_review','approved')`, [enrollmentId]);
  if (open) reasons.push(open.status === "approved" ? "Your certificate has already been issued." : "A request is already being reviewed.");
  return { eligible: reasons.length === 0, reasons, attendancePercent: e.attendance_percent as number | null, minAttendance };
}

export interface IssueOverrides { codeQuality?: number; milestoneSprints?: number; technicalInterview?: number; lorQualified?: boolean; ppoQualified?: boolean }

/** Issues (or returns the existing) public credential for an enrollment. Optionally closes the student's request. */
export async function issueCredential(enrollmentId: number, admin: { id: number; name: string }, opts: { requestId?: number; overrides?: IssueOverrides; reviewNotes?: string } = {}) {
  const cred = await tx(async (c) => {
    const e = await one(
      `SELECT e.*, c.name AS course_name, c.slug AS course_slug, c.code AS course_code, p.code AS plan_code, p.days AS plan_days,
              p.lor_eligible, p.ppo_eligible, u.name AS user_name, sp.college, sp.degree
       FROM enrollments e JOIN courses c ON c.id=e.course_id LEFT JOIN course_plans p ON p.id=e.plan_id
       JOIN users u ON u.id=e.student_id LEFT JOIN student_profiles sp ON sp.user_id=u.id
       WHERE e.id=$1 FOR UPDATE OF e`, [enrollmentId], c);
    if (!e) throw notFound("Enrollment not found.");
    if (e.status !== "completed") throw conflict("The enrollment must be marked completed before a certificate can be issued.");

    const existing = await one(`SELECT * FROM credentials WHERE enrollment_id=$1`, [enrollmentId], c);
    if (existing) {
      if (opts.requestId) await q(`UPDATE certificate_requests SET status='approved', credential_id=$2, reviewed_by=$3, reviewed_at=now(), review_notes=COALESCE($4,review_notes) WHERE id=$1`, [opts.requestId, existing.id, admin.id, opts.reviewNotes ?? null], c);
      return { row: existing, created: false };
    }
    const req = opts.requestId ? await one(`SELECT * FROM certificate_requests WHERE id=$1 AND enrollment_id=$2`, [opts.requestId, enrollmentId], c) : null;
    if (opts.requestId && !req) throw notFound("Certificate request not found for this enrollment.");

    const o = opts.overrides ?? {};
    const cq = o.codeQuality ?? 0, ms = o.milestoneSprints ?? 0, ti = o.technicalInterview ?? 0;
    const name = req?.name_on_certificate || e.user_name;
    const prefix = await settingsGet<string>("certificate_prefix", "CG", c);
    const cid = await credentialId(e.course_code, prefix, c);
    const row = await one(
      `INSERT INTO credentials(credential_id, enrollment_id, user_id, course_id, student_name, student_initials, degree, college_name,
         track_slug, track_name, duration, duration_days, issue_date, verification_status, verified_at, skills, github_url, live_deployment_url,
         capstone_title, capstone_description, lor_qualified, ppo_qualified, code_quality, milestone_sprints, technical_interview, total_score, verified_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,current_date,'VERIFIED',now(),$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
      [cid, enrollmentId, e.student_id, e.course_id, name, initials(name), req?.degree ?? e.degree, req?.college_name ?? e.college,
       e.course_slug, e.course_name, e.plan_code ?? "45D", e.plan_days ?? 45, JSON.stringify(req?.skills ?? []),
       req?.github_url ?? null, req?.live_deployment_url ?? null, req?.capstone_title ?? null, req?.capstone_description ?? null,
       o.lorQualified ?? !!e.lor_eligible, o.ppoQualified ?? !!e.ppo_eligible, cq, ms, ti, cq + ms + ti, admin.name], c);
    if (opts.requestId) await q(`UPDATE certificate_requests SET status='approved', credential_id=$2, reviewed_by=$3, reviewed_at=now(), review_notes=COALESCE($4,review_notes) WHERE id=$1`, [opts.requestId, row.id, admin.id, opts.reviewNotes ?? null], c);
    await notify(e.student_id, { type: "success", title: "Your certificate is ready 🎓", body: `${e.course_name} – credential ${cid}`, link: "/student/certificates" }, c);
    return { row, created: true, studentId: e.student_id, courseName: e.course_name };
  });

  if (cred.created) {
    const u = await one(`SELECT email, name FROM users WHERE id=$1`, [(cred as any).studentId]);
    if (u) await sendMail(u.email, "Your Internkul certificate is ready", "Congratulations!",
      `<p>Hi ${esc(u.name)}, your certificate for <b>${esc((cred as any).courseName)}</b> has been issued.</p>
       <p>Credential ID: <b>${esc(cred.row.credential_id)}</b>. Anyone can verify it at ${appUrl("/verify/" + cred.row.credential_id)}</p>`,
      { label: "Download certificate", url: appUrl("/student/certificates") });
    await logActivity({ action: "certificate.issued", userId: admin.id, role: "admin", enrollmentId, entityType: "credential", entityId: cred.row.credential_id });
  }
  return cred.row;
}

export async function rejectRequest(requestId: number, admin: { id: number }, notes: string) {
  const r = await one(`UPDATE certificate_requests SET status='rejected', review_notes=$2, reviewed_by=$3, reviewed_at=now()
                       WHERE id=$1 AND status IN ('submitted','under_review') RETURNING *`, [requestId, notes, admin.id]);
  if (!r) throw new ApiError(409, "This request has already been processed.");
  await notify(r.student_id, { type: "warning", title: "Certificate request needs changes", body: notes, link: "/student/certificates" });
  return r;
}

/* ───────────────────────────── PDF rendering ───────────────────────────── */
export async function renderCertificatePdf(cred: any): Promise<Buffer> {
  const issuer = await settingsGet<string>("issuer_name", "Internkul");
  const signatory = await settingsGet<string>("authorised_signatory", "Director, Internkul");
  const verifyUrl = appUrl(`/verify/${cred.credential_id}`);
  const qr = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 220 });

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, info: { Title: `Certificate ${cred.credential_id}`, Author: issuer } });
  const chunks: Buffer[] = [];
  doc.on("data", (d) => chunks.push(d));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  const W = doc.page.width, H = doc.page.height, blue = "#3157D5", ink = "#172033", muted = "#64748B";
  doc.rect(0, 0, W, H).fill("#FFFFFF");
  doc.lineWidth(6).strokeColor(blue).rect(24, 24, W - 48, H - 48).stroke();
  doc.lineWidth(1).strokeColor("#D8E5FF").rect(36, 36, W - 72, H - 72).stroke();

  doc.fillColor(blue).font("Helvetica-Bold").fontSize(15).text(issuer.toUpperCase(), 0, 70, { align: "center", characterSpacing: 4 });
  doc.fillColor(ink).font("Times-Bold").fontSize(40).text("Certificate of Completion", 0, 105, { align: "center" });
  doc.fillColor(muted).font("Helvetica").fontSize(13).text("This is to certify that", 0, 180, { align: "center" });
  doc.fillColor(blue).font("Times-BoldItalic").fontSize(38).text(cred.student_name, 60, 205, { align: "center", width: W - 120 });
  doc.moveTo(W / 2 - 170, 258).lineTo(W / 2 + 170, 258).lineWidth(1).strokeColor("#CBD5E1").stroke();
  doc.fillColor(muted).font("Helvetica").fontSize(13)
    .text("has successfully completed the industry-aligned programme", 0, 272, { align: "center" });
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(22).text(cred.track_name || "", 60, 298, { align: "center", width: W - 120 });
  const meta = [`${cred.duration_days}-day programme`, cred.college_name, cred.total_score ? `Score ${cred.total_score}/100` : null].filter(Boolean).join("   •   ");
  doc.fillColor(muted).font("Helvetica").fontSize(12).text(meta, 0, 338, { align: "center" });
  if (cred.capstone_title) doc.fillColor(muted).fontSize(11).text(`Capstone: ${cred.capstone_title}`, 60, 360, { align: "center", width: W - 120 });

  const y = H - 150;
  doc.image(qr, 70, y - 8, { width: 84 });
  doc.fillColor(muted).font("Helvetica").fontSize(8).text("Scan to verify", 70, y + 78, { width: 84, align: "center" });
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(10).text(`Credential ID: ${cred.credential_id}`, 180, y + 6);
  doc.font("Helvetica").fillColor(muted).text(`Issued: ${String(cred.issue_date).slice(0, 10)}`, 180, y + 24);
  doc.text(verifyUrl, 180, y + 42, { width: 380 });
  doc.moveTo(W - 290, y + 40).lineTo(W - 70, y + 40).lineWidth(1).strokeColor("#94A3B8").stroke();
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(11).text(signatory, W - 290, y + 48, { width: 220, align: "center" });
  if (cred.verification_status === "REVOKED") {
    doc.save().rotate(-20, { origin: [W / 2, H / 2] }).fillColor("#DC2626").opacity(0.18).font("Helvetica-Bold").fontSize(120).text("REVOKED", 0, H / 2 - 70, { align: "center" }).restore();
  }
  doc.end();
  return done;
}
