DROP POLICY IF EXISTS "exercise_isolation" ON "exercise";
ALTER TABLE "exercise" DISABLE ROW LEVEL SECURITY;

ALTER TABLE "exercise" DROP CONSTRAINT IF EXISTS "exercise_class_batch_id_fkey";
DROP INDEX IF EXISTS "exercise_facility_id_idx";
DROP INDEX IF EXISTS "exercise_class_batch_id_idx";

ALTER TABLE "exercise"
  DROP COLUMN IF EXISTS "facility_id",
  DROP COLUMN IF EXISTS "class_batch_id",
  DROP COLUMN IF EXISTS "due_at";
