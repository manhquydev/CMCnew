# Work Shift Attendance Hardening Report

Date: 2026-07-01

## Scope

Audit and harden reported work-shift registration + punch attendance implementation.

## Agent Findings

- Admin UX: facility network and shift config panels existed but were unreachable from normalized route keys. Outside-IP approval had API but no manager UI.
- Backend/domain: same-facility staff could read peers' registrations/punch history; manual punch approval was not direct-manager scoped; manager fallback was not facility scoped; entry validation trusted client template IDs.
- Docs/Harness: roadmap/story proof overstated implementation. Claimed `70/70 files, 389 tests` not proven.
- Test: actual pre-fix integration proof was lower than claimed and had no work-shift behavioral tests.

## Fixes

- Made `facility-network` and `shift-config` valid Admin section keys.
- Exposed shift registration queue to managers through `shiftRegistration.list` nav gate.
- Hid create action from users without `shiftRegistration.create`.
- Fixed stale selected-shift save in detail panel.
- Added manager manual-punch queue and approve action to CheckIn panel.
- Added `checkInOut.pendingManual`.
- Scoped punch history and manual approval by self/direct manager/HR/super admin.
- Scoped registration list/get and registered-month view by self/direct manager/HR/super admin.
- Scoped auto manager fallback by facility.
- Rejected unresolved-manager approval for normal managers.
- Validated date ranges, entry date bounds, and template group/facility membership.
- Superseded all overlapping approved registrations when a newer registration is approved.
- Allowed `quan_ly` to configure facility WiFi/IP ranges through existing facility network API/UI.
- Added integration regression tests for the high-risk invariants.

## Verification

- PASS `pnpm --filter @cmc/api typecheck`
- PASS `pnpm --filter @cmc/admin typecheck`
- PASS `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts` — 25 tests
- PASS `pnpm --filter @cmc/api test:integration -- work-shift-attendance` — 1 file, 5 tests
- PASS `pnpm --filter @cmc/api test:integration` — 69 files, 347 tests
- PASS `pnpm --filter @cmc/admin test` — 1 file, 8 tests
- PASS `pnpm --filter @cmc/admin build` — existing Vite large chunk warning

## Corrected Claim

Current proven API integration count after this hardening is 69 files / 347 tests, not 70/70 files / 389 tests.

## Remaining Gaps

- Browser E2E for end-to-end manager approval and network settings UI.
- Product decision: should directors also configure facility WiFi/IP ranges, or only `quan_ly` + `super_admin`?
- Attendance penalty calculation still needs deeper audit for multiple shifts/overnight edge cases.
- Employment profiles without `managerId` need operational cleanup because normal manager approval now fails closed.

## Unresolved Questions

- Should `quan_ly` be allowed to create/delete WiFi/IP ranges, or only request changes from `super_admin`?
- Should director roles receive the same manual-punch approval queue as direct managers when they are not stored in `managerId`?
