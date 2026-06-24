-- CreateTable
CREATE TABLE "compensation_policy" (
    "id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "params" JSONB NOT NULL,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "compensation_policy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compensation_policy_effective_from_idx" ON "compensation_policy"("effective_from");

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — compensation_policy is company-wide config (no facility). Any staff principal may READ
-- the effective policy (HR payslip compute needs it; the policy is rate tables, not individual
-- salary secrets — those live in salary_rate, app-layer role-gated). Only super_admin WRITES.
-- App-layer requireRole still confines policy-management endpoints to super_admin.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "compensation_policy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY compensation_policy_access ON "compensation_policy"
  USING (app_is_super_admin() OR app_principal_kind() = 'staff')
  WITH CHECK (app_is_super_admin());
