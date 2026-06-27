-- Academic term with explicit date bounds (decision 2026-06-26): final grade aggregates
-- grades/attendance within [start_date, end_date] for the matching period_key.

-- CreateTable
CREATE TABLE "academic_term" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "period_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "program" "Program",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_term_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "academic_term_facility_id_idx" ON "academic_term"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_term_facility_id_period_key_key" ON "academic_term"("facility_id", "period_key");

-- RLS: facility-scoped like other Phase 1 academic tables.
ALTER TABLE "academic_term" ENABLE ROW LEVEL SECURITY;
CREATE POLICY academic_term_isolation ON "academic_term"
  USING (app_is_super_admin() OR facility_id = ANY (app_facility_ids()))
  WITH CHECK (app_is_super_admin() OR facility_id = ANY (app_facility_ids()));
