-- CreateEnum
CREATE TYPE "TestType" AS ENUM ('entrance', 'periodic');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('scheduled', 'done', 'no_show');

-- CreateTable
CREATE TABLE "test_appointment" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "opportunity_id" UUID,
    "student_name" TEXT,
    "type" "TestType" NOT NULL DEFAULT 'entrance',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" "TestStatus" NOT NULL DEFAULT 'scheduled',
    "score" DOUBLE PRECISION,
    "result" TEXT,
    "graded_by_id" UUID,
    "graded_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_appointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_appointment_facility_id_idx" ON "test_appointment"("facility_id");

-- CreateIndex
CREATE INDEX "test_appointment_opportunity_id_idx" ON "test_appointment"("opportunity_id");

-- AddForeignKey
ALTER TABLE "test_appointment" ADD CONSTRAINT "test_appointment_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — test_appointment is facility-scoped staff data. staff→facility; super bypass.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  EXECUTE 'ALTER TABLE test_appointment ENABLE ROW LEVEL SECURITY';
  EXECUTE $f$
    CREATE POLICY test_appointment_isolation ON test_appointment
      USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
      WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
  $f$;
END$$;
