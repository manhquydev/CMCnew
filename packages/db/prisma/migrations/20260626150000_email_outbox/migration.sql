-- Email outbox (transactional outbox for Microsoft Graph sender).
-- Business code enqueues a row inside its own txn; a cron worker drains and sends.
-- System-scoped: the worker runs under the super-bypass GUC and sees all rows; staff may
-- enqueue rows for their own facility (or facility-null system rows). Parents/students have
-- no policy branch, so the outbox is invisible to LMS principals.

CREATE TYPE "EmailStatus" AS ENUM ('queued', 'sending', 'sent', 'failed', 'skipped');

CREATE TABLE "email_outbox" (
  "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
  "facility_id"   INTEGER,
  "dedup_key"     TEXT         NOT NULL,
  "to_address"    TEXT         NOT NULL,
  "mailbox"       TEXT         NOT NULL,
  "template_kind" TEXT         NOT NULL,
  "subject"       TEXT         NOT NULL,
  "body_html"     TEXT         NOT NULL,
  "attach_ref"    TEXT,
  "status"        "EmailStatus" NOT NULL DEFAULT 'queued',
  "attempts"      INTEGER      NOT NULL DEFAULT 0,
  "last_error"    TEXT,
  "scheduled_for" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at"       TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_outbox_dedup_key_key" ON "email_outbox" ("dedup_key");
CREATE INDEX "email_outbox_status_scheduled_for_idx" ON "email_outbox" ("status", "scheduled_for");
CREATE INDEX "email_outbox_facility_id_idx" ON "email_outbox" ("facility_id");

-- RLS: super_admin (worker) sees all; staff may read/write rows for their facility or
-- facility-null system rows. Uses the same GUC helpers as other facility-scoped tables.
ALTER TABLE "email_outbox" ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_outbox_isolation ON "email_outbox"
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff'
        AND ("facility_id" IS NULL OR "facility_id" = ANY (app_facility_ids())))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff'
        AND ("facility_id" IS NULL OR "facility_id" = ANY (app_facility_ids())))
  );
