import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { one, q } from "../db.js";

export type Role = "admin" | "tutor" | "student";
export interface SessionUser { id: number; name: string; email: string; role: Role; avatarUrl: string | null; phone: string | null }

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const hashPassword = (p: string) => bcrypt.hash(p, 12);
export const verifyPassword = (p: string, hash: string) => bcrypt.compare(p, hash);

export function signAccessToken(u: { id: number; role: Role }) {
  return jwt.sign({ role: u.role }, config.JWT_SECRET, {
    subject: String(u.id), expiresIn: config.ACCESS_TOKEN_TTL as any, algorithm: "HS256",
  });
}
export function verifyAccessToken(token: string): { id: number; role: Role } {
  const p = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
  return { id: Number(p.sub), role: p.role as Role };
}

/** Opaque, rotating refresh token – only a SHA-256 hash is stored. */
export async function issueRefreshToken(userId: number, meta: { ua?: string; ip?: string } = {}) {
  const raw = crypto.randomBytes(48).toString("base64url");
  await q(
    `INSERT INTO refresh_tokens(user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1,$2, now() + ($3 || ' days')::interval, $4, $5)`,
    [userId, sha256(raw), String(config.REFRESH_TOKEN_DAYS), meta.ua?.slice(0, 250) ?? null, meta.ip ?? null],
  );
  return raw;
}
/** Consumes a refresh token (rotation). Returns the user id or null. A replayed token revokes the whole family. */
export async function consumeRefreshToken(raw: string): Promise<number | null> {
  const row = await one<{ id: number; user_id: number; revoked_at: Date | null; expires_at: Date }>(
    `SELECT id, user_id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash=$1`, [sha256(raw)]);
  if (!row) return null;
  if (row.revoked_at) {            // reuse of a rotated token => assume theft, kill all sessions of this user
    await q(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id=$1 AND revoked_at IS NULL`, [row.user_id]);
    return null;
  }
  if (row.expires_at < new Date()) return null;
  await q(`UPDATE refresh_tokens SET revoked_at = now() WHERE id=$1`, [row.id]);
  return row.user_id;
}
export const revokeRefreshToken = (raw: string) =>
  q(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash=$1 AND revoked_at IS NULL`, [sha256(raw)]);

export const publicUser = (u: any): SessionUser => ({
  id: u.id, name: u.name, email: u.email, role: u.role, avatarUrl: u.avatar_url ?? null, phone: u.phone ?? null,
});

export async function startSession(user: any, meta: { ua?: string; ip?: string } = {}) {
  await q(`UPDATE users SET last_login_at = now(), last_active_at = now() WHERE id=$1`, [user.id]);
  return {
    user: publicUser(user),
    token: signAccessToken(user),
    refreshToken: await issueRefreshToken(user.id, meta),
    tokenType: "Bearer",
  };
}
