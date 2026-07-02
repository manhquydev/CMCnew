-- Schema step of the RBAC role consolidation. Postgres has no DROP VALUE for enums, so this
-- recreates the type: rename old -> create new (9 values) -> cast both AppUser columns ->
-- drop old. Must run after 20260701210000_remap_legacy_roles verified zero rows hold a
-- retired role. Only app_user.roles / app_user.primary_role use the Role type (no RLS
-- policy or other column casts the "Role" type by name).

ALTER TYPE "Role" RENAME TO "Role_old";

CREATE TYPE "Role" AS ENUM (
  'super_admin',
  'giao_vien',
  'ke_toan',
  'hr',
  'sale',
  'cskh',
  'ctv_mkt',
  'giam_doc_kinh_doanh',
  'giam_doc_dao_tao'
);

ALTER TABLE "app_user"
  ALTER COLUMN "primary_role" TYPE "Role" USING ("primary_role"::text::"Role"),
  ALTER COLUMN "roles" TYPE "Role"[] USING ("roles"::text[]::"Role"[]);

DROP TYPE "Role_old";
