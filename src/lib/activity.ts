import type { Request } from "express";
import { q, type Db } from "../db.js";
import { clientIp } from "./http.js";

interface LogInput {
  action: string;
  userId?: number | null;
  role?: string | null;
  enrollmentId?: number | null;
  entityType?: string;
  entityId?: string | number;
  meta?: Record<string, unknown>;
  ip?: string;
}
/** Best-effort audit / activity trail. Never throws. */
export async function logActivity(i: LogInput, db?: Db) {
  try {
    await q(
      `INSERT INTO activity_logs(user_id, actor_role, enrollment_id, action, entity_type, entity_id, meta, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.userId ?? null, i.role ?? null, i.enrollmentId ?? null, i.action, i.entityType ?? null,
       i.entityId != null ? String(i.entityId) : null, JSON.stringify(i.meta ?? {}), i.ip ?? null], db);
  } catch (e) { console.error("[activity] failed", (e as Error).message); }
}
export const logReq = (req: Request, action: string, extra: Omit<LogInput, "action" | "userId" | "role" | "ip"> = {}) =>
  logActivity({ action, userId: req.user?.id, role: req.user?.role, ip: clientIp(req), ...extra });
