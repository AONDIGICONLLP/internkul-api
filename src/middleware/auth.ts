import type { NextFunction, Request, Response } from "express";
import { one, q } from "../db.js";
import { forbidden, unauthorized } from "../lib/http.js";
import { publicUser, verifyAccessToken, type Role, type SessionUser } from "../lib/tokens.js";

declare module "express-serve-static-core" {
  interface Request { user?: SessionUser }
}

async function resolveUser(req: Request): Promise<SessionUser | null> {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  let claims: { id: number; role: Role };
  try { claims = verifyAccessToken(h.slice(7)); } catch { throw unauthorized("Session expired. Please sign in again."); }
  const u = await one(`SELECT id,name,email,role,avatar_url,phone,is_active,last_active_at FROM users WHERE id=$1`, [claims.id]);
  if (!u || !u.is_active || u.role !== claims.role) throw unauthorized("Account is disabled or no longer exists.");
  if (!u.last_active_at || Date.now() - new Date(u.last_active_at).getTime() > 5 * 60_000) {
    q(`UPDATE users SET last_active_at = now() WHERE id=$1`, [u.id]).catch(() => {});
  }
  return publicUser(u);
}

/** Requires a valid access token. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const u = await resolveUser(req);
  if (!u) throw unauthorized();
  req.user = u;
  next();
}
/** Attaches req.user when a valid token is present but never rejects anonymous callers. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try { req.user = (await resolveUser(req)) ?? undefined; } catch { /* treat as anonymous */ }
  next();
}
export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) throw unauthorized();
  if (!roles.includes(req.user.role)) throw forbidden();
  next();
};
