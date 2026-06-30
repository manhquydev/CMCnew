-- RLS for opportunity_assignment — facility-scoped staff data (B1 assignment log).
-- Mirrors the contact/opportunity isolation policy: staff see their facilities; super bypasses.
-- No parent/student access.
ALTER TABLE "opportunity_assignment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY opportunity_assignment_isolation ON "opportunity_assignment"
  USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
  WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())));
