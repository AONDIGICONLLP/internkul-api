/** End-to-end API check (needs the API running on API_URL, mock payments, fresh seeded DB).  npm run test:smoke */
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
let passed = 0, failed = 0;
async function call(method: string, path: string, body?: any, token?: string, form?: FormData) {
  const r = await fetch(API + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, body: ct.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers };
}
function check(name: string, cond: boolean, extra?: any) { cond ? passed++ : failed++; console.log(`${cond ? "  ✓" : "  ✗"} ${name}${cond ? "" : "  → " + JSON.stringify(extra)?.slice(0, 300)}`); }
const section = (s: string) => console.log(`\n${s}`);

section("Public");
let r = await call("GET", "/health"); check("health", r.status === 200 && r.body.database === "connected");
r = await call("GET", "/tracks"); check("tracks list shape", r.body.data.length >= 8 && r.body.data[0].durationOptions && r.body.data[0].startingPriceINR >= 0, r.body);
const mern = r.body.data.find((t: any) => t.slug === "mern-full-stack");
r = await call("GET", "/tracks/mern-full-stack"); check("track detail has curriculum", !!r.body.data.curriculum);
r = await call("GET", "/domains"); check("domains", r.body.data.length === 4 && r.body.data[0].countText);
r = await call("GET", "/batches"); check("timings", r.body.data.length === 4 && r.body.data[0].timeLabel);
r = await call("GET", "/credentials/verify/NOPE-1"); check("verify unknown → 404", r.status === 404 && r.body.verified === false);
r = await call("POST", "/inquiries/contact", { fullName: "Test", mobileNumber: "9999999999", email: "t@example.com", message: "hi" }); check("contact inquiry", r.status === 201, r.body);

section("Auth & RBAC");
r = await call("POST", "/auth/login", { email: "admin@internkul.com", password: "wrong" }); check("bad password → 401", r.status === 401);
r = await call("POST", "/auth/login", { email: "admin@internkul.com", password: process.env.ADMIN_PASSWORD ?? "ChangeMe#2026" });
check("admin login", r.status === 200 && r.body.data.user.role === "admin", r.body); const admin = r.body.data.token; const adminRefresh = r.body.data.refreshToken;
r = await call("POST", "/auth/login", { email: "tutor@internkul.com", password: "Tutor#12345" }); check("tutor login", r.status === 200); const tutor = r.body.data.token;
r = await call("POST", "/auth/login", { email: "gungungpta99@gmail.com", password: "whatever12" }); check("legacy student must activate first", r.status === 401 && /activated/.test(r.body.message), r.body);
r = await call("GET", "/admin/dashboard"); check("admin route without token → 401", r.status === 401);
r = await call("GET", "/admin/dashboard", undefined, tutor); check("tutor blocked from admin → 403", r.status === 403);
r = await call("POST", "/auth/refresh", { refreshToken: adminRefresh }); check("refresh rotates", r.status === 200 && r.body.data.refreshToken !== adminRefresh);
r = await call("POST", "/auth/refresh", { refreshToken: adminRefresh }); check("replayed refresh token rejected", r.status === 401);
r = await call("POST", "/auth/login", { email: "admin@internkul.com", password: process.env.ADMIN_PASSWORD ?? "ChangeMe#2026" }); const adminT = r.body.data.token;

section("Checkout → payment → enrolment (new student)");
const email = `student${Date.now()}@example.com`;
const orderBody = { courseSlug: "mern-full-stack", planCode: "10D", timingId: "07:30_AM", student: { firstName: "Riya", lastName: "Sharma", email, phone: "9876543210", password: "Student#1234", college: "ABC College" } };
r = await call("POST", "/checkout/orders", { ...orderBody, planCode: "NOPE" }); check("unknown plan rejected", r.status === 404, r.body);
r = await call("POST", "/checkout/orders", { ...orderBody, amount: 1 }); check("order created, price from DB", r.status === 201 && r.body.data.amount === 499 && r.body.data.order.amount === 49900, r.body);
const order = r.body.data;
r = await call("POST", "/checkout/verify", { razorpay_order_id: order.order.id, razorpay_payment_id: "pay_fake12345", razorpay_signature: "deadbeef".repeat(8) }); check("forged signature rejected", r.status === 400);
r = await call("POST", "/checkout/dev/simulate", { orderId: order.order.id }); const pay = r.body.data;
r = await call("POST", "/checkout/verify", pay); check("payment verified & signed in", r.status === 200 && r.body.data.paid && r.body.data.signedIn && r.body.data.token, r.body); const student = r.body.data.token;
check("auto-assigned to demo batch", r.body.data.batchAssigned === true, r.body.data);
r = await call("POST", "/checkout/verify", pay); check("verify is idempotent", r.status === 200 && r.body.data.paid);
r = await call("POST", "/checkout/orders", orderBody); check("duplicate enrolment blocked", r.status === 409, r.body);

