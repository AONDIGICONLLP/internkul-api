import express, { Router } from "express";
import { z } from "zod";
import { one, q, tx } from "../db.js";
import { ApiError, conflict, notFound, ok, parse, zEmail, zPassword } from "../lib/http.js";
import { gateway } from "../lib/gateway.js";
import { logActivity } from "../lib/activity.js";
import { receiptNo, studentCode } from "../lib/ids.js";
import { hashPassword, startSession } from "../lib/tokens.js";
import { checkoutLimiter } from "../lib/limits.js";
import { optionalAuth } from "../middleware/auth.js";
import { markPaymentFailed, settlePayment } from "../services/payments.js";
import { buildStudentProfile } from "../services/profile.js";
import { config, isProd } from "../config.js";
import { clientIp } from "../lib/http.js";

export const checkoutRouter = Router();

const orderSchema = z.object({
  courseSlug: z.string().trim().min(1), planCode: z.string().trim().min(1), timingId: z.string().trim().optional().nullable(),
  student: z.object({
    firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().max(100).optional().nullable(), email: zEmail,
    phone: z.string().trim().min(6).max(20), countryCode: z.string().trim().max(8).default("+91"),
    college: z.string().trim().max(255).optional().nullable(), permanentAddress: z.string().trim().max(1000).optional().nullable(),
    password: zPassword.optional().nullable().or(z.literal("").transform(() => null)),
  }),
});

/**
 * Step 1 – creates (or reuses) the student, a pending enrollment and a gateway order.
 * The amount is ALWAYS read from course_plans; nothing price-related is trusted from the browser.
 */
