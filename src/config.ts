import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  APP_URL: z.string().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL: z.string().default("30m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().default(14),
  PAYMENT_DRIVER: z.enum(["razorpay", "mock"]).default("mock"),
  RAZORPAY_KEY_ID: z.string().default(""),
  RAZORPAY_KEY_SECRET: z.string().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(""),
  // Swagger UI at /api/v1/docs. Defaults to on; set ENABLE_DOCS=false to hide it in production.
  ENABLE_DOCS: z.string().default("true"),
  PUBLIC_API_URL: z.string().default(""),
  UPLOAD_DIR: z.string().default("./uploads"),
  MAX_UPLOAD_MB: z.coerce.number().default(25),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.string().default("false"),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z.string().default('"Internkul" <no-reply@internkul.com>'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const i of parsed.error.issues) console.error(`  - ${i.path.join(".")}: ${i.message}`);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === "production";

if (isProd && config.PAYMENT_DRIVER === "mock") {
  console.error("PAYMENT_DRIVER=mock is not allowed in production.");
  process.exit(1);
}
if (config.PAYMENT_DRIVER === "razorpay" && (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET)) {
  console.error("PAYMENT_DRIVER=razorpay requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
  process.exit(1);
}
