-- Data integrity hardening (prod-readiness review):
--  * Deterministic pricing/payroll via unique (facility,course,effectiveFrom) / (user,effectiveFrom)
--  * StarTransaction idempotency via PARTIAL unique index (Postgres treats NULL as distinct, so a
--    plain unique on a nullable column allows unlimited (type, NULL) duplicates)
--  * Restrict cascade deletes that would silently wipe commission history / grades
--  * ParentAccount must be reachable by at least one identifier

-- DropForeignKey
ALTER TABLE "exercise" DROP CONSTRAINT "exercise_class_batch_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunity" DROP CONSTRAINT "opportunity_contact_id_fkey";

-- DropIndex
DROP INDEX "salary_rate_user_id_effective_from_idx";

-- DropIndex (replaced by a partial unique + a plain managed index below)
DROP INDEX "star_transaction_type_reference_key";

-- CreateIndex
CREATE UNIQUE INDEX "course_price_facility_id_course_id_effective_from_key" ON "course_price"("facility_id", "course_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "salary_rate_user_id_effective_from_key" ON "salary_rate"("user_id", "effective_from");

-- CreateIndex (Prisma-managed plain index, matches @@index([type, reference]))
CREATE INDEX "star_transaction_type_reference_idx" ON "star_transaction"("type", "reference");

-- Partial unique index for star idempotency — raw SQL because Prisma @@unique cannot express a
-- WHERE clause. Earn/redeem/refund always supply a non-null reference, so this dedupes them while
-- leaving future manual adjustments (reference required at the tRPC layer) free.
CREATE UNIQUE INDEX "star_transaction_type_reference_unique_notnull" ON "star_transaction"("type", "reference") WHERE "reference" IS NOT NULL;

-- AddForeignKey (Restrict: deleting a class must not cascade-delete its exercises→submissions→grades)
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_class_batch_id_fkey" FOREIGN KEY ("class_batch_id") REFERENCES "class_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (Restrict: deleting a contact must not cascade-delete its opportunities/commission)
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A parent account with neither email nor phone is unrecoverable; require at least one.
ALTER TABLE "parent_account" ADD CONSTRAINT "chk_parent_has_identifier" CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);
