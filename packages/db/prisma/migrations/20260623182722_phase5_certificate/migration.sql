-- CreateTable
CREATE TABLE "certificate" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "student_id" UUID NOT NULL,
    "program" "Program" NOT NULL,
    "level" TEXT,
    "title" TEXT NOT NULL,
    "issued_by_id" UUID,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "certificate_facility_id_idx" ON "certificate"("facility_id");

-- CreateIndex
CREATE INDEX "certificate_student_id_idx" ON "certificate"("student_id");

-- AddForeignKey
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — certificate is facility-scoped staff data. staff→facility; super bypass.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  EXECUTE 'ALTER TABLE certificate ENABLE ROW LEVEL SECURITY';
  EXECUTE $f$
    CREATE POLICY certificate_isolation ON certificate
      USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
      WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
  $f$;
END$$;
