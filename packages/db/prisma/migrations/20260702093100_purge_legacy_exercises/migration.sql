-- Legacy exercises were class/facility-scoped demo rows. Production has no real
-- submissions to preserve for this model, so hard-delete before tightening shape.
DELETE FROM "submission"
WHERE "exercise_id" IN (
  SELECT "id"
  FROM "exercise"
  WHERE "curriculum_unit_id" IS NULL
);

DELETE FROM "exercise"
WHERE "curriculum_unit_id" IS NULL;
