--
-- PostgreSQL database dump
--

\restrict c5BZXiK7dv3e6cW9605dq4ZjCu7icK48fIC4chkFeDP3gPNKtUVddOR69qXvgWm

-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_logs (
    id bigint NOT NULL,
    user_id bigint,
    actor_role text,
    enrollment_id bigint,
    action text NOT NULL,
    entity_type text,
    entity_id text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activity_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.activity_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.activity_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id bigint NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    course_id bigint,
    batch_id bigint,
    author_id bigint,
    pinned boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT announcements_check CHECK (((course_id IS NOT NULL) OR (batch_id IS NOT NULL)))
);


--
-- Name: announcements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.announcements ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.announcements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_by bigint,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    session_id bigint NOT NULL,
    enrollment_id bigint NOT NULL,
    status text NOT NULL,
    note text,
    marked_by bigint,
    marked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attendance_status_check CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text, 'excused'::text])))
);


--
-- Name: batch_timings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.batch_timings (
    id bigint NOT NULL,
    timing_id text NOT NULL,
    time_label text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    suitable_for text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT batch_timings_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'FILLING_FAST'::text, 'CLOSED'::text])))
);


--
-- Name: batch_timings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.batch_timings ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.batch_timings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.batches (
    id bigint NOT NULL,
    code text NOT NULL,
    name text,
    course_id bigint NOT NULL,
    plan_id bigint,
    timing_id text NOT NULL,
    tutor_id bigint,
    start_date date,
    end_date date,
    schedule_days smallint[] DEFAULT '{1,2,3,4,5}'::smallint[] NOT NULL,
    seat_limit integer DEFAULT 30 NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    meeting_url text,
    notes text,
    archived boolean DEFAULT false NOT NULL,
    created_by bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT batches_check CHECK (((end_date IS NULL) OR (start_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT batches_seat_limit_check CHECK ((seat_limit > 0)),
    CONSTRAINT batches_status_check CHECK ((status = ANY (ARRAY['upcoming'::text, 'open'::text, 'ongoing'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.batches ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.batches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: certificate_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certificate_requests (
    id bigint NOT NULL,
    enrollment_id bigint NOT NULL,
    student_id bigint NOT NULL,
    name_on_certificate text NOT NULL,
    college_name text,
    degree text,
    github_url text,
    live_deployment_url text,
    capstone_title text,
    capstone_description text,
    skills jsonb DEFAULT '[]'::jsonb NOT NULL,
    feedback_rating smallint,
    feedback_text text,
    declaration_accepted boolean DEFAULT false NOT NULL,
    status text DEFAULT 'submitted'::text NOT NULL,
    review_notes text,
    reviewed_by bigint,
    reviewed_at timestamp with time zone,
    credential_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT certificate_requests_feedback_rating_check CHECK (((feedback_rating >= 1) AND (feedback_rating <= 5))),
    CONSTRAINT certificate_requests_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: certificate_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.certificate_requests ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.certificate_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: class_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_sessions (
    id bigint NOT NULL,
    batch_id bigint NOT NULL,
    title text NOT NULL,
    description text,
    starts_at timestamp with time zone NOT NULL,
    duration_minutes integer DEFAULT 60 NOT NULL,
    meeting_url text,
    status text DEFAULT 'scheduled'::text NOT NULL,
    created_by bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT class_sessions_duration_minutes_check CHECK ((duration_minutes > 0)),
    CONSTRAINT class_sessions_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: class_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.class_sessions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.class_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: course_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_plans (
    id bigint NOT NULL,
    course_id bigint NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    tier_name text,
    days integer NOT NULL,
    sessions integer DEFAULT 0 NOT NULL,
    lab_hours integer DEFAULT 0 NOT NULL,
    price_inr numeric(10,2) NOT NULL,
    original_price_inr numeric(10,2) DEFAULT 0 NOT NULL,
    discount_percent smallint DEFAULT 0 NOT NULL,
    academic_support_eligible boolean DEFAULT false NOT NULL,
    lor_eligible boolean DEFAULT false NOT NULL,
    ppo_eligible boolean DEFAULT false NOT NULL,
    synopsis_pages integer DEFAULT 0 NOT NULL,
    features jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT course_plans_days_check CHECK ((days > 0)),
    CONSTRAINT course_plans_discount_percent_check CHECK (((discount_percent >= 0) AND (discount_percent <= 100))),
    CONSTRAINT course_plans_price_inr_check CHECK ((price_inr >= (0)::numeric))
);


--
-- Name: course_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.course_plans ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.course_plans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: course_tutors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_tutors (
    course_id bigint NOT NULL,
    tutor_id bigint NOT NULL
);


--
-- Name: courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courses (
    id bigint NOT NULL,
    slug text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    short_name text,
    domain text NOT NULL,
    summary text NOT NULL,
    detailed_description text,
    technologies jsonb DEFAULT '[]'::jsonb NOT NULL,
    primary_stack jsonb DEFAULT '[]'::jsonb NOT NULL,
    target_degrees jsonb DEFAULT '[]'::jsonb NOT NULL,
    available_timings jsonb DEFAULT '[]'::jsonb NOT NULL,
    capstone jsonb DEFAULT '{}'::jsonb NOT NULL,
    curriculum jsonb DEFAULT '{}'::jsonb NOT NULL,
    featured boolean DEFAULT false NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    thumbnail_url text,
    created_by bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT courses_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text])))
);


--
-- Name: courses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.courses ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.courses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: credential_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.credential_seq
    START WITH 100
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credentials (
    id bigint NOT NULL,
    credential_id text NOT NULL,
    enrollment_id bigint,
    user_id bigint,
    course_id bigint,
    student_name text NOT NULL,
    student_initials text,
    degree text,
    college_name text,
    track_slug text,
    track_name text,
    duration text DEFAULT '45D'::text NOT NULL,
    duration_days integer DEFAULT 45 NOT NULL,
    issue_date date,
    verification_status text DEFAULT 'VERIFIED'::text NOT NULL,
    verified_at timestamp with time zone,
    skills jsonb DEFAULT '[]'::jsonb NOT NULL,
    github_url text,
    live_deployment_url text,
    capstone_title text,
    capstone_description text,
    lor_qualified boolean DEFAULT false NOT NULL,
    ppo_qualified boolean DEFAULT false NOT NULL,
    code_quality smallint DEFAULT 0 NOT NULL,
    milestone_sprints smallint DEFAULT 0 NOT NULL,
    technical_interview smallint DEFAULT 0 NOT NULL,
    total_score smallint DEFAULT 0 NOT NULL,
    verified_by text,
    revoked_at timestamp with time zone,
    revoked_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT credentials_code_quality_check CHECK (((code_quality >= 0) AND (code_quality <= 40))),
    CONSTRAINT credentials_milestone_sprints_check CHECK (((milestone_sprints >= 0) AND (milestone_sprints <= 30))),
    CONSTRAINT credentials_technical_interview_check CHECK (((technical_interview >= 0) AND (technical_interview <= 30))),
    CONSTRAINT credentials_total_score_check CHECK (((total_score >= 0) AND (total_score <= 100))),
    CONSTRAINT credentials_verification_status_check CHECK ((verification_status = ANY (ARRAY['VERIFIED'::text, 'REVOKED'::text])))
);


--
-- Name: credentials_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.credentials ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.credentials_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: document_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_recipients (
    document_id bigint NOT NULL,
    enrollment_id bigint NOT NULL
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id bigint NOT NULL,
    title text NOT NULL,
    description text,
    kind text DEFAULT 'document'::text NOT NULL,
    scope text NOT NULL,
    course_id bigint NOT NULL,
    batch_id bigint,
    file_path text,
    file_name text,
    mime_type text,
    file_size bigint,
    external_url text,
    is_published boolean DEFAULT true NOT NULL,
    uploaded_by bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT documents_check CHECK (((file_path IS NOT NULL) OR (external_url IS NOT NULL))),
    CONSTRAINT documents_check1 CHECK (((scope <> 'batch'::text) OR (batch_id IS NOT NULL))),
    CONSTRAINT documents_kind_check CHECK ((kind = ANY (ARRAY['document'::text, 'video'::text, 'link'::text, 'assignment'::text, 'certificate'::text, 'other'::text]))),
    CONSTRAINT documents_scope_check CHECK ((scope = ANY (ARRAY['course'::text, 'batch'::text, 'student'::text])))
);


--
-- Name: documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.documents ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.domains (
    id bigint NOT NULL,
    slug text NOT NULL,
    label text NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: domains_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.domains ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.domains_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrollments (
    id bigint NOT NULL,
    student_id bigint NOT NULL,
    course_id bigint NOT NULL,
    plan_id bigint,
    batch_id bigint,
    timing_id text,
    status text DEFAULT 'pending_payment'::text NOT NULL,
    amount_due numeric(10,2) DEFAULT 0 NOT NULL,
    progress_percent smallint DEFAULT 0 NOT NULL,
    tutor_remarks text,
    enrolled_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT enrollments_progress_percent_check CHECK (((progress_percent >= 0) AND (progress_percent <= 100))),
    CONSTRAINT enrollments_status_check CHECK ((status = ANY (ARRAY['pending_payment'::text, 'active'::text, 'completed'::text, 'suspended'::text, 'dropped'::text, 'cancelled'::text])))
);


--
-- Name: enrollments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.enrollments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.enrollments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: inquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inquiries (
    id bigint NOT NULL,
    type text NOT NULL,
    name text NOT NULL,
    email public.citext NOT NULL,
    phone text,
    enquiry_category text,
    interested_course text,
    institution_name text,
    designation text,
    number_of_students text,
    preferred_duration text,
    preferred_training_window text,
    message text,
    status text DEFAULT 'new'::text NOT NULL,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inquiries_status_check CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'closed'::text]))),
    CONSTRAINT inquiries_type_check CHECK ((type = ANY (ARRAY['contact'::text, 'college'::text])))
);


--
-- Name: inquiries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.inquiries ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.inquiries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    type text DEFAULT 'info'::text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.notifications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: password_reset_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_codes (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    code_hash text NOT NULL,
    attempts smallint DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: password_reset_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.password_reset_codes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.password_reset_codes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id bigint NOT NULL,
    enrollment_id bigint,
    student_id bigint NOT NULL,
    provider text NOT NULL,
    status text DEFAULT 'created'::text NOT NULL,
    amount numeric(12,2) NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    receipt_no text NOT NULL,
    razorpay_order_id text,
    razorpay_payment_id text,
    razorpay_signature text,
    method text,
    paid_at timestamp with time zone,
    refunded_amount numeric(12,2) DEFAULT 0 NOT NULL,
    refunded_at timestamp with time zone,
    refund_reason text,
    failure_reason text,
    notes text,
    recorded_by bigint,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payments_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT payments_check CHECK ((refunded_amount <= amount)),
    CONSTRAINT payments_provider_check CHECK ((provider = ANY (ARRAY['razorpay'::text, 'manual'::text, 'legacy'::text]))),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['created'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'partially_refunded'::text])))
);


