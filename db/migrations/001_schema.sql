-- =====================================================================
-- Internkul LMS  ·  PostgreSQL schema  ·  migration 001
-- Evolves the legacy MySQL (Laravel) database into a role-based LMS.
--   legacy `tracks`        -> courses + course_plans (pricing normalised)
--   legacy `students`      -> users(role=student) + student_profiles
--   legacy `batches`       -> batches (now with tutor, dates, lifecycle)
--   legacy `credentials`   -> credentials (+ link to enrollment/student)
--   legacy "PAID: ..." text-> payments table (server verified)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ───────────────────────── Identity & access ─────────────────────────
CREATE TABLE users (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              text        NOT NULL,
  email             citext      NOT NULL UNIQUE,
  phone             text,
  country_code      text        NOT NULL DEFAULT '+91',
  password_hash     text,                       -- NULL = account must be activated via "forgot password"
  role              text        NOT NULL CHECK (role IN ('admin','tutor','student')),
  avatar_url        text,
  is_active         boolean     NOT NULL DEFAULT true,
  email_verified_at timestamptz,
  last_login_at     timestamptz,
  last_active_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_role_idx ON users(role);

CREATE TABLE student_profiles (
  user_id                bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  student_code           text   NOT NULL UNIQUE,   -- legacy students.student_id e.g. STU-2026-AIML-3131
  first_name             text   NOT NULL,
  last_name              text,
  college                text,
  degree                 text,
  permanent_address      text,
  interested_course_slug text,
  interested_topics      jsonb  NOT NULL DEFAULT '[]'::jsonb,
  auth_method            text   NOT NULL DEFAULT 'manual' CHECK (auth_method IN ('manual','google')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tutor_profiles (
  user_id          bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tutor_code       text   NOT NULL UNIQUE,         -- TUT-0001
  headline         text,
  bio              text,
  expertise        jsonb  NOT NULL DEFAULT '[]'::jsonb,
  qualification    text,
  experience_years smallint NOT NULL DEFAULT 0 CHECK (experience_years >= 0),
  linkedin_url     text,
  status           text   NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','on_leave')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text   NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  user_agent  text,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens(user_id);

CREATE TABLE password_reset_codes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   text   NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_codes_user_idx ON password_reset_codes(user_id);

-- ───────────────────────────── Catalogue ─────────────────────────────
CREATE TABLE domains (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  label       text NOT NULL,
  sort_order  smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE batch_timings (            -- reusable daily time slots (legacy batch_timings)
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timing_id     text NOT NULL UNIQUE,   -- '07:30_AM'
  time_label    text NOT NULL,          -- '07:30 AM IST'
  name          text NOT NULL,          -- MORNING
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','FILLING_FAST','CLOSED')),
  suitable_for  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE courses (                  -- legacy `tracks`
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug                  text NOT NULL UNIQUE,
  code                  text NOT NULL,                       -- 'MERN' used in student / certificate ids
  name                  text NOT NULL,
  short_name            text,
  domain                text NOT NULL REFERENCES domains(slug) ON UPDATE CASCADE,
  summary               text NOT NULL,
  detailed_description  text,
  technologies          jsonb NOT NULL DEFAULT '[]'::jsonb,
  primary_stack         jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_degrees        jsonb NOT NULL DEFAULT '[]'::jsonb,
  available_timings     jsonb NOT NULL DEFAULT '[]'::jsonb,  -- list of batch_timings.timing_id
  capstone              jsonb NOT NULL DEFAULT '{}'::jsonb,
  curriculum            jsonb NOT NULL DEFAULT '{}'::jsonb,
  featured              boolean NOT NULL DEFAULT false,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  thumbnail_url         text,
  created_by            bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX courses_status_idx ON courses(status);
CREATE INDEX courses_domain_idx ON courses(domain);

CREATE TABLE course_plans (             -- one priced duration tier per row (was JSON `duration_options`)
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id                 bigint NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  code                      text   NOT NULL,                 -- '45D'
  label                     text   NOT NULL,                 -- '45 Days'
  tier_name                 text,
  days                      integer NOT NULL CHECK (days > 0),
  sessions                  integer NOT NULL DEFAULT 0,
  lab_hours                 integer NOT NULL DEFAULT 0,
  price_inr                 numeric(10,2) NOT NULL CHECK (price_inr >= 0),
  original_price_inr        numeric(10,2) NOT NULL DEFAULT 0,
  discount_percent          smallint NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  academic_support_eligible boolean NOT NULL DEFAULT false,
  lor_eligible              boolean NOT NULL DEFAULT false,
  ppo_eligible              boolean NOT NULL DEFAULT false,
  synopsis_pages            integer NOT NULL DEFAULT 0,
  features                  jsonb   NOT NULL DEFAULT '[]'::jsonb,
  is_active                 boolean NOT NULL DEFAULT true,
  sort_order                smallint NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, code)
);

CREATE TABLE course_tutors (            -- which tutors are qualified to teach which course
  course_id bigint NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  tutor_id  bigint NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  PRIMARY KEY (course_id, tutor_id)
);

-- ───────────────────────────── Batches ─────────────────────────────
CREATE TABLE batches (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text   NOT NULL UNIQUE,                 -- MERN-0730AM-241201
  name          text,
  course_id     bigint NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  plan_id       bigint REFERENCES course_plans(id) ON DELETE SET NULL,   -- NULL = open to any duration
  timing_id     text   NOT NULL REFERENCES batch_timings(timing_id) ON UPDATE CASCADE,
  tutor_id      bigint REFERENCES users(id) ON DELETE SET NULL,
  start_date    date,
  end_date      date,
  schedule_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',   -- ISO weekday 1=Mon … 7=Sun
  seat_limit    integer NOT NULL DEFAULT 30 CHECK (seat_limit > 0),
  status        text   NOT NULL DEFAULT 'open'
                CHECK (status IN ('upcoming','open','ongoing','completed','cancelled')),
  meeting_url   text,
  notes         text,
  archived      boolean NOT NULL DEFAULT false,
  created_by    bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX batches_course_idx ON batches(course_id);
CREATE INDEX batches_tutor_idx  ON batches(tutor_id);
CREATE INDEX batches_status_idx ON batches(status) WHERE NOT archived;

-- ─────────────────────── Enrolment & payments ───────────────────────
CREATE TABLE enrollments (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id       bigint NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  course_id        bigint NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  plan_id          bigint REFERENCES course_plans(id)     ON DELETE SET NULL,
  batch_id         bigint REFERENCES batches(id)          ON DELETE SET NULL,
  timing_id        text   REFERENCES batch_timings(timing_id) ON UPDATE CASCADE,  -- student's preferred slot
  status           text   NOT NULL DEFAULT 'pending_payment'
                   CHECK (status IN ('pending_payment','active','completed','suspended','dropped','cancelled')),
  amount_due       numeric(10,2) NOT NULL DEFAULT 0,
  progress_percent smallint NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  tutor_remarks    text,
  enrolled_at      timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- a student can hold only one live enrolment per course (re-enrolling is allowed after drop/cancel)
CREATE UNIQUE INDEX enrollments_one_live_per_course
  ON enrollments(student_id, course_id)
  WHERE status IN ('pending_payment','active','completed','suspended');
CREATE INDEX enrollments_batch_idx  ON enrollments(batch_id);
CREATE INDEX enrollments_course_idx ON enrollments(course_id);
CREATE INDEX enrollments_status_idx ON enrollments(status);

CREATE SEQUENCE receipt_seq START 1000;

CREATE TABLE payments (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enrollment_id        bigint REFERENCES enrollments(id) ON DELETE SET NULL,
  student_id           bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider             text   NOT NULL CHECK (provider IN ('razorpay','manual','legacy')),
  status               text   NOT NULL DEFAULT 'created'
                       CHECK (status IN ('created','paid','failed','refunded','partially_refunded')),
  amount               numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency             text   NOT NULL DEFAULT 'INR',
  receipt_no           text   NOT NULL UNIQUE,
  razorpay_order_id    text   UNIQUE,
  razorpay_payment_id  text   UNIQUE,
  razorpay_signature   text,
  method               text,                       -- upi / card / netbanking / cash / bank_transfer …
  paid_at              timestamptz,
  refunded_amount      numeric(12,2) NOT NULL DEFAULT 0,
  refunded_at          timestamptz,
  refund_reason        text,
  failure_reason       text,
  notes                text,
  recorded_by          bigint REFERENCES users(id) ON DELETE SET NULL,   -- admin who logged a manual payment
  raw                  jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (refunded_amount <= amount)
);
CREATE INDEX payments_student_idx    ON payments(student_id);
CREATE INDEX payments_enrollment_idx ON payments(enrollment_id);
CREATE INDEX payments_status_idx     ON payments(status, paid_at DESC);

-- ───────────────────── Teaching: sessions & attendance ─────────────────────
CREATE TABLE class_sessions (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id         bigint NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  title            text   NOT NULL,
  description      text,
  starts_at        timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  meeting_url      text,
  status           text   NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled')),
  created_by       bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX class_sessions_batch_idx ON class_sessions(batch_id, starts_at);

CREATE TABLE attendance (
  session_id    bigint NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  enrollment_id bigint NOT NULL REFERENCES enrollments(id)    ON DELETE CASCADE,
  status        text   NOT NULL CHECK (status IN ('present','absent','late','excused')),
  note          text,
  marked_by     bigint REFERENCES users(id) ON DELETE SET NULL,
  marked_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, enrollment_id)
);

-- attendance % per enrolment (late counts as present, excused sessions are ignored)
CREATE VIEW v_enrollment_attendance AS
SELECT e.id AS enrollment_id,
       COUNT(a.session_id) FILTER (WHERE a.status <> 'excused')          AS counted_sessions,
       COUNT(a.session_id) FILTER (WHERE a.status IN ('present','late')) AS attended_sessions,
       CASE WHEN COUNT(a.session_id) FILTER (WHERE a.status <> 'excused') = 0 THEN NULL
            ELSE ROUND(100.0 * COUNT(a.session_id) FILTER (WHERE a.status IN ('present','late'))
                       / COUNT(a.session_id) FILTER (WHERE a.status <> 'excused'))
       END::int AS attendance_percent
FROM enrollments e
LEFT JOIN class_sessions s ON s.batch_id = e.batch_id AND s.status = 'completed'
LEFT JOIN attendance a     ON a.session_id = s.id AND a.enrollment_id = e.id
GROUP BY e.id;

-- ───────────────────────── Course material ─────────────────────────
CREATE TABLE documents (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title         text   NOT NULL,
  description   text,
  kind          text   NOT NULL DEFAULT 'document'
                CHECK (kind IN ('document','video','link','assignment','certificate','other')),
  scope         text   NOT NULL CHECK (scope IN ('course','batch','student')),
  course_id     bigint NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  batch_id      bigint REFERENCES batches(id) ON DELETE CASCADE,
  file_path     text,            -- relative to UPLOAD_DIR
  file_name     text,
  mime_type     text,
  file_size     bigint,
  external_url  text,
  is_published  boolean NOT NULL DEFAULT true,
  uploaded_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (file_path IS NOT NULL OR external_url IS NOT NULL),
  CHECK (scope <> 'batch' OR batch_id IS NOT NULL)
);
CREATE INDEX documents_course_idx ON documents(course_id);
CREATE INDEX documents_batch_idx  ON documents(batch_id);

CREATE TABLE document_recipients (      -- used when scope = 'student'
  document_id   bigint NOT NULL REFERENCES documents(id)   ON DELETE CASCADE,
  enrollment_id bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, enrollment_id)
);

CREATE TABLE announcements (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title      text   NOT NULL,
  body       text   NOT NULL,
  course_id  bigint REFERENCES courses(id) ON DELETE CASCADE,
  batch_id   bigint REFERENCES batches(id) ON DELETE CASCADE,
  author_id  bigint REFERENCES users(id) ON DELETE SET NULL,
  pinned     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (course_id IS NOT NULL OR batch_id IS NOT NULL)
);
CREATE INDEX announcements_batch_idx  ON announcements(batch_id, created_at DESC);
CREATE INDEX announcements_course_idx ON announcements(course_id, created_at DESC);

CREATE TABLE notifications (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text   NOT NULL DEFAULT 'info',
  title      text   NOT NULL,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, read_at, created_at DESC);

-- ─────────────────── Completion form & certificates ───────────────────
CREATE SEQUENCE credential_seq START 100;

CREATE TABLE credentials (               -- legacy `credentials` (public verification registry)
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  credential_id         text NOT NULL UNIQUE,            -- CG-2026-MERN-104
  enrollment_id         bigint UNIQUE REFERENCES enrollments(id) ON DELETE SET NULL,
  user_id               bigint REFERENCES users(id) ON DELETE SET NULL,
  course_id             bigint REFERENCES courses(id) ON DELETE SET NULL,
  student_name          text NOT NULL,
  student_initials      text,
  degree                text,
  college_name          text,
  track_slug            text,
  track_name            text,
  duration              text NOT NULL DEFAULT '45D',
  duration_days         integer NOT NULL DEFAULT 45,
  issue_date            date,
  verification_status   text NOT NULL DEFAULT 'VERIFIED' CHECK (verification_status IN ('VERIFIED','REVOKED')),
  verified_at           timestamptz,
  skills                jsonb NOT NULL DEFAULT '[]'::jsonb,
  github_url            text,
  live_deployment_url   text,
  capstone_title        text,
  capstone_description  text,
  lor_qualified         boolean NOT NULL DEFAULT false,
  ppo_qualified         boolean NOT NULL DEFAULT false,
  code_quality          smallint NOT NULL DEFAULT 0 CHECK (code_quality BETWEEN 0 AND 40),
  milestone_sprints     smallint NOT NULL DEFAULT 0 CHECK (milestone_sprints BETWEEN 0 AND 30),
  technical_interview   smallint NOT NULL DEFAULT 0 CHECK (technical_interview BETWEEN 0 AND 30),
  total_score           smallint NOT NULL DEFAULT 0 CHECK (total_score BETWEEN 0 AND 100),
  verified_by           text,
  revoked_at            timestamptz,
  revoked_reason        text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credentials_user_idx ON credentials(user_id);

CREATE TABLE certificate_requests (      -- the "course completion form" a student files
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enrollment_id        bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  student_id           bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name_on_certificate  text   NOT NULL,
  college_name         text,
  degree               text,
  github_url           text,
  live_deployment_url  text,
  capstone_title       text,
  capstone_description text,
  skills               jsonb  NOT NULL DEFAULT '[]'::jsonb,
  feedback_rating      smallint CHECK (feedback_rating BETWEEN 1 AND 5),
  feedback_text        text,
  declaration_accepted boolean NOT NULL DEFAULT false,
  status               text   NOT NULL DEFAULT 'submitted'
                       CHECK (status IN ('submitted','under_review','approved','rejected')),
  review_notes         text,
  reviewed_by          bigint REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at          timestamptz,
  credential_id        bigint REFERENCES credentials(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX certificate_requests_one_open
  ON certificate_requests(enrollment_id) WHERE status IN ('submitted','under_review','approved');
CREATE INDEX certificate_requests_status_idx ON certificate_requests(status, created_at DESC);

-- ───────────────────────── Operations ─────────────────────────
CREATE TABLE inquiries (
  id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type                       text NOT NULL CHECK (type IN ('contact','college')),
  name                       text NOT NULL,
  email                      citext NOT NULL,
  phone                      text,
  enquiry_category           text,
  interested_course          text,
  institution_name           text,
  designation                text,
  number_of_students         text,
  preferred_duration         text,
  preferred_training_window  text,
  message                    text,
  status                     text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  admin_notes                text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inquiries_status_idx ON inquiries(type, status);

CREATE TABLE activity_logs (             -- student/tutor activity tracking + admin audit trail
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        bigint REFERENCES users(id) ON DELETE SET NULL,
  actor_role     text,
  enrollment_id  bigint REFERENCES enrollments(id) ON DELETE CASCADE,
  action         text NOT NULL,           -- auth.login, document.download, certificate.requested …
  entity_type    text,
  entity_id      text,
  meta           jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip             text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_user_idx       ON activity_logs(user_id, created_at DESC);
CREATE INDEX activity_enrollment_idx ON activity_logs(enrollment_id, created_at DESC);
CREATE INDEX activity_action_idx     ON activity_logs(action, created_at DESC);

CREATE TABLE app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings(key, value, description) VALUES
  ('certificate_min_attendance', '75',                    'Minimum attendance % a student needs before they can apply for a certificate'),
  ('certificate_prefix',         '"CG"',                  'Prefix used in generated credential IDs'),
  ('issuer_name',                '"Internkul"',           'Organisation name printed on certificates'),
  ('authorised_signatory',       '"Director, Internkul"', 'Signatory printed on certificates'),
  ('auto_assign_batch',          'true',                  'Automatically place paid students into the next open batch for their course and time-slot'),
  ('support_email',              '"support@internkul.com"', 'Shown to students in notifications');

-- ───────────────────── updated_at triggers ─────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','student_profiles','tutor_profiles','domains','batch_timings','courses',
    'course_plans','batches','enrollments','payments','class_sessions','documents','credentials',
    'certificate_requests','inquiries'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t||'_updated_at', t);
  END LOOP;
END $$;
