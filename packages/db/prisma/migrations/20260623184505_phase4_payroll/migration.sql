-- CreateEnum
CREATE TYPE "PayslipStatus" AS ENUM ('draft', 'finalized', 'paid');

-- CreateTable
CREATE TABLE "employment_profile" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "position" TEXT NOT NULL,
    "grade" TEXT,
    "dependents" INTEGER NOT NULL DEFAULT 0,
    "started_at" DATE,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_rate" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "base_salary" INTEGER NOT NULL,
    "meal_allowance" INTEGER NOT NULL DEFAULT 0,
    "other_allowance" INTEGER NOT NULL DEFAULT 0,
    "kpi_max" INTEGER NOT NULL DEFAULT 0,
    "effective_from" DATE NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslip" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "period_key" TEXT NOT NULL,
    "standard_days" INTEGER NOT NULL,
    "workdays" INTEGER NOT NULL,
    "kpi_score" DOUBLE PRECISION NOT NULL,
    "kpi_grade" TEXT NOT NULL,
    "base_earned" INTEGER NOT NULL,
    "allowance_earned" INTEGER NOT NULL,
    "kpi_bonus" INTEGER NOT NULL,
    "variable_pay" INTEGER NOT NULL DEFAULT 0,
    "variable_note" TEXT,
    "insurance_deduction" INTEGER NOT NULL DEFAULT 0,
    "dependents" INTEGER NOT NULL DEFAULT 0,
    "gross_income" INTEGER NOT NULL,
    "taxable_income" INTEGER NOT NULL,
    "pit_amount" INTEGER NOT NULL,
    "net_income" INTEGER NOT NULL,
    "status" "PayslipStatus" NOT NULL DEFAULT 'draft',
    "computed_by_id" UUID,
    "finalized_by_id" UUID,
    "finalized_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employment_profile_user_id_key" ON "employment_profile"("user_id");

-- CreateIndex
CREATE INDEX "employment_profile_facility_id_idx" ON "employment_profile"("facility_id");

-- CreateIndex
CREATE INDEX "salary_rate_facility_id_idx" ON "salary_rate"("facility_id");

-- CreateIndex
CREATE INDEX "salary_rate_user_id_effective_from_idx" ON "salary_rate"("user_id", "effective_from");

-- CreateIndex
CREATE INDEX "payslip_facility_id_period_key_idx" ON "payslip"("facility_id", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "payslip_user_id_period_key_key" ON "payslip"("user_id", "period_key");

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — payroll tables are facility-scoped. staff→facility; super bypass. "Non-HR can't see
-- salary" is enforced at the tRPC layer (requireRole hr/ke_toan) — every read/write path is
-- role-gated; there is no role GUC for RLS to key on.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employment_profile','salary_rate','payslip']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY %1$s_isolation ON %1$I
        USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
        WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
    $f$, t);
  END LOOP;
END$$;
