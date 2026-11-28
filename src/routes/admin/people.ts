import { Router } from "express";
import { z } from "zod";
import { one, q, tx } from "../../db.js";
import { conflict, idParam, notFound, ok, pageOf, paged, parse, qs, zEmail, zPassword, zUrl } from "../../lib/http.js";
import { logReq } from "../../lib/activity.js";
import { nextTutorCode, studentCode } from "../../lib/ids.js";
import { appUrl, esc, sendMail } from "../../lib/mail.js";
import { hashPassword } from "../../lib/tokens.js";
import { buildStudentProfile } from "../../services/profile.js";
import { tutorProfileQuery } from "../tutor.js";

export const adminPeople = Router();

/* ───────────── students ───────────── */
adminPeople.get("/students", async (req, res) => {
  const p = pageOf(req), params: any[] = [], w: string[] = ["u.role='student'"];
  const s = qs(req, "search"), active = qs(req, "active"), course = qs(req, "course_id");
  if (s) { params.push(`%${s}%`); w.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.phone ILIKE $${params.length} OR sp.student_code ILIKE $${params.length})`); }
  if (active) { params.push(active === "1"); w.push(`u.is_active=$${params.length}`); }
  if (course) { params.push(Number(course)); w.push(`EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id=u.id AND e.course_id=$${params.length})`); }
  const from = `FROM users u JOIN student_profiles sp ON sp.user_id=u.id WHERE ${w.join(" AND ")}`;
  const total = (await one<{ n: number }>(`SELECT count(*)::int n ${from}`, params))!.n;
  const rows = await q(`SELECT u.id, u.name, u.email, u.phone, u.is_active, u.last_active_at, u.created_at, sp.student_code, sp.college,
      (SELECT count(*)::int FROM enrollments e WHERE e.student_id=u.id AND e.status IN ('active','completed')) AS enrollments,
      (SELECT COALESCE(sum(amount-refunded_amount),0) FROM payments pm WHERE pm.student_id=u.id AND pm.status IN ('paid','partially_refunded')) AS total_paid,
      u.password_hash IS NOT NULL AS activated ${from} ORDER BY u.created_at DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params);
  paged(res, rows, total, p);
});
adminPeople.get("/students/:id", async (req, res) => {
  const id = idParam(req);
  const u = await one(`SELECT id FROM users WHERE id=$1 AND role='student'`, [id]);
  if (!u) throw notFound("Student not found.");
  const [profile, enrollments, payments, credentials, activity] = await Promise.all([
    buildStudentProfile(id),
    q(`SELECT e.id, e.status, e.progress_percent, e.enrolled_at, c.name AS course_name, p.label AS plan_label, b.code AS batch_code, t.name AS tutor_name, va.attendance_percent
       FROM enrollments e JOIN courses c ON c.id=e.course_id LEFT JOIN course_plans p ON p.id=e.plan_id LEFT JOIN batches b ON b.id=e.batch_id LEFT JOIN users t ON t.id=b.tutor_id
       LEFT JOIN v_enrollment_attendance va ON va.enrollment_id=e.id WHERE e.student_id=$1 ORDER BY e.enrolled_at DESC`, [id]),
    q(`SELECT id,receipt_no,status,amount,refunded_amount,method,provider,paid_at,razorpay_payment_id FROM payments WHERE student_id=$1 ORDER BY created_at DESC`, [id]),
    q(`SELECT credential_id, track_name, issue_date, verification_status FROM credentials WHERE user_id=$1`, [id]),
    q(`SELECT id, action, entity_type, entity_id, meta, created_at FROM activity_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [id]),
  ]);
  const u2 = await one(`SELECT is_active, last_login_at, last_active_at, password_hash IS NOT NULL AS activated FROM users WHERE id=$1`, [id]);
  ok(res, { profile, account: u2, enrollments, payments, credentials, activity });
});
adminPeople.post("/students", async (req, res) => {
  const b = parse(z.object({ firstName: z.string().trim().min(1), lastName: z.string().trim().optional().nullable(), email: zEmail, phone: z.string().trim().min(6), college: z.string().trim().optional().nullable(), password: zPassword.optional() }), req.body);
  const user = await tx(async (c) => {
    if (await one(`SELECT 1 FROM users WHERE email=$1`, [b.email], c)) throw conflict("A user with this email already exists.");
    const u = await one(`INSERT INTO users(name,email,phone,password_hash,role) VALUES ($1,$2,$3,$4,'student') RETURNING id`, [`${b.firstName} ${b.lastName ?? ""}`.trim(), b.email, b.phone, b.password ? await hashPassword(b.password) : null], c);
    await q(`INSERT INTO student_profiles(user_id,student_code,first_name,last_name,college) VALUES ($1,$2,$3,$4,$5)`, [u.id, studentCode(null), b.firstName, b.lastName ?? null, b.college ?? null], c);
    return u;
  });
  if (!b.password) await sendMail(b.email, "Activate your Internkul account", "Your student account is ready", `<p>Hi ${esc(b.firstName)}, an account was created for you. Use “Forgot password” on the sign-in page to choose your password.</p>`, { label: "Sign in", url: appUrl("/login") });
  await logReq(req, "student.created", { entityType: "user", entityId: user.id });
  ok(res, await buildStudentProfile(user.id), {}, 201);
});
adminPeople.put("/students/:id", async (req, res) => {
  const id = idParam(req);
  const b = parse(z.object({ firstName: z.string().trim().min(1).optional(), lastName: z.string().trim().optional().nullable(), phone: z.string().trim().min(6).optional(), college: z.string().trim().optional().nullable(), degree: z.string().trim().optional().nullable(), permanentAddress: z.string().trim().optional().nullable(), isActive: z.boolean().optional() }), req.body);
  if (!(await one(`SELECT 1 FROM users WHERE id=$1 AND role='student'`, [id]))) throw notFound("Student not found.");
  await tx(async (c) => {
    await q(`UPDATE student_profiles SET first_name=COALESCE($2,first_name), last_name=CASE WHEN $3::boolean THEN $4 ELSE last_name END, college=COALESCE($5,college), degree=COALESCE($6,degree), permanent_address=COALESCE($7,permanent_address) WHERE user_id=$1`,
      [id, b.firstName ?? null, b.lastName !== undefined, b.lastName ?? null, b.college ?? null, b.degree ?? null, b.permanentAddress ?? null], c);
    await q(`UPDATE users u SET phone=COALESCE($2,u.phone), is_active=COALESCE($3,u.is_active), name=(SELECT trim(first_name||' '||COALESCE(last_name,'')) FROM student_profiles WHERE user_id=u.id) WHERE u.id=$1`, [id, b.phone ?? null, b.isActive ?? null], c);
    if (b.isActive === false) await q(`UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [id], c);
  });
  await logReq(req, "student.updated", { entityType: "user", entityId: id, meta: b });
  ok(res, await buildStudentProfile(id));
});
adminPeople.delete("/students/:id", async (req, res) => {
  const id = idParam(req);
  if (await one(`SELECT 1 FROM enrollments WHERE student_id=$1 UNION SELECT 1 FROM payments WHERE student_id=$1 LIMIT 1`, [id]))
    throw conflict("This student has enrolment or payment history and cannot be deleted. Deactivate the account instead.");
  const r = await q(`DELETE FROM users WHERE id=$1 AND role='student' RETURNING id`, [id]);
  if (!r.length) throw notFound("Student not found.");
  await logReq(req, "student.deleted", { entityType: "user", entityId: id });
  res.json({ message: "Student deleted." });
});