section("Student portal");
r = await call("GET", "/student/dashboard", undefined, student); check("dashboard", r.status === 200 && r.body.data.courses.length === 1 && r.body.data.unreadCount >= 1, r.body);
const enr = r.body.data.courses[0]; check("batch + tutor visible", !!enr.batchCode && enr.tutorName === "Aarav Mentor", enr);
r = await call("GET", `/student/enrollments/${enr.id}`, undefined, student); check("course detail with sessions/docs", r.status === 200 && r.body.data.sessions.length >= 1 && r.body.data.documents.length >= 1, r.body.data?.documents);
check("certificate not eligible before completion", r.body.data.certificateEligibility.eligible === false);
r = await call("GET", "/student/enrollments/1", undefined, student); check("cannot read another student's enrolment", r.status === 404);
r = await call("GET", "/admin/students", undefined, student); check("student blocked from admin", r.status === 403);
r = await call("POST", `/student/enrollments/${enr.id}/certificate-request`, { nameOnCertificate: "Riya Sharma", feedbackRating: 5, declarationAccepted: true }, student); check("early certificate request blocked", r.status === 409, r.body);

section("Tutor flow");
r = await call("GET", "/tutor/dashboard", undefined, tutor); check("tutor dashboard", r.status === 200 && r.body.data.stats.activeStudents >= 1, r.body);
r = await call("GET", "/tutor/batches", undefined, tutor); const batchId = enr.batchId; check("tutor batches", r.body.data.some((b: any) => b.id === batchId));
r = await call("GET", `/tutor/batches/${batchId}/students`, undefined, tutor); check("batch students", r.body.data.some((s: any) => s.enrollmentId === enr.id), r.body);
r = await call("POST", `/tutor/batches/${batchId}/sessions`, { title: "Day 1: Git & tooling", startsAt: new Date(Date.now() - 3600e3).toISOString(), durationMinutes: 60 }, tutor); check("create session", r.status === 201, r.body); const sid = r.body.data.id;
r = await call("PUT", `/tutor/batches/${batchId}/sessions/${sid}/attendance`, { records: [{ enrollmentId: enr.id, status: "present" }] }, tutor); check("mark attendance", r.status === 200, r.body);
const fd = new FormData(); fd.append("title", "Week 1 notes"); fd.append("kind", "document"); fd.append("recipientIds", String(enr.id)); fd.append("file", new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), "notes.pdf");
r = await call("POST", `/tutor/batches/${batchId}/documents`, undefined, tutor, fd); check("upload document to student", r.status === 201, r.body); const docId = r.body.data.id;
r = await call("GET", `/documents/${docId}/download`, undefined, student); check("student downloads shared document", r.status === 200 && Buffer.isBuffer(r.body) && r.body.toString().startsWith("%PDF"));
r = await call("POST", "/auth/login", { email: "tutor@internkul.com", password: "Tutor#12345" });
r = await call("GET", `/documents/${docId}/download`, undefined, admin); check("admin can download", r.status === 200);
r = await call("PATCH", `/tutor/batches/${batchId}/students/${enr.id}`, { progressPercent: 60, tutorRemarks: "Great pace" }, tutor); check("tutor sets progress", r.status === 200 && r.body.data.progressPercent === 60, r.body);
r = await call("GET", `/tutor/batches/${batchId}/students/${enr.id}`, undefined, tutor); check("tutor tracks student activity", r.body.data.activity.length >= 1 && r.body.data.enrollment.attendancePercent === 100, r.body.data?.activity);
r = await call("GET", "/tutor/batches/999999/students", undefined, tutor); check("tutor cannot open foreign batch", r.status === 404);
r = await call("PATCH", `/tutor/batches/${batchId}/students/${enr.id}`, { status: "completed" }, tutor); check("tutor marks completed", r.status === 200 && r.body.data.status === "completed", r.body);

