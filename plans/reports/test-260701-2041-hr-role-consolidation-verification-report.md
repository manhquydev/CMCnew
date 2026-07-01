# Test Report — 2026-07-01 — hr-role-consolidation (RBAC) full verification

## Test Results Overview
- **apps/api**: 419 tests (75 files) — 418 passed, 1 failed (pre-existing, unrelated)
- **apps/admin**: 14 tests (2 files) — all passed
- **Duration**: api ~37s, admin ~2.5s

## Static Analysis
- `tsc --noEmit`: clean on `apps/api`, `apps/admin`, `packages/auth`, `packages/db`
- `eslint`: 0 errors. Warnings present (`no-explicit-any` in `emit-staff-notif.ts`,
  `shift-registration.ts`, `checkin-panel.tsx`, `shift-reg-detail-panel.tsx`) — all
  confirmed pre-existing via `git diff`, not introduced by this change.

## State/Outcome Verification (both live Postgres instances)
| DB | Role enum | app_user rows | Migrations |
|---|---|---|---|
| `cmcnew-prod-postgres-1` (deployment, no host port) | 9 values, retired roles gone | 2 (`super_admin` only) | 50/52 applied — 2 work-shift RLS migrations blocked by a pre-existing missing CREATE TABLE migration (unrelated to RBAC, see below) |
| `cmcnew-postgres-dev` (`docker/docker-compose.dev.yml`, port 5433 — what the test suite actually connects to) | 9 values, retired roles gone | 7 real seed/test rows remapped (user-confirmed) then verified 0 remaining with retired roles | 52/52 applied cleanly |

## Critical Issue Found & Fixed During This Verification Pass
**Regression**: full `apps/api` suite initially came back 357 passed / 41 failed after the
Phase 3 enum migration, all erroring `Value 'X' not found in enum 'Role'`.

- **Root cause #1**: `prisma generate` had been silently failing (Windows `EPERM` file lock)
  because 4 stray `tsx watch src/index.ts` dev-server processes held the query engine
  `.dll.node` open. Stopped those processes, `prisma generate` succeeded.
- **Root cause #2 (the real one)**: the RBAC enum migration had only ever been applied to
  `cmcnew-prod-postgres-1`. The actual dev/test database (`localhost:5433`, per root
  `.env` `DATABASE_URL`) is a **separate** Postgres — its container didn't even exist yet
  in this Docker daemon. Starting it (`pnpm db:up`) attached to an existing named volume
  with real historical seed data (7 rows holding retired roles). The migration's own
  safety check correctly aborted on first attempt (would not blindly remap). Presented the
  remap table to the user, got explicit confirmation, applied it, then deployed cleanly.
- **Fix verified**: full suite back to 418/419 (only the pre-existing unrelated failure
  remains).

## Failed Tests
### `test/email-graph-client.test.ts` — `templates > renders otp_login with the code in subject + body`
- **Error**: `expected 'Mã đăng nhập LMS CMC EDU' to contain '123456'`
- **Cause**: unrelated to this RBAC change — confirmed via `git diff` that this file/its
  source (`email-graph-client.ts`) has zero changes from this work. Pre-existing failure.
- **Fix**: out of scope for this task; flag separately.

## Build Status
- **apps/admin**: `vite build` — PASS (bundle-size warnings only, pre-existing: pdf.worker
  chunk 1.2MB, main bundle 1.45MB — not introduced by this change)
- **apps/api / packages/auth / packages/db**: no build step (type-checked only) — PASS

## Critical Issues
None outstanding. The one found during this pass (DB desync) is fixed and verified.

## Recommendations
1. **High** — `cmcnew-prod-postgres-1` is still missing the work-shift feature's initial
   CREATE TABLE migration (2 RLS migrations correctly un-applied, not falsely marked).
   Needs a new migration authored from the dev DB's actual `shift_*` table DDL before that
   deployment can serve the work-shift feature. Tracked in memory
   (`work-shift-missing-create-table-migration`), not fixed here (out of RBAC scope).
2. **Medium** — orphaned test-fixture row `qly_asgn_28808_29320@cmc.test` existed in the
   dev DB from a prior test run that didn't clean up after itself
   (`cskh-assignable-staff.int.test.ts`, already fixed to not create this anymore, but
   worth checking other `.int.test.ts` files for missing `afterAll` cleanup as a general
   hygiene pass).
3. **Low** — pre-existing `email-graph-client.test.ts` failure and `no-explicit-any` lint
   warnings are unrelated cleanup opportunities, not blockers.

## Unresolved Questions
- None for RBAC scope. Work-shift migration gap (finding #1 above) needs a separate
  decision on when/how to fix.
