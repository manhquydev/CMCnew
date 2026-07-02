# ERP/LMS Seam Fixes Validation

## Proof Strategy

Use layered proof because this changes authorization, RLS posture, schema, and user-visible LMS behavior.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Session end helper at ICT boundary; payroll domain guard including multi-role and self-write block; existing grading pure function. |
| Integration | Exercise auto-open before/after boundary, cancelled session exclusion, cross-student isolation, cross-class/before-open submission denial, director-only upsert, payroll domain scoping, KPI SoD preserved, guardian OTP isolation. |
| Parity | Permission snapshot contains only intended exercise and payroll changes. |
| Migration | `prisma migrate reset` from zero, `prisma migrate diff` no drift, exercise RLS disabled/no policy, submission RLS retained. |
| E2E | Teacher no longer sees exercise create/publish/manager; director upload for a unit becomes visible to enrolled LMS student only after session end. |
| Type/build | `pnpm typecheck`; targeted admin/api/lms typechecks; no tRPC `as any` cleanup regressions. |

## Commands

```text
pnpm --filter @cmc/db generate
pnpm --filter @cmc/domain-grading test
pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts
pnpm --filter @cmc/api test:integration
pnpm --filter @cmc/admin typecheck
pnpm --filter @cmc/lms typecheck
pnpm -r typecheck
```

Migration replay and prod-mirror commands follow `docs/operate-and-test-guide.md`.

## Acceptance Evidence

2026-07-02 implementation pass:

| Check | Result |
| --- | --- |
| `pnpm --filter @cmc/db generate` | Pass |
| `pnpm --filter @cmc/db exec prisma validate` | Pass |
| `pnpm --filter @cmc/api typecheck` | Pass |
| `pnpm --filter @cmc/admin typecheck` | Pass |
| `pnpm --filter @cmc/lms typecheck` | Pass |
| `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts` | Pass, 23 tests |
| `pnpm --filter @cmc/lms build` | Pass, Vite chunk-size warning only |
| `rg "showcase\|Trải nghiệm UI mới\|ShowcaseView" apps/lms/dist -S` | Pass, no production asset hits |
| `pnpm --filter @cmc/api exec vitest run --config vitest.integration.config.ts test/guardian-principal-isolation.int.test.ts` | Blocked: local Postgres unavailable at `localhost:5433` |

Not run locally:

- `prisma migrate reset`
- `prisma migrate diff`
- Browser e2e

Unresolved Questions:

- Need DB-backed integration/migration replay once local/prod-mirror Postgres is available.
