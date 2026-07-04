---
phase: 1
status: done_with_concerns
---

# Phase 1: Backend workflow & validation — implementation report

## BLOCKER check
`apps/api` was NOT actually deleted from the working tree at implementation time (the plan's noted `D` deletions were already resolved before this session started). No `git checkout -- apps/api` was needed.

## Changes

`apps/api/src/routers/shift-registration.ts`
- Added `saigonToday()` + `assertFutureFrom(fromDate)` helpers (line ~65-76), Asia/Ho_Chi_Minh, string comparison on `YYYY-MM-DD`.
- `create` (line ~200): existing-ticket guard changed from `status:'submitted'` to `status:{ in:['draft','submitted'] }`; added `assertFutureFrom(input.fromDate)` after the from/to range check; updated CONFLICT message per spec.
- New `updateDates` mutation (line ~334-382): permission `shiftRegistration.updateDates`, owner-only, draft-only, `fromDate<=toDate` + `assertFutureFrom`, updates fromDate/toDate and deletes out-of-range `shiftRegistrationEntry` rows in the same `tx`, writes `logEvent` type `updated` with old→new range + removed-entry count.
- `submit` (line ~384+): added `assertFutureFrom(reg.fromDate.toISOString().slice(0,10))` before allowing submit.
- `list` (line ~120-152): replaced with `findMany` → batch-map. Collects `userIds`, queries `tx.appUser.findMany({ where:{id:{in:userIds}}, select:{id,displayName,email} })`, builds a `Map`, returns `regs.map(r => ({ ...r, user: map.get(r.userId) ?? null }))`. Did NOT use Prisma `include` (no such relation exists on `ShiftRegistration.userId`).

`packages/auth/src/permissions.ts`
- Added `updateDates: ['giao_vien','sale','cskh']` to the `shiftRegistration` permission block (same role set as `updateEntry`/`submit`).

`apps/api/test/fixtures/permission-snapshot.json`
- Added `"shiftRegistration.updateDates": ["giao_vien", "sale", "cskh"]` matching the new permission entry.

## RLS check (required before implementing A4)

Checked `packages/db/prisma/migrations/20260623053955_app_user_rls_and_token_trigger/migration.sql`: base policy `app_user_admin_only` is `USING (app_is_super_admin())` — super_admin only.

However a later migration `packages/db/prisma/migrations/20260623090000_app_user_facility_roster/migration.sql` adds a second, OR'd, SELECT-only permissive policy `app_user_facility_roster`:
```sql
USING (
  app_is_super_admin()
  OR EXISTS (SELECT 1 FROM user_facility uf WHERE uf.user_id = app_user.id AND uf.facility_id = ANY (app_facility_ids()))
)
```
Postgres ORs permissive policies, so a manager/HR/director caller can read `appUser` rows for any user who shares a facility with them via `app_facility_ids()`. Since `shift-registration.list` is already scoped by `facilityId` and the viewer (manager/HR/director) shares that facility to see the ticket at all, the batch-map `appUser.findMany` will resolve names/emails correctly for all viewers who can reach `list` in the first place. **Not a blocker** — no RLS gap found for this feature's access pattern.

## Verification

- Manual read-through of the full diff: guard logic, transaction boundaries, permission wiring all match the phase spec.
- `pnpm --filter @cmc/api exec tsc --noEmit` could NOT be run: the `typescript` package in the repo's `node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/` is present but **empty** (broken/incomplete install), unrelated to this change. This is an environment issue, not introduced by this phase — flagging as a concern for Phase 4 (tests & verification) to resolve (likely needs `pnpm install` to repair).

## Concerns

- Typecheck environment is broken repo-wide (empty `typescript` package content) — Phase 4 should run `pnpm install` (or equivalent repair) before relying on `pnpm typecheck` to gate the PR.

Status: DONE_WITH_CONCERNS
Summary: All 5 phase requirements implemented (create guard, updateDates mutation, submit future-date check, list batch-map owner resolution, permission+snapshot). RLS verified safe for the batch-map query via the facility-roster policy.
Concerns/Blockers: Local `typescript` install is broken (empty package dir) so `tsc --noEmit` could not be run in this session — code was reviewed manually instead; recommend Phase 4 repair the install before running the typecheck gate.
