-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('draft', 'approved', 'sent', 'reconciled', 'cancelled');

-- CreateTable
CREATE TABLE "course_price" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "course_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_tier" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "years" INTEGER NOT NULL,
    "percent" INTEGER NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "valid_from" DATE,
    "valid_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "code" TEXT,
    "student_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "period" TEXT,
    "years_prepaid" INTEGER NOT NULL,
    "annual_price" INTEGER NOT NULL,
    "gross_amount" INTEGER NOT NULL,
    "tier_percent" INTEGER NOT NULL,
    "voucher_id" UUID,
    "voucher_percent" INTEGER NOT NULL DEFAULT 0,
    "effective_discount_percent" INTEGER NOT NULL,
    "net_amount" INTEGER NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'draft',
    "collected_by_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "reconciled_at" TIMESTAMP(3),
    "reconcile_note" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_code_counter" (
    "facility_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "receipt_code_counter_pkey" PRIMARY KEY ("facility_id","year")
);

-- CreateIndex
CREATE INDEX "course_price_facility_id_idx" ON "course_price"("facility_id");

-- CreateIndex
CREATE INDEX "course_price_course_id_effective_from_idx" ON "course_price"("course_id", "effective_from");

-- CreateIndex
CREATE INDEX "discount_tier_facility_id_idx" ON "discount_tier"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_tier_facility_id_years_key" ON "discount_tier"("facility_id", "years");

-- CreateIndex
CREATE INDEX "voucher_facility_id_idx" ON "voucher"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_facility_id_code_key" ON "voucher"("facility_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_code_key" ON "receipt"("code");

-- CreateIndex
CREATE INDEX "receipt_facility_id_idx" ON "receipt"("facility_id");

-- CreateIndex
CREATE INDEX "receipt_student_id_idx" ON "receipt"("student_id");

-- AddForeignKey
ALTER TABLE "course_price" ADD CONSTRAINT "course_price_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — Phase 3 S1 revenue tables are a facility-scoped staff catalog/ledger.
-- staff→facility; super_admin bypass. No parent/student access (finance is staff-only).
-- cmc_app DML granted by ALTER DEFAULT PRIVILEGES (rls_tenancy migration).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['course_price','discount_tier','voucher','receipt','receipt_code_counter']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY %1$s_isolation ON %1$I
        USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
        WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
    $f$, t);
  END LOOP;
END$$;
