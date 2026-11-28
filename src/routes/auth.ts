import crypto from "node:crypto";
import { Router } from "express";
import { config, isProd } from "../config.js";
import { z } from "zod";
import { one, q, tx } from "../db.js";
import { ApiError, clientIp, conflict, ok, parse, unauthorized, zEmail, zPassword } from "../lib/http.js";
import { logActivity, logReq } from "../lib/activity.js";
import { studentCode } from "../lib/ids.js";
import { appUrl, esc, sendMail } from "../lib/mail.js";
import bcrypt from "bcryptjs";
import { consumeRefreshToken, hashPassword, publicUser, revokeRefreshToken, sha256, startSession, verifyPassword } from "../lib/tokens.js";
import { emailOtpLimiter, loginLimiter, lookupLimiter, resetLimiter } from "../lib/limits.js";
import { authenticate } from "../middleware/auth.js";
import { buildStudentProfile } from "../services/profile.js";

export const authRouter = Router();
const meta = (req: any) => ({ ua: req.get("user-agent") ?? undefined, ip: clientIp(req) });
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser", 12); // burn the same CPU for unknown emails

authRouter.post("/login", loginLimiter, async (req, res) => {
  const b = parse(z.object({ email: zEmail, password: z.string().min(1, "Enter your password.") }), req.body);
  const u = await one(`SELECT * FROM users WHERE email=$1`, [b.email]);
  let valid = false;
  if (u?.password_hash) valid = await verifyPassword(b.password, u.password_hash);
  else await verifyPassword(b.password, DUMMY_HASH);
  if (u && !u.password_hash) throw unauthorized("This account has not been activated yet. Use “Forgot password” to set your password.");
  if (!u || !valid) throw unauthorized("Invalid email or password.");
  if (!u.is_active) throw new ApiError(403, "This account has been disabled. Please contact support.");
  const session = await startSession(u, meta(req));
  await logActivity({ action: "auth.login", userId: u.id, role: u.role, ip: clientIp(req) });
  ok(res, session);
});

const registerSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(100), lastName: z.string().trim().max(100).optional().nullable(),
  email: zEmail, phone: z.string().trim().min(6, "Enter a valid phone number.").max(20), countryCode: z.string().trim().max(8).default("+91"),
  password: zPassword, college: z.string().trim().max(255).optional().nullable(), permanentAddress: z.string().trim().max(1000).optional().nullable(),
  interestedCourseSlug: z.string().trim().optional().nullable(), interestedTopics: z.array(z.string()).max(40).default([]),
  authMethod: z.enum(["manual", "google"]).default("manual"), avatarUrl: z.string().url().optional().nullable(),
}).passthrough();

