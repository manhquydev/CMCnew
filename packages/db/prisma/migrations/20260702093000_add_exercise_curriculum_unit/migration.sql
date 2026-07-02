-- Add nullable curriculum binding first so existing legacy rows can be purged safely
-- before NOT NULL and composite uniqueness are enforced.
ALTER TABLE "exercise"
  ADD COLUMN "curriculum_unit_id" UUID;

CREATE INDEX "exercise_curriculum_unit_id_idx"
  ON "exercise"("curriculum_unit_id");

ALTER TABLE "exercise"
  ADD CONSTRAINT "exercise_curriculum_unit_id_fkey"
  FOREIGN KEY ("curriculum_unit_id")
  REFERENCES "curriculum_unit"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