checkoutRouter.post("/orders", checkoutLimiter, optionalAuth, async (req, res) => {
  const b = parse(orderSchema, req.body);
  const plan = await one(
    `SELECT p.*, c.id AS cid, c.name AS course_name, c.code AS course_code, c.status AS course_status, c.available_timings
     FROM course_plans p JOIN courses c ON c.id=p.course_id WHERE c.slug=$1 AND p.code=$2`, [b.courseSlug, b.planCode]);
  if (!plan || plan.course_status !== "active" || !plan.is_active) throw notFound("This course or duration is not available for enrolment.");
  if (b.timingId && !(plan.available_timings as string[]).includes(b.timingId)) throw new ApiError(422, "That time-slot is not offered for this course.");
  const timing = b.timingId ?? null;
  const amount = Number(plan.price_inr);

  const out = await tx(async (c) => {
    // ── identify the student ──
    let user: any = null, newAccount = false;
    if (req.user?.role === "student") user = await one(`SELECT * FROM users WHERE id=$1`, [req.user.id], c);
    else if (req.user) throw new ApiError(403, "Staff accounts cannot purchase courses.");
    if (!user) user = await one(`SELECT * FROM users WHERE email=$1`, [b.student.email], c);
    if (user && user.role !== "student") throw new ApiError(403, "This email belongs to a staff account.");
    if (!user) {
      user = await one(`INSERT INTO users(name,email,phone,country_code,password_hash,role) VALUES ($1,$2,$3,$4,$5,'student') RETURNING *`,
        [`${b.student.firstName} ${b.student.lastName ?? ""}`.trim(), b.student.email, b.student.phone, b.student.countryCode,
         b.student.password ? await hashPassword(b.student.password) : null], c);
      await q(`INSERT INTO student_profiles(user_id,student_code,first_name,last_name,college,permanent_address,interested_course_slug)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [user.id, studentCode(plan.course_code), b.student.firstName, b.student.lastName ?? null, b.student.college ?? null, b.student.permanentAddress ?? null, b.courseSlug], c);
      newAccount = !!b.student.password;
    } else if (!user.is_active) throw new ApiError(403, "This account has been disabled. Please contact support.");
    else if (req.user) {  // logged-in student may refresh their own profile details at checkout
      await q(`UPDATE student_profiles SET college=COALESCE($2,college), permanent_address=COALESCE($3,permanent_address) WHERE user_id=$1`,
        [user.id, b.student.college ?? null, b.student.permanentAddress ?? null], c);
    }

    // ── enrolment ──
    let enr = await one(`SELECT * FROM enrollments WHERE student_id=$1 AND course_id=$2 AND status IN ('pending_payment','active','completed','suspended')`, [user.id, plan.cid], c);
    if (enr && enr.status !== "pending_payment") throw conflict("You are already enrolled in this course. Open your dashboard to continue learning.");
    if (enr) enr = await one(`UPDATE enrollments SET plan_id=$2, timing_id=$3, amount_due=$4 WHERE id=$1 RETURNING *`, [enr.id, plan.id, timing, amount], c);
    else enr = await one(`INSERT INTO enrollments(student_id,course_id,plan_id,timing_id,status,amount_due) VALUES ($1,$2,$3,$4,'pending_payment',$5) RETURNING *`, [user.id, plan.cid, plan.id, timing, amount], c);

    // ── free plans skip the gateway ──
    if (amount === 0) {
      await q(`UPDATE enrollments SET status='active' WHERE id=$1`, [enr.id], c);
      return { user, enr, free: true as const, newAccount };
    }
    // abandoned attempts for this enrolment are closed, then a fresh order is created
    await q(`UPDATE payments SET status='failed', failure_reason='superseded by a new attempt' WHERE enrollment_id=$1 AND status='created'`, [enr.id], c);
    const receipt = await receiptNo(c);
    const order = await gateway.createOrder(amount, receipt, { course: plan.course_name, plan: plan.label, student: user.email });
    const pay = await one(
      `INSERT INTO payments(enrollment_id,student_id,provider,status,amount,receipt_no,razorpay_order_id,raw)
       VALUES ($1,$2,$3,'created',$4,$5,$6,$7) RETURNING id`,
      [enr.id, user.id, gateway.driver === "razorpay" ? "razorpay" : "razorpay", amount, receipt, order.id, JSON.stringify({ checkout: { newAccount, plan: plan.code } })], c);
    return { user, enr, order, pay, free: false as const, newAccount };
  });

  if (out.free) {
    const s = await tx((c) => import("../services/enrollment.js").then((m) => m.autoAssign(out.enr.id, c)));
    return ok(res, { free: true, enrollmentId: out.enr.id, batchAssigned: !!s, ...(out.newAccount ? await startSession(out.user) : {}) }, {}, 201);
  }
  ok(res, {
    free: false, driver: gateway.driver, key: gateway.publicKey, order: out.order, enrollmentId: out.enr.id, paymentId: out.pay!.id,
    amount, currency: "INR", course: plan.course_name, plan: plan.label,
  }, {}, 201);
});

/**
 * Step 2 – browser hands back Razorpay's three fields; we verify the HMAC signature server-side.
 * A session is only issued when the account was created in this very checkout (prevents someone paying
 * with another person's e-mail from being logged in as them).
 */
checkoutRouter.post("/verify", checkoutLimiter, optionalAuth, async (req, res) => {
  const b = parse(z.object({ razorpay_order_id: z.string().min(5), razorpay_payment_id: z.string().min(5), razorpay_signature: z.string().min(10) }), req.body);
  if (!gateway.verifySignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) throw new ApiError(400, "Payment signature could not be verified.");
  const method = await gateway.paymentMethod(b.razorpay_payment_id);
  const r = await settlePayment({ orderId: b.razorpay_order_id, paymentId: b.razorpay_payment_id, signature: b.razorpay_signature, method });
  const user = await one(`SELECT * FROM users WHERE id=$1`, [r.payment.student_id]);
  const canLogin = !!(r.payment.raw?.checkout?.newAccount) && Date.now() - new Date(user.created_at).getTime() < 2 * 3600_000;
  const session = canLogin && !req.user ? await startSession(user, { ip: clientIp(req) }) : null;
  ok(res, {
    paid: true, paymentId: b.razorpay_payment_id, receiptNo: r.payment.receipt_no, enrollmentId: r.payment.enrollment_id,
    batchAssigned: !!r.batchId, signedIn: !!session, ...(session ?? {}),
    student: session ? await buildStudentProfile(user.id) : undefined,
    message: session ? "Payment successful." : "Payment successful. Please sign in to access your course.",
  });
});

/** Razorpay → server webhook (backup for browser-side failures). Needs the raw body for signature checking. */
export const webhookRouter = Router();
webhookRouter.post("/", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  const sig = String(req.get("x-razorpay-signature") ?? "");
  if (!Buffer.isBuffer(req.body) || !gateway.verifyWebhook(req.body, sig)) return void res.status(400).json({ message: "Invalid signature." });
  const evt = JSON.parse(req.body.toString("utf8"));
  const pay = evt?.payload?.payment?.entity;
  if (pay?.order_id) {
    if (["payment.captured", "order.paid"].includes(evt.event)) {
      await settlePayment({ orderId: pay.order_id, paymentId: pay.id, method: pay.method, raw: { event: evt.event } }).catch((e) => console.error("[webhook] settle failed", e.message));
    } else if (evt.event === "payment.failed") await markPaymentFailed(pay.order_id, pay.error_description ?? "Payment failed");
    await logActivity({ action: `webhook.${evt.event}`, entityType: "payment", entityId: pay.id });
  }
  res.json({ received: true });
});

/** Local development only: simulates the successful Razorpay popup so the flow can be exercised without keys. */
if (!isProd && config.PAYMENT_DRIVER === "mock") {
  checkoutRouter.post("/dev/simulate", async (req, res) => {
    const { orderId } = parse(z.object({ orderId: z.string() }), req.body);
    res.json({ data: gateway.mockPayment(orderId) });   // raw snake_case, like Razorpay Checkout
  });
}
