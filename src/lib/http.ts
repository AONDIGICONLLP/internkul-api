import type { Request, Response } from "express";
import { z, ZodType } from "zod";
import { camelize } from "../db.js";

export class ApiError extends Error {
  constructor(public status: number, message: string, public errors?: Record<string, string[]>) {
    super(message);
  }
}
export const badRequest = (m: string) => new ApiError(400, m);
export const unauthorized = (m = "Authentication required.") => new ApiError(401, m);
export const forbidden = (m = "You do not have permission to do that.") => new ApiError(403, m);
export const notFound = (m = "Resource not found.") => new ApiError(404, m);
export const conflict = (m: string) => new ApiError(409, m);

/** Validate with zod; failures become a Laravel-style 422 `{ message, errors: { field: [msg] } }` the UI already understands. */
export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const errors: Record<string, string[]> = {};
  for (const i of r.error.issues) (errors[i.path.join(".") || "_"] ||= []).push(i.message);
  const first = Object.entries(errors)[0];
  throw new ApiError(422, first ? `${first[0] === "_" ? "" : first[0] + ": "}${first[1][0]}` : "Validation failed.", errors);
}

export interface Page { page: number; perPage: number; offset: number }
export function pageOf(req: Request, defaultPer = 20): Page {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(String(req.query.per_page ?? defaultPer), 10) || defaultPer));
  return { page, perPage, offset: (page - 1) * perPage };
}

export function ok(res: Response, data: unknown, extra: Record<string, unknown> = {}, status = 200) {
  res.status(status).json({ data: camelize(data), ...extra });
}
export function paged(res: Response, rows: unknown[], total: number, p: Page) {
  res.json({
    data: camelize(rows),
    meta: { currentPage: p.page, lastPage: Math.max(1, Math.ceil(total / p.perPage)), perPage: p.perPage, total },
  });
}

export const qs = (req: Request, key: string): string | undefined => {
  const v = req.query[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
export const idParam = (req: Request, key = "id"): number => {
  const n = Number((req.params as Record<string, string>)[key]);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${key}.`);
  return n;
};
export const clientIp = (req: Request) => (req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "");

/** Common zod building blocks */
export const zEmail = z.string().trim().toLowerCase().email("Enter a valid email address.");
export const zPassword = z.string().min(8, "Password must be at least 8 characters.").max(128);
export const zOptStr = z.string().trim().max(2000).optional().nullable().transform((v) => (v === "" ? null : v));
export const zUrl = z.string().trim().url("Enter a valid URL.").max(500).optional().nullable().or(z.literal("").transform(() => null));