section("Certificate lifecycle");
r = await call("POST", `/student/enrollments/${enr.id}/certificate-request`, { nameOnCertificate: "Riya Sharma", collegeName: "ABC College", githubUrl: "https://github.com/riya/app", capstoneTitle: "Shop app", skills: ["React", "Node"], feedbackRating: 5, declarationAccepted: true }, student);
check("student submits completion form", r.status === 201, r.body); const reqId = r.body.data.id;
r = await call("POST", `/student/enrollments/${enr.id}/certificate-request`, { nameOnCertificate: "Riya Sharma", feedbackRating: 5, declarationAccepted: true }, student); check("duplicate request blocked", r.status === 409);
r = await call("GET", "/admin/certificate-requests?status=submitted", undefined, adminT); check("admin sees request", r.body.data.some((x: any) => x.id === reqId), r.body);
r = await call("POST", `/admin/certificate-requests/${reqId}/approve`, { codeQuality: 35, milestoneSprints: 25, technicalInterview: 24 }, adminT); check("admin approves → credential issued", r.status === 200 && /^CG-\d{4}-MERN-\d+$/.test(r.body.data.credentialId), r.body); const cid = r.body.data.credentialId;
r = await call("GET", `/credentials/verify/${cid}`); check("public verification works", r.body.verified && r.body.data.scoreBreakdown.totalScore === 84, r.body);
r = await call("GET", `/certificates/${cid}/pdf`, undefined, student); check("student downloads PDF", r.status === 200 && (r.body as Buffer).subarray(0, 4).toString() === "%PDF", r.status);
r = await call("GET", `/certificates/${cid}/pdf`, undefined, tutor); check("tutor cannot download others' PDF", r.status === 403);

section("Admin");
r = await call("GET", "/admin/dashboard", undefined, adminT); check("dashboard KPIs", r.body.data.stats.revenueTotal > 0 && r.body.data.revenueByMonth.length === 6, r.body);
r = await call("GET", "/admin/payments?status=paid", undefined, adminT); check("payments list", r.body.data.length >= 4 && r.body.meta.total >= 4, r.body.meta);
const p = r.body.data.find((x: any) => x.razorpayPaymentId === pay.razorpay_payment_id);
r = await call("POST", `/admin/payments/${p.id}/refund`, { amount: 100, reason: "Goodwill refund" }, adminT); check("partial refund", r.status === 200 && r.body.data.status === "partially_refunded", r.body);
r = await call("POST", `/admin/payments/${p.id}/refund`, { amount: 999999, reason: "too much" }, adminT); check("over-refund blocked", r.status === 422);
r = await call("GET", `/admin/students?search=${encodeURIComponent(email)}`, undefined, adminT); check("students search", r.body.data.length === 1 && r.body.data[0].totalPaid === 399, r.body);
r = await call("GET", `/admin/students/${r.body.data[0].id}`, undefined, adminT); check("student 360° detail", r.body.data.enrollments.length === 1 && r.body.data.activity.length > 0 && r.body.data.payments.length === 1);
r = await call("GET", "/admin/activity?role=student", undefined, adminT); check("activity feed", r.body.data.length >= 3);
r = await call("POST", "/admin/tutors", { name: "Neha Tutor", email: `neha${Date.now()}@example.com`, password: "Tutor#99999", expertise: ["Java"], courseIds: [1] }, adminT); check("create tutor", r.status === 201 && /^TUT-/.test(r.body.data.tutorCode), r.body);
r = await call("POST", "/admin/batches", { courseId: mern.id ?? 1, timingId: "02:00_PM", tutorId: r.body.data.id, startDate: "2027-01-10", seatLimit: 2 }, adminT); check("create batch with generated code", r.status === 201 && /^MERN-/.test(r.body.data.code), r.body);
const course = await call("GET", "/admin/courses/mern-full-stack", undefined, adminT);
const upd = { ...course.body.data, summary: course.body.data.summary + " ✓" }; r = await call("PUT", "/admin/courses/mern-full-stack", upd, adminT); check("legacy course payload still saves (plans normalised)", r.status === 200 && Object.keys(r.body.data.durationOptions).length === 5, r.body);
r = await call("DELETE", "/admin/courses/mern-full-stack", undefined, adminT); check("course with enrolments is archived, not deleted", r.body.archived === true, r.body);
await call("PATCH", "/admin/courses/mern-full-stack/status", { status: "active" }, adminT);
r = await call("POST", "/auth/forgot-password", { email: "gungungpta99@gmail.com" }); check("forgot password (activation) responds 200", r.status === 200);
console.log(`\n${failed ? "✗" : "✓"} ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
