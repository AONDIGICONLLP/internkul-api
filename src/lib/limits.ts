import rateLimit from "express-rate-limit";

const make = (windowMin: number, max: number, message: string) =>
  rateLimit({ windowMs: windowMin * 60_000, limit: max, standardHeaders: "draft-7", legacyHeaders: false, message: { message } });

export const loginLimiter = make(15, 20, "Too many sign-in attempts. Please try again in a few minutes.");
export const resetLimiter = make(60, 8, "Too many reset requests. Please try again later.");
export const lookupLimiter = make(10, 40, "Too many requests. Please slow down.");
export const checkoutLimiter = make(60, 30, "Too many checkout attempts. Please try again later.");
export const formLimiter = make(60, 15, "Too many submissions. Please try again later.");
export const emailOtpLimiter = make(60, 20, "Too many verification attempts. Please try again later.");
