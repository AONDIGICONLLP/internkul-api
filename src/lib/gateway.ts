import crypto from "node:crypto";
import Razorpay from "razorpay";
import { config } from "../config.js";

/**
 * Payment gateway abstraction.
 *  - "razorpay": real gateway (amounts are always taken from the DB price, never from the browser)
 *  - "mock":     local dev only – lets the whole checkout run without keys (blocked in production by config.ts)
 */
export interface GatewayOrder { id: string; amount: number; currency: string }
const MOCK_SECRET = "mock_secret_dev_only";
const hmac = (secret: string, body: string) => crypto.createHmac("sha256", secret).update(body).digest("hex");
const safeEq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const rz = config.PAYMENT_DRIVER === "razorpay"
  ? new Razorpay({ key_id: config.RAZORPAY_KEY_ID, key_secret: config.RAZORPAY_KEY_SECRET }) : null;

export const gateway = {
  driver: config.PAYMENT_DRIVER,
  publicKey: config.PAYMENT_DRIVER === "razorpay" ? config.RAZORPAY_KEY_ID : "mock_key",

  async createOrder(amountInr: number, receipt: string, notes: Record<string, string>): Promise<GatewayOrder> {
    const paise = Math.round(amountInr * 100);
    if (!rz) return { id: "order_mock_" + crypto.randomBytes(7).toString("hex"), amount: paise, currency: "INR" };
    const o = await rz.orders.create({ amount: paise, currency: "INR", receipt, notes });
    return { id: o.id, amount: Number(o.amount), currency: o.currency };
  },

  verifySignature(orderId: string, paymentId: string, signature: string): boolean {
    const secret = rz ? config.RAZORPAY_KEY_SECRET : MOCK_SECRET;
    return safeEq(hmac(secret, `${orderId}|${paymentId}`), signature);
  },
  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    if (!config.RAZORPAY_WEBHOOK_SECRET) return false;
    return safeEq(hmac(config.RAZORPAY_WEBHOOK_SECRET, rawBody.toString("utf8")), signature);
  },
  /** Dev helper – produce what Razorpay Checkout would hand back after a successful payment. */
  mockPayment(orderId: string) {
    const paymentId = "pay_mock_" + crypto.randomBytes(7).toString("hex");
    return { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: hmac(MOCK_SECRET, `${orderId}|${paymentId}`) };
  },

  async paymentMethod(paymentId: string): Promise<string | null> {
    if (!rz) return "mock";
    try { return ((await rz.payments.fetch(paymentId)) as any).method ?? null; } catch { return null; }
  },
  async refund(paymentId: string, amountInr: number): Promise<{ id: string } | null> {
    if (!rz) return { id: "rfnd_mock_" + crypto.randomBytes(5).toString("hex") };
    const r = await rz.payments.refund(paymentId, { amount: Math.round(amountInr * 100) });
    return { id: r.id };
  },
};
