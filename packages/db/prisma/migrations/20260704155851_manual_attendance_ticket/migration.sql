-- CreateTable
CREATE TABLE "manual_attendance_ticket" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "date_key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_attendance_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "manual_attendance_ticket_facility_id_status_idx" ON "manual_attendance_ticket"("facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "manual_attendance_ticket_user_id_date_key_key" ON "manual_attendance_ticket"("user_id", "date_key");

-- RLS: facility-scoped tenant table, same pattern as time_punch (20260630140000_work_shift_rls).
-- Rollback: DROP TABLE "manual_attendance_ticket"; (drops the policy with it).
ALTER TABLE "manual_attendance_ticket" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manual_attendance_ticket_isolation ON "manual_attendance_ticket";
CREATE POLICY manual_attendance_ticket_isolation ON "manual_attendance_ticket"
  USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
  WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())));
