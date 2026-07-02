-- RLS for work shift registration + attendance tables.
-- Facility-scoped: staff see their facilities; super bypasses. No parent/student access.
-- Pattern: app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))

ALTER TABLE "shift_group" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shift_group_isolation ON "shift_group";
CREATE POLICY shift_group_isolation ON "shift_group"
  USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
  WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())));

ALTER TABLE "shift_template" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shift_template_isolation ON "shift_template";
CREATE POLICY shift_template_isolation ON "shift_template"
  USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
  WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())));

ALTER TABLE "shift_registration" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shift_registration_isolation ON "shift_registration";
CREATE POLICY shift_registration_isolation ON "shift_registration"
  USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
  WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())));

ALTER TABLE "time_punch" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS time_punch_isolation ON "time_punch";
CREATE POLICY time_punch_isolation ON "time_punch"
  USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
  WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())));

ALTER TABLE "facility_network" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facility_network_isolation ON "facility_network";
CREATE POLICY facility_network_isolation ON "facility_network"
  USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
  WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())));

ALTER TABLE "shift_code_counter" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shift_code_counter_isolation ON "shift_code_counter";
CREATE POLICY shift_code_counter_isolation ON "shift_code_counter"
  USING (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())))
  WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())));
