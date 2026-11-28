import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ApiError } from "../lib/http.js";
import { isProd } from "../config.js";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ message: `Route ${req.method} ${req.path} not found.` });
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  if (err instanceof ApiError) return void res.status(err.status).json({ message: err.message, errors: err.errors });
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "File is too large." : `Upload error: ${err.message}`;
    return void res.status(400).json({ message: msg });
  }
  if (err?.type === "entity.parse.failed") return void res.status(400).json({ message: "Malformed JSON body." });
  // PostgreSQL constraint violations -> friendly 4xx
  if (err?.code === "23505") return void res.status(409).json({ message: "That record already exists (duplicate value)." });
  if (err?.code === "23503") return void res.status(409).json({ message: "This record is linked to other data and cannot be changed or removed." });
  if (err?.code === "23514" || err?.code === "22P02" || err?.code === "22007") return void res.status(422).json({ message: "One of the submitted values is invalid." });
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ message: isProd ? "Something went wrong on our side." : String(err?.message ?? err) });
}
