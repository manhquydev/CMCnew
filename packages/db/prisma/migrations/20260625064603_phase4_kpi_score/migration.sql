-- CreateTable
CREATE TABLE "kpi_score" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "period_key" TEXT NOT NULL,
    "block" TEXT NOT NULL,
    "auto_score" DOUBLE PRECISION NOT NULL,
    "auto_breakdown" JSONB,
    "override_score" DOUBLE PRECISION,
    "override_reason" TEXT,
    "overridden_by_id" UUID,
    "overridden_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_score_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kpi_score_facility_id_period_key_idx" ON "kpi_score"("facility_id", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_score_user_id_period_key_key" ON "kpi_score"("user_id", "period_key");

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — kpi_score is facility-scoped (staff→facility; super bypass). Override authority (manager
-- tree) is enforced at the tRPC layer; RLS here adds facility isolation.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "kpi_score" ENABLE ROW LEVEL SECURITY;
CREATE POLICY kpi_score_isolation ON "kpi_score"
  USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
  WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())));
