-- Defense-in-depth (found in Plan 6 P4 code review): the generic phase-2 facility-isolation
-- policy on `guardian` allows any principal in the facility to read/write, with no
-- app_principal_kind() gate — unlike student/submission/star_transaction/reward/grade/exercise,
-- which were already tightened by 20260623100000_principal_aware_rls. No parent/student
-- procedure currently writes `guardian` directly (linking only ever happens through staff-gated
-- procedures — guardian.link/unlink, finance.receiptApprove, guardian.linkRequestReview), so this
-- is not an active exploit today. But Plan 6 P4's entire threat model is "a parent must never be
-- able to materialize a Guardian row" (anti-takeover) — that guarantee currently rests solely on
-- application routing, not on RLS. This migration backs it with a DB-level guarantee: only staff
-- (or super_admin) may write `guardian`. Read access is left unrestricted-by-principal-kind
-- (still facility-scoped) since no current code path needs to change; only a future parent/
-- student read of `guardian` directly would be a scope decision, not a security regression.

DROP POLICY guardian_isolation ON guardian;
CREATE POLICY guardian_isolation ON guardian
  USING (app_is_super_admin() OR facility_id = ANY (app_facility_ids()))
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
  );
