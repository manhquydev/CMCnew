-- Sales-ops + DB foundations (B1 assignment-log, B2 attribution, B4 lost-reason enum, E3 indexes).
-- NOTE: unrelated pre-existing drift (receipt FK, email_outbox/login_otp id defaults) intentionally
-- NOT bundled here — this migration is scoped to the feature only.

-- CreateEnum
CREATE TYPE "LostReason" AS ENUM ('price', 'schedule', 'distance', 'competitor', 'no_response', 'not_ready', 'other');

-- AlterTable: B2 channel attribution on contact
ALTER TABLE "contact" ADD COLUMN     "campaign" TEXT,
ADD COLUMN     "medium" TEXT;

-- AlterTable: B4 lost-reason — convert free-text -> enum, preserving original text into lost_note.
-- expand -> backfill -> constrain so existing rows are never dropped.
ALTER TABLE "opportunity" ADD COLUMN "lost_note" TEXT;
UPDATE "opportunity" SET "lost_note" = "lost_reason" WHERE "lost_reason" IS NOT NULL;
ALTER TABLE "opportunity"
  ALTER COLUMN "lost_reason" TYPE "LostReason"
  USING (CASE WHEN "lost_reason" IS NULL THEN NULL ELSE 'other' END::"LostReason");

-- CreateTable: B1 append-only assignment log
CREATE TABLE "opportunity_assignment" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "from_owner_id" UUID,
    "to_owner_id" UUID,
    "assigned_by_id" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunity_assignment_facility_id_idx" ON "opportunity_assignment"("facility_id");

-- CreateIndex
CREATE INDEX "opportunity_assignment_opportunity_id_idx" ON "opportunity_assignment"("opportunity_id");

-- CreateIndex: E3 high-volume table indexes (student-centric / date-window lookups)
CREATE INDEX "attendance_enrollment_id_idx" ON "attendance"("enrollment_id");

-- CreateIndex
CREATE INDEX "class_session_facility_id_session_date_idx" ON "class_session"("facility_id", "session_date");

-- CreateIndex
CREATE INDEX "enrollment_student_id_idx" ON "enrollment"("student_id");

-- CreateIndex
CREATE INDEX "submission_student_id_idx" ON "submission"("student_id");

-- AddForeignKey
ALTER TABLE "opportunity_assignment" ADD CONSTRAINT "opportunity_assignment_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
