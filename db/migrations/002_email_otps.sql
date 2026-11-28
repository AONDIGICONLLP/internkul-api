-- One-time codes that prove ownership of an e-mail address during sign-up / checkout
CREATE TABLE email_otps (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       citext      NOT NULL,
  code_hash   text        NOT NULL,
  attempts    smallint    NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_otps_email_idx ON email_otps(email, created_at DESC);
