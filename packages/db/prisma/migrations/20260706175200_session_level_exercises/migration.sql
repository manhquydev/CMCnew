-- Add lesson-template rows under each curriculum unit so exercises can be
-- assigned per concrete lesson/session slot instead of per whole unit.

CREATE TABLE "curriculum_lesson" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "course_id" UUID NOT NULL,
  "curriculum_unit_id" UUID NOT NULL,
  "lesson_code" TEXT NOT NULL,
  "seq_in_unit" INTEGER NOT NULL,
  "order_global" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "curriculum_lesson_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "curriculum_lesson_lesson_code_key"
  ON "curriculum_lesson"("lesson_code");
CREATE UNIQUE INDEX "curriculum_lesson_curriculum_unit_id_seq_in_unit_key"
  ON "curriculum_lesson"("curriculum_unit_id", "seq_in_unit");
CREATE INDEX "curriculum_lesson_course_id_order_global_idx"
  ON "curriculum_lesson"("course_id", "order_global");
CREATE INDEX "curriculum_lesson_curriculum_unit_id_idx"
  ON "curriculum_lesson"("curriculum_unit_id");

ALTER TABLE "curriculum_lesson"
  ADD CONSTRAINT "curriculum_lesson_course_id_fkey"
  FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "curriculum_lesson"
  ADD CONSTRAINT "curriculum_lesson_curriculum_unit_id_fkey"
  FOREIGN KEY ("curriculum_unit_id") REFERENCES "curriculum_unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "curriculum_lesson" (
  "course_id",
  "curriculum_unit_id",
  "lesson_code",
  "seq_in_unit",
  "order_global"
)
SELECT
  cu."course_id",
  cu."id",
  cu."unit_code" || '-S' || lpad(gs::text, 2, '0'),
  gs,
  cu."order_global" * 100 + gs
FROM "curriculum_unit" cu
CROSS JOIN LATERAL generate_series(1, GREATEST(cu."sessions", 1)) AS gs
ON CONFLICT ("lesson_code") DO NOTHING;

ALTER TABLE "class_session"
  ADD COLUMN "curriculum_lesson_id" UUID;

CREATE INDEX "class_session_curriculum_lesson_id_idx"
  ON "class_session"("curriculum_lesson_id");

ALTER TABLE "class_session"
  ADD CONSTRAINT "class_session_curriculum_lesson_id_fkey"
  FOREIGN KEY ("curriculum_lesson_id") REFERENCES "curriculum_lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

WITH ordered_sessions AS (
  SELECT
    cs."id",
    cb."course_id",
    row_number() OVER (
      PARTITION BY cs."class_batch_id"
      ORDER BY cs."session_date", cs."start_time", cs."id"
    ) AS rn
  FROM "class_session" cs
  JOIN "class_batch" cb ON cb."id" = cs."class_batch_id"
  WHERE cs."status" <> 'cancelled'
    AND cs."is_makeup" = false
),
ordered_lessons AS (
  SELECT
    cl."id",
    cl."course_id",
    cl."curriculum_unit_id",
    row_number() OVER (
      PARTITION BY cl."course_id"
      ORDER BY cl."order_global", cl."id"
    ) AS rn
  FROM "curriculum_lesson" cl
)
UPDATE "class_session" cs
SET
  "curriculum_lesson_id" = ol."id",
  "curriculum_unit_id" = COALESCE(cs."curriculum_unit_id", ol."curriculum_unit_id")
FROM ordered_sessions os
JOIN ordered_lessons ol
  ON ol."course_id" = os."course_id"
 AND ol.rn = os.rn
WHERE cs."id" = os."id";

ALTER TABLE "exercise"
  ADD COLUMN "curriculum_lesson_id" UUID;

CREATE INDEX "exercise_curriculum_lesson_id_idx"
  ON "exercise"("curriculum_lesson_id");

ALTER TABLE "exercise"
  ADD CONSTRAINT "exercise_curriculum_lesson_id_fkey"
  FOREIGN KEY ("curriculum_lesson_id") REFERENCES "curriculum_lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "exercise" e
SET "curriculum_lesson_id" = first_lesson."id"
FROM (
  SELECT DISTINCT ON (cl."curriculum_unit_id")
    cl."curriculum_unit_id",
    cl."id"
  FROM "curriculum_lesson" cl
  ORDER BY cl."curriculum_unit_id", cl."seq_in_unit" ASC
) AS first_lesson
WHERE e."curriculum_lesson_id" IS NULL
  AND e."curriculum_unit_id" = first_lesson."curriculum_unit_id";

DROP INDEX IF EXISTS "exercise_curriculum_unit_id_type_key";

CREATE UNIQUE INDEX "exercise_curriculum_lesson_id_type_key"
  ON "exercise"("curriculum_lesson_id", "type");
