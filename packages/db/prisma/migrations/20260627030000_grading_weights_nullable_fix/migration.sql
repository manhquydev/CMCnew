-- Corrective migration: make grading blend weights nullable (DEFAULT NULL).
--
-- The previous migration added qualitative_weight/quantitative_weight with
-- NOT NULL DEFAULT 1.0/0.0. That default is only correct for UCREA. Any
-- GradingTemplate row created AFTER the migration (e.g. via seed-demo.ts)
-- silently received 1.0/0.0 for every program, causing BRIGHT_IG and
-- BLACK_HOLE to compute as 100% qualitative instead of their charter blends
-- (0.6/0.4 and 0.3/0.7 respectively).
--
-- Override semantics (invariant for all callers):
--   NULL  = no override; the assessment router falls back to the canonical
--           programWeights() constants defined in @cmc/domain-grading.
--   non-null (both columns set) = explicit per-template override; the router
--           passes these values to computeFinalGrade() instead of the constants.
--
-- Existing rows are cleared to NULL so they fall back to charter constants
-- through code. A template that genuinely needs non-charter weights must have
-- both columns set explicitly by the operator.

ALTER TABLE "grading_template"
  ALTER COLUMN "qualitative_weight"  DROP NOT NULL,
  ALTER COLUMN "qualitative_weight"  DROP DEFAULT,
  ALTER COLUMN "quantitative_weight" DROP NOT NULL,
  ALTER COLUMN "quantitative_weight" DROP DEFAULT;

-- Clear all existing rows: NULL = use charter programWeights() fallback.
-- Rows seeded by the previous migration held the charter values anyway;
-- this moves the source of truth from DB columns back to @cmc/domain-grading.
UPDATE "grading_template"
  SET "qualitative_weight" = NULL, "quantitative_weight" = NULL;
