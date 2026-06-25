-- Enable Row-Level Security on staff_notification so facility isolation is enforced
-- at the DB layer (not only application WHERE clauses). Mirrors the pattern used by
-- all other facility-scoped tables (payslip, kpi_score, salary_rate, etc.).
-- The policy grants access when the session principal is a super_admin OR when the
-- row's facility_id is in the caller's facility set (app_facility_ids() GUC).
-- WITH CHECK applies the same rule to INSERT/UPDATE so emitStaffNotif callers cannot
-- write cross-facility rows even if application code passes a wrong facilityId.

ALTER TABLE "staff_notification" ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_notification_isolation ON "staff_notification"
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
  );
