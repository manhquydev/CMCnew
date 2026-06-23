-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('O1_LEAD', 'O2_CONTACTED', 'O3_TEST_SCHEDULED', 'O4_TESTED', 'O5_ENROLLED');

-- CreateTable
CREATE TABLE "contact" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "source" TEXT,
    "note" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "contact_id" UUID NOT NULL,
    "student_name" TEXT,
    "program" "Program",
    "stage" "OpportunityStage" NOT NULL DEFAULT 'O1_LEAD',
    "lost_reason" TEXT,
    "closed_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_facility_id_idx" ON "contact"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_facility_id_phone_key" ON "contact"("facility_id", "phone");

-- CreateIndex
CREATE INDEX "opportunity_facility_id_idx" ON "opportunity"("facility_id");

-- CreateIndex
CREATE INDEX "opportunity_contact_id_idx" ON "opportunity"("contact_id");

-- AddForeignKey
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — CRM tables are facility-scoped staff data. staff→facility; super bypass.
-- No parent/student access. cmc_app DML via ALTER DEFAULT PRIVILEGES (rls_tenancy).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contact','opportunity']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY %1$s_isolation ON %1$I
        USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
        WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
    $f$, t);
  END LOOP;
END$$;
