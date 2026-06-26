-- F1: Student provisioning atomic at receipt.approve
--
-- Three changes:
--   1. receipt.student_id becomes nullable (student created at approve, not at draft)
--   2. New provisioning fields on receipt (parent_phone, parent_name, student_name, student_dob, class_batch_id)
--   3. Provenance FK on student and enrollment (created_by_receipt_id)
--
-- No existing data is affected: all new columns are nullable, and existing receipt rows
-- with student_id already set continue to satisfy the FK (now nullable, still valid).

-- 1. Make receipt.student_id nullable (was NOT NULL)
ALTER TABLE "receipt" ALTER COLUMN "student_id" DROP NOT NULL;

-- 2. New receipt fields for new-student provisioning
ALTER TABLE "receipt" ADD COLUMN "parent_phone"   TEXT;
ALTER TABLE "receipt" ADD COLUMN "parent_name"    TEXT;
ALTER TABLE "receipt" ADD COLUMN "student_name"   TEXT;
ALTER TABLE "receipt" ADD COLUMN "student_dob"    DATE;
ALTER TABLE "receipt" ADD COLUMN "class_batch_id" UUID;

-- 3. Provenance on student
ALTER TABLE "student" ADD COLUMN "created_by_receipt_id" UUID;

-- 4. Provenance on enrollment
ALTER TABLE "enrollment" ADD COLUMN "created_by_receipt_id" UUID;

-- 5. Foreign key constraints
ALTER TABLE "receipt"
  ADD CONSTRAINT "receipt_class_batch_id_fkey"
  FOREIGN KEY ("class_batch_id") REFERENCES "class_batch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Student → Receipt (circular FK: receipt also FKs to student, both nullable — safe in Postgres)
ALTER TABLE "student"
  ADD CONSTRAINT "student_created_by_receipt_id_fkey"
  FOREIGN KEY ("created_by_receipt_id") REFERENCES "receipt"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "enrollment"
  ADD CONSTRAINT "enrollment_created_by_receipt_id_fkey"
  FOREIGN KEY ("created_by_receipt_id") REFERENCES "receipt"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Indexes
CREATE INDEX "receipt_class_batch_id_idx"            ON "receipt"("class_batch_id");
CREATE INDEX "student_created_by_receipt_id_idx"     ON "student"("created_by_receipt_id");
CREATE INDEX "enrollment_created_by_receipt_id_idx"  ON "enrollment"("created_by_receipt_id");
