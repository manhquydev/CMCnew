-- CreateEnum
CREATE TYPE "GuardianLinkRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "guardian_link_request" (
    "id" UUID NOT NULL,
    "requested_by_account_id" UUID NOT NULL,
    "student_phone" TEXT,
    "student_code" TEXT,
    "matched_student_id" UUID,
    "facility_id" INTEGER,
    "status" "GuardianLinkRequestStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_link_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guardian_link_request_requested_by_account_id_idx" ON "guardian_link_request"("requested_by_account_id");

-- CreateIndex
CREATE INDEX "guardian_link_request_facility_id_idx" ON "guardian_link_request"("facility_id");

-- CreateIndex
CREATE INDEX "guardian_link_request_status_idx" ON "guardian_link_request"("status");

-- AddForeignKey
ALTER TABLE "guardian_link_request" ADD CONSTRAINT "guardian_link_request_requested_by_account_id_fkey" FOREIGN KEY ("requested_by_account_id") REFERENCES "parent_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: parent self-link anti-takeover (plan 260702-1109 phase-04).
--
-- New GUC app.account_id carries the LMS principal's own account id (ParentAccount id for a
-- parent), so "own row only" policies no longer need a student-ownership detour. Only
-- guardian_link_request and (below) parent_account's self-edit clause use it for now.
CREATE OR REPLACE FUNCTION app_account_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.account_id', true), '')::uuid;
$$;

-- guardian_link_request: parent reads/creates only own rows (requested_by_account_id =
-- app_account_id()). Staff sees facility-scoped resolved rows PLUS unresolved rows
-- (facility_id IS NULL, the director-global bucket) — access to that bucket is narrowed to
-- directors at the router permission layer (guardian.linkRequestList), not here, because RLS
-- has no role granularity, only facility scope. Anti-takeover: no policy here ever grants a
-- parent write access to the `guardian` table itself — only staff RLS (existing policy) can
-- create a Guardian row, via the reviewed approve path.
ALTER TABLE "guardian_link_request" ENABLE ROW LEVEL SECURITY;
CREATE POLICY guardian_link_request_isolation ON guardian_link_request
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND (facility_id IS NULL OR facility_id = ANY (app_facility_ids())))
    OR (app_principal_kind() = 'parent' AND requested_by_account_id = app_account_id())
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND (facility_id IS NULL OR facility_id = ANY (app_facility_ids())))
    OR (app_principal_kind() = 'parent' AND requested_by_account_id = app_account_id())
  );

-- parent_account: extend the existing staff-only identity policy so a parent principal may
-- read/update ONLY their own row (id = app_account_id()). Parents still cannot read/list other
-- parent_account rows — this is narrower than the staff clause, not a relaxation of it.
DROP POLICY IF EXISTS parent_account_staff_rw ON parent_account;
CREATE POLICY parent_account_staff_rw ON parent_account
  USING (
    app_is_super_admin()
    OR app_principal_kind() = 'staff'
    OR (app_principal_kind() = 'parent' AND id = app_account_id())
  )
  WITH CHECK (
    app_is_super_admin()
    OR app_principal_kind() = 'staff'
    OR (app_principal_kind() = 'parent' AND id = app_account_id())
  );
