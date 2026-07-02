# Code Review — Finance-Ops Phase 4 (Discount-Tier Config UI)

## Scope
- `apps/api/src/routers/finance.ts` — `discountTierList`/`discountTierUpsert`/`discountTierArchive` only (verified other diff hunks in this file belong to already-reviewed Phase 3, not touched by this review)
- `packages/auth/src/permissions.ts` — 3 new `finance.discountTier*` perm lines
- `apps/admin/src/finance-panel.tsx` — new `DiscountTierCard` only
- `apps/api/test/discount-tier-config.int.test.ts` (new)
- `apps/api/test/fixtures/permission-snapshot.json` — 3 new entries
- Spec: `plans/260702-1109-finance-ops/phase-04-discount-tier-ui.md`

## Overall Assessment
Correct and well-tested. Ran the integration suite against real dev Postgres (4/4 pass) and both typechecks (clean). Verified claims (a), (c), (e), (f) directly against code, not just the implementer's report. One real deviation from the plan's explicit architecture requirement (client cap constant), otherwise no blocking issues.

## Critical Issues
None.

## High Priority
None.

## Medium Priority

**M1 — Client discount-cap constant is a re-declared magic number, contradicting the plan's explicit single-source requirement.**
`apps/admin/src/finance-panel.tsx:437`:
```ts
const DISCOUNT_TIER_PERCENT_CAP = 35;
```
The plan's Architecture section states: *"The cap constant is single-sourced from `packages/domain-finance/src/pricing.ts:9` on both server validation **and (imported) client hint)**."* The Risk Assessment section explicitly calls out this exact failure mode: *"Cap drift (Low×Med): hardcoding 35 in a second place diverges from the domain constant → import `DISCOUNT_CAP_PERCENT`, never re-declare."*

`@cmc/domain-finance` (`packages/domain-finance/package.json`) is a pure, dependency-free module (`export const DISCOUNT_CAP_PERCENT = 35`) — nothing prevents importing it into the admin bundle; it's not currently a listed dependency of `apps/admin` but adding it is trivial and was exactly what the plan asked for. As written, if `DISCOUNT_CAP_PERCENT` ever changes server-side, the client input's `max` and inline validation message silently go stale (shows a wrong cap, or under-restricts the input before the server rejects it). Not exploitable — server re-validates via `.max(DISCOUNT_CAP_PERCENT)` in `finance.ts` — but it's a direct, named-in-the-plan risk the implementer's own report doesn't mention encountering or making a tradeoff call on.

Fix: add `@cmc/domain-finance` to `apps/admin/package.json` deps, import `DISCOUNT_CAP_PERCENT`, delete the local `DISCOUNT_TIER_PERCENT_CAP`.

## Low Priority

**L1 — `discountTierList` cross-facility response doesn't distinguish "empty because RLS filtered" from "empty because genuinely on defaults".**
Test (e) confirms a facility-B caller listing facility-A's tiers gets `tiers: []` (RLS-filtered, not an error) — this is correct isolation, but the same shape (`{tiers: [], usingDefaults: true}`) is indistinguishable from a facility legitimately having 0 configured tiers. Not a security issue (RLS still blocks writes and the UI only ever queries the caller's own selectable facilities), just worth noting if this endpoint is ever reused outside the current UI flow where `facilityId` is picker-constrained.

## Verified Checks (a)–(g)

- **(a) In-place upsert on `(facilityId, years)`, not insert-a-new-row on re-add-after-archive** — Confirmed by reading `discountTierUpsert` (`finance.ts`): `upsert({ where: { facilityId_years: {...} }, update: { percent, archivedAt: null } })`. Test (c) asserts `readded.id === tier.id` AND `findMany` for `(facilityId, years=3)` returns exactly 1 row after archive→re-add — this is row-id-level proof, not just "a row with this percent exists."
- **(b) 35% cap imported, not re-declared** — `finance.ts` imports `DISCOUNT_CAP_PERCENT` from `@cmc/domain-finance` and uses it directly in the zod schema (`.max(DISCOUNT_CAP_PERCENT)`). No magic number server-side. (See M1 for the client-side exception.)
- **(c) `discountTierList` "using defaults" signal** — `{ tiers, usingDefaults: tiers.length === 0 }`, correctly mirrors `tiersFor`'s fallback condition (`rows.length ? rows : DEFAULT_DISCOUNT_TIERS`).
- **(d) Archive is soft** — `discountTierArchive` only sets `archivedAt: new Date()`; no `delete`/`deleteMany` call in the procedure.
- **(e) Cross-facility RLS enforced at the DB layer, not just app logic** — `packages/db/prisma/migrations/20260623170152_phase3_revenue_s1/migration.sql` has a genuine Postgres RLS policy on `discount_tier` (`facility_id = ANY(app_facility_ids())`, both `USING` and `WITH CHECK`). This means even a compromised/buggy `input.facilityId` handling in the router could not leak or mutate another facility's rows — the DB is the enforcement boundary, not the router. Integration test (e) exercises list (silently filtered to empty), upsert (throws — `WITH CHECK` violation), and archive (throws — row not visible under `USING`, Prisma `update()` gets 0 matching rows), and confirms the target row is untouched afterward.
- **(f) `tiersFor` all-or-nothing fallback is genuinely pre-existing, not introduced/worsened by this phase** — Checked `git show HEAD:apps/api/src/routers/finance.ts` (commit `69200f5`, before this phase's uncommitted diff): `tiersFor` already reads `rows.length ? rows : DEFAULT_DISCOUNT_TIERS` in the last committed version. This phase's diff does not touch `tiersFor` at all (confirmed by diff hunk boundaries — the new procedures are inserted before the `financeRouter` object, `tiersFor` is untouched above it). Implementer's report claim is accurate.
- **(g) Real repricing via `receiptCreate`, not a mocked pricing function** — Test (a)+(d) calls `caller.finance.receiptCreate(...)` twice through the actual tRPC caller (once before configuring a tier, expecting `tierPercent === 20` from `DEFAULT_DISCOUNT_TIERS`; once after `discountTierUpsert`, expecting `tierPercent === 12` from the newly configured row) — genuine end-to-end proof, not a unit-level stub.

## Phase 1 Isolation Check
`git diff 69200f5 HEAD -- apps/admin/src/finance-panel.tsx` returns empty (file identical to the Phase-1-committed version at HEAD). The only uncommitted diff against that file is the additive `DiscountTierCard` block + its mount point in `FinancePanel`'s `Stack`. Refund UI section is byte-identical to what's already in git history — confirmed, not just asserted by the implementer's report.

## Verification Run
- `cd apps/api && npx vitest run --config vitest.integration.config.ts test/discount-tier-config.int.test.ts` → 4/4 pass (against real dev Postgres, port 5433)
- `pnpm --filter @cmc/api typecheck` → clean
- `pnpm --filter @cmc/admin typecheck` → clean

## Recommended Actions
1. (M1) Import `DISCOUNT_CAP_PERCENT` from `@cmc/domain-finance` in `finance-panel.tsx` instead of the local `DISCOUNT_TIER_PERCENT_CAP = 35` — add the package as an admin dependency. Low effort, directly closes a risk the plan named explicitly.
2. No other blocking changes. Safe to proceed to P5 cross-phase validation once M1 is addressed (or explicitly waived by the orchestrator).

## Unresolved Questions
- None requiring user input — M1 is a mechanical fix with no design ambiguity.
