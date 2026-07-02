# Phase 4 — Discount-Tier Config UI (per-facility, 35% cap)

## Context links
- Report §PLAN 4.5 (UI bậc giảm giá).
- Read path: `apps/api/src/routers/finance.ts:28-37` (`tiersFor` — reads `discountTier` per facility, falls back to `DEFAULT_DISCOUNT_TIERS` when none).
- Domain constants: `packages/domain-finance/src/pricing.ts:9` (`DISCOUNT_CAP_PERCENT = 35`), `:12` (`DiscountTier` iface), `:16` (`DEFAULT_DISCOUNT_TIERS` = 15/20/30), `:57` (`tierPercentForYears`), `:66` (`effectiveDiscountPercent` — stacks then caps at 35).
- Schema (EXISTS, NO migration): `packages/db/prisma/schema.prisma:983-994` (`DiscountTier { id, facilityId, years, percent, archivedAt, createdAt }`, `@@unique([facilityId, years])`, `@@index([facilityId])`).
- Perms: `packages/auth/src/permissions.ts` (`finance.*`).

## Overview
`discountTier` rows are read at pricing time but there is NO UI to create/edit them, so every facility silently runs on the hardcoded 15/20/30 defaults. This phase adds a per-facility discount-tier config UI backed by CRUD on the existing model — no schema change, no migration. Percent per tier is capped at the existing 35% domain constant.

## Key Insights
- **Model + unique constraint already exist** (`@@unique([facilityId, years])`) — upsert-by-(facility,years) is the natural write. Archive (`archivedAt`) instead of delete keeps the pricing audit trail intact (a past receipt's discount is reconstructable).
- **`tiersFor` fallback stays**: a facility with zero active tier rows keeps using `DEFAULT_DISCOUNT_TIERS`. The UI writing the first row switches that facility off defaults — surface this to the operator ("đang dùng mặc định" vs "đã cấu hình").
- **Cap is per-tier percent, not the stacked total**: `DISCOUNT_CAP_PERCENT=35` also caps the tier+voucher stack at pricing time (`effectiveDiscountPercent` :66). Enforce `0 < percent ≤ 35` on each tier row so a single tier can't exceed the ceiling; the stack cap already runs downstream.
- **This phase edits `finance-panel.tsx`** → per the plan file-ownership rule it MUST run after P1 has landed its finance-panel edits (serialize same-file).

## Requirements
- New perms `finance.discountTierList`, `finance.discountTierUpsert`, `finance.discountTierArchive` → `['giam_doc_kinh_doanh']` (facility-config authority; add `ke_toan` only if operator wants clerks editing tiers — default GĐKD-only).
- Query `finance.discountTierList({ facilityId })`: active rows (`archivedAt: null`) ordered by `years`; include a flag when the facility is on defaults (0 rows). RLS-scoped.
- Mutation `finance.discountTierUpsert({ facilityId, years, percent })`: validate `years ≥ 1`, `0 < percent ≤ DISCOUNT_CAP_PERCENT`; upsert on `@@unique([facilityId, years])`; `logEvent`. Import the cap from `@cmc/domain-finance` — do NOT re-declare `35`.
- Mutation `finance.discountTierArchive({ id })`: set `archivedAt` (soft, reversible via re-upsert of same years); `logEvent`.
- UI: a discount-tier config section (per selected facility) — table of years→percent rows, add/edit form (percent capped at 35 with inline validation), archive action, and a "đang dùng mặc định 15/20/30" banner when unconfigured. Place inside `finance-panel.tsx` (owned by P1 — serialize) or a dedicated config sub-panel routed from finance settings.

## Architecture
Data flow: config UI → `discountTierUpsert`/`discountTierArchive` (validate ≤35 + audit + RLS) → `discount_tier` rows → next `receiptCreate` pricing reads them via `tiersFor` (finance.ts:32) instead of `DEFAULT_DISCOUNT_TIERS`. No schema, no migration. The cap constant is single-sourced from `packages/domain-finance/src/pricing.ts:9` on both server validation and (imported) client hint.

## Related code files
- MODIFY `apps/api/src/routers/finance.ts` (add `discountTierList`/`discountTierUpsert`/`discountTierArchive`; reuse imported `DISCOUNT_CAP_PERCENT`).
- MODIFY `packages/auth/src/permissions.ts` (3 new perms).
- MODIFY `apps/admin/src/finance-panel.tsx` (discount-tier config section) — SERIALIZE after P1.
- (No schema, no migration — `DiscountTier` model already exists.)

## Implementation Steps
1. Add perms + `discountTierList` (with defaults-flag) + `discountTierUpsert` (cap-validated) + `discountTierArchive` + audit.
2. Import `DISCOUNT_CAP_PERCENT` for server validation; reject percent > 35 with a clear message.
3. Build the config section: table, add/edit form (capped input), archive, defaults banner.
4. Verify a facility switching from defaults to a configured set reprices correctly on the next receipt (manual check).

## Todo list
- [ ] perms + CRUD router (upsert on unique, archive soft) + audit
- [ ] server-side 35% cap from `@cmc/domain-finance` (no magic number)
- [ ] config UI (table + capped form + archive + defaults banner)
- [ ] repricing sanity check (defaults → configured)

## Success Criteria
- A GĐKD can add/edit/archive discount tiers for a facility; percent > 35 is rejected.
- A facility with no rows shows the "using defaults" banner and prices on 15/20/30.
- Configuring a tier changes the next receipt's discount for that facility.
- Cross-facility user cannot list/edit another facility's tiers (RLS verified).

## Risk Assessment
- **Silent repricing (Med×High)**: editing a tier changes future receipt prices → mitigate with audit on every write + the defaults banner + the manual repricing check; existing receipts are unaffected (netAmount is stored, not recomputed).
- **Cap drift (Low×Med)**: hardcoding 35 in a second place diverges from the domain constant → import `DISCOUNT_CAP_PERCENT`, never re-declare.
- **Same-file contention with P1 (Med)**: both touch `finance-panel.tsx` → serialize; do not start until P1 is merged (plan file-ownership rule).
- **Unique-constraint clash (Low)**: two edits same (facility,years) → upsert semantics resolve; last-write-wins is acceptable + audited.

## Security Considerations
- All CRUD perm-gated (GĐKD) + RLS-scoped by facilityId.
- Cap enforced server-side (client hint is convenience only).
- Archive is soft (audit trail preserved); no hard delete of pricing config.

## Rollback
- No schema. Revert router + UI edits. Any rows created remain valid config; to fully revert a facility to defaults, archive its rows (fallback re-engages automatically).

## Next steps
P5 (validation) — int + e2e across P1-P4, decision 0028, DEBT capture, harness trace, 0-drift.
