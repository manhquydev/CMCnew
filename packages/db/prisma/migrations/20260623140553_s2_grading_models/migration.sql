-- CreateEnum
CREATE TYPE "AssessmentPeriod" AS ENUM ('MONTHLY', 'END_LEVEL');

-- CreateTable
CREATE TABLE "grading_template" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "program" "Program" NOT NULL,
    "level" TEXT,
    "formula" JSONB NOT NULL,
    "criteria" JSONB,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grading_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grading_threshold" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "template_id" UUID NOT NULL,
    "min_percent" DOUBLE PRECISION NOT NULL,
    "max_percent" DOUBLE PRECISION NOT NULL,
    "grade" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "grading_threshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qualitative_assessment" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "student_id" UUID NOT NULL,
    "program" "Program",
    "level" TEXT,
    "period" "AssessmentPeriod" NOT NULL,
    "period_key" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "narrative" TEXT,
    "assessed_by_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qualitative_assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_grade" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "student_id" UUID NOT NULL,
    "program" "Program" NOT NULL,
    "level" TEXT,
    "period_key" TEXT NOT NULL,
    "homework_avg" DOUBLE PRECISION,
    "attendance_rate" DOUBLE PRECISION,
    "test_score" DOUBLE PRECISION,
    "qualitative_score" DOUBLE PRECISION,
    "final_score" DOUBLE PRECISION,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "final_grade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grading_template_facility_id_idx" ON "grading_template"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "grading_template_facility_id_program_level_key" ON "grading_template"("facility_id", "program", "level");

-- CreateIndex
CREATE INDEX "grading_threshold_template_id_idx" ON "grading_threshold"("template_id");

-- CreateIndex
CREATE INDEX "grading_threshold_facility_id_idx" ON "grading_threshold"("facility_id");

-- CreateIndex
CREATE INDEX "qualitative_assessment_facility_id_idx" ON "qualitative_assessment"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "qualitative_assessment_student_id_period_key_key" ON "qualitative_assessment"("student_id", "period_key");

-- CreateIndex
CREATE INDEX "final_grade_facility_id_idx" ON "final_grade"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "final_grade_student_id_program_period_key_key" ON "final_grade"("student_id", "program", "period_key");

-- AddForeignKey
ALTER TABLE "grading_threshold" ADD CONSTRAINT "grading_threshold_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "grading_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualitative_assessment" ADD CONSTRAINT "qualitative_assessment_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_grade" ADD CONSTRAINT "final_grade_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS (principal-aware). Config tables (template/threshold) are a facility-scoped staff
-- catalog. Student-owned tables (qualitative_assessment/final_grade) follow the ownership
-- pattern: staff→facility, parent/student→student_id ∈ app.student_ids. Writes on the owned
-- tables are staff/system only (teacher assesses, system computes) — parent/student read-only.
-- cmc_app DML is granted by ALTER DEFAULT PRIVILEGES (rls_tenancy migration).
-- ─────────────────────────────────────────────────────────────────────────────

-- Config catalog: staff by facility (parents/students read FinalGrade, not templates).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['grading_template','grading_threshold']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY %1$s_isolation ON %1$I
        USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
        WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
    $f$, t);
  END LOOP;
END$$;

-- Student-owned: staff by facility; parent/student by student ownership. Write = staff/super only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['qualitative_assessment','final_grade']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY %1$s_isolation ON %1$I
        USING (
          app_is_super_admin()
          OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
          OR (app_principal_kind() <> 'staff' AND student_id = ANY (app_student_ids()))
        )
        WITH CHECK (
          app_is_super_admin()
          OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
        )
    $f$, t);
  END LOOP;
END$$;