--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.payments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: receipt_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.receipt_seq
    START WITH 1000
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    user_agent text,
    ip text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.refresh_tokens ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: student_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_profiles (
    user_id bigint NOT NULL,
    student_code text NOT NULL,
    first_name text NOT NULL,
    last_name text,
    college text,
    degree text,
    permanent_address text,
    interested_course_slug text,
    interested_topics jsonb DEFAULT '[]'::jsonb NOT NULL,
    auth_method text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_profiles_auth_method_check CHECK ((auth_method = ANY (ARRAY['manual'::text, 'google'::text])))
);


--
-- Name: tutor_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_profiles (
    user_id bigint NOT NULL,
    tutor_code text NOT NULL,
    headline text,
    bio text,
    expertise jsonb DEFAULT '[]'::jsonb NOT NULL,
    qualification text,
    experience_years smallint DEFAULT 0 NOT NULL,
    linkedin_url text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tutor_profiles_experience_years_check CHECK ((experience_years >= 0)),
    CONSTRAINT tutor_profiles_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'on_leave'::text])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    name text NOT NULL,
    email public.citext NOT NULL,
    phone text,
    country_code text DEFAULT '+91'::text NOT NULL,
    password_hash text,
    role text NOT NULL,
    avatar_url text,
    is_active boolean DEFAULT true NOT NULL,
    email_verified_at timestamp with time zone,
    last_login_at timestamp with time zone,
    last_active_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'tutor'::text, 'student'::text])))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: v_enrollment_attendance; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_enrollment_attendance AS
 SELECT e.id AS enrollment_id,
    count(a.session_id) FILTER (WHERE (a.status <> 'excused'::text)) AS counted_sessions,
    count(a.session_id) FILTER (WHERE (a.status = ANY (ARRAY['present'::text, 'late'::text]))) AS attended_sessions,
    (
        CASE
            WHEN (count(a.session_id) FILTER (WHERE (a.status <> 'excused'::text)) = 0) THEN NULL::numeric
            ELSE round(((100.0 * (count(a.session_id) FILTER (WHERE (a.status = ANY (ARRAY['present'::text, 'late'::text]))))::numeric) / (count(a.session_id) FILTER (WHERE (a.status <> 'excused'::text)))::numeric))
        END)::integer AS attendance_percent
   FROM ((public.enrollments e
     LEFT JOIN public.class_sessions s ON (((s.batch_id = e.batch_id) AND (s.status = 'completed'::text))))
     LEFT JOIN public.attendance a ON (((a.session_id = s.id) AND (a.enrollment_id = e.id))))
  GROUP BY e.id;


--
-- Data for Name: activity_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.activity_logs (id, user_id, actor_role, enrollment_id, action, entity_type, entity_id, meta, ip, created_at) FROM stdin;
\.


--
-- Data for Name: announcements; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.announcements (id, title, body, course_id, batch_id, author_id, pinned, created_at) FROM stdin;
\.


