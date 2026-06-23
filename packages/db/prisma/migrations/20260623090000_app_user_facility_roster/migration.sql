-- Facility-scoped staff roster read access on app_user.
--
-- Phase 0 left app_user readable by super_admin only (policy app_user_admin_only),
-- with a noted follow-up: "Facility-scoped staff rosters in later phases will add a
-- broader policy." Phase 1 scheduling needs that now — quan_ly must pick a teacher
-- (giao_vien) in their own facility to assign to a class, which makes the hard
-- teacher-conflict block reachable.
--
-- This adds a SELECT-ONLY permissive policy. PostgreSQL ORs permissive policies, so
-- SELECT now succeeds when the caller is super_admin OR shares a facility with the
-- target user. INSERT/UPDATE/DELETE remain governed solely by app_user_admin_only
-- (super_admin only) — staff can read co-facility rosters but never mutate accounts.
--
-- The EXISTS subquery filters user_facility on facility_id = ANY(app_facility_ids());
-- that is exactly the row set user_facility_isolation already exposes to the caller,
-- so no SECURITY DEFINER bypass is required.

DROP POLICY IF EXISTS app_user_facility_roster ON app_user;
CREATE POLICY app_user_facility_roster ON app_user
  FOR SELECT
  USING (
    app_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM user_facility uf
      WHERE uf.user_id = app_user.id
        AND uf.facility_id = ANY (app_facility_ids())
    )
  );
