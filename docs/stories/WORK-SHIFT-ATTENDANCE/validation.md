# Work Shift Attendance Validation

## Proof Strategy

Prove the high-risk authorization and workflow invariants with API integration tests, permission parity, admin tests, admin build, typecheck, and browser E2E smoke over the operator UI surfaces.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Permission snapshot parity for new/changed procedures. |
| Integration | Registration visibility, manager approval ownership, date/template validation, supersede overlap, outside-IP manual punch queue, punch history scope, facility network create/delete. |
| E2E | Browser smoke covers Admin navigation/panels for Chấm công, Đăng ký ca, IP WiFi chấm công, and Danh mục ca. It verifies WiFi IP ranges are configurable through UI/API, not code edits. Full manager approval click-through remains integration-covered, not browser-covered. |
| Platform | RLS coverage includes new facility-scoped work-shift tables. |
| Performance | Not covered in this pass. |
| Logs/Audit | Notification path for submitted registrations and manual punches remains in router flow. |

## Fixtures

- Facility `1`.
- Two managers.
- Two sale staff with different managers.
- One sale staff without manager.
- Seeded Kinh doanh and Giao vien shift groups/templates.

## Commands

```text
pnpm --filter @cmc/api typecheck
pnpm --filter @cmc/admin typecheck
pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts
pnpm --filter @cmc/api test:integration -- work-shift-attendance
pnpm --filter @cmc/api test:integration
pnpm --filter @cmc/admin test
pnpm --filter @cmc/admin build
pnpm -r typecheck
pnpm -r test
pnpm --filter @cmc/e2e test -- --reporter=dot
docker compose -f docker/docker-compose.dev.yml logs --since 20m postgres redis
```

## Acceptance Evidence

2026-07-01:

- `pnpm --filter @cmc/api typecheck` passed.
- `pnpm --filter @cmc/admin typecheck` passed.
- `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts` passed: 25 tests.
- `pnpm --filter @cmc/api test:integration -- work-shift-attendance` passed: 1 file, 5 tests.
- `pnpm --filter @cmc/api test:integration` passed: 69 files, 347 tests.
- `pnpm --filter @cmc/admin test` passed: 1 file, 8 tests.
- `pnpm --filter @cmc/admin build` passed with existing Vite chunk-size warning.
- `pnpm -r typecheck` passed.
- `pnpm -r test` passed: workspace unit/domain/admin/ui suites plus Playwright E2E.
- `pnpm --filter @cmc/e2e test -- --reporter=dot` passed: 20/20 tests, including `apps/e2e/tests/work-shift-attendance.spec.ts`.
- Docker dev stack verified healthy for Postgres and Redis. Log review found SQL errors from negative/idempotency/RLS test probes only; no runtime crash found.
