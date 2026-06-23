-- CreateEnum
CREATE TYPE "LevelProgressStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "level_progress" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "student_id" UUID NOT NULL,
    "from_level" TEXT,
    "to_level" TEXT NOT NULL,
    "status" "LevelProgressStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "proposed_by_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "level_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "level_progress_student_id_idx" ON "level_progress"("student_id");

-- CreateIndex
CREATE INDEX "level_progress_facility_id_status_idx" ON "level_progress"("facility_id", "status");

-- AddForeignKey
ALTER TABLE "level_progress" ADD CONSTRAINT "level_progress_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS (principal-aware). Student-owned: staff→facility, parent/student→student_id ∈
-- app.student_ids (so a parent can see their child's level history). Writes are staff/system
-- only (teacher proposes, head_teacher approves) — a parent/student can never propose or approve.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "level_progress" ENABLE ROW LEVEL SECURITY;
CREATE POLICY level_progress_isolation ON "level_progress"
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
    OR (app_principal_kind() <> 'staff' AND student_id = ANY (app_student_ids()))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
  );
