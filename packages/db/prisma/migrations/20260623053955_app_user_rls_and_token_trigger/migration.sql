-- Defence-in-depth hardening (from Phase 0 adversarial review).

-- 1. RLS on app_user. Today the only reader is identity/system code (login,
--    resolveSession) which runs under a super-admin context, and the admin-only
--    user.list route. Enabling RLS makes that a DB guarantee, not just app-level:
--    a non-super_admin query can never enumerate accounts across facilities.
--    (Facility-scoped staff rosters in later phases will add a broader policy.)
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_user_admin_only ON app_user
  USING (app_is_super_admin())
  WITH CHECK (app_is_super_admin());

-- 2. Auto-revoke outstanding JWTs the moment a user is deactivated. resolveSession
--    rejects a token whose tokenVersion != the row's; bumping it here guarantees a
--    deactivated user is locked out on their next request even mid-session.
CREATE OR REPLACE FUNCTION bump_token_version_on_deactivate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active = false AND OLD.is_active = true THEN
    NEW.token_version := NEW.token_version + 1;
  END IF;
  RETURN NEW;
END$$;

CREATE TRIGGER app_user_deactivate_bump
  BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION bump_token_version_on_deactivate();
