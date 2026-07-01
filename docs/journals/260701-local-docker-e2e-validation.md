# 260701 local Docker + E2E validation

## Scope

Validate work-shift attendance and related LMS smoke flows in local Docker, then fix blockers found by the validation run.

## What changed

- Added Playwright coverage for work-shift attendance Admin surfaces:
  - Chấm công.
  - Đăng ký ca.
  - IP WiFi chấm công.
  - Danh mục ca.
- Confirmed company WiFi/IP is configurable in Admin UI through the `IP WiFi chấm công` panel. Admin does not need code edits for this.
- Hardened Playwright boot:
  - single worker by default.
  - longer webServer/global timeout.
  - explicit `--host 127.0.0.1`.
- Updated LMS smoke assertions for current UI copy and isolated test cookies.

## Validation

- `pnpm db:up` passed; Postgres and Redis healthy.
- `pnpm db:migrate` passed; no pending migrations.
- `pnpm db:seed` passed.
- `pnpm --filter @cmc/db exec tsx src/verify-rls.ts` passed.
- `pnpm -r typecheck` passed.
- `pnpm --filter @cmc/api test:integration` passed: 69 files, 347 tests.
- `pnpm --filter @cmc/admin build` passed with existing Vite chunk-size warning.
- `pnpm --filter @cmc/e2e test -- --reporter=dot` passed: 20/20 tests.
- `pnpm -r test` passed.
- Docker logs reviewed after tests. PostgreSQL showed expected duplicate/RLS errors from negative and idempotency tests only; no service crash found.

## Findings

- The user's WiFi/IP concern is covered: Admin has a configurable `IP WiFi chấm công` module, and E2E now asserts it is reachable.
- Full browser click-through for manager approval/rejection remains not covered. API integration covers manager ownership, approval, supersede, outside-IP manual queue, and facility network create/delete.
- Windows Prisma generate can fail with `EPERM` when a dev server holds the Prisma engine DLL. Stop old dev server processes before `pnpm --filter @cmc/db generate`.
- Subagent fan-out was unavailable because the environment hit usage limits. Main-agent validation continued with the same scoped review lanes.

## Unresolved Questions

- None.