--
-- Data for Name: app_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.app_settings (key, value, description, updated_by, updated_at) FROM stdin;
certificate_min_attendance	75	Minimum attendance % a student needs before they can apply for a certificate	\N	2026-11-24 08:18:26.823987+00
certificate_prefix	"CG"	Prefix used in generated credential IDs	\N	2026-11-24 08:18:26.823987+00
issuer_name	"Internkul"	Organisation name printed on certificates	\N	2026-11-24 08:18:26.823987+00
authorised_signatory	"Director, Internkul"	Signatory printed on certificates	\N	2026-11-24 08:18:26.823987+00
auto_assign_batch	true	Automatically place paid students into the next open batch for their course and time-slot	\N	2026-11-24 08:18:26.823987+00
support_email	"support@internkul.com"	Shown to students in notifications	\N	2026-11-24 08:18:26.823987+00
\.


--
-- Data for Name: attendance; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.attendance (session_id, enrollment_id, status, note, marked_by, marked_at) FROM stdin;
\.


--
-- Data for Name: batch_timings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.batch_timings (id, timing_id, time_label, name, status, suitable_for, created_at, updated_at) FROM stdin;
1	07:30_AM	07:30 AM IST	MORNING	OPEN	Early risers & pre-college slot	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
2	02:00_PM	02:00 PM IST	AFTERNOON	OPEN	Students with free afternoons	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
3	06:00_PM	06:00 PM IST	EVENING	FILLING_FAST	Post-college live instructor-led cohort	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
4	08:30_PM	08:30 PM IST	NIGHT	OPEN	Working students & late-evening learners	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
\.


