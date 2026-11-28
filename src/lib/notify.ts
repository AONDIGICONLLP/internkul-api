import { q, type Db } from "../db.js";

export interface Notice { type?: string; title: string; body?: string; link?: string }
export async function notify(userId: number, n: Notice, db?: Db) {
  await q(`INSERT INTO notifications(user_id,type,title,body,link) VALUES ($1,$2,$3,$4,$5)`,
    [userId, n.type ?? "info", n.title, n.body ?? null, n.link ?? null], db);
}
export async function notifyMany(userIds: number[], n: Notice, db?: Db) {
  if (!userIds.length) return;
  await q(
    `INSERT INTO notifications(user_id,type,title,body,link)
     SELECT u, $2, $3, $4, $5 FROM unnest($1::bigint[]) AS u`,
    [userIds, n.type ?? "info", n.title, n.body ?? null, n.link ?? null], db);
}
