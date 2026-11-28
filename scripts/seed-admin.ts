/** Creates the first admin (or resets that admin's password):  ADMIN_EMAIL / ADMIN_PASSWORD from .env */
import { pool } from "../src/db.js";
import { hashPassword } from "../src/lib/tokens.js";

const email = (process.env.ADMIN_EMAIL ?? "admin@internkul.com").toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 8) { console.error("Set ADMIN_PASSWORD (min 8 chars) in .env"); process.exit(1); }
await pool.query(
  `INSERT INTO users(name,email,password_hash,role,email_verified_at) VALUES ('Internkul Admin',$1,$2,'admin',now())
   ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='admin', is_active=true`, [email, await hashPassword(password)]);
console.log(`✓ admin ready: ${email}`);
await pool.end();