--
-- Data for Name: batches; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.batches (id, code, name, course_id, plan_id, timing_id, tutor_id, start_date, end_date, schedule_days, seat_limit, status, meeting_url, notes, archived, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: certificate_requests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.certificate_requests (id, enrollment_id, student_id, name_on_certificate, college_name, degree, github_url, live_deployment_url, capstone_title, capstone_description, skills, feedback_rating, feedback_text, declaration_accepted, status, review_notes, reviewed_by, reviewed_at, credential_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: class_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.class_sessions (id, batch_id, title, description, starts_at, duration_minutes, meeting_url, status, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: course_plans; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.course_plans (id, course_id, code, label, tier_name, days, sessions, lab_hours, price_inr, original_price_inr, discount_percent, academic_support_eligible, lor_eligible, ppo_eligible, synopsis_pages, features, is_active, sort_order, created_at, updated_at) FROM stdin;
1	1	1D	1 Day Workshop	Starter Workshop	1	1	2	99.00	499.00	80	f	f	f	0	["Certificate of Attendance"]	t	0	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
2	1	10D	10 Days	Skill Sprint	10	10	20	499.00	3499.00	86	f	f	f	0	["Certificate of Completion", "Mini project"]	t	1	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
3	1	20D	20 Days	Skill Sprint	20	20	40	999.00	7999.00	88	f	f	f	0	["Certificate of Completion", "2 Minor projects"]	t	2	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
4	1	30D	30 Days	Marathon	30	30	60	1299.00	9999.00	87	t	f	f	10	["Certificate of Completion", "Synopsis Guide"]	t	3	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
5	1	45D	45 Days	Internship Pack	45	45	90	1499.00	14999.00	90	t	t	t	25	["Certificate of Completion", "Capstone Project", "LOR & PPO Eligibility"]	t	4	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
6	2	1D	1 Day Workshop	Starter Workshop	1	1	2	99.00	499.00	80	f	f	f	0	["Certificate of Attendance"]	t	0	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
7	2	10D	10 Days	Skill Sprint	10	10	20	499.00	3499.00	86	f	f	f	0	["Certificate of Completion", "Mini project"]	t	1	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
8	2	20D	20 Days	Skill Sprint	20	20	40	999.00	7999.00	88	f	f	f	0	["Certificate of Completion", "2 Minor projects"]	t	2	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
9	2	30D	30 Days	Marathon	30	30	60	1299.00	9999.00	87	t	f	f	10	["Certificate of Completion", "Synopsis Guide"]	t	3	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
10	2	45D	45 Days	Internship Pack	45	45	90	1499.00	14999.00	90	t	t	t	25	["Certificate of Completion", "Capstone Project", "LOR & PPO Eligibility"]	t	4	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
11	3	1D	1 Day Workshop	Starter Workshop	1	1	2	99.00	499.00	80	f	f	f	0	["Certificate of Attendance"]	t	0	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
12	3	10D	10 Days	Skill Sprint	10	10	20	499.00	3499.00	86	f	f	f	0	["Certificate of Completion", "Mini project"]	t	1	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
13	3	20D	20 Days	Skill Sprint	20	20	40	999.00	7999.00	88	f	f	f	0	["Certificate of Completion", "2 Minor projects"]	t	2	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
14	3	30D	30 Days	Marathon	30	30	60	1299.00	9999.00	87	t	f	f	10	["Certificate of Completion", "Synopsis Guide"]	t	3	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
15	3	45D	45 Days	Internship Pack	45	45	90	1599.00	14999.00	89	t	t	t	25	["Certificate of Completion", "Capstone Project", "LOR & PPO Eligibility"]	t	4	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
16	4	1D	1 Day Workshop	Starter Workshop	1	1	2	99.00	499.00	80	f	f	f	0	["Certificate of Attendance"]	t	0	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
17	4	10D	10 Days	Skill Sprint	10	10	20	499.00	3499.00	86	f	f	f	0	["Certificate of Completion", "Mini project"]	t	1	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
18	4	20D	20 Days	Skill Sprint	20	20	40	999.00	7999.00	88	f	f	f	0	["Certificate of Completion", "2 Minor projects"]	t	2	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
19	4	30D	30 Days	Marathon	30	30	60	1299.00	9999.00	87	t	f	f	10	["Certificate of Completion", "Synopsis Guide"]	t	3	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
20	4	45D	45 Days	Internship Pack	45	45	90	1499.00	14999.00	90	t	t	t	25	["Certificate of Completion", "Capstone Project", "LOR & PPO Eligibility"]	t	4	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
21	5	1D	1 Day Workshop	Starter Workshop	1	1	2	99.00	499.00	80	f	f	f	0	["Certificate of Attendance"]	t	0	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
22	5	10D	10 Days	Skill Sprint	10	10	20	499.00	3499.00	86	f	f	f	0	["Certificate of Completion", "Mini project"]	t	1	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
23	5	20D	20 Days	Skill Sprint	20	20	40	999.00	7999.00	88	f	f	f	0	["Certificate of Completion", "2 Minor projects"]	t	2	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
24	5	30D	30 Days	Marathon	30	30	60	1299.00	9999.00	87	t	f	f	10	["Certificate of Completion", "Synopsis Guide"]	t	3	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
25	5	45D	45 Days	Internship Pack	45	45	90	1499.00	14999.00	90	t	t	t	25	["Certificate of Completion", "Capstone Project", "LOR & PPO Eligibility"]	t	4	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
26	6	1D	1 Day Workshop	Starter Workshop	1	1	2	99.00	499.00	80	f	f	f	0	["Certificate of Attendance"]	t	0	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
27	6	10D	10 Days	Skill Sprint	10	10	20	499.00	3499.00	86	f	f	f	0	["Certificate of Completion", "Mini project"]	t	1	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
28	6	20D	20 Days	Skill Sprint	20	20	40	999.00	7999.00	88	f	f	f	0	["Certificate of Completion", "2 Minor projects"]	t	2	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
29	6	30D	30 Days	Marathon	30	30	60	1299.00	9999.00	87	t	f	f	10	["Certificate of Completion", "Synopsis Guide"]	t	3	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
30	6	45D	45 Days	Internship Pack	45	45	90	1499.00	14999.00	90	t	t	t	25	["Certificate of Completion", "Capstone Project", "LOR & PPO Eligibility"]	t	4	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
31	7	1D	1 Day Workshop	Starter Workshop	1	1	2	99.00	499.00	80	f	f	f	0	["Certificate of Attendance"]	t	0	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
32	7	10D	10 Days	Skill Sprint	10	10	20	499.00	3499.00	86	f	f	f	0	["Certificate of Completion", "Mini project"]	t	1	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
33	7	20D	20 Days	Skill Sprint	20	20	40	999.00	7999.00	88	f	f	f	0	["Certificate of Completion", "2 Minor projects"]	t	2	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
34	7	30D	30 Days	Marathon	30	30	60	1299.00	9999.00	87	t	f	f	10	["Certificate of Completion", "Synopsis Guide"]	t	3	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
35	7	45D	45 Days	Internship Pack	45	45	90	1499.00	14999.00	90	t	t	t	25	["Certificate of Completion", "Capstone Project", "LOR & PPO Eligibility"]	t	4	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
36	8	1D	1 Day Workshop	Starter Workshop	1	1	3	99.00	499.00	80	f	f	f	0	["Certificate of Attendance"]	t	0	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
37	8	10D	10 Days	Skill Sprint	10	10	20	499.00	3499.00	86	f	f	f	0	["Certificate of Completion", "Mini project"]	t	1	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
38	8	20D	20 Days	Skill Sprint	20	20	40	999.00	7999.00	88	f	f	f	0	["Certificate of Completion", "2 Minor projects"]	t	2	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
39	8	30D	30 Days	Marathon	30	30	60	1299.00	9999.00	87	t	f	f	10	["Certificate of Completion", "Synopsis Guide"]	t	3	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
40	8	45D	45 Days	Internship Pack	45	45	90	1499.00	14999.00	90	t	t	t	25	["Certificate of Completion", "Capstone Project", "LOR & PPO Eligibility"]	t	4	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
\.


--
-- Data for Name: course_tutors; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.course_tutors (course_id, tutor_id) FROM stdin;
\.


--
-- Data for Name: courses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.courses (id, slug, code, name, short_name, domain, summary, detailed_description, technologies, primary_stack, target_degrees, available_timings, capstone, curriculum, featured, status, thumbnail_url, created_by, created_at, updated_at) FROM stdin;
1	mern-full-stack	MERN	MERN Full Stack Development	MERN Stack	fullstack	Build production web apps with MongoDB, Express, React and Node.js.	Build production web apps with MongoDB, Express, React and Node.js. Includes live instructor-led sessions, Git-based milestones and a verifiable capstone.	["React 19", "Next.js", "Node.js", "Express", "MongoDB", "TypeScript"]	["React 19", "Next.js", "Node.js", "Express"]	["BCA", "MCA", "BE", "B.Tech"]	["07:30_AM", "02:00_PM", "06:00_PM", "08:30_PM"]	{"title": "MERN Stack Industrial Capstone", "modules": [], "architecture": null, "academicDocReady": true, "deploymentTarget": "Production", "problemStatement": null, "repositoryStructure": "monorepo"}	{"1D": [], "10D": [], "20D": [], "30D": [], "45D": [{"day": 1, "hours": 2, "topics": ["Git flow", "Project setup", "Code review basics"], "commitHash": "a1b2c3d", "commitMessage": "chore: bootstrap repository and tooling", "milestoneTitle": "Environment & Git workflow", "practicalDeliverable": "Initialised repository with CI checks"}]}	t	active	\N	\N	2026-10-14 23:26:44+00	2026-11-24 08:18:26.938127+00
2	flutter-mobile	FLUT	Flutter Mobile App Development	Flutter	fullstack	Ship cross-platform Android and iOS apps with Flutter and Dart.	Ship cross-platform Android and iOS apps with Flutter and Dart. Includes live instructor-led sessions, Git-based milestones and a verifiable capstone.	["Flutter", "Dart", "Firebase", "REST APIs"]	["Flutter", "Dart", "Firebase", "REST APIs"]	["BCA", "MCA", "BE", "B.Tech"]	["07:30_AM", "02:00_PM", "06:00_PM", "08:30_PM"]	{"title": "Flutter Industrial Capstone", "modules": [], "architecture": null, "academicDocReady": true, "deploymentTarget": "Production", "problemStatement": null, "repositoryStructure": "monorepo"}	{"1D": [], "10D": [], "20D": [], "30D": [], "45D": [{"day": 1, "hours": 2, "topics": ["Git flow", "Project setup", "Code review basics"], "commitHash": "a1b2c3d", "commitMessage": "chore: bootstrap repository and tooling", "milestoneTitle": "Environment & Git workflow", "practicalDeliverable": "Initialised repository with CI checks"}]}	f	active	\N	\N	2026-10-14 23:26:44+00	2026-11-24 08:18:26.938127+00
3	python-development	PYTH	Python Backend Development	Python	programming	Design APIs and async services with Python, FastAPI and Django.	Design APIs and async services with Python, FastAPI and Django. Includes live instructor-led sessions, Git-based milestones and a verifiable capstone.	["Python 3.12", "FastAPI", "Django", "PostgreSQL", "Celery"]	["Python 3.12", "FastAPI", "Django", "PostgreSQL"]	["BCA", "MCA", "BE", "B.Tech"]	["07:30_AM", "02:00_PM", "06:00_PM", "08:30_PM"]	{"title": "Python Industrial Capstone", "modules": [], "architecture": null, "academicDocReady": true, "deploymentTarget": "Production", "problemStatement": null, "repositoryStructure": "monorepo"}	{"1D": [], "10D": [], "20D": [], "30D": [], "45D": [{"day": 1, "hours": 2, "topics": ["Git flow", "Project setup", "Code review basics"], "commitHash": "a1b2c3d", "commitMessage": "chore: bootstrap repository and tooling", "milestoneTitle": "Environment & Git workflow", "practicalDeliverable": "Initialised repository with CI checks"}]}	t	active	\N	\N	2026-10-14 23:26:44+00	2026-11-24 08:18:26.938127+00
4	core-java	JAVA	Core Java & Spring Boot	Java	programming	Master Java fundamentals and build enterprise services with Spring Boot.	Master Java fundamentals and build enterprise services with Spring Boot. Includes live instructor-led sessions, Git-based milestones and a verifiable capstone.	["Java", "Spring Boot", "PostgreSQL", "REST APIs"]	["Java", "Spring Boot", "PostgreSQL", "REST APIs"]	["BCA", "MCA", "BE", "B.Tech"]	["07:30_AM", "02:00_PM", "06:00_PM", "08:30_PM"]	{"title": "Java Industrial Capstone", "modules": [], "architecture": null, "academicDocReady": true, "deploymentTarget": "Production", "problemStatement": null, "repositoryStructure": "monorepo"}	{"1D": [], "10D": [], "20D": [], "30D": [], "45D": [{"day": 1, "hours": 2, "topics": ["Git flow", "Project setup", "Code review basics"], "commitHash": "a1b2c3d", "commitMessage": "chore: bootstrap repository and tooling", "milestoneTitle": "Environment & Git workflow", "practicalDeliverable": "Initialised repository with CI checks"}]}	f	active	\N	\N	2026-10-14 23:26:44+00	2026-11-24 08:18:26.938127+00
5	dotnet-core	DOTN	.NET Core Development	.NET Core	programming	Build secure, scalable APIs and apps with C# and .NET.	Build secure, scalable APIs and apps with C# and .NET. Includes live instructor-led sessions, Git-based milestones and a verifiable capstone.	["C#", ".NET Core", "SQL Server", "REST APIs"]	["C#", ".NET Core", "SQL Server", "REST APIs"]	["BCA", "MCA", "BE", "B.Tech"]	["07:30_AM", "02:00_PM", "06:00_PM", "08:30_PM"]	{"title": ".NET Core Industrial Capstone", "modules": [], "architecture": null, "academicDocReady": true, "deploymentTarget": "Production", "problemStatement": null, "repositoryStructure": "monorepo"}	{"1D": [], "10D": [], "20D": [], "30D": [], "45D": [{"day": 1, "hours": 2, "topics": ["Git flow", "Project setup", "Code review basics"], "commitHash": "a1b2c3d", "commitMessage": "chore: bootstrap repository and tooling", "milestoneTitle": "Environment & Git workflow", "practicalDeliverable": "Initialised repository with CI checks"}]}	f	active	\N	\N	2026-10-14 23:26:44+00	2026-11-24 08:18:26.938127+00
6	power-bi-sql	PBSQ	Power BI & SQL Analytics	Power BI	data	Turn raw data into dashboards with SQL, Power Query and DAX.	Turn raw data into dashboards with SQL, Power Query and DAX. Includes live instructor-led sessions, Git-based milestones and a verifiable capstone.	["Power BI", "SQL", "DAX", "Power Query"]	["Power BI", "SQL", "DAX", "Power Query"]	["BCA", "MCA", "BE", "B.Tech"]	["07:30_AM", "02:00_PM", "06:00_PM", "08:30_PM"]	{"title": "Power BI Industrial Capstone", "modules": [], "architecture": null, "academicDocReady": true, "deploymentTarget": "Production", "problemStatement": null, "repositoryStructure": "monorepo"}	{"1D": [], "10D": [], "20D": [], "30D": [], "45D": [{"day": 1, "hours": 2, "topics": ["Git flow", "Project setup", "Code review basics"], "commitHash": "a1b2c3d", "commitMessage": "chore: bootstrap repository and tooling", "milestoneTitle": "Environment & Git workflow", "practicalDeliverable": "Initialised repository with CI checks"}]}	f	active	\N	\N	2026-10-14 23:26:44+00	2026-11-24 08:18:26.938127+00
7	ai-ml	AIML	AI & Machine Learning	AI / ML	advanced	Train, evaluate and deploy ML models with PyTorch and scikit-learn.	Train, evaluate and deploy ML models with PyTorch and scikit-learn. Includes live instructor-led sessions, Git-based milestones and a verifiable capstone.	["Python", "PyTorch", "Scikit-Learn", "NLP", "MLflow"]	["Python", "PyTorch", "Scikit-Learn", "NLP"]	["BCA", "MCA", "BE", "B.Tech"]	["07:30_AM", "02:00_PM", "06:00_PM", "08:30_PM"]	{"title": "AI / ML Industrial Capstone", "modules": [], "architecture": null, "academicDocReady": true, "deploymentTarget": "Production", "problemStatement": null, "repositoryStructure": "monorepo"}	{"1D": [], "10D": [], "20D": [], "30D": [], "45D": [{"day": 1, "hours": 2, "topics": ["Git flow", "Project setup", "Code review basics"], "commitHash": "a1b2c3d", "commitMessage": "chore: bootstrap repository and tooling", "milestoneTitle": "Environment & Git workflow", "practicalDeliverable": "Initialised repository with CI checks"}]}	t	active	\N	\N	2026-10-14 23:26:44+00	2026-11-24 08:18:26.938127+00
8	modern-seo-organic-growth	SEO	Search Engine Optimization (SEO) & Organic Growth	Modern SEO Masterclass	fullstack	Master end-to-end modern SEO from technical audits and semantic keyword research to AI-driven on-page optimization, content strategy, programmatic SEO, and authoritative backlink acquisition.	This industrial, hands-on Search Engine Optimization (SEO) program equips learners with actionable skills to rank web properties on Google and leading search engines. Covering the spectrum from foundational search engine mechanics to advanced technical optimization, students will learn Core Web Vitals diagnostics, crawl budget management, structured schema data, keyword clustering, and intent-based content creation. The curriculum also dives deep into enterprise-grade analytics (Google Search Console & Google Analytics 4), competitor intelligence using industry-standard tools (SEMrush & Ahrefs), local search (Google Business Profile), e-commerce SEO, and Generative Engine Optimization (GEO) for AI search summaries (ChatGPT Search, Perplexity, and Google AI Overviews).	["Google Search Console", "Google Analytics 4", "Ahrefs", "SEMrush", "Schema.org", "Looker Studio"]	["Technical SEO", "On-Page SEO", "Off-Page SEO", "Content & Semantic Optimization", "Local SEO", "GEO & AI Search Strategy"]	["BBA", "MBA", "B.Com", "BCA", "B.Tech / B.E.", "B.A. (Mass Communication / Journalism)", "MCA", "Any Graduate / Digital Marketing Aspirant"]	["07:30_AM", "02:00_PM", "06:00_PM", "08:30_PM"]	{"title": null, "modules": [], "architecture": null, "academicDocReady": true, "deploymentTarget": "Production", "problemStatement": null, "repositoryStructure": "monorepo"}	{"1D": [], "10D": [], "20D": [], "30D": [], "45D": []}	f	active	\N	\N	2026-10-24 05:25:41+00	2026-11-24 08:18:26.938127+00
\.


--
-- Data for Name: credentials; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.credentials (id, credential_id, enrollment_id, user_id, course_id, student_name, student_initials, degree, college_name, track_slug, track_name, duration, duration_days, issue_date, verification_status, verified_at, skills, github_url, live_deployment_url, capstone_title, capstone_description, lor_qualified, ppo_qualified, code_quality, milestone_sprints, technical_interview, total_score, verified_by, revoked_at, revoked_reason, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: document_recipients; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.document_recipients (document_id, enrollment_id) FROM stdin;
\.


--
-- Data for Name: documents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.documents (id, title, description, kind, scope, course_id, batch_id, file_path, file_name, mime_type, file_size, external_url, is_published, uploaded_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: domains; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.domains (id, slug, label, sort_order, created_at, updated_at) FROM stdin;
1	fullstack	Full Stack & Mobile	1	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
2	programming	Programming & Systems	2	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
3	data	Data & Productivity	3	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
4	advanced	Advanced Technologies	4	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
\.


--
-- Data for Name: enrollments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.enrollments (id, student_id, course_id, plan_id, batch_id, timing_id, status, amount_due, progress_percent, tutor_remarks, enrolled_at, completed_at, created_at, updated_at) FROM stdin;
1	2	7	35	\N	07:30_AM	active	1499.00	0	\N	2026-11-16 06:14:41+00	\N	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
2	3	7	35	\N	07:30_AM	active	6999.00	0	\N	2026-11-16 07:34:53+00	\N	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
3	4	7	35	\N	07:30_AM	active	6999.00	0	\N	2026-11-16 07:53:21+00	\N	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
\.


--
-- Data for Name: inquiries; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inquiries (id, type, name, email, phone, enquiry_category, interested_course, institution_name, designation, number_of_students, preferred_duration, preferred_training_window, message, status, admin_notes, created_at, updated_at) FROM stdin;
1	contact	Other Degree Candidate	student.8827510999@internkul.com	8827510999	internship	Python Backend & Systems (45 Days (AICTE Capstone + LOR + PPO))	\N	\N	\N	\N	\N	Lead from Hero Course Finder Dock: Degree: Other Degree | Track: Python Backend & Systems | Duration: 45 Days (AICTE Capstone + LOR + PPO) | WhatsApp: +91 8827510999	new	\N	2026-10-23 02:31:14+00	2026-11-24 08:18:26.938127+00
2	contact	B.Tech / BE (CSE / IT) Candidate	student.7974332528@internkul.com	7974332528	internship	MERN Full-Stack Development (45 Days (AICTE Capstone + LOR + PPO))	\N	\N	\N	\N	\N	Lead from Hero Course Finder Dock: Degree: B.Tech / BE (CSE / IT) | Track: MERN Full-Stack Development | Duration: 45 Days (AICTE Capstone + LOR + PPO) | WhatsApp: +91 7974332528	new	\N	2026-11-11 23:27:22+00	2026-11-24 08:18:26.938127+00
3	contact	B.Tech / BE (CSE / IT) Candidate	student.7974332528@internkul.com	7974332528	internship	Applied AI & Machine Learning (10 Days (Hands-on Sprint))	\N	\N	\N	\N	\N	Lead from Hero Course Finder Dock: Degree: B.Tech / BE (CSE / IT) | Track: Applied AI & Machine Learning | Duration: 10 Days (Hands-on Sprint) | WhatsApp: +91 7974332528	new	\N	2026-11-13 23:54:09+00	2026-11-24 08:18:26.938127+00
4	contact	B.Tech / BE (CSE / IT) Candidate	student.8827510999@internkul.com	8827510999	internship	MERN Full-Stack Development (45 Days (AICTE Capstone + LOR + PPO))	\N	\N	\N	\N	\N	Lead from Hero Course Finder Dock: Degree: B.Tech / BE (CSE / IT) | Track: MERN Full-Stack Development | Duration: 45 Days (AICTE Capstone + LOR + PPO) | WhatsApp: +91 8827510999	new	\N	2026-11-18 07:07:35+00	2026-11-24 08:18:26.938127+00
5	contact	B.Tech / BE (CSE / IT) Candidate	student.8827510999@internkul.com	8827510999	internship	MERN Full-Stack Development (45 Days (AICTE Capstone + LOR + PPO))	\N	\N	\N	\N	\N	Lead from Hero Course Finder Dock: Degree: B.Tech / BE (CSE / IT) | Track: MERN Full-Stack Development | Duration: 45 Days (AICTE Capstone + LOR + PPO) | WhatsApp: +91 8827510999	new	\N	2026-11-18 23:10:48+00	2026-11-24 08:18:26.938127+00
6	contact	B.Tech / BE (CSE / IT) Candidate	student.8827510999@internkul.com	8827510999	internship	MERN Full-Stack Development (45 Days (AICTE Capstone + LOR + PPO))	\N	\N	\N	\N	\N	Lead from Hero Course Finder Dock: Degree: B.Tech / BE (CSE / IT) | Track: MERN Full-Stack Development | Duration: 45 Days (AICTE Capstone + LOR + PPO) | WhatsApp: +91 8827510999	new	\N	2026-11-21 00:28:02+00	2026-11-24 08:18:26.938127+00
7	contact	B.Tech / BE (CSE / IT) Candidate	student.8718966511@internkul.com	8718966511	internship	MERN Full-Stack Development (45 Days (AICTE Capstone + LOR + PPO))	\N	\N	\N	\N	\N	Lead from Hero Course Finder Dock: Degree: B.Tech / BE (CSE / IT) | Track: MERN Full-Stack Development | Duration: 45 Days (AICTE Capstone + LOR + PPO) | WhatsApp: +91 8718966511	new	\N	2026-11-22 23:57:11+00	2026-11-24 08:18:26.938127+00
8	contact	B.Tech / BE (CSE / IT) Candidate	student.8718966511@internkul.com	8718966511	internship	MERN Full-Stack Development (45 Days (AICTE Capstone + LOR + PPO))	\N	\N	\N	\N	\N	Lead from Hero Course Finder Dock: Degree: B.Tech / BE (CSE / IT) | Track: MERN Full-Stack Development | Duration: 45 Days (AICTE Capstone + LOR + PPO) | WhatsApp: +91 8718966511	new	\N	2026-11-22 23:57:20+00	2026-11-24 08:18:26.938127+00
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notifications (id, user_id, type, title, body, link, read_at, created_at) FROM stdin;
\.


--
-- Data for Name: password_reset_codes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.password_reset_codes (id, user_id, code_hash, attempts, expires_at, used_at, created_at) FROM stdin;
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payments (id, enrollment_id, student_id, provider, status, amount, currency, receipt_no, razorpay_order_id, razorpay_payment_id, razorpay_signature, method, paid_at, refunded_amount, refunded_at, refund_reason, failure_reason, notes, recorded_by, raw, created_at, updated_at) FROM stdin;
1	1	2	legacy	paid	1499.00	INR	LEG-1000	\N	pay_U2jWfdszbauc8T	\N	razorpay	2026-11-16 06:14:41+00	0.00	\N	\N	\N	Imported from legacy students.interested_course_name	\N	\N	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
2	2	3	legacy	paid	6999.00	INR	LEG-1001	\N	pay_U0rB9ervXcmK1E	\N	razorpay	2026-11-16 07:34:53+00	0.00	\N	\N	\N	Imported from legacy students.interested_course_name	\N	\N	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
3	3	4	legacy	paid	6999.00	INR	LEG-1002	\N	pay_U18GSvdvjZmPyo	\N	razorpay	2026-11-16 07:53:21+00	0.00	\N	\N	\N	Imported from legacy students.interested_course_name	\N	\N	2026-11-24 08:18:26.938127+00	2026-11-24 08:18:26.938127+00
\.


--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, user_agent, ip, created_at) FROM stdin;
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schema_migrations (name, applied_at) FROM stdin;
001_schema.sql	2026-11-24 08:18:26.823987+00
\.


--
-- Data for Name: student_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.student_profiles (user_id, student_code, first_name, last_name, college, degree, permanent_address, interested_course_slug, interested_topics, auth_method, created_at, updated_at) FROM stdin;
2	STU-2026-CORE-4240	Gungun	Gupta	\N	\N	police line, kawardha, Chhattisgarh - 491995, India	ai-ml	["Python", "PyTorch", "Scikit-Learn", "NLP", "MLflow"]	manual	2026-11-16 06:14:41+00	2026-11-24 08:18:26.938127+00
3	STU-2026-AIML-3131	aon	\N	\N	\N	qwertyui	ai-ml	["Python", "PyTorch", "Scikit-Learn", "NLP", "MLflow"]	manual	2026-11-16 07:34:53+00	2026-11-24 08:18:26.938127+00
4	STU-2026-AIML-9062	Gungun	Gupta	\N	\N	police line, pune, Maharashtra - 411057, India	ai-ml	["Python", "PyTorch", "Scikit-Learn", "NLP", "MLflow"]	manual	2026-11-16 07:53:21+00	2026-11-24 08:18:26.938127+00
\.


--
-- Data for Name: tutor_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tutor_profiles (user_id, tutor_code, headline, bio, expertise, qualification, experience_years, linkedin_url, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, name, email, phone, country_code, password_hash, role, avatar_url, is_active, email_verified_at, last_login_at, last_active_at, created_at, updated_at) FROM stdin;
1	Internkul Admin	admin@internkul.com	\N	+91	$2b$12$IaBWXT5FaP0TuHlKQLZ9e./KpV7CHkSC9v0iL1rPgRL2zXpFN3Bt6	admin	\N	t	2026-11-24 08:18:26.938127+00	\N	\N	2026-10-14 23:26:44+00	2026-11-24 08:18:26.938127+00
2	Gungun Gupta	gungungupta6699@gmail.com	8827510999	+91	\N	student	\N	t	\N	\N	\N	2026-11-16 06:14:41+00	2026-11-24 08:18:26.938127+00
3	aon	priya.negi@aondigicon.com	7974332528	+91	\N	student	\N	t	\N	\N	\N	2026-11-16 07:34:53+00	2026-11-24 08:18:26.938127+00
4	Gungun Gupta	gungungpta99@gmail.com	8827510999	+91	\N	student	\N	t	\N	\N	\N	2026-11-16 07:53:21+00	2026-11-24 08:18:26.938127+00
\.


--
-- Name: activity_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.activity_logs_id_seq', 1, false);


--
-- Name: announcements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.announcements_id_seq', 1, false);


--
-- Name: batch_timings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.batch_timings_id_seq', 4, true);


--
-- Name: batches_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.batches_id_seq', 1, false);


--
-- Name: certificate_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.certificate_requests_id_seq', 1, false);


--
-- Name: class_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.class_sessions_id_seq', 1, false);


--
-- Name: course_plans_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.course_plans_id_seq', 40, true);


--
-- Name: courses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.courses_id_seq', 8, true);


--
-- Name: credential_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.credential_seq', 100, false);


--
-- Name: credentials_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.credentials_id_seq', 1, false);


--
-- Name: documents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.documents_id_seq', 1, false);


--
-- Name: domains_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.domains_id_seq', 4, true);


--
-- Name: enrollments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.enrollments_id_seq', 3, true);


--
-- Name: inquiries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.inquiries_id_seq', 8, true);


--
-- Name: notifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.notifications_id_seq', 1, false);


--
-- Name: password_reset_codes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.password_reset_codes_id_seq', 1, false);


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.payments_id_seq', 3, true);


--
-- Name: receipt_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.receipt_seq', 1002, true);


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.refresh_tokens_id_seq', 1, false);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 4, true);


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (session_id, enrollment_id);


--
-- Name: batch_timings batch_timings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_timings
    ADD CONSTRAINT batch_timings_pkey PRIMARY KEY (id);


--
-- Name: batch_timings batch_timings_timing_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_timings
    ADD CONSTRAINT batch_timings_timing_id_key UNIQUE (timing_id);


--
-- Name: batches batches_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_code_key UNIQUE (code);


--
-- Name: batches batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_pkey PRIMARY KEY (id);


--
-- Name: certificate_requests certificate_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_requests
    ADD CONSTRAINT certificate_requests_pkey PRIMARY KEY (id);


--
-- Name: class_sessions class_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_sessions
    ADD CONSTRAINT class_sessions_pkey PRIMARY KEY (id);


--
-- Name: course_plans course_plans_course_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_plans
    ADD CONSTRAINT course_plans_course_id_code_key UNIQUE (course_id, code);


--
-- Name: course_plans course_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_plans
    ADD CONSTRAINT course_plans_pkey PRIMARY KEY (id);


--
-- Name: course_tutors course_tutors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_tutors
    ADD CONSTRAINT course_tutors_pkey PRIMARY KEY (course_id, tutor_id);


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);


--
-- Name: courses courses_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_slug_key UNIQUE (slug);


--
-- Name: credentials credentials_credential_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials
    ADD CONSTRAINT credentials_credential_id_key UNIQUE (credential_id);


--
-- Name: credentials credentials_enrollment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials
    ADD CONSTRAINT credentials_enrollment_id_key UNIQUE (enrollment_id);


--
-- Name: credentials credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials
    ADD CONSTRAINT credentials_pkey PRIMARY KEY (id);


--
-- Name: document_recipients document_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_recipients
    ADD CONSTRAINT document_recipients_pkey PRIMARY KEY (document_id, enrollment_id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: domains domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domains
    ADD CONSTRAINT domains_pkey PRIMARY KEY (id);


--
-- Name: domains domains_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domains
    ADD CONSTRAINT domains_slug_key UNIQUE (slug);


--
-- Name: enrollments enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_pkey PRIMARY KEY (id);


--
-- Name: inquiries inquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inquiries
    ADD CONSTRAINT inquiries_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: password_reset_codes password_reset_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_codes
    ADD CONSTRAINT password_reset_codes_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payments payments_razorpay_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_razorpay_order_id_key UNIQUE (razorpay_order_id);


--
-- Name: payments payments_razorpay_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_razorpay_payment_id_key UNIQUE (razorpay_payment_id);


--
-- Name: payments payments_receipt_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_receipt_no_key UNIQUE (receipt_no);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);


--
-- Name: student_profiles student_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: student_profiles student_profiles_student_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_student_code_key UNIQUE (student_code);


--
-- Name: tutor_profiles tutor_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_profiles
    ADD CONSTRAINT tutor_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: tutor_profiles tutor_profiles_tutor_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_profiles
    ADD CONSTRAINT tutor_profiles_tutor_code_key UNIQUE (tutor_code);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: activity_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_action_idx ON public.activity_logs USING btree (action, created_at DESC);


--
-- Name: activity_enrollment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_enrollment_idx ON public.activity_logs USING btree (enrollment_id, created_at DESC);


--
-- Name: activity_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_user_idx ON public.activity_logs USING btree (user_id, created_at DESC);


--
-- Name: announcements_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX announcements_batch_idx ON public.announcements USING btree (batch_id, created_at DESC);


--
-- Name: announcements_course_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX announcements_course_idx ON public.announcements USING btree (course_id, created_at DESC);


--
-- Name: batches_course_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX batches_course_idx ON public.batches USING btree (course_id);


--
-- Name: batches_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX batches_status_idx ON public.batches USING btree (status) WHERE (NOT archived);


--
-- Name: batches_tutor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX batches_tutor_idx ON public.batches USING btree (tutor_id);


--
-- Name: certificate_requests_one_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX certificate_requests_one_open ON public.certificate_requests USING btree (enrollment_id) WHERE (status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'approved'::text]));


--
-- Name: certificate_requests_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX certificate_requests_status_idx ON public.certificate_requests USING btree (status, created_at DESC);


--
-- Name: class_sessions_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX class_sessions_batch_idx ON public.class_sessions USING btree (batch_id, starts_at);


--
-- Name: courses_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX courses_domain_idx ON public.courses USING btree (domain);


--
-- Name: courses_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX courses_status_idx ON public.courses USING btree (status);


--
-- Name: credentials_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX credentials_user_idx ON public.credentials USING btree (user_id);


--
-- Name: documents_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_batch_idx ON public.documents USING btree (batch_id);


--
-- Name: documents_course_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_course_idx ON public.documents USING btree (course_id);


--
-- Name: enrollments_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX enrollments_batch_idx ON public.enrollments USING btree (batch_id);


--
-- Name: enrollments_course_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX enrollments_course_idx ON public.enrollments USING btree (course_id);


--
-- Name: enrollments_one_live_per_course; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX enrollments_one_live_per_course ON public.enrollments USING btree (student_id, course_id) WHERE (status = ANY (ARRAY['pending_payment'::text, 'active'::text, 'completed'::text, 'suspended'::text]));


--
-- Name: enrollments_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX enrollments_status_idx ON public.enrollments USING btree (status);


--
-- Name: inquiries_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inquiries_status_idx ON public.inquiries USING btree (type, status);


--
-- Name: notifications_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_idx ON public.notifications USING btree (user_id, read_at, created_at DESC);


--
-- Name: password_reset_codes_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX password_reset_codes_user_idx ON public.password_reset_codes USING btree (user_id);


--
-- Name: payments_enrollment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_enrollment_idx ON public.payments USING btree (enrollment_id);


--
-- Name: payments_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_status_idx ON public.payments USING btree (status, paid_at DESC);


--
-- Name: payments_student_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_student_idx ON public.payments USING btree (student_id);


--
-- Name: refresh_tokens_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refresh_tokens_user_idx ON public.refresh_tokens USING btree (user_id);


--
-- Name: users_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_role_idx ON public.users USING btree (role);


--
-- Name: batch_timings batch_timings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER batch_timings_updated_at BEFORE UPDATE ON public.batch_timings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: batches batches_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER batches_updated_at BEFORE UPDATE ON public.batches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: certificate_requests certificate_requests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER certificate_requests_updated_at BEFORE UPDATE ON public.certificate_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: class_sessions class_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER class_sessions_updated_at BEFORE UPDATE ON public.class_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: course_plans course_plans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER course_plans_updated_at BEFORE UPDATE ON public.course_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: courses courses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER courses_updated_at BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: credentials credentials_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER credentials_updated_at BEFORE UPDATE ON public.credentials FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: documents documents_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: domains domains_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER domains_updated_at BEFORE UPDATE ON public.domains FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: enrollments enrollments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enrollments_updated_at BEFORE UPDATE ON public.enrollments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: inquiries inquiries_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER inquiries_updated_at BEFORE UPDATE ON public.inquiries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payments payments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: student_profiles student_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER student_profiles_updated_at BEFORE UPDATE ON public.student_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tutor_profiles tutor_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tutor_profiles_updated_at BEFORE UPDATE ON public.tutor_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: activity_logs activity_logs_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id) ON DELETE CASCADE;


