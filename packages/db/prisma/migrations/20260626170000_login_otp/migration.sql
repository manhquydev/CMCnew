-- Passwordless login OTP for LMS parents. Stores only SHA-256 of email + code (no plaintext PII or
-- code at rest). Short-lived, single-use, attempt-counted to defeat brute force of the 6-digit code.
-- System-scoped: issued/verified by no-session endpoints under super-bypass → super-only RLS.

CREATE TABLE "login_otp" (
  "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
  "email_hash"  TEXT         NOT NULL,
  "code_hash"   TEXT         NOT NULL,
  "expires_at"  TIMESTAMP(3) NOT NULL,
  "attempts"    INTEGER      NOT NULL DEFAULT 0,
  "consumed_at" TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "login_otp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_otp_email_hash_created_at_idx" ON "login_otp" ("email_hash", "created_at");

ALTER TABLE "login_otp" ENABLE ROW LEVEL SECURITY;
CREATE POLICY login_otp_super_only ON "login_otp"
  USING (app_is_super_admin())
  WITH CHECK (app_is_super_admin());
