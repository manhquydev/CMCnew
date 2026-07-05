# Phase 2 — Soft duplicate warning in receiptCreate (Option C)

## Context links
- Plan: [plan.md](plan.md)
- Research: `reports/researcher-260705-1420-duplicate-warning-pattern-report.md`
- Red-team: `reports/code-reviewer-260705-1436-crm-finance-receipt-linkage-red-team-plan-review-report.md`
- Brainstorm: `../reports/brainstorm-260705-1407-crm-finance-data-linkage-report.md`
- Depends on: Phase 1's shared `OPEN_OPPORTUNITY_WHERE` helper (must land first, or be introduced here if Phase 2 ships alone).

## Overview
Server-side defense that catches new-student receipts that duplicate an OPEN opportunity's phone but forget to link
`opportunityId` — at EVERY entry point (UI, future API/import), unlike Phase 1 which only guards the one form. Soft warning:
first call surfaces the match without creating; staff confirm → retry with `confirmDuplicate:true` creates. Never hard-blocks
(sibling shared-phone is legitimate).

## Key insights (verified, revised after red-team)
- Trigger condition = new-student path (`parentPhone` set) AND `!opportunityId` AND `!confirmDuplicate`. Callers that pass `opportunityId` (opportunity-detail, and Phase-1-linked receipts) never trigger.
- `Receipt.parentPhone` is stored RAW (`finance.ts:554`); `Contact.phone` is `+84` (`crm.ts:62`). Compare MUST normalize input to +84 (D1) or it silently never matches.
- **Response-shape reality (contract-critical):** `receiptCreate` returns a **bare `Receipt`** — the `.mutation(...).then(({receipt}) => receipt)` at `finance.ts:597-600` unwraps it. Callers rely on `.grossAmount/.code/.id` directly.
- Enumerated callers of `receiptCreate` (blast radius of a union return): `finance-panel.tsx:1262` + `:1279` (FE), `opportunity-detail.tsx:411` (FE, uses `.code`), and **~71 integration-test call sites** across `apps/api/test/*` (red-team's grep count, revised down from the researcher's rough 73 — treat as ballpark, verify exact count when sweeping). Total ≈ **74 call sites**.
- No existing "warn-and-retry" pattern in the codebase (report 2 §4) — this is the first.
- **Must use the SAME `OPEN_OPPORTUNITY_WHERE` helper as Phase 1** (red-team High finding: independently written "open" filters in each phase can silently diverge — confirmed via `crm.ts:414-434 opportunityReopen`, which can clear `closedAt` on a WON opp without resetting `stage`, so `!closedAt` and `stage!=O5_ENROLLED` are NOT equivalent predicates in this schema).
- **Race condition (accepted, documented):** the duplicate check is a plain `findFirst` inside the mutation's tx, no unique constraint on `Receipt.parentPhone`, no cross-request locking. Two concurrent receipt-creates for the same phone could both pass the check and both succeed. This is an accepted pre-existing class of gap consistent with "soft warning only, siblings always allowed" — not fixed in this phase, called out explicitly rather than silently.

## Requirements
- Add `confirmDuplicate: z.boolean().optional()` to `receiptCreate` input (`finance.ts:475-491`); no `.refine` change.
- Before `tx.receipt.create` (`finance.ts:537`): if new-student path && `!opportunityId` && `!confirmDuplicate`, query an open opportunity (via shared `OPEN_OPPORTUNITY_WHERE`) by normalized phone in same facility; if found, surface warning WITHOUT creating.
- Warning payload: `{ opportunityId, parentName, studentName }` for the FE modal.
- Sibling case: `confirmDuplicate:true` bypasses cleanly (no block, no repeat warning) — this is a soft warning, not a lock; accept the race-condition risk above rather than adding cross-request locking (YAGNI at current scale).
- FE (`finance-panel.tsx createDraft`, `:1252-1313`): detect warning, open Mantine `Modal` (already imported `:20`), "Vẫn lập phiếu" → re-call with `confirmDuplicate:true`; "Hủy" → close, no-op.

## Architecture — response shape (D2 RESOLVED: union, user override 2026-07-05)
- **Chosen: discriminated union** `{status:'success';receipt:Receipt} | {status:'warning';duplicateWarning:{opportunityId,parentName,studentName}}`.
  User explicitly chose this over the recommended sentinel-throw, accepting the full ~74-caller blast radius (`finance-panel.tsx:1262,1279`, `opportunity-detail.tsx:411`, **~71 integration-test call sites**).