authRouter.post("/register", loginLimiter, async (req, res) => {
  const b = parse(registerSchema, req.body);
  const fullName = `${b.firstName} ${b.lastName ?? ""}`.trim();
  const course = b.interestedCourseSlug ? await one(`SELECT code FROM courses WHERE slug=$1`, [b.interestedCourseSlug]) : null;
  const user = await tx(async (c) => {
    if (await one(`SELECT 1 FROM users WHERE email=$1`, [b.email], c))
      throw conflict("An account with this email already exists. Please sign in (or use “Forgot password” if you haven’t set a password yet).");
    const u = await one(`INSERT INTO users(name,email,phone,country_code,password_hash,role,avatar_url) VALUES ($1,$2,$3,$4,$5,'student',$6) RETURNING *`,
      [fullName, b.email, b.phone, b.countryCode, await hashPassword(b.password), b.avatarUrl ?? null], c);
    await q(`INSERT INTO student_profiles(user_id,student_code,first_name,last_name,college,permanent_address,interested_course_slug,interested_topics,auth_method)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [u.id, studentCode(course?.code), b.firstName, b.lastName ?? null, b.college ?? null, b.permanentAddress ?? null, b.interestedCourseSlug ?? null, JSON.stringify(b.interestedTopics), b.authMethod], c);
    return u;
  });
  const session = await startSession(user, meta(req));
  await logActivity({ action: "auth.register", userId: user.id, role: "student", ip: clientIp(req) });
  sendMail(user.email, "Welcome to Internkul", `Welcome, ${b.firstName}!`, `<p>Your student account is ready. Pick a course, join a live batch and earn a verifiable certificate.</p>`, { label: "Browse courses", url: appUrl("/tracks") });
  ok(res, { ...session, student: await buildStudentProfile(user.id) }, {}, 201);
});

/** Lets the sign-in popup decide between "log in" and "sign up". Rate-limited; reveals only existence/activation. */
authRouter.post("/check-email", lookupLimiter, async (req, res) => {
  const { email } = parse(z.object({ email: zEmail }), req.body);
  const u = await one(`SELECT role, password_hash IS NOT NULL AS activated FROM users WHERE email=$1`, [email]);
  ok(res, { exists: !!u, activated: !!u?.activated });
});

authRouter.post("/refresh", async (req, res) => {
  const { refreshToken } = parse(z.object({ refreshToken: z.string().min(10) }), req.body);
  const uid = await consumeRefreshToken(refreshToken);
  const u = uid ? await one(`SELECT * FROM users WHERE id=$1 AND is_active`, [uid]) : null;
  if (!u) throw unauthorized("Session expired. Please sign in again.");
  const s = await startSession(u, meta(req));
  ok(res, s);
});

authRouter.post("/logout", async (req, res) => {
  const t = typeof req.body?.refreshToken === "string" ? req.body.refreshToken : null;
  if (t) await revokeRefreshToken(t);
  res.json({ message: "Signed out." });
});

authRouter.get("/me", authenticate, async (req, res) => {
  const extra = req.user!.role === "student" ? { student: await buildStudentProfile(req.user!.id) } : {};
  ok(res, { ...req.user, ...extra });
});

authRouter.post("/change-password", authenticate, async (req, res) => {
  const b = parse(z.object({ currentPassword: z.string().min(1), newPassword: zPassword }), req.body);
  const u = await one(`SELECT password_hash FROM users WHERE id=$1`, [req.user!.id]);
  if (!u?.password_hash || !(await verifyPassword(b.currentPassword, u.password_hash))) throw new ApiError(422, "Current password is incorrect.", { currentPassword: ["Current password is incorrect."] });
  await q(`UPDATE users SET password_hash=$2 WHERE id=$1`, [req.user!.id, await hashPassword(b.newPassword)]);
  await q(`UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [req.user!.id]);
  await logReq(req, "auth.password_changed");
  res.json({ message: "Password updated. Please sign in again on your other devices." });
});

/* ── Password reset / account activation with a 6-digit e-mailed code (10 min, 5 attempts) ── */
authRouter.post("/forgot-password", resetLimiter, async (req, res) => {
  const { email } = parse(z.object({ email: zEmail }), req.body);
  const u = await one(`SELECT id, name, is_active FROM users WHERE email=$1`, [email]);
  if (u?.is_active) {
    const code = String(crypto.randomInt(100000, 1000000));
    await q(`UPDATE password_reset_codes SET used_at=now() WHERE user_id=$1 AND used_at IS NULL`, [u.id]);
    await q(`INSERT INTO password_reset_codes(user_id, code_hash, expires_at) VALUES ($1,$2, now() + interval '10 minutes')`, [u.id, sha256(`${u.id}:${code}`)]);
    await sendMail(email, `${code} is your Internkul verification code`, "Reset your password",
      `<p>Hi ${esc(u.name)}, use this code to set a new password. It expires in 10 minutes.</p>
       <p style="font-size:28px;letter-spacing:6px;font-weight:700;color:#172033">${code}</p><p>If you didn’t request this, you can ignore this email.</p>`);
  }
  res.json({ message: "If an account exists for that email, a verification code has been sent." });   // same answer either way
});

authRouter.post("/reset-password", resetLimiter, async (req, res) => {
  const b = parse(z.object({ email: zEmail, code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."), password: zPassword }), req.body);
  const u = await one(`SELECT id FROM users WHERE email=$1 AND is_active`, [b.email]);
  const row = u ? await one(`SELECT * FROM password_reset_codes WHERE user_id=$1 AND used_at IS NULL AND expires_at>now() ORDER BY id DESC LIMIT 1`, [u.id]) : null;
  if (!u || !row || row.attempts >= 5) throw new ApiError(422, "That code is invalid or has expired. Request a new one.");
  const match = crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(sha256(`${u.id}:${b.code}`)));
  if (!match) {
    await q(`UPDATE password_reset_codes SET attempts=attempts+1 WHERE id=$1`, [row.id]);
    throw new ApiError(422, "That code is incorrect.");
  }
  await q(`UPDATE password_reset_codes SET used_at=now() WHERE id=$1`, [row.id]);
  await q(`UPDATE users SET password_hash=$2, email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1`, [u.id, await hashPassword(b.password)]);
  await q(`UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [u.id]);
  await logActivity({ action: "auth.password_reset", userId: u.id, ip: clientIp(req) });
  res.json({ message: "Password updated. You can now sign in." });
});

/* ── E-mail ownership check used by the sign-up / checkout forms (6-digit code, 10 min, 5 attempts) ── */
authRouter.post("/email-otp/send", emailOtpLimiter, async (req, res) => {
  const { email } = parse(z.object({ email: zEmail }), req.body);
  const last = await one(`SELECT created_at FROM email_otps WHERE email=$1 ORDER BY id DESC LIMIT 1`, [email]);
  if (last && Date.now() - new Date(last.created_at).getTime() < 30_000)
    throw new ApiError(429, "A code was just sent. Please wait 30 seconds before requesting another.");
  const code = String(crypto.randomInt(100000, 1000000));
  await q(`UPDATE email_otps SET used_at=now() WHERE email=$1 AND used_at IS NULL`, [email]);
  await q(`INSERT INTO email_otps(email, code_hash, expires_at) VALUES ($1,$2, now() + interval '10 minutes')`, [email, sha256(`${email}:${code}`)]);
  await sendMail(email, `${code} is your Internkul verification code`, "Verify your email",
    `<p>Use this code to verify your email address. It expires in 10 minutes.</p><p style="font-size:28px;letter-spacing:6px;font-weight:700;color:#172033">${code}</p><p>If you didn’t request this, you can ignore this email.</p>`);
  const devMode = !config.SMTP_HOST && !isProd;     // no SMTP in development: hand the code back so the flow can be tested
  res.json({ success: true, message: "Verification code sent to your email.", ...(devMode ? { devMode: true, devOtp: code } : {}) });
});

authRouter.post("/email-otp/verify", emailOtpLimiter, async (req, res) => {
  const { email, otp } = parse(z.object({ email: zEmail, otp: z.string().regex(/^\d{6}$/, "Enter the 6-digit code.") }), req.body);
  const row = await one(`SELECT * FROM email_otps WHERE email=$1 AND used_at IS NULL AND expires_at>now() ORDER BY id DESC LIMIT 1`, [email]);
  if (!row || row.attempts >= 5) throw new ApiError(400, "That code is invalid or has expired. Request a new one.");
  if (!crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(sha256(`${email}:${otp}`)))) {
    await q(`UPDATE email_otps SET attempts=attempts+1 WHERE id=$1`, [row.id]);
    throw new ApiError(400, "That code is incorrect.");
  }
  await q(`UPDATE email_otps SET used_at=now() WHERE id=$1`, [row.id]);
  res.json({ success: true, message: "Email verified." });
});

export { publicUser };
