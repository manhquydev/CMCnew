-- Data step of the RBAC role consolidation (quan_ly/head_teacher/bgd retired — absorbed by
-- giam_doc_kinh_doanh / giam_doc_dao_tao). Phase 1 discovery (2026-07-01) confirmed zero
-- AppUser rows hold any of the 3 retired roles, so there is no real remap target to apply.
-- This step is a safety check, not a blind remap: it aborts the migration if a row appeared
-- since discovery, rather than guessing a destination role for someone we never reviewed.
DO $$
DECLARE
  affected_count integer;
BEGIN
  SELECT count(*) INTO affected_count
  FROM app_user
  WHERE roles && ARRAY['quan_ly', 'head_teacher', 'bgd']::"Role"[]
     OR primary_role IN ('quan_ly', 'head_teacher', 'bgd');

  IF affected_count > 0 THEN
    RAISE EXCEPTION 'RBAC migration abort: % app_user row(s) still hold a retired role (quan_ly/head_teacher/bgd). Re-run Phase 1 discovery and confirm a remap table before dropping the enum values.', affected_count;
  END IF;
END $$;