- Every caller must add `if (result.status !== 'success') { /* handle */ }` (or `.status === 'success'` narrowing) before accessing `.receipt.id/.code/...`. For the tests: since none of them currently pass `confirmDuplicate` and most don't hit a duplicate-phone collision, the mechanical fix is `const { receipt } = assertSuccess(result)` (add a tiny test-helper `assertSuccess` in a shared test-util file to keep the diff a 1-liner per call site rather than repeating the narrowing ~71 times).
- `opportunity-detail.tsx:411`'s `createOpportunityReceipt` ALWAYS passes `opportunityId` → per the trigger condition (`!opportunityId`) it will always get `status:'success'`, but the TypeScript union still requires narrowing before `.code` is read.

## Duplicate query (server)
```ts
tx.opportunity.findFirst({
  where: { facilityId: input.facilityId,
           contact: { phone: normalizeContactPhone(input.parentPhone) },
           ...OPEN_OPPORTUNITY_WHERE, // shared with Phase 1's opportunityLookupByPhone — { stage: { not: 'O5_ENROLLED' }, lostReason: null }
           archivedAt: null },
  select: { id: true, studentName: true, contact: { select: { fullName: true } } } })
```
Runs inside the existing `withRls(rlsContextOf(ctx.session), ...)` tx (`finance.ts:498-499`) → facility + RLS scoped.

