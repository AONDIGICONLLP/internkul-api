/** Demo data for local development: 1 tutor, batches for the first active courses, sessions and a sample document.  npm run seed:demo */
import { one, pool, q } from "../src/db.js";
import { hashPassword } from "../src/lib/tokens.js";
import { nextTutorCode } from "../src/lib/ids.js";

const pw = await hashPassword("Tutor#12345");
const tutor = await one(`INSERT INTO users(name,email,phone,password_hash,role,email_verified_at) VALUES ('Aarav Mentor','tutor@internkul.com','9000000001',$1,'tutor',now())
  ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash RETURNING id`, [pw]);
await q(`INSERT INTO tutor_profiles(user_id,tutor_code,headline,expertise,experience_years,qualification) VALUES ($1,$2,'Senior Full-Stack & AI Mentor','["React","Node.js","Python","ML"]',8,'M.Tech CSE')
  ON CONFLICT (user_id) DO NOTHING`, [tutor.id, await nextTutorCode()]);

const courses = await q(`SELECT id, code, slug FROM courses WHERE status='active' ORDER BY id LIMIT 3`);
const start = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
for (const c of courses) {
  await q(`INSERT INTO course_tutors(course_id,tutor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [c.id, tutor.id]);
  for (const t of ["07:30_AM", "06:00_PM"]) {
    const code = `${c.code}-${t.replace(/\D/g, "")}${t.slice(-2)}-DEMO`;
    const b = await one(`INSERT INTO batches(code,course_id,timing_id,tutor_id,start_date,seat_limit,status) VALUES ($1,$2,$3,$4,$5,25,'open')
      ON CONFLICT (code) DO UPDATE SET tutor_id=EXCLUDED.tutor_id RETURNING id`, [code, c.id, t, tutor.id, start]);
    await q(`INSERT INTO class_sessions(batch_id,title,starts_at,duration_minutes) SELECT $1,'Orientation & environment setup', now() + interval '3 days', 90
             WHERE NOT EXISTS (SELECT 1 FROM class_sessions WHERE batch_id=$1)`, [b.id]);
  }
}
await q(`INSERT INTO documents(title,description,kind,scope,course_id,external_url,uploaded_by)
  SELECT 'Course handbook (link)','Read before day 1','link','course',c.id,'https://example.com/handbook',$1 FROM courses c WHERE c.status='active'
  AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.course_id=c.id) LIMIT 3`, [tutor.id]);
console.log("✓ demo data ready  →  tutor@internkul.com / Tutor#12345");
await pool.end();
