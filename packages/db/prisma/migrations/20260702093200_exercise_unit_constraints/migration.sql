ALTER TABLE "exercise"
  ALTER COLUMN "curriculum_unit_id" SET NOT NULL;

CREATE UNIQUE INDEX "exercise_curriculum_unit_id_type_key"
  ON "exercise"("curriculum_unit_id", "type");
