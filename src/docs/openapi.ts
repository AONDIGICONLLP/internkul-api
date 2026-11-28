/**
 * OpenAPI 3 description of the LMS API, generated from a compact route table so it stays easy to maintain.
 * Served at  /api/v1/docs  (Swagger UI)  and  /api/v1/openapi.json.
 */
type Auth = "-" | "any" | "student" | "tutor" | "admin";
// [method, path, tag, summary, auth, body example | "multipart"]
type R = [string, string, string, string, Auth, (object | "multipart")?];

const R: R[] = [
  // ── Auth ──
  ["post", "/auth/login", "Auth", "Sign in (student, tutor or admin)", "-", { email: "tutor@internkul.com", password: "Tutor#12345" }],
  ["post", "/auth/register", "Auth", "Student sign-up", "-", { firstName: "Riya", lastName: "Sharma", email: "riya@example.com", phone: "9876543210", countryCode: "+91", password: "min8chars", college: "ABC College" }],
  ["post", "/auth/check-email", "Auth", "Does an account exist / is it activated?", "-", { email: "riya@example.com" }],
  ["post", "/auth/email-otp/send", "Auth", "Send an e-mail verification code", "-", { email: "riya@example.com" }],
  ["post", "/auth/email-otp/verify", "Auth", "Verify the e-mail code", "-", { email: "riya@example.com", otp: "123456" }],
  ["post", "/auth/refresh", "Auth", "Exchange a refresh token for a new token pair", "-", { refreshToken: "..." }],
  ["post", "/auth/logout", "Auth", "Revoke a refresh token", "-", { refreshToken: "..." }],
  ["get", "/auth/me", "Auth", "Current user (students also get their profile)", "any"],
  ["post", "/auth/forgot-password", "Auth", "E-mail a 6-digit reset / activation code", "-", { email: "riya@example.com" }],
  ["post", "/auth/reset-password", "Auth", "Set a new password with the code", "-", { email: "riya@example.com", code: "123456", password: "NewPass#2026" }],
  ["post", "/auth/change-password", "Auth", "Change password", "any", { currentPassword: "old", newPassword: "newpassword1" }],
  // ── Public ──
  ["get", "/health", "Public", "Health check (also tests the database)", "-"],
  ["get", "/tracks", "Public", "Active courses with pricing plans (?include_curriculum=1)", "-"],
  ["get", "/tracks/{slug}", "Public", "Course detail incl. curriculum", "-"],
  ["get", "/domains", "Public", "Course categories", "-"],
  ["get", "/batches", "Public", "Daily time-slots", "-"],
  ["get", "/courses/{slug}/batches", "Public", "Open batches of a course with seats left", "-"],
  ["get", "/credentials/verify/{id}", "Public", "Verify a certificate by credential id", "-"],
  ["post", "/inquiries/contact", "Public", "Contact enquiry", "-", { fullName: "Test User", mobileNumber: "9999999999", email: "t@example.com", message: "Hello" }],
  ["post", "/inquiries/college", "Public", "College / institution enquiry", "-", { institutionName: "ABC", contactPerson: "Dr X", designation: "TPO", officialEmail: "tpo@abc.edu", phone: "9999999999", numberOfStudents: "100", preferredTechnology: "MERN", preferredDuration: "45D", preferredTrainingWindow: "Jan–Feb" }],
  // ── Checkout ──
  ["post", "/checkout/orders", "Checkout", "Create enrolment + payment order (price comes from the DB). Token optional.", "-", { courseSlug: "mern-full-stack", planCode: "45D", timingId: "07:30_AM", student: { firstName: "Riya", lastName: "Sharma", email: "riya@example.com", phone: "9876543210" } }],
  ["post", "/checkout/verify", "Checkout", "Verify the Razorpay signature and activate the enrolment", "-", { razorpay_order_id: "order_xxx", razorpay_payment_id: "pay_xxx", razorpay_signature: "..." }],
  ["post", "/checkout/webhook", "Checkout", "Razorpay webhook (raw body, x-razorpay-signature header)", "-"],
  // ── Shared ──
  ["get", "/notifications", "Shared", "My notifications (?unread=1)", "any"],
  ["post", "/notifications/read", "Shared", "Mark notifications read ({} = all)", "any", { ids: [1, 2] }],
  ["get", "/documents/{id}/download", "Shared", "Download a document I can access", "any"],
  ["get", "/certificates/{credentialId}/pdf", "Shared", "Certificate PDF (owner or admin)", "any"],
  // ── Student ──
  ["get", "/student/dashboard", "Student", "Dashboard", "student"],
  ["get", "/student/enrollments", "Student", "My courses", "student"],
  ["get", "/student/enrollments/{id}", "Student", "Course detail: sessions, attendance, documents, payments, certificate eligibility", "student"],
  ["get", "/student/enrollments/{id}/batch-options", "Student", "Batches I can choose", "student"],
  ["post", "/student/enrollments/{id}/select-batch", "Student", "Choose a batch", "student", { batchId: 1 }],
  ["post", "/student/enrollments/{id}/certificate-request", "Student", "Submit the course completion form", "student", { nameOnCertificate: "Riya Sharma", feedbackRating: 5, declarationAccepted: true, collegeName: "ABC College", githubUrl: "https://github.com/riya/app", capstoneTitle: "Shop app", skills: ["React", "Node.js"] }],
  ["get", "/student/documents", "Student", "All documents shared with me (?search=)", "student"],
  ["get", "/student/certificates", "Student", "My certificate requests and credentials", "student"],
  ["get", "/student/payments", "Student", "My payments", "student"],
  ["get", "/student/profile", "Student", "My profile", "student"],
  ["put", "/student/profile", "Student", "Update my profile", "student", { firstName: "Riya", phone: "9876543210", college: "ABC College" }],
  // ── Tutor ──
  ["get", "/tutor/dashboard", "Tutor", "Dashboard", "tutor"],
  ["get", "/tutor/batches", "Tutor", "My batches (?status=)", "tutor"],
  ["get", "/tutor/batches/{id}", "Tutor", "Batch detail", "tutor"],
  ["patch", "/tutor/batches/{id}", "Tutor", "Update batch status / meeting link / notes", "tutor", { status: "ongoing", meetingUrl: "https://meet.google.com/abc" }],
  ["get", "/tutor/students", "Tutor", "All my students (?search=&status=&batch_id=&page=)", "tutor"],
  ["get", "/tutor/profile", "Tutor", "My profile", "tutor"],
  ["put", "/tutor/profile", "Tutor", "Update my profile", "tutor", { headline: "Senior Mentor", expertise: ["React", "Node"], experienceYears: 8 }],
  // ── Batch tools: identical under /tutor/batches/{batchId} and /admin/batches/{batchId} ──
  ...(["tutor", "admin"] as const).flatMap((role): R[] => {
    const b = `/${role}/batches/{batchId}`, T = role === "tutor" ? "Tutor" : "Admin";
    return [
      ["get", `${b}/students`, T, "Students in the batch", role],
      ["get", `${b}/students/{eid}`, T, "Track one student (attendance, activity, certificate)", role],
      ["patch", `${b}/students/{eid}`, T, "Change student status / progress / remarks", role, { status: "completed", progressPercent: 100, tutorRemarks: "Great work" }],
      ["get", `${b}/sessions`, T, "Classes of the batch", role],
      ["post", `${b}/sessions`, T, "Schedule a class", role, { title: "Day 1: Git & tooling", startsAt: "2026-12-01T10:00:00.000Z", durationMinutes: 60, meetingUrl: "https://meet.google.com/abc" }],
      ["patch", `${b}/sessions/{sid}`, T, "Edit a class", role, { title: "Day 1 (updated)" }],
      ["delete", `${b}/sessions/{sid}`, T, "Delete a class", role],
      ["get", `${b}/sessions/{sid}/attendance`, T, "Attendance sheet for a class", role],
      ["put", `${b}/sessions/{sid}/attendance`, T, "Mark attendance (present | absent | late | excused)", role, { records: [{ enrollmentId: 1, status: "present" }] }],
      ["get", `${b}/documents`, T, "Documents shared with the batch", role],
      ["post", `${b}/documents`, T, "Share a document (multipart; recipientIds = CSV of enrollment ids, empty = whole batch)", role, "multipart"],
      ["delete", `${b}/documents/{did}`, T, "Remove a document", role],
      ["get", `${b}/announcements`, T, "Announcements", role],
      ["post", `${b}/announcements`, T, "Post an announcement", role, { title: "Class moved", body: "Tomorrow's class starts at 11 AM.", pinned: false }],
      ["delete", `${b}/announcements/{aid}`, T, "Delete an announcement", role],
    ];
  }),
  // ── Admin ──
  ["get", "/admin/dashboard", "Admin", "KPIs, revenue, queues", "admin"],
  ["get", "/admin/courses", "Admin", "All courses (?status=&include_curriculum=1). Alias: /admin/tracks", "admin"],
  ["post", "/admin/courses", "Admin", "Create a course (legacy 'track' JSON; prices in durationOptions)", "admin", { slug: "react-native", name: "React Native", domain: "mobile", summary: "Build apps", status: "draft", availableBatches: ["07:30_AM"], durationOptions: { "10D": { label: "10 Days", days: 10, priceINR: 999, originalPriceINR: 1499 } } }],
  ["get", "/admin/courses/{slug}", "Admin", "Course with plans & curriculum", "admin"],
  ["put", "/admin/courses/{slug}", "Admin", "Update a course and its prices (full course object)", "admin", { name: "React Native", domain: "mobile", summary: "Build apps", status: "active", durationOptions: { "10D": { label: "10 Days", days: 10, priceINR: 1199 } } }],
  ["patch", "/admin/courses/{slug}/status", "Admin", "Set draft / active / archived", "admin", { status: "active" }],
  ["delete", "/admin/courses/{slug}", "Admin", "Delete (archives instead when it has enrolments)", "admin"],
  ["get", "/admin/timings", "Admin", "Time-slots", "admin"], ["post", "/admin/timings", "Admin", "Add a time-slot", "admin", { timingId: "09:00_AM", timeLabel: "09:00 AM IST", name: "MORNING", status: "OPEN" }],
  ["put", "/admin/timings/{id}", "Admin", "Edit a time-slot", "admin", { status: "FILLING_FAST" }], ["delete", "/admin/timings/{id}", "Admin", "Delete a time-slot", "admin"],
  ["get", "/admin/domains", "Admin", "Domains", "admin"], ["post", "/admin/domains", "Admin", "Add a domain", "admin", { slug: "devops", label: "DevOps", sortOrder: 5 }],
  ["put", "/admin/domains/{id}", "Admin", "Edit a domain", "admin", { label: "DevOps & Cloud" }], ["delete", "/admin/domains/{id}", "Admin", "Delete a domain", "admin"],
  ["get", "/admin/batches", "Admin", "Batches (?course_id=&tutor_id=&status=&archived=1)", "admin"],
  ["post", "/admin/batches", "Admin", "Create a batch", "admin", { courseId: 1, planId: null, timingId: "07:30_AM", tutorId: 2, startDate: "2026-12-10", endDate: "2027-01-24", scheduleDays: [1, 2, 3, 4, 5], seatLimit: 30, status: "open", meetingUrl: "https://meet.google.com/abc" }],
  ["get", "/admin/batches/{id}", "Admin", "Batch detail", "admin"], ["put", "/admin/batches/{id}", "Admin", "Update a batch", "admin", { courseId: 1, timingId: "07:30_AM", tutorId: 2, seatLimit: 40, status: "ongoing", scheduleDays: [1, 2, 3, 4, 5] }],
  ["delete", "/admin/batches/{id}", "Admin", "Delete (archives when it has students)", "admin"],
  ["post", "/admin/batches/{id}/assign", "Admin", "Place an enrolment in the batch", "admin", { enrollmentId: 1, force: false }],
  ["post", "/admin/batches/{id}/unassign", "Admin", "Remove an enrolment from the batch", "admin", { enrollmentId: 1 }],
  ["get", "/admin/enrollments", "Admin", "Enrollments (?status=&course_id=&batch_id=&unassigned=1&search=&page=)", "admin"],
  ["post", "/admin/enrollments", "Admin", "Manual enrolment (optionally with an offline payment)", "admin", { studentId: 5, courseId: 1, planId: 3, timingId: "07:30_AM", payment: { amount: 6999, method: "cash", notes: "Receipt 55" } }],
  ["get", "/admin/enrollments/{id}", "Admin", "Full tracking of one enrolment", "admin"],
  ["patch", "/admin/enrollments/{id}", "Admin", "Change status / batch / progress / remarks", "admin", { status: "completed", batchId: 3, progressPercent: 100 }],
  ["get", "/admin/students", "Admin", "Students (?search=&active=1&course_id=&page=)", "admin"],
  ["post", "/admin/students", "Admin", "Create a student", "admin", { firstName: "Asha", email: "asha@example.com", phone: "9876500000" }],
  ["get", "/admin/students/{id}", "Admin", "Student 360° (profile, enrolments, payments, activity)", "admin"],
  ["put", "/admin/students/{id}", "Admin", "Edit / disable a student", "admin", { phone: "9876500001", isActive: true }], ["delete", "/admin/students/{id}", "Admin", "Delete a student with no history", "admin"],
  ["get", "/admin/tutors", "Admin", "Tutors with workload", "admin"],
  ["post", "/admin/tutors", "Admin", "Create a tutor", "admin", { name: "Neha Tutor", email: "neha@example.com", password: "Tutor#99999", expertise: ["Java"], courseIds: [1], status: "active" }],
  ["get", "/admin/tutors/{id}", "Admin", "Tutor detail", "admin"], ["put", "/admin/tutors/{id}", "Admin", "Edit a tutor / assign courses", "admin", { courseIds: [1, 2], status: "active" }], ["delete", "/admin/tutors/{id}", "Admin", "Delete a tutor without batches", "admin"],
  ["get", "/admin/payments", "Admin", "Payments (?status=&from=&to=&course_id=&provider=&search=&page=)", "admin"],
  ["get", "/admin/payments/summary", "Admin", "Totals (?from=&to=)", "admin"], ["get", "/admin/payments/{id}", "Admin", "Payment detail", "admin"],
  ["post", "/admin/payments/manual", "Admin", "Record an offline payment", "admin", { enrollmentId: 1, amount: 6999, method: "upi", notes: "UPI ref 123" }],
  ["post", "/admin/payments/{id}/refund", "Admin", "Refund (gateway + record)", "admin", { amount: 500, reason: "Goodwill refund" }],
  ["get", "/admin/documents", "Admin", "Documents (?course_id=&batch_id=&scope=)", "admin"],
  ["post", "/admin/documents", "Admin", "Share a document with a course, a batch or students (multipart)", "admin", "multipart"],
  ["patch", "/admin/documents/{id}", "Admin", "Edit / unpublish a document", "admin", { title: "New title", isPublished: true }], ["delete", "/admin/documents/{id}", "Admin", "Delete a document", "admin"],
  ["get", "/admin/certificate-requests", "Admin", "Completion forms (?status=submitted|approved|rejected)", "admin"],
  ["get", "/admin/certificate-requests/{id}", "Admin", "Request + student tracking", "admin"],
  ["post", "/admin/certificate-requests/{id}/approve", "Admin", "Approve and issue the credential", "admin", { codeQuality: 35, milestoneSprints: 25, technicalInterview: 24, lorQualified: false, ppoQualified: false }],
  ["post", "/admin/certificate-requests/{id}/reject", "Admin", "Send back with notes", "admin", { notes: "Please add a working GitHub link." }],
  ["post", "/admin/certificates/issue", "Admin", "Issue directly for a completed enrolment", "admin", { enrollmentId: 1, codeQuality: 30, milestoneSprints: 20, technicalInterview: 20 }],
  ["get", "/admin/credentials", "Admin", "Issued credentials (?status=&search=&page=)", "admin"],
  ["patch", "/admin/credentials/{credentialId}", "Admin", "Revoke / restore / re-score", "admin", { status: "REVOKED", reason: "Issued in error" }],
  ["get", "/admin/inquiries", "Admin", "Inquiries (?type=&status=&search=&page=)", "admin"], ["put", "/admin/inquiries/{id}", "Admin", "Update status / notes", "admin", { status: "contacted", adminNotes: "Called" }], ["delete", "/admin/inquiries/{id}", "Admin", "Delete an inquiry", "admin"],
  ["get", "/admin/activity", "Admin", "Activity / audit log (?role=&action=&user_id=&enrollment_id=&page=)", "admin"],
  ["get", "/admin/announcements", "Admin", "Announcements", "admin"], ["post", "/admin/announcements", "Admin", "Announce to a course or batch", "admin", { title: "Holiday", body: "No class on Friday", courseId: 1 }],
  ["delete", "/admin/announcements/{id}", "Admin", "Delete an announcement", "admin"],
  ["get", "/admin/settings", "Admin", "Platform settings", "admin"],
  ["put", "/admin/settings", "Admin", "Update settings", "admin", { certificate_min_attendance: 75, auto_assign_batch: true, certificate_prefix: "CG" }],
];

