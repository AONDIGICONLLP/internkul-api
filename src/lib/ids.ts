import crypto from "node:crypto";
import { one, type Db } from "../db.js";

const rand4 = () => String(crypto.randomInt(1000, 10000));
export const studentCode = (courseCode?: string | null) => `STU-${new Date().getFullYear()}-${(courseCode || "GEN").toUpperCase()}-${rand4()}`;

export async function nextTutorCode(db?: Db) {
  const r = await one<{ n: number }>(`SELECT COALESCE(MAX(NULLIF(regexp_replace(tutor_code,'\\D','','g'),'')::int),0)+1 AS n FROM tutor_profiles`, [], db);
  return `TUT-${String(r!.n).padStart(4, "0")}`;
}
export async function receiptNo(db?: Db, prefix = "RCPT") {
  const r = await one<{ n: number }>(`SELECT nextval('receipt_seq') AS n`, [], db);
  return `${prefix}-${new Date().getFullYear()}-${r!.n}`;
}
export async function credentialId(courseCode: string, prefix: string, db?: Db) {
  const r = await one<{ n: number }>(`SELECT nextval('credential_seq') AS n`, [], db);
  return `${prefix}-${new Date().getFullYear()}-${courseCode.toUpperCase()}-${r!.n}`;
}
export const courseCodeFromSlug = (slug: string) => {
  const parts = slug.split("-").filter(Boolean);
  const code = (parts.length > 1 ? parts.map((p) => p[0]).join("") : parts[0] || "CRS").replace(/[^a-z0-9]/gi, "").toUpperCase();
  return code.slice(0, 5) || "CRS";
};
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
export const settingsGet = async <T = any>(key: string, fallback: T, db?: Db): Promise<T> =>
  (await one<{ value: T }>(`SELECT value FROM app_settings WHERE key=$1`, [key], db))?.value ?? fallback;
