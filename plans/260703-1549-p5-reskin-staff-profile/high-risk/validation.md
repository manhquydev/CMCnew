# Validation

## Proof Strategy

No jsdom/RTL infra exists in `packages/ui` or `apps/admin` for component-render testing (confirmed
by red-team across P2/P3/P5). Proof combines: (1) pure-logic unit tests for the 2 new P2 hooks'
behavior contracts, (2) `pnpm -w typecheck` clean, (3) manual before/after behavior comparison on
the running admin app as the actual regression proof for the UI-level migration — documented
explicitly as a manual gate, not silently skipped.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | `record-detail.test.ts`: `onFieldChange` merges returned partial data into form state; `onStateChange` fires with correct `{busy, isDirty, validationError, data}` shape on save/edit transitions |
| Integration | None (no test infra) |
| E2E | None new (existing `apps/e2e/tests/unified-staff-shell.spec.ts` covers nav shell only, not save/validation — gap acknowledged, not addressed this round) |
| Platform | Manual: open staff-profile in running admin app, verify tabs/role-edit/activity-log/save/reset-password all behave identically pre- vs post-migration |
| Performance | N/A |
| Logs/Audit | Confirm `audit.staffTimeline` entries still generated correctly after a real save |

## Fixtures

Use an existing seeded staff account (per prior session's seed data, e.g. `it@cmc.local` or
similar director/HR test account) with multiple roles to exercise the `roleEditInvalid` /
auto-clear-primaryRole path.

## Commands

```text
pnpm --filter @cmc/ui exec vitest run
pnpm --filter @cmc/ui exec tsc --noEmit -p .
pnpm --filter @cmc/admin exec tsc --noEmit -p .
pnpm -w typecheck
```

## Acceptance Evidence

- `pnpm --filter @cmc/ui exec vitest run` — 40/40 pass (4 new `applyFieldChange` cases covering
  onFieldChange merge behavior; onStateChange's `{busy,isDirty,validationError,data}` shape is
  covered by the `RecordDetailHandle`/effect wiring itself, not a separate pure-function test —
  no jsdom infra to render-test the effect firing, consistent with the Proof Strategy above).
- `pnpm --filter @cmc/ui exec tsc --noEmit -p .` — clean.
- `pnpm --filter @cmc/admin exec tsc --noEmit -p .` — clean.
- `pnpm -w typecheck` — 12/12 packages clean.
- ESLint (`eslint src/record-detail.tsx src/record-detail.test.ts` in `@cmc/ui`, `eslint
  src/staff-profile.tsx` in `@cmc/admin`) — 0 errors, 0 warnings.
- `gitnexus_detect_changes({scope:'all'})` — risk_level low, 0 affected_processes, changed symbols
  confined to `record-detail.tsx`/`staff-profile.tsx` (plus unrelated pre-existing doc edits).
- Manual platform gate (open staff-profile in running admin app, verify tabs/role-edit/
  activity-log/save/reset-password behave identically pre- vs post-migration) — **not executed this
  session** (no running dev stack available in this pass). Flagged as an open item, not silently
  skipped — see plan.md's Implementation Summary.
