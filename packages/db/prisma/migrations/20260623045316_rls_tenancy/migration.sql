-- RLS tenancy bootstrap.
-- Tables are owned by the migration role (cmc). The app connects as a non-owner
-- role (cmc_app) so row-level security applies. The owner bypasses RLS, which is
-- what lets migrations and the seed script write freely.

-- 1. App role (idempotent). Used by the API runtime via DATABASE_URL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cmc_app') THEN
    CREATE ROLE cmc_app LOGIN PASSWORD 'cmc_app';
  END IF;
END$$;

GRANT USAGE ON SCHEMA public TO cmc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cmc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cmc_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cmc_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cmc_app;

-- 2. Helper: parse the per-request facility GUC into int[] (NULL when unset/empty).
CREATE OR REPLACE FUNCTION app_facility_ids() RETURNS int[]
  LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN NULLIF(current_setting('app.facility_ids', true), '') IS NULL THEN NULL
    ELSE string_to_array(current_setting('app.facility_ids', true), ',')::int[]
  END;
$$;

CREATE OR REPLACE FUNCTION app_is_super_admin() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.is_super_admin', true) = 'true';
$$;

-- 3. RLS on facility — a row is visible/writable to super_admin, or when its id is
--    in the caller's facility set.
ALTER TABLE facility ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_isolation ON facility
  USING (app_is_super_admin() OR id = ANY (app_facility_ids()))
  WITH CHECK (app_is_super_admin() OR id = ANY (app_facility_ids()));

-- 4. RLS on user_facility — scoped by facility_id.
ALTER TABLE user_facility ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_facility_isolation ON user_facility
  USING (app_is_super_admin() OR facility_id = ANY (app_facility_ids()))
  WITH CHECK (app_is_super_admin() OR facility_id = ANY (app_facility_ids()));