--
-- Name: activity_logs activity_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: announcements announcements_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: announcements announcements_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.batches(id) ON DELETE CASCADE;


--
-- Name: announcements announcements_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: app_settings app_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: attendance attendance_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id) ON DELETE CASCADE;


--
-- Name: attendance attendance_marked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: attendance attendance_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.class_sessions(id) ON DELETE CASCADE;


--
-- Name: batches batches_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: batches batches_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: batches batches_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.course_plans(id) ON DELETE SET NULL;


--
-- Name: batches batches_timing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_timing_id_fkey FOREIGN KEY (timing_id) REFERENCES public.batch_timings(timing_id) ON UPDATE CASCADE;


--
-- Name: batches batches_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: certificate_requests certificate_requests_credential_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_requests
    ADD CONSTRAINT certificate_requests_credential_id_fkey FOREIGN KEY (credential_id) REFERENCES public.credentials(id) ON DELETE SET NULL;


--
-- Name: certificate_requests certificate_requests_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_requests
    ADD CONSTRAINT certificate_requests_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id) ON DELETE CASCADE;


--
-- Name: certificate_requests certificate_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_requests
    ADD CONSTRAINT certificate_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: certificate_requests certificate_requests_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate_requests
    ADD CONSTRAINT certificate_requests_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: class_sessions class_sessions_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_sessions
    ADD CONSTRAINT class_sessions_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.batches(id) ON DELETE CASCADE;