/* ───────────── tutors ───────────── */
const tutorSchema = z.object({
  name: z.string().trim().min(2).max(120), email: zEmail, phone: z.string().trim().max(20).optional().nullable(), password: zPassword.optional(),
  headline: z.string().trim().max(160).optional().nullable(), bio: z.string().trim().max(2000).optional().nullable(), qualification: z.string().trim().max(200).optional().nullable(),
  expertise: z.array(z.string().trim().max(40)).max(20).default([]), experienceYears: z.coerce.number().int().min(0).max(60).default(0), linkedinUrl: zUrl,
  status: z.enum(["active", "inactive", "on_leave"]).default("active"), courseIds: z.array(z.coerce.number().int()).default([]),
});
const tutorDetail = async (id: number) => {
  const t = await one(`${tutorProfileQuery} WHERE u.id=$1`, [id]);
  if (!t) throw notFound("Tutor not found.");
  const [courses, batches] = await Promise.all([
    q(`SELECT c.id, c.name FROM course_tutors ct JOIN courses c ON c.id=ct.course_id WHERE ct.tutor_id=$1 ORDER BY c.name`, [id]),
    q(`SELECT b.id, b.code, b.status, b.start_date, c.name AS course_name, (SELECT count(*)::int FROM enrollments e WHERE e.batch_id=b.id AND e.status IN ('active','completed')) AS students
       FROM batches b JOIN courses c ON c.id=b.course_id WHERE b.tutor_id=$1 AND NOT b.archived ORDER BY b.start_date DESC NULLS LAST`, [id]),
  ]);
  return { ...t, courses, batches };
};
adminPeople.get("/tutors", async (req, res) => {
  const s = qs(req, "search"), params: any[] = [];
  let w = "u.role='tutor'";
  if (s) { params.push(`%${s}%`); w += ` AND (u.name ILIKE $1 OR u.email ILIKE $1 OR tp.tutor_code ILIKE $1)`; }
  ok(res, await q(`SELECT u.id,u.name,u.email,u.phone,u.is_active,u.last_login_at,tp.tutor_code,tp.headline,tp.expertise,tp.experience_years,tp.status,
      (SELECT count(*)::int FROM batches b WHERE b.tutor_id=u.id AND NOT b.archived AND b.status IN ('open','upcoming','ongoing')) AS active_batches,
      (SELECT count(*)::int FROM enrollments e JOIN batches b ON b.id=e.batch_id WHERE b.tutor_id=u.id AND e.status='active') AS active_students,
      (SELECT COALESCE(json_agg(c.name),'[]'::json) FROM course_tutors ct JOIN courses c ON c.id=ct.course_id WHERE ct.tutor_id=u.id) AS course_names
      FROM users u JOIN tutor_profiles tp ON tp.user_id=u.id WHERE ${w} ORDER BY u.name`, params));
});
adminPeople.get("/tutors/:id", async (req, res) => ok(res, await tutorDetail(idParam(req))));
adminPeople.post("/tutors", async (req, res) => {
  const b = parse(tutorSchema, req.body);
  const id = await tx(async (c) => {
    if (await one(`SELECT 1 FROM users WHERE email=$1`, [b.email], c)) throw conflict("A user with this email already exists.");
    const u = await one(`INSERT INTO users(name,email,phone,password_hash,role) VALUES ($1,$2,$3,$4,'tutor') RETURNING id`, [b.name, b.email, b.phone ?? null, b.password ? await hashPassword(b.password) : null], c);
    await q(`INSERT INTO tutor_profiles(user_id,tutor_code,headline,bio,qualification,expertise,experience_years,linkedin_url,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [u.id, await nextTutorCode(c), b.headline ?? null, b.bio ?? null, b.qualification ?? null, JSON.stringify(b.expertise), b.experienceYears, b.linkedinUrl ?? null, b.status], c);
    for (const cid of b.courseIds) await q(`INSERT INTO course_tutors(course_id,tutor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [cid, u.id], c);
    return u.id as number;
  });
  await sendMail(b.email, "Your Internkul tutor account", "Welcome to the teaching team", `<p>Hi ${esc(b.name)}, a tutor account has been created for you.${b.password ? " Your administrator will share your temporary password." : " Use “Forgot password” on the sign-in page to choose your password."}</p>`, { label: "Open sign-in", url: appUrl("/login") });
  await logReq(req, "tutor.created", { entityType: "user", entityId: id });
  ok(res, await tutorDetail(id), {}, 201);
});
adminPeople.put("/tutors/:id", async (req, res) => {
  const id = idParam(req), b = parse(tutorSchema.partial(), req.body);
  if (!(await one(`SELECT 1 FROM users WHERE id=$1 AND role='tutor'`, [id]))) throw notFound("Tutor not found.");
  await tx(async (c) => {
    await q(`UPDATE users SET name=COALESCE($2,name), phone=COALESCE($3,phone), is_active=COALESCE($4,is_active), password_hash=COALESCE($5,password_hash) WHERE id=$1`,
      [id, b.name ?? null, b.phone ?? null, b.status ? b.status === "active" : null, b.password ? await hashPassword(b.password) : null], c);
    await q(`UPDATE tutor_profiles SET headline=COALESCE($2,headline), bio=COALESCE($3,bio), qualification=COALESCE($4,qualification), expertise=COALESCE($5,expertise),
             experience_years=COALESCE($6,experience_years), linkedin_url=COALESCE($7,linkedin_url), status=COALESCE($8,status) WHERE user_id=$1`,
      [id, b.headline ?? null, b.bio ?? null, b.qualification ?? null, b.expertise ? JSON.stringify(b.expertise) : null, b.experienceYears ?? null, b.linkedinUrl ?? null, b.status ?? null], c);
    if (b.courseIds) {
      await q(`DELETE FROM course_tutors WHERE tutor_id=$1`, [id], c);
      for (const cid of b.courseIds) await q(`INSERT INTO course_tutors(course_id,tutor_id) VALUES ($1,$2)`, [cid, id], c);
    }
    if (b.status && b.status !== "active") await q(`UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [id], c);
  });
  await logReq(req, "tutor.updated", { entityType: "user", entityId: id });
  ok(res, await tutorDetail(id));
});
adminPeople.delete("/tutors/:id", async (req, res) => {
  const id = idParam(req);
  if (await one(`SELECT 1 FROM batches WHERE tutor_id=$1 LIMIT 1`, [id])) throw conflict("This tutor has batches. Reassign them or set the tutor inactive instead.");
  const r = await q(`DELETE FROM users WHERE id=$1 AND role='tutor' RETURNING id`, [id]);
  if (!r.length) throw notFound("Tutor not found.");
  res.json({ message: "Tutor deleted." });
});
