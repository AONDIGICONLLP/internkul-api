import { one, q } from "../db.js";
import { notFound } from "../lib/http.js";

/** Builds the `StudentProfile` shape the React app already consumes (profile + enrolledCourses with payment info). */
export async function buildStudentProfile(userId: number) {
  const u = await one(
    `SELECT u.*, sp.student_code, sp.first_name, sp.last_name, sp.college, sp.degree, sp.permanent_address,
            sp.interested_course_slug, sp.interested_topics, sp.auth_method
     FROM users u JOIN student_profiles sp ON sp.user_id=u.id WHERE u.id=$1`, [userId]);
  if (!u) throw notFound("Student profile not found.");
  const enr = await q(
    `SELECT e.id, e.status, e.enrolled_at, e.timing_id, e.progress_percent, c.slug, c.name AS course_name, pl.label AS plan_label,
            b.code AS batch_code, b.start_date, b.end_date, t.name AS mentor, va.attendance_percent, cr.credential_id,
            (SELECT p.razorpay_payment_id FROM payments p WHERE p.enrollment_id=e.id AND p.status IN ('paid','partially_refunded') ORDER BY p.paid_at DESC LIMIT 1) AS payment_id,
            (SELECT p.amount FROM payments p WHERE p.enrollment_id=e.id AND p.status IN ('paid','partially_refunded') ORDER BY p.paid_at DESC LIMIT 1) AS amount
     FROM enrollments e JOIN courses c ON c.id=e.course_id LEFT JOIN course_plans pl ON pl.id=e.plan_id
     LEFT JOIN batches b ON b.id=e.batch_id LEFT JOIN users t ON t.id=b.tutor_id
     LEFT JOIN v_enrollment_attendance va ON va.enrollment_id=e.id LEFT JOIN credentials cr ON cr.enrollment_id=e.id
     WHERE e.student_id=$1 AND e.status NOT IN ('pending_payment','cancelled') ORDER BY e.enrolled_at DESC`, [userId]);
  const course = enr[0];
  return {
    id: u.student_code, userId: u.id, firstName: u.first_name, lastName: u.last_name ?? undefined, fullName: u.name,
    email: u.email, phone: u.phone ?? "", countryCode: u.country_code, permanentAddress: u.permanent_address ?? undefined,
    college: u.college ?? undefined, degree: u.degree ?? undefined, interestedCourseSlug: u.interested_course_slug ?? course?.slug ?? "",
    interestedCourseName: course?.course_name ?? "", interestedTopics: u.interested_topics ?? [], authMethod: u.auth_method,
    registeredAt: u.created_at, avatarUrl: u.avatar_url ?? undefined,
    enrolledCourses: enr.map((e) => ({
      enrollmentId: e.id, slug: e.slug, courseName: e.course_name, batchTiming: e.timing_id ?? undefined, durationLabel: e.plan_label ?? undefined,
      paymentId: e.payment_id ?? undefined, amountINR: e.amount != null ? Number(e.amount) : undefined, enrolledAt: e.enrolled_at,
      batchCode: e.batch_code ?? undefined, startDate: e.start_date ?? undefined, endDate: e.end_date ?? undefined, mentor: e.mentor ?? undefined,
      attendancePercent: e.attendance_percent ?? undefined, certificateId: e.credential_id ?? undefined, progressPercent: e.progress_percent,
      status: e.status === "completed" ? "COMPLETED" : e.status === "active" ? "ACTIVE" : "REVOKED",
    })),
  };
}
