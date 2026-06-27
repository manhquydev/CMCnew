-- Activation / password-reset tokens (account provisioning + password reset emails) and a
-- parent email-notification preference. Tokens store only a SHA-256 hash; the raw token lives
-- only in the delivered email. System-scoped: issued/consumed via endpoints with no session, so
-- the table runs under the super-bypass GUC (RLS enabled, super-only) and is invisible to clients.

CREATE TYPE "ActivationKind" AS ENUM ('parent_account', 'staff_account', 'password_reset');

CREATE TABLE "activation_token" (
  "id"           UUID             NOT NULL DEFAULT gen_random_uuid(),
  "kind"         "ActivationKind" NOT NULL,
  "subject_type" TEXT             NOT NULL,
  "subject_id"   UUID             NOT NULL,
  "token_hash"   TEXT             NOT NULL,
  "expires_at"   TIMESTAMP(3)     NOT NULL,
  "consumed_at"  TIMESTAMP(3),
  "created_at"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activation_token_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "activation_token_token_hash_key" ON "activation_token" ("token_hash");
CREATE INDEX "activation_token_subject_type_subject_id_idx" ON "activation_token" ("subject_type", "subject_id");

ALTER TABLE "activation_token" ENABLE ROW LEVEL SECURITY;
-- Super-bypass only: the worker/endpoints set the super GUC; no normal principal may read tokens.
CREATE POLICY activation_token_super_only ON "activation_token"
  USING (app_is_super_admin())
  WITH CHECK (app_is_super_admin());

-- Parent email-notification preference (digests/reminders honor it; transactional email ignores it).
ALTER TABLE "parent_account" ADD COLUMN "email_notifications" BOOLEAN NOT NULL DEFAULT true;
