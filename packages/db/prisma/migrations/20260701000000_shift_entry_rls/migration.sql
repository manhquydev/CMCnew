-- RLS for shift_registration_entry (join-parent pattern).
-- This table has no facility_id column — it inherits facility scope via its
-- parent shift_registration row. Pattern matches opportunity_assignment.
ALTER TABLE "shift_registration_entry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shift_registration_entry_isolation ON "shift_registration_entry"
  USING (EXISTS (SELECT 1 FROM shift_registration r
                 WHERE r.id = shift_registration_entry.registration_id
                   AND (app_is_super_admin() OR (app_principal_kind() = 'staff' AND r.facility_id = ANY (app_facility_ids())))))
  WITH CHECK (EXISTS (SELECT 1 FROM shift_registration r
                      WHERE r.id = shift_registration_entry.registration_id
                        AND (app_is_super_admin() OR (app_principal_kind() = 'staff' AND r.facility_id = ANY (app_facility_ids())))));