--
-- Name: class_sessions class_sessions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_sessions
    ADD CONSTRAINT class_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: course_plans course_plans_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_plans
    ADD CONSTRAINT course_plans_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: course_tutors course_tutors_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_tutors
    ADD CONSTRAINT course_tutors_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: course_tutors course_tutors_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_tutors
    ADD CONSTRAINT course_tutors_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: courses courses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: courses courses_domain_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_domain_fkey FOREIGN KEY (domain) REFERENCES public.domains(slug) ON UPDATE CASCADE;


--
-- Name: credentials credentials_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials
    ADD CONSTRAINT credentials_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE SET NULL;


--
-- Name: credentials credentials_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials
    ADD CONSTRAINT credentials_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id) ON DELETE SET NULL;


--
-- Name: credentials credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials
    ADD CONSTRAINT credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: document_recipients document_recipients_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_recipients
    ADD CONSTRAINT document_recipients_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_recipients document_recipients_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_recipients
    ADD CONSTRAINT document_recipients_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id) ON DELETE CASCADE;


--
-- Name: documents documents_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.batches(id) ON DELETE CASCADE;


--
-- Name: documents documents_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: documents documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: enrollments enrollments_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.batches(id) ON DELETE SET NULL;


--
-- Name: enrollments enrollments_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE RESTRICT;


--
-- Name: enrollments enrollments_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.course_plans(id) ON DELETE SET NULL;


--
-- Name: enrollments enrollments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: enrollments enrollments_timing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_timing_id_fkey FOREIGN KEY (timing_id) REFERENCES public.batch_timings(timing_id) ON UPDATE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: password_reset_codes password_reset_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_codes
    ADD CONSTRAINT password_reset_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payments payments_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id) ON DELETE SET NULL;


--
-- Name: payments payments_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payments payments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: student_profiles student_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tutor_profiles tutor_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_profiles
    ADD CONSTRAINT tutor_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict c5BZXiK7dv3e6cW9605dq4ZjCu7icK48fIC4chkFeDP3gPNKtUVddOR69qXvgWm

