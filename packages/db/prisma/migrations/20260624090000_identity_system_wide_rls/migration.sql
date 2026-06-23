-- Identity tables become system-wide (approved 2026-06-24, security-class).
--
-- Facilities are linked branches, not isolated companies. parent_account / student_account
-- are global identities (no facility_id) — like Odoo res.partner. Previously super_admin-only,
-- which blocked leadership (bgd/quan_ly) from managing parents at the system level.
--
-- New policy: any staff principal may read/write these identity rows; parents/students
-- (principal_kind <> 'staff') still cannot. Operational scoping stays on the facility-tagged
-- tables (student, guardian, …). Router-level role gates restrict WHO among staff manages them;
-- every select excludes passwordHash / login secrets. See docs/specs/facility-model-decision.md.

DROP POLICY IF EXISTS parent_account_admin_only ON parent_account;
CREATE POLICY parent_account_staff_rw ON parent_account
  USING (app_is_super_admin() OR app_principal_kind() = 'staff')
  WITH CHECK (app_is_super_admin() OR app_principal_kind() = 'staff');

DROP POLICY IF EXISTS student_account_admin_only ON student_account;
CREATE POLICY student_account_staff_rw ON student_account
  USING (app_is_super_admin() OR app_principal_kind() = 'staff')
  WITH CHECK (app_is_super_admin() OR app_principal_kind() = 'staff');
