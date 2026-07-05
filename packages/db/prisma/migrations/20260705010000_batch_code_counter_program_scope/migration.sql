-- Widen batch_code_counter key to (facility_id, program, year) so class-batch
-- codes carry the program dimension (see docs/decisions/0036). Project has no
-- production class data yet, so existing counter rows are cleared rather than
-- backfilled with a guessed program value — new counters start fresh per
-- (facility, program, year). ALTER (not DROP+CREATE) preserves the table's
-- existing RLS enablement + isolation policy from the phase-1 migration.
TRUNCATE TABLE "batch_code_counter";

-- DropForeignKey / DropIndex not needed — no FKs reference this table's PK.
ALTER TABLE "batch_code_counter" DROP CONSTRAINT "batch_code_counter_pkey";

ALTER TABLE "batch_code_counter" ADD COLUMN "program" "Program" NOT NULL;

ALTER TABLE "batch_code_counter" ADD CONSTRAINT "batch_code_counter_pkey" PRIMARY KEY ("facility_id", "program", "year");
