import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { config } from "../config.js";
import { badRequest } from "../lib/http.js";

export const uploadRoot = path.resolve(config.UPLOAD_DIR);
fs.mkdirSync(uploadRoot, { recursive: true });

const ALLOWED = new Set([
  "application/pdf", "application/zip", "application/x-zip-compressed", "text/plain", "text/markdown", "text/csv",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png", "image/jpeg", "image/webp", "video/mp4",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(uploadRoot, new Date().toISOString().slice(0, 7));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase().slice(0, 10)),
});

export const upload = multer({
  storage,
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    ALLOWED.has(file.mimetype) ? cb(null, true) : cb(badRequest("This file type is not allowed. Use PDF, Office documents, images, zip, csv/txt or mp4.")),
});

/** Path stored in DB is relative to the upload root; resolve defensively to block traversal. */
export function absolutePath(rel: string): string {
  const abs = path.resolve(uploadRoot, rel);
  if (!abs.startsWith(uploadRoot + path.sep)) throw badRequest("Invalid file path.");
  return abs;
}
export const relativePath = (abs: string) => path.relative(uploadRoot, abs);
export const removeFile = (rel?: string | null) => { if (rel) fs.promises.unlink(absolutePath(rel)).catch(() => {}); };
