-- AlterTable
ALTER TABLE "employment_profile" ADD COLUMN     "callio_ext" TEXT;

-- CreateTable
CREATE TABLE "call_metric" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "period_key" TEXT NOT NULL,
    "valid_calls" INTEGER NOT NULL DEFAULT 0,
    "total_calls" INTEGER NOT NULL DEFAULT 0,
    "total_talk_sec" INTEGER NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_metric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_metric_facility_id_period_key_idx" ON "call_metric"("facility_id", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "call_metric_user_id_period_key_key" ON "call_metric"("user_id", "period_key");

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — call_metric is facility-scoped (staff→facility; super bypass). Like payroll, "non-HR
-- can't read salary-adjacent data" is enforced at the tRPC layer (requireRole hr/ke_toan); RLS
-- here adds facility isolation.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "call_metric" ENABLE ROW LEVEL SECURITY;
CREATE POLICY call_metric_isolation ON "call_metric"
  USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
  WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())));
