-- Migration: DB-driven grading weights + term lock.
--
-- Grading weights (qualitative_weight / quantitative_weight) replace the hardcoded per-program
-- constants that previously lived only in packages/domain-grading. Existing rows are seeded to
-- EXACTLY the charter values so no recomputation of already-stored FinalGrade rows is needed.
--   UCREA      → 1.0 / 0.0
--   BRIGHT_IG  → 0.6 / 0.4
--   BLACK_HOLE → 0.3 / 0.7
-- Rows with unknown/future programs fall back to 1.0 / 0.0 (qualitative-only default).
--
-- isLocked on academic_term prevents FinalGrade mutations once a period is closed.

-- Step 1: Add weight columns with neutral defaults (will be patched per program below).
ALTER TABLE "grading_template"
  ADD COLUMN "qualitative_weight"  DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN "quantitative_weight" DOUBLE PRECISION NOT NULL DEFAULT 0.0;

-- Step 2: Back-fill existing rows to charter weights by program.
UPDATE "grading_template" SET "qualitative_weight" = 1.0, "quantitative_weight" = 0.0 WHERE "program" = 'UCREA';
UPDATE "grading_template" SET "qualitative_weight" = 0.6, "quantitative_weight" = 0.4 WHERE "program" = 'BRIGHT_IG';
UPDATE "grading_template" SET "qualitative_weight" = 0.3, "quantitative_weight" = 0.7 WHERE "program" = 'BLACK_HOLE';

-- Step 3: Add isLocked to academic_term.
ALTER TABLE "academic_term"
  ADD COLUMN "is_locked" BOOLEAN NOT NULL DEFAULT FALSE;

-- Step 4: Add chatter_note to StaffNotifEvent enum (follower fan-out for Chatter notes).
ALTER TYPE "StaffNotifEvent" ADD VALUE IF NOT EXISTS 'chatter_note';
