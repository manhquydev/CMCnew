# Red-Team Plan Review — CRM ↔ Finance Receipt Linkage

Plan reviewed: `plans/260705-1418-crm-finance-receipt-linkage/` (plan.md + phase-01 + phase-02). Nothing implemented yet. All findings below verified against live code, not the plan's own citations.

## Verdict

**Not safe to proceed to implementation as-is.** One CRITICAL authorization-scope finding must go back to the user as an explicit decision (the plan currently states a factually wrong "no new exposure" security claim). One HIGH finding is a real logic inconsistency between Phase 1's and Phase 2's "open opportunity" filters that will produce mismatched UI-vs-server behavior. One HIGH finding is a missing test-fixture update that will break CI (permission-parity test) if the todo list is followed as written. Everything else the plan claims (D1 phone-format warning, D2 union-shape mechanics, line citations, no-contradiction with 0024, RLS/facility scoping) checked out correctly against source.

---

## Critical

### 1. `ke_toan` permission grant silently unlocks the entire CRM nav tab, not just the reused query — plan's security claim is false

- Evidence: `apps/admin/src/nav-permissions.ts:1-16` (file header) states explicitly: *"The nav layer derives `visible` directly from this map via `can()` — no hardcoded role arrays anywhere in the nav. Adding/removing roles from the backend registry automatically propagates to the sidebar without touching this file."*
- `apps/admin/src/nav-permissions.ts:94-96`: the `crm` nav section is gated on exactly `{ module: 'crm', action: 'opportunityList' }` — the same permission key phase-01 proposes granting to `ke_toan`.
- `apps/admin/src/crm-panel.tsx` is the full CRM kanban board: shows every open+closed opportunity in the facility with `contact.fullName`/`phone`, `stage`, `program`, and `ownerName(o.ownerId)` (sales-owner attribution) (`crm-panel.tsx:96,265,351`). `contact-directory-panel.tsx` (imported by crm-panel.tsx:40) is also reachable from the same tab.
- `packages/auth/src/permissions.ts:111-118` confirms `ke_toan` currently has **zero** CRM permissions (`opportunityList`, `opportunityGet`, `opportunityTransition`, `opportunityMarkLost`, `opportunityReopen`, `assignableOwners` are all `['sale','cskh','ctv_mkt','giam_doc_kinh_doanh']` only — no `ke_toan` anywhere). Granting `opportunityList` gives read-only access (edit mutations stay gated), but that read access is the **entire sales pipeline board**, not a scoped phone-lookup.
- The plan's phase-01 "Security considerations" section says: *"No PII leak beyond what the caller's role already sees in CRM."* This premise is false for `ke_toan` — they currently see none of CRM. The plan's own D3 already recognizes this needs a new decision doc ("Phase 1 widens ke_toan's CRM read access, a new decision doc is required") — but the risk-table entry undersells the blast radius as if it were narrow, and no phase document proposes decoupling "can call this one query for the receipt-form lookup" from "gets the full CRM nav tab."
- Relevant precedent: `docs/decisions/0024-commission-sale-draft-receipt-auto-o5.md` §5 explicitly enforces a converse separation-of-duties rule ("Sale... never sees the finance panel or others' receipts"). No document establishes the reverse (ke_toan seeing sale's pipeline) is fine — it should not be inferred as harmless by default.

**Action required before implementation:** present this to the user explicitly as a decision point — either (a) accept ke_toan gets full CRM-tab read visibility (name the exposed screens: kanban board + contact directory, owner attribution) as a deliberate, documented trade-off in the new decision doc, or (b) decouple the phone-lookup capability from nav visibility (e.g., a narrower endpoint/permission key gated only for the finance-panel lookup, not wired into `nav-permissions.ts`). Do not let this ship as a quiet side effect of "permissions.ts:111" alone.

---

## High

### 2. Phase 1's client-side "open" filter and Phase 2's server-side "open" filter are not equivalent — will diverge

- Phase-01 plan (`phase-01-phone-lookup-ui.md:18,32`) defines "open" as `!closedAt && lostReason == null`, and its own text asserts this is equivalent to `stage != O5_ENROLLED AND lostReason IS NULL` — treating them as interchangeable.
- Phase-02 plan (`phase-02-duplicate-warning.md:39`) implements the guard query as `stage: { not: 'O5_ENROLLED' }, lostReason: null` — no `closedAt` check at all.
- These are only equivalent if `closedAt !== null` and `stage === 'O5_ENROLLED'` always coincide exactly. Verified against `apps/api/src/routers/crm.ts:414-434` (`opportunityReopen`): it clears `closedAt`/`lostReason` on **any** closed opportunity that has `closedAt !== null`, with **no check that `stage !== 'O5_ENROLLED'`** before doing so (only guard is "must currently be closed"). If that endpoint is ever invoked on a WON opportunity (`stage=O5_ENROLLED, closedAt` set) — nothing in the code blocks it structurally, only convention — the result is `stage=O5_ENROLLED, closedAt=null`: Phase 1's filter (`!closedAt`) would treat it as an open match and surface it as a lookup candidate in the finance form; Phase 2's filter (`stage != O5_ENROLLED`) would correctly exclude it and never warn. Two different "open" truths in the same feature.
- Even without that specific edge case, the plan should not describe two textually different predicates as "the same filter" across two phase docs — this is exactly the kind of inconsistency that produces silent divergent behavior later. Recommend: pick ONE canonical predicate (`stage != O5_ENROLLED AND lostReason IS NULL`, the one plan.md's "Resolved questions" line 51 already settled on) and make Phase 1's client memo use the *same* fields (requires `stage` to be in the widened `select`, which phase-01 step 3 already plans to add) instead of `closedAt`.

### 3. `apps/api/test/fixtures/permission-snapshot.json` is not in either phase's todo list — will break CI

- Evidence: `apps/api/test/permission-parity.test.ts:1-12` — a parity test that fails the build if `permissions.ts`'s registry and `permission-snapshot.json` diverge for any key ("Registry has no entries absent from snapshot" + roles must match exactly, sorted).
- `apps/api/test/fixtures/permission-snapshot.json:43`: `"crm.opportunityList": ["sale", "cskh", "ctv_mkt", "giam_doc_kinh_doanh"]` — does not include `ke_toan`.
- Phase 1's todo list (`phase-01-phone-lookup-ui.md:50-58`) and Phase 2's todo list do not mention updating this fixture. If `permissions.ts:111` is edited to add `ke_toan` without touching the snapshot, `permission-parity.test.ts` fails immediately. Small fix, but it's a real gap in the "todo" checklist that should be added explicitly (not left to be "discovered" when the sweep-heavy Phase 2 test run fails).

---

## Medium

### 4. Test-call-site count is a slight overestimate, not a blocker

- Grep of `finance\.receiptCreate` across `apps/api/test/*` returns **71** raw occurrences across 18 files (not 73), and that count includes 1 hit in `permission-snapshot.json` (not a `.mutate()` call site at all) and likely 1 in `permission-parity.test.ts` (also not a call site, just referencing the permission key name). Actual `.receiptCreate.mutate(...)`/`trpc-caller` call sites needing the `assertSuccess` sweep are probably closer to ~65–69, not 73. Not a blocking discrepancy — the ballpark and the "mechanical sweep is the dominant cost" framing both hold — but the plan should not present 73 as a verified precise count; it's an estimate.

### 5. Race-window on the duplicate check is real but is an accepted, pre-existing gap, not a new regression

- `packages/db/prisma/schema.prisma:1065-1100` (`Receipt` model) has no unique constraint on `parentPhone` (confirmed no `@unique`). `withRls` (`packages/db/src/index.ts:63`) wraps each mutation call in its own `prisma.$transaction` — there is no cross-request locking. Two concurrent `receiptCreate` calls for the same phone (e.g., accidental double-submit, or two staff racing) each run their own `findFirst` against the `Opportunity` table (not against `Receipt`), so both could independently see "no match" or both see "match" and both retry with `confirmDuplicate:true` — nothing in the design prevents two orphan receipts for the same phone from being created concurrently. This is consistent with the explicit "soft, never hard-block, siblings are legitimate" design intent, so it is not a defect the plan needs to fix, but the plan's risk tables don't call out this concurrency gap at all — worth one line acknowledging it as an accepted limitation rather than silence, since a future reader could otherwise assume the duplicate check is authoritative.

### 6. Effort estimate (8h for Phase 2) is optimistic once items above are folded in

- The 8h estimate already accounts for the ~73-call sweep as "the dominant cost," decision-doc authoring, and the permission grant. It does **not** account for: (a) fixing the permission-snapshot.json fixture (item 3), (b) reconciling the Phase 1/Phase 2 filter inconsistency (item 2), (c) the additional user round-trip likely required for item 1 (CRM-nav-exposure decision), or (d) full regression run time across 18 affected test files plus whatever the finance/crm suites already take. Not wildly off, but treat 8h as a floor, not a target — recommend re-baselining after the CRM-nav decision is resolved with the user.

---

## Confirmed correct (no issue)

- **D1 (phone normalizer) is correct and necessary.** Verified `packages/auth/src/login-phone.ts:1-17` — `normalizeLoginPhone` emits bare `84xxxxxxxxx` (no `+`), while `crm.ts:62-68`'s `normalizePhone` emits `+84...`. The plan's warning not to conflate them is accurate and important; `normalizeContactPhone` doesn't exist yet anywhere in the repo (no naming collision).
- **D2 (union response shape) mechanics verified.** `apps/api/src/routers/finance.ts:597-600` is exactly `.then(({ pushNotifs, receipt }) => { pushNotifs(); return receipt; })` — confirms the bare-`Receipt` unwrap the plan cites. `finance-panel.tsx:1262` and `:1279` and `opportunity-detail.tsx:411` are exactly the 3 FE call sites cited, and read `.grossAmount/.effectiveDiscountPercent/.netAmount` (finance-panel:1293) / `.code` (opportunity-detail:422) directly off the bare result today — union will break all three at compile time as claimed.
- **`opportunity-detail.tsx`'s `createOpportunityReceipt` always passes `opportunityId`.** Verified `opportunity-detail.tsx:411-421` — `opportunityId: opp.id` is unconditional, so per the trigger condition (`!opportunityId`) it will never warn, matching the plan's claim.
- **No contradiction with decision 0024.** Read `docs/decisions/0024-commission-sale-draft-receipt-auto-o5.md` in full — it covers sale's linked draft-receipt path from opportunity-detail (already-safe door) and receiptApprove auto-O5/cancel-revert logic. Nothing in 0024 constrains or duplicates what Phase 1 (standalone-form lookup) or Phase 2 (server-side duplicate guard) add; the two efforts are complementary, not overlapping.
- **Facility-scoping / no cross-facility leak.** Phase 1's `opportunityList` call is facility-scoped by `input.facilityId` under `withRls` (`crm.ts:203-207` per plan citation, confirmed pattern present), and Phase 2's duplicate query includes `facilityId: input.facilityId` explicitly. `Contact` is unique per `(facilityId, phone)` (per researcher report, consistent with schema design), so a phone existing in two different facilities as two separate Contact rows is possible by design but each Phase's queries stay correctly scoped to the caller's chosen facility — no leak found.
- **Permission citations accurate.** `packages/auth/src/permissions.ts:111` (`opportunityList`) and `:156` (`receiptCreate`) match the plan's claimed role lists exactly.
- **D3 decision-index claim accurate.** `docs/DECISION_INDEX.md:36` does list `finance-panel.tsx`, `opportunity-detail.tsx` → 0024 (FE files only — the backend `apps/api/src/routers/finance.ts`/`crm.ts` are not yet indexed, which is exactly why the plan correctly schedules a *new* decision doc adding those backend files to the index rather than amending 0024).

---

## Unresolved questions (for user, before implementation)

1. Item 1 (CRITICAL): does the user want `ke_toan` to see the full CRM pipeline board (kanban, contact directory, sales-owner names) as a side effect of this grant, or should Phase 1 use a narrower mechanism (e.g., a dedicated read scope not wired into `nav-permissions.ts`)?
2. Item 2 (HIGH): which "open opportunity" predicate should be canonical for BOTH phases — recommend `stage != O5_ENROLLED AND lostReason IS NULL` used identically in the client memo (Phase 1) and the server query (Phase 2)?
3. Should `apps/api/src/routers/crm.ts`'s `opportunityReopen` also gain a stage guard (block reopening a WON `O5_ENROLLED` opportunity) as a related hardening item, or is that explicitly out of scope for this plan and tracked separately?