## Related code files (exact)
- `apps/api/src/routers/finance.ts:472-497` (input), `:498-499` (withRls tx), `:537` (receipt.create — insert guard above), `:597-600` (unwrap `.then`).
- `apps/api/src/routers/crm.ts:62` (normalizePhone → source for `normalizeContactPhone`), `OPEN_OPPORTUNITY_WHERE` (shared helper introduced in Phase 1), `:414-434` (`opportunityReopen` — reason the shared predicate matters).
- `apps/api/src/routers/enrollment.ts:64-72` (friendly-guard throw pattern — reference only, not used since union was chosen over sentinel-throw).
- `apps/admin/src/finance-panel.tsx:1252-1313` (createDraft), `:20` (Modal import), `:1292-1294` (success toast reads `.grossAmount/.effectiveDiscountPercent/.netAmount`).
- `apps/admin/src/opportunity-detail.tsx:411-422` (caller using `.code` — must be updated to narrow `status==='success'` first).
- Tests: `apps/api/test/*` — ~71 `finance.receiptCreate(...)` call sites (verify exact count at sweep time; all need the `assertSuccess` wrap).
- `docs/decisions/0024-commission-sale-draft-receipt-auto-o5.md` (related, no contradiction — read before touching `finance.ts`/`opportunity-detail.tsx` per project's Decision Lookup hard rule).

## Implementation steps
1. Author the new decision doc (`docs/decisions/00NN-*.md`, next free number) covering: `receiptCreate` union response shape, the new narrow `crm.opportunityLookup` permission (Phase 1), and the duplicate-warning behavior. Add its row to `docs/DECISION_INDEX.md` for `apps/api/src/routers/finance.ts` + `apps/api/src/routers/crm.ts`. Do this BEFORE code review.
2. Add `confirmDuplicate: z.boolean().optional()` to input schema (`finance.ts:475-491`).
3. Import `normalizeContactPhone` from `@cmc/auth` and the shared `OPEN_OPPORTUNITY_WHERE` from Phase 1's module; insert duplicate guard before `receipt.create` (`finance.ts:537`).
4. Change mutation return type to the union; update the `.then(({receipt}) => receipt)` unwrap at `finance.ts:597-600` to return the discriminated shape instead.
5. FE: add `duplicateWarning` state + Modal + retry-with-flag in `finance-panel.tsx createDraft` (`:1252-1313`); narrow `result.status` before reading `.receipt`.
6. Update `opportunity-detail.tsx:411` `createOpportunityReceipt` to narrow `result.status === 'success'` before reading `.receipt.code`.
7. Add a shared test-helper `assertSuccess(result)` (throws if `status !== 'success'`, else returns `.receipt`) in the api test-util file; sweep all `finance.receiptCreate(...)` call sites in `apps/api/test/*` (verify exact count, ~71) to wrap through it — mechanical, 1-liner per call site.
8. Add/extend integration tests: dup→warning (no receipt created), retry with `confirmDuplicate:true`→created, sibling-phone bypass (2nd child, different name, same phone → still warns per soft-warning design, but `confirmDuplicate:true` always succeeds — verify this matches intended UX, not a silent skip), opportunityId-present never warns.

## Todo
- [x] Decision doc authored + `DECISION_INDEX.md` row added
- [x] `confirmDuplicate` input added
- [x] duplicate guard uses shared `OPEN_OPPORTUNITY_WHERE` (normalized, facility+RLS scoped)
- [x] union response type implemented; `finance.ts:597-600` unwrap updated
- [x] FE modal + retry wired (`finance-panel.tsx`)
- [x] `opportunity-detail.tsx:411` narrowed to `status==='success'`
- [x] `assertSuccess` test-helper added
- [x] all `finance.receiptCreate` test callers swept through `assertSuccess` — full suite green (verify exact count, ~71)
- [x] int test: warning / retry / sibling-bypass / opportunityId-present-no-warn

## Success criteria
- New-student receipt whose phone matches an open opportunity (no opportunityId) does NOT create a receipt on first call; warning shows parent+student.
- "Vẫn lập phiếu" creates the receipt (confirmDuplicate:true). Sibling shared-phone can always proceed (with the warning shown once, non-blocking).
- Receipts WITH `opportunityId` (opportunity-detail, Phase-1-linked) never warn.
- All pre-existing receiptCreate tests still compile & pass after the `assertSuccess` sweep.
- Phase 1 and Phase 2's "open opportunity" definitions are provably identical (same shared helper, not just same logic written twice).

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| **Public-contract change (HIGH, ACCEPTED by user):** union return breaks ≈74 callers incl. ~71 int-tests | H×H | D2 resolved as union (user override). Mitigate via `assertSuccess` test-helper (1-liner per call site, not ~71 manual rewrites) + full suite run before merge. This is the single largest cost driver in Phase 2 — do not underestimate the sweep. |
| Phone-normalization mismatch → guard never fires (false sense of safety) | M×H | D1 +84 `normalizeContactPhone`; test raw/`+84`/`84`/spaced. Never `normalizeLoginPhone`. |
| **Divergent "open" definition vs Phase 1 (RESOLVED by shared helper):** confirmed possible via `opportunityReopen` clearing `closedAt` without resetting `stage`. | M×H | Both phases import the same `OPEN_OPPORTUNITY_WHERE` fragment — no independent reimplementation possible. |
| **Race condition (ACCEPTED, documented, not fixed):** concurrent receipt-creates for the same phone can both pass the pre-create check (no unique constraint, no locking) — both could succeed as separate receipts. | L×M | Explicitly accepted: consistent with "soft warning, never hard-block, siblings legitimate" design intent. Not in scope to fix (would need a unique constraint or advisory lock, disproportionate to a UX nudge feature). Documented here so it isn't mistaken for an oversight later. |
| Hard-blocking siblings | L×H | Soft only; `confirmDuplicate:true` always bypasses; never throw without the retry escape. |
| Money mutation regression | L×H | Guard is read-only + pre-create; add focused int-test; run finance test suite before merge. |
| **Decision-doc gate (D3, CONFIRMED required):** `finance-panel.tsx`/`opportunity-detail.tsx` already have a `docs/DECISION_INDEX.md` row → `docs/decisions/0024-...md`. Red-team confirmed no contradiction, but this phase's union-response-shape + new permission changes are substantive enough to need their OWN new decision doc (not an amendment to 0024). | M×M | Author the new decision doc as implementation step 1, before code review — not optional. |

## Security considerations
- Duplicate query runs under the same `withRls`/facility scope as receipt creation — no facility-crossing read; cannot reveal another facility's opportunity/contact.
- Warning payload exposes only parentName+studentName+opportunityId within the caller's own facility. Because Phase 1 now uses a narrow lookup permission (not full `crm.opportunityList`) for ke_toan, this warning payload is consistent with what ke_toan can already see via the Phase 1 lookup — no new exposure surface beyond Phase 1's own security boundary.
- `confirmDuplicate` is a plain bypass flag, not an authz decision — it does not weaken any permission check; `receiptCreate` permission still gates the whole mutation.

## Next steps
- Implement in the order: shared `OPEN_OPPORTUNITY_WHERE` helper (if not already landed by Phase 1) → decision doc → schema/query changes → union return + caller sweep → FE modal → tests.
