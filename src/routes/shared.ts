import fs from "node:fs";
import { Router } from "express";
import { one, q } from "../db.js";
import { forbidden, idParam, notFound, ok, parse, qs } from "../lib/http.js";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { absolutePath } from "../middleware/upload.js";
import { logReq } from "../lib/activity.js";
import { assertCanAccessDocument } from "../services/documents.js";
import { renderCertificatePdf } from "../services/certificates.js";

/** Endpoints available to any signed-in role (access rules enforced per resource). */
export const sharedRouter = Router();

sharedRouter.get("/notifications", authenticate, async (req, res) => {
  const unreadOnly = qs(req, "unread") === "1";
  const rows = await q(`SELECT * FROM notifications WHERE user_id=$1 ${unreadOnly ? "AND read_at IS NULL" : ""} ORDER BY created_at DESC LIMIT 50`, [req.user!.id]);
  const unread = (await one<{ n: number }>(`SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND read_at IS NULL`, [req.user!.id]))!.n;
  ok(res, rows, { unread });
});
sharedRouter.post("/notifications/read", authenticate, async (req, res) => {
  const b = parse(z.object({ ids: z.array(z.coerce.number().int()).optional() }), req.body ?? {});
  await q(`UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2))`, [req.user!.id, b.ids ?? null]);
  res.json({ message: "Marked as read." });
});

sharedRouter.get("/documents/:id/download", authenticate, async (req, res) => {
  const d = await assertCanAccessDocument(req.user!, idParam(req));
  if (req.user!.role === "student") await logReq(req, "document.downloaded", { entityType: "document", entityId: d.id, meta: { title: d.title } });
  if (!d.file_path) return void res.redirect(d.external_url);
  const abs = absolutePath(d.file_path);
  if (!fs.existsSync(abs)) throw notFound("The file is no longer available.");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.download(abs, d.file_name ?? "document");
});

/** Certificate PDF – owner or admin only. Rendered on demand from the registry so revocations show immediately. */
sharedRouter.get("/certificates/:credentialId/pdf", authenticate, async (req, res) => {
  const c = await one(`SELECT * FROM credentials WHERE credential_id=$1`, [req.params.credentialId]);
  if (!c) throw notFound("Certificate not found.");
  if (req.user!.role !== "admin" && c.user_id !== req.user!.id) throw forbidden();
  const pdf = await renderCertificatePdf(c);
  if (req.user!.role === "student") await logReq(req, "certificate.downloaded", { entityType: "credential", entityId: c.credential_id });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${c.credential_id}.pdf"`);
  res.send(pdf);
});