const TAG_NOTES: Record<string, string> = {
  Auth: "Sign-in, registration, tokens, password reset.", Public: "No login needed.", Checkout: "Buy a course – price is always read from the database.",
  Shared: "Any signed-in role (access rules per resource).", Student: "Role: student.", Tutor: "Role: tutor – only your own batches.", Admin: "Role: admin.",
};

export function buildOpenApi(serverUrl: string) {
  const paths: Record<string, any> = {};
  for (const [method, path, tag, summary, auth, body] of R) {
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    const op: any = {
      tags: [tag], summary, parameters: params,
      responses: { "200": { description: "OK – `{ data: ... }` (lists also include `meta`)" }, "401": { description: "Missing / expired token" }, "403": { description: "Wrong role" }, "422": { description: "Validation error – `{ message, errors }`" } },
    };
    if (auth !== "-") op.security = [{ bearerAuth: [] }];
    if (auth !== "-" && auth !== "any") op.description = `Requires role **${auth}**.`;
    if (path === "/checkout/orders") op.description = "A token is optional: a signed-in student buys for their own account; otherwise an account is created.";
    if (body === "multipart") {
      op.requestBody = { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: {
        title: { type: "string" }, description: { type: "string" }, kind: { type: "string", enum: ["document", "video", "link", "assignment", "certificate", "other"] },
        file: { type: "string", format: "binary" }, externalUrl: { type: "string", description: "Use instead of a file" }, recipientIds: { type: "string", description: "CSV of enrollment ids" },
        scope: { type: "string", enum: ["course", "batch", "student"], description: "Admin endpoint only" }, courseId: { type: "integer", description: "Admin endpoint only" }, batchId: { type: "integer" } }, required: ["title"] } } } };
    } else if (body) op.requestBody = { required: true, content: { "application/json": { schema: { type: "object" }, example: body } } };
    if (method === "get" && /s$|summary|activity|dashboard/.test(path.split("/").pop()!) && !path.includes("{id}")) {
      op.parameters.push({ name: "page", in: "query", schema: { type: "integer" } }, { name: "per_page", in: "query", schema: { type: "integer" } });
    }
    (paths[path] ||= {})[method] = op;
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "Internkul LMS API", version: "1.0.0",
      description: "REST API for the Internkul LMS (student, tutor and admin).\n\n**Authorize:** call `POST /auth/login`, copy `data.token` and click **Authorize** → paste the token (without `Bearer`). Access tokens last 30 min – use `POST /auth/refresh` with `data.refreshToken` to get a new pair.\n\nErrors: `{ \"message\": \"...\", \"errors\": { \"field\": [\"...\"] } }`. Lists: `{ \"data\": [...], \"meta\": { currentPage, lastPage, perPage, total } }`.",
    },
    servers: [{ url: serverUrl }],
    tags: Object.entries(TAG_NOTES).map(([name, description]) => ({ name, description })),
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
    paths,
  };
}
export const endpointCount = R.length;
