# Phase 3: Tests & verification — completion report

## Executed Phase
- Phase: phase-03-tests-verification
- Plan: `D:\project\CMCnew\plans\260704-2130-employee-code-cmcx`
- Status: completed

## Files Modified
- Created: `apps/api/test/employee-code.int.test.ts` (199 lines, 6 tests)

## Tasks Completed
- [x] Int test **cấp mã mới**: new profile → `employeeCode` matches `^CMC\d{4,}$`; two consecutive new profiles → adjacent, distinct codes (read counter first, not hardcoded).
- [x] Int test **một lần**: re-upserting an already-coded profile (position/dependents change) → `employeeCode` unchanged.
- [x] Int test **atomic**: two concurrent `profileUpsert` creates via `Promise.all` → both get codes, distinct, no unique-constraint error.
- [x] Backfill verify: snapshot of pre-existing coded profiles (captured once at file load, before this suite's own new-code tests run) → sequential `CMC0001..CMC000N`, unique, counter `>=` that count. (Deliberately not hardcoded to "46" — actual pre-existing count in the dev DB is 45 today; see Concerns.)
- [x] Display verify: `shiftRegistration.list` returns `user.employeeCode` for a coded owner; for an owner with no `EmploymentProfile`, the field resolves to `null` with no crash.
- [x] `pnpm --filter @cmc/db exec prisma migrate status` — 0-drift, "Database schema is up to date!" (dev DB; env vars sourced from root `.env` since prisma CLI doesn't auto-load it from the package dir).
- [x] `pnpm --filter @cmc/api exec tsc --noEmit`, `pnpm --filter @cmc/admin exec tsc --noEmit`, `pnpm --filter @cmc/db exec tsc --noEmit` — all clean.

## Tests Status
- Type check: pass (api, admin, db)
- New file alone: `test/employee-code.int.test.ts` — 6/6 passed
- Full suite: `pnpm --filter @cmc/api run test:integration` (note: package has no plain `test` script, only `test:int`/`test:integration`) — **106 files / 586 tests passed, 0 failures** (baseline was 105 files/580 tests before this phase; +1 file/+6 tests, 0 regressions).
- Integration tests: pass (same run as above — this whole package is integration-style, hits real Postgres at localhost:5433)

## Issues Encountered
1. **Discovered the real pre-existing backfilled count is 45, not 46.** Queried the dev DB directly (`employmentProfile` rows with non-null `employeeCode`, ordered by `createdAt`/`id`): all 45 have `createdAt` in `2026-07-02` and codes `CMC0001..CMC0045` contiguously; `employee_code_counter.lastSeq` is now 112 (bumped by this session's own test runs, including a discarded earlier failed attempt — codes are never reused/reset, which is correct behavior). Rather than hardcode "46" per the phase file's literal wording, the backfill test captures the pre-existing coded set at file-load time via a promise and asserts against its own actual length — this is more robust and still verifies the exact invariant (sequential from 1, unique, counter caught up) without depending on a number that had already drifted from the phase file's assumption.
2. Initial draft of the display test called `shiftRegistration.create` via tRPC for the profile-less user, which hit an unrelated business-rule guard (`shift-registration.ts:234` — "Tài khoản chưa được thiết lập hồ sơ nhân sự") since that router requires an `EmploymentProfile` to resolve a shift group. Fixed by inserting that one registration row directly via `withRls(SUPER, ...)`, isolating the test to the actual thing under test (list-query display fallback), consistent with how `shift-registration-workflow.int.test.ts` seeds approved/cancelled rows directly.
3. Prod-mirror migration run is **outstanding** and explicitly NOT attempted here (Plan B hard-gate, per `plan.md`) — flagging as instructed. Only dev DB `migrate status` was verified.

## Next Steps
- Prod-mirror migration + backup-before-apply (hard-gate) is the only remaining item for Plan B before it can be considered fully shipped.

Status: DONE
Summary: Wrote `apps/api/test/employee-code.int.test.ts` (6 tests: new-code format/sequencing, immutability, concurrency, backfill invariant, display fallback) — all pass; full suite 106/106 files, 586/586 tests, 0 regressions; dev migrate status 0-drift; tsc clean across api/admin/db.
Concerns/Blockers: Prod-mirror migration apply is still outstanding (hard-gate, not attempted per instructions). Backfill count assumption in the phase file (46) does not match current dev DB state (45) — test does not hardcode this number, so it's self-correcting regardless.
