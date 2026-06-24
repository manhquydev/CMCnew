-- CreateEnum
CREATE TYPE "ParentMeetingStatus" AS ENUM ('scheduled', 'done', 'cancelled');

-- CreateTable
CREATE TABLE "parent_meeting" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "class_batch_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "note" TEXT,
    "status" "ParentMeetingStatus" NOT NULL DEFAULT 'scheduled',
    "reminded_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "parent_meeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parent_meeting_facility_id_idx" ON "parent_meeting"("facility_id");

-- CreateIndex
CREATE INDEX "parent_meeting_class_batch_id_idx" ON "parent_meeting"("class_batch_id");

-- CreateIndex
CREATE INDEX "parent_meeting_status_reminded_at_scheduled_at_idx" ON "parent_meeting"("status", "reminded_at", "scheduled_at");

-- AddForeignKey
ALTER TABLE "parent_meeting" ADD CONSTRAINT "parent_meeting_class_batch_id_fkey" FOREIGN KEY ("class_batch_id") REFERENCES "class_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — parent_meeting is a per-class entity (no student_id). staff→facility; super bypass;
-- parents/students read meetings for a class their student is enrolled in (via enrollment,
-- same pattern as exercise_isolation). Writes are staff-only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "parent_meeting" ENABLE ROW LEVEL SECURITY;
CREATE POLICY parent_meeting_isolation ON "parent_meeting"
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
    OR (app_principal_kind() <> 'staff' AND EXISTS (
      SELECT 1 FROM enrollment e
      WHERE e.class_batch_id = parent_meeting.class_batch_id AND e.student_id = ANY (app_student_ids())
    ))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
  );
