-- Principal-aware RLS for notification.
--
-- The Phase-2 notification policy was facility-only: any parent/student principal would
-- match `facility_id = ANY(app_facility_ids())` and therefore read EVERY notification in
-- their center — including other children's grade alerts. That leaks one family's grades
-- to another. Notifications are addressed (recipient_id = the owning student's id), so a
-- parent/student must see only rows whose recipient is one of their own students.
--
-- staff             : facility scope (unchanged — facility_id NULL rows stay broadcast-safe).
-- parent | student  : recipient_id ∈ app.student_ids (own child set / self).
-- WITH CHECK: staff/super write freely; a principal may update (mark-read) only its own rows
--             — it can never re-address a row outside its student set (both clauses pin it).

DROP POLICY notification_isolation ON notification;
CREATE POLICY notification_isolation ON notification
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND (facility_id IS NULL OR facility_id = ANY (app_facility_ids())))
    OR (app_principal_kind() <> 'staff' AND recipient_id = ANY (app_student_ids()))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND (facility_id IS NULL OR facility_id = ANY (app_facility_ids())))
    OR (app_principal_kind() <> 'staff' AND recipient_id = ANY (app_student_ids()))
  );
