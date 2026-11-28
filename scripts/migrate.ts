/** Minimal forward-only SQL migration runner:  npm run migrate [-- --legacy] */
import fs from "node:fs";
import path from "node:path";
import { pool } from "../src/db.js";

const dir = path.resolve("db/migrations");
await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
const done = new Set((await pool.query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name));
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(f)) continue;
  console.log(`→ applying ${f}`);
  const c = await pool.connect();
  try {
    await c.query("BEGIN"); await c.query(fs.readFileSync(path.join(dir, f), "utf8"));
    await c.query(`INSERT INTO schema_migrations(name) VALUES ($1)`, [f]); await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); console.error(`✗ ${f} failed:`, (e as Error).message); process.exit(1); }
  finally { c.release(); }
}
if (process.argv.includes("--legacy")) {
  const f = path.resolve("db/seed/002_legacy_data.sql");
  console.log("→ importing legacy data (db/seed/002_legacy_data.sql)");
  await pool.query(fs.readFileSync(f, "utf8"));
}
console.log("✓ database up to date");
await pool.end();
