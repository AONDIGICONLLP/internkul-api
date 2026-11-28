import { one, q, tx } from "../db.js";
import { ApiError, notFound } from "../lib/http.js";
import { gateway } from "../lib/gateway.js";
import { logActivity } from "../lib/activity.js";
import { appUrl, esc, sendMail } from "../lib/mail.js";
import { notify } from "../lib/notify.js";
import { autoAssign } from "./enrollment.js";

export interface SettleInput { orderId: string; paymentId: string; signature?: string | null; method?: string | null; raw?: unknown }

/**
 * Idempotent "payment captured" handler shared by the browser verify call and the Razorpay webhook.
 * Safe to run twice: the second run finds the row already paid and returns early.
 */
export async function settlePayment(i: SettleInput) {
  const result = await tx(async (c) => {
    const p = await one(`SELECT * FROM payments WHERE razorpay_order_id=$1 FOR UPDATE`, [i.orderId], c);
    if (!p) throw notFound("Unknown payment order.");
    if (p.status === "paid" || p.status === "refunded" || p.status === "partially_refunded") return { payment: p, already: true, batchId: null as number | null };
    try {
      await q(`UPDATE payments SET status='paid', razorpay_payment_id=$2, razorpay_signature=$3, method=$4, paid_at=now(),
               failure_reason=NULL, raw = COALESCE(raw,'{}'::jsonb) || $5::jsonb WHERE id=$1`,
        [p.id, i.paymentId, i.signature ?? null, i.method ?? null, JSON.stringify({ capture: i.raw ?? null })], c);
    } catch (e: any) {
      if (e.code === "23505") throw new ApiError(409, "This payment id has already been used for another order.");
      throw e;
    }
    let batchId: number | null = null;
    if (p.enrollment_id) {
      await q(`UPDATE enrollments SET status='active' WHERE id=$1 AND status='pending_payment'`, [p.enrollment_id], c);
      batchId = await autoAssign(p.enrollment_id, c);
    }
    return { payment: { ...p, status: "paid" }, already: false, batchId };
  });

  const { payment } = result;
  if (!result.already) {
    // side-effects after commit – failures here must not undo a captured payment
    try {
      const info = await one(
        `SELECT u.id AS user_id, u.name, u.email, c.name AS course_name, pl.label AS plan_label, e.id AS enrollment_id,
                b.code AS batch_code, b.start_date
         FROM payments p JOIN users u ON u.id=p.student_id
         LEFT JOIN enrollments e ON e.id=p.enrollment_id LEFT JOIN courses c ON c.id=e.course_id
         LEFT JOIN course_plans pl ON pl.id=e.plan_id LEFT JOIN batches b ON b.id=e.batch_id WHERE p.id=$1`, [payment.id]);
      if (info) {
        await notify(info.user_id, { type: "success", title: "Payment received", body: `${info.course_name ?? "Course"} – ₹${payment.amount}. Receipt ${payment.receipt_no}`,
          link: info.enrollment_id ? `/student/courses/${info.enrollment_id}` : "/student/payments" });
        const batchLine = info.batch_code
          ? `You have been placed in batch <b>${esc(info.batch_code)}</b>${info.start_date ? ` starting <b>${info.start_date}</b>` : ""}.`
          : "We will assign you to a batch shortly and notify you here and by email.";
        await sendMail(info.email, "Payment received – welcome to Internkul", "Payment received",
          `<p>Hi ${esc(info.name)}, we received your payment of <b>₹${payment.amount}</b> for <b>${esc(info.course_name ?? "your course")}</b>${info.plan_label ? ` (${esc(info.plan_label)})` : ""}.</p>
           <p>Receipt no: <b>${esc(payment.receipt_no)}</b></p><p>${batchLine}</p>`, { label: "Open my dashboard", url: appUrl("/student") });
        await logActivity({ action: "payment.captured", userId: info.user_id, role: "student", enrollmentId: info.enrollment_id, entityType: "payment", entityId: payment.id, meta: { amount: payment.amount, batch: info.batch_code } });
      }
    } catch (e) { console.error("[payments] post-capture side effects failed", e); }
  }
  return result;
}

export async function markPaymentFailed(orderId: string, reason: string) {
  await q(`UPDATE payments SET status='failed', failure_reason=$2 WHERE razorpay_order_id=$1 AND status='created'`, [orderId, reason.slice(0, 300)]);
}

/** Admin refund: calls the gateway for gateway payments, then records it. */
export async function refundPayment(paymentId: number, amount: number, reason: string, adminId: number) {
  const p = await one(`SELECT * FROM payments WHERE id=$1`, [paymentId]);
  if (!p) throw notFound("Payment not found.");
  if (!["paid", "partially_refunded"].includes(p.status)) throw new ApiError(409, "Only paid payments can be refunded.");
  const refundable = Number(p.amount) - Number(p.refunded_amount);
  if (amount <= 0 || amount > refundable) throw new ApiError(422, `Refund must be between ₹1 and ₹${refundable}.`);
  let gatewayRefund: { id: string } | null = null;
  if (p.provider === "razorpay" && p.razorpay_payment_id) {
    try { gatewayRefund = await gateway.refund(p.razorpay_payment_id, amount); }
    catch (e: any) { throw new ApiError(502, `Gateway refund failed: ${e?.error?.description ?? e?.message ?? "unknown error"}`); }
  }
  const total = Number(p.refunded_amount) + amount;
  const status = total >= Number(p.amount) ? "refunded" : "partially_refunded";
  await q(`UPDATE payments SET status=$2, refunded_amount=$3, refunded_at=now(), refund_reason=$4,
           raw = COALESCE(raw,'{}'::jsonb) || $5::jsonb WHERE id=$1`,
    [paymentId, status, total, reason, JSON.stringify({ refund: { gatewayRefundId: gatewayRefund?.id ?? null, by: adminId, amount } })]);
  if (status === "refunded" && p.enrollment_id) {
    await q(`UPDATE enrollments SET status='cancelled' WHERE id=$1 AND status IN ('active','pending_payment','suspended')`, [p.enrollment_id]);
  }
  await notify(p.student_id, { type: "info", title: "Refund processed", body: `₹${amount} has been refunded. ${reason}` });
  return { status, refunded: total };
}
