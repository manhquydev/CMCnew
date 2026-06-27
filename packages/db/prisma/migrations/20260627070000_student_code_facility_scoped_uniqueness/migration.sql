-- Student.studentCode was globally @unique but codes are receipt-derived (HS-YYYY-NNNN from
-- PT-YYYY-NNNN via the per-facility receipt counter). Two facilities independently produce
-- HS-2026-0001, which collides under a global unique — same class of bug as ClassBatch/Receipt.
-- Drop the global unique; add per-facility composite unique.
-- Existing data is safe: all current rows belong to one facility.

DROP INDEX IF EXISTS "student_student_code_key";
ALTER TABLE "student" DROP CONSTRAINT IF EXISTS "student_student_code_key";
CREATE UNIQUE INDEX "student_facility_id_student_code_key" ON "student"("facility_id", "student_code");
