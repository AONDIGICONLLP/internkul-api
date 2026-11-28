import { one, q } from "../db.js";
import type { SessionUser } from "../lib/tokens.js";
import { forbidden, notFound } from "../lib/http.js";

/** SQL predicate: document `d` is visible to student `$1` through one of their live enrolments. */
export const STUDENT_DOC_VISIBLE = `
  d.is_published AND EXISTS (
    SELECT 1 FROM enrollments e
    WHERE e.student_id = $1 AND e.status IN ('active','completed') AND (
         (d.scope = 'course'  AND e.course_id = d.course_id)
      OR (d.scope = 'batch'   AND e.batch_id  = d.batch_id)
      OR (d.scope = 'student' AND EXISTS (SELECT 1 FROM document_recipients r WHERE r.document_id = d.id AND r.enrollment_id = e.id))
    ))`;

export async function listStudentDocuments(studentId: number, filter: { enrollmentId?: number; search?: string } = {}) {
  const params: any[] = [studentId];
  let extra = "";
  if (filter.enrollmentId) {
    params.push(filter.enrollmentId);
    extra += ` AND EXISTS (SELECT 1 FROM enrollments e2 WHERE e2.id=$${params.length} AND e2.student_id=$1 AND (
       (d.scope='course' AND e2.course_id=d.course_id) OR (d.scope='batch' AND e2.batch_id=d.batch_id)
       OR (d.scope='student' AND EXISTS (SELECT 1 FROM document_recipients r2 WHERE r2.document_id=d.id AND r2.enrollment_id=e2.id))))`;
  }
  if (filter.search) { params.push(`%${filter.search}%`); extra += ` AND (d.title ILIKE $${params.length} OR d.description ILIKE $${params.length})`; }
  return q(
    `SELECT d.id, d.title, d.description, d.kind, d.scope, d.file_name, d.mime_type, d.file_size, d.external_url,
            d.created_at, c.name AS course_name, c.slug AS course_slug, b.code AS batch_code, u.name AS uploaded_by_name
     FROM documents d JOIN courses c ON c.id=d.course_id LEFT JOIN batches b ON b.id=d.batch_id LEFT JOIN users u ON u.id=d.uploaded_by
     WHERE ${STUDENT_DOC_VISIBLE} ${extra} ORDER BY d.created_at DESC`, params);
}

/** Central access rule for downloading a document – used by every role's download endpoint. */
export async function assertCanAccessDocument(user: SessionUser, docId: number) {
  const d = await one(`SELECT * FROM documents d WHERE d.id=$1`, [docId]);
  if (!d) throw notFound("Document not found.");
  if (user.role === "admin") return d;
  if (user.role === "tutor") {
    const mine = await one(
      `SELECT 1 FROM batches b WHERE b.tutor_id=$1 AND (b.id=$2 OR (b.course_id=$3 AND $4='course')) LIMIT 1`,
      [user.id, d.batch_id ?? 0, d.course_id, d.scope]);
    if (d.uploaded_by === user.id || mine) return d;
    throw forbidden();
  }
  const visible = await one(`SELECT 1 FROM documents d WHERE d.id=$2 AND ${STUDENT_DOC_VISIBLE}`, [user.id, docId]);
  if (!visible) throw forbidden("This document is not shared with you.");
  return d;
}
