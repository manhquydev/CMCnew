# Watzup Handoff - Local Docker + E2E Validation

Status: DONE

## Current State

- Branch: `develop`.
- Worktree: dirty, expected. Many existing work-shift/session-evidence files predated this validation pass.
- Watzup scan completed from `D:/project/CMCnew`.
- Active relevant plan from scan: `plans/260630-2200-attendance-gap-closure/plan.md`.

## Completed This Pass

- Ran local Docker validation for Postgres/Redis.
- Re-ran migration, seed, RLS verification, typecheck, API integration, admin build, E2E, and full workspace test suite.
- Added E2E smoke for work-shift attendance UI surfaces.
- Fixed E2E stability issues in Playwright config and LMS smoke.
- Updated work-shift validation docs and journal.

## Key Evidence

- `pnpm --filter @cmc/api test:integration`: PASS, 69 files, 347 tests.
- `pnpm --filter @cmc/e2e test -- --reporter=dot`: PASS, 20/20 tests.
- `pnpm -r test`: PASS.
- `pnpm -r typecheck`: PASS.
- `pnpm --filter @cmc/admin build`: PASS, existing Vite chunk-size warning only.
- Docker Postgres/Redis healthy. PostgreSQL SQL errors observed were expected negative/idempotency/RLS test noise.

## Product Completeness Notes

- Company WiFi/IP configuration exists in Admin UI: `IP WiFi chấm công`.
- Shift catalog configuration exists in Admin UI: `Danh mục ca`.
- Punch UI exists in Admin UI: `Chấm công`.
- Shift registration UI exists in Admin UI: `Đăng ký ca`.
- Manager approval and supersede behavior are proven by integration tests; full browser manager approval journey remains a future E2E hardening item.

## Friction

- Subagent review fan-out failed due usage limit; main session completed validation and fixes.
- Prisma generate on Windows can hit `EPERM` if old dev servers keep the Prisma engine DLL locked.
- Valid parent OTP browser path can be slow/flaky under Playwright webServer cold boot because it enters the real email/Graph branch. Browser smoke uses a no-enumeration OTP probe; API integration covers valid parent OTP behavior.

## Next Suggested Work

- Add browser E2E for full manager approval/rejection click-through.
- Add browser E2E for outside-IP manual punch approval queue if the UI is intended for manager daily use.
- Decide whether to suppress expected PostgreSQL negative-test log noise in test docs or keep as known validation artifact.

## Unresolved Questions

- None.
