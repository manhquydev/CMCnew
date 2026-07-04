# Phase 4: Tests & verification — report

## Executed Phase
- Phase: phase-04-tests-verification
- Plan: `plans/260704-2130-cong-ca-workflow-ux-fixes`
- Status: completed

## Files Modified
- Created: `apps/api/test/shift-registration-workflow.int.test.ts` (~230 lines, 8 tests)
- Verified only (no changes needed): `apps/api/test/fixtures/permission-snapshot.json`, `packages/auth/src/permissions.ts`, `apps/api/test/permission-parity.test.ts` — `shiftRegistration.updateDates` already present and matching in both, snapshot already includes the named parity test for delegated approval.

## Tasks Completed
- [x] create-lock: draft ticket blocks `create` (CONFLICT); submitted ticket blocks `create` (CONFLICT); only approved/cancelled tickets → `create` succeeds.
- [x] future-date guard: `create` with `fromDate` = today/yesterday → BAD_REQUEST, tomorrow → OK; `updateDates` same; `submit` on a directly-seeded draft with `fromDate` = today → BAD_REQUEST. Dates computed via the same `Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Ho_Chi_Minh'})` formula as the router's `saigonToday()`, not hardcoded, to avoid midnight/TZ flakiness.
- [x] updateDates: narrowing the range deletes out-of-range `shiftRegistrationEntry` rows (verified via count before/after: 3 → 2, checked exact remaining dates) while in-range entries survive; non-owner → FORBIDDEN; on a `submitted` ticket → CONFLICT; audit log verified via `tx.recordEvent` (`entityType: 'shift_registration'`, `type: 'updated'`).
- [x] list include: returned registrations carry `user.displayName`/`user.email` for the ticket owner; a `giam_doc_kinh_doanh` manager sees the employee's ticket via `visibleRegistrationWhere`; an unrelated peer sale does not see it.
- [x] Confirmed no regression in the broader int suite (shift-registration, attendance, and all others).
- [x] Confirmed `permission-parity.test.ts` green with `shiftRegistration.updateDates` present in registry + snapshot (no edits needed — already added in Phase 1).

## Tests Status
- Type check `@cmc/api`: pass (tsc --noEmit clean, no output)
- Type check `@cmc/admin`: pass (tsc --noEmit clean, no output)
- Int tests (`pnpm --filter @cmc/api run test:int`): **105 files / 580 tests passed, 0 failed** (full suite, includes new file's 8 tests + `permission-parity.test.ts` + `shift-registration-delegated-approver.int.test.ts` + `work-shift-attendance.int.test.ts`, all green, no regressions)
- New file alone: `test/shift-registration-workflow.int.test.ts` — 8/8 tests passed (607ms)

## Issues Encountered
None. The "tsc install broken" concern noted by an earlier agent did not reproduce — both packages typecheck cleanly.

## Next Steps
Phase 4 (and Plan A overall: Phases 1-4) is complete. No blockers for merge/PR.

Status: DONE
Summary: Added 8 new int tests covering create-lock, future-date guard (create/updateDates/submit), updateDates entry-pruning + owner/draft/audit invariants, and list user-include/visibility; full int suite 105 files/580 tests green, tsc clean on api+admin, permission-parity already matches.
Concerns/Blockers: none
