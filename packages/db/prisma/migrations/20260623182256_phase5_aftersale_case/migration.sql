-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "CasePriority" AS ENUM ('low', 'normal', 'high');

-- CreateTable
CREATE TABLE "after_sale_case" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "student_id" UUID,
    "contact_phone" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "priority" "CasePriority" NOT NULL DEFAULT 'normal',
    "status" "CaseStatus" NOT NULL DEFAULT 'open',
    "assigned_to_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "after_sale_case_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "after_sale_case_facility_id_idx" ON "after_sale_case"("facility_id");

-- CreateIndex
CREATE INDEX "after_sale_case_student_id_idx" ON "after_sale_case"("student_id");

-- AddForeignKey
ALTER TABLE "after_sale_case" ADD CONSTRAINT "after_sale_case_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — after_sale_case is facility-scoped staff data. staff→facility; super bypass.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  EXECUTE 'ALTER TABLE after_sale_case ENABLE ROW LEVEL SECURITY';
  EXECUTE $f$
    CREATE POLICY after_sale_case_isolation ON after_sale_case
      USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
      WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
  $f$;
END$$;
