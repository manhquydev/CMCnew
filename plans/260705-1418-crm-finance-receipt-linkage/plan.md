---
title: "CRM ↔ Finance receipt linkage (phone lookup + duplicate warning)"
description: "Link standalone finance receipt form to CRM opportunities via phone: autofill lookup (B) + soft server-side duplicate warning (C)"
status: done
priority: P2
effort: 12h
branch: develop
tags: [crm, finance, receipt, opportunity, rls, public-contract]
created: 2026-07-05
---

# CRM ↔ Finance Receipt Linkage

Close the data-entry gap in the standalone "Học sinh mới" receipt form (`finance-panel.tsx`), which retypes
parentPhone/studentName that already exist in CRM `Contact`/`Opportunity`. Two independent defenses (user chose B+C, B first):

- **Phase 1 (B):** phone-lookup UI — on parentPhone entry, match an OPEN opportunity, let staff confirm+autofill (links `opportunityId`).
- **Phase 2 (C):** server soft-warning in `receiptCreate` when a new-student receipt duplicates an open opportunity's phone.

## Phases

| # | File | Effort | Status |
|---|------|--------|--------|
| 1 | [phase-01-phone-lookup-ui.md](phase-01-phone-lookup-ui.md) | 4h | done |
| 2 | [phase-02-duplicate-warning.md](phase-02-duplicate-warning.md) | 8h | done |

## Dependencies

- Phase 1 → none (read-only UI + reuse existing query). Ship independently.
- Phase 2 → depends on the **phone-normalization decision** (D1) and the **response-shape decision** (D2) below; both must be resolved before coding.
- Shared prerequisite for both: canonical +84 contact-phone normalizer (D1).

## Decisions RESOLVED (user sign-off 2026-07-05, revised after red-team 2026-07-05)

- **D1 — phone normalizer.** Export a single `normalizeContactPhone` (+84 format) from `@cmc/auth`; reuse in `crm.ts` (replacing local `normalizePhone`), `finance.ts` (Phase 2), and admin (Phase 1). Never use `normalizeLoginPhone` (wrong format, `84…` no `+`) for this matching.
- **D2 — `receiptCreate` response shape → UNION (user chose this over the recommended sentinel-throw).** `receiptCreate` moves from bare `Receipt` to `{status:'success';receipt} | {status:'warning';duplicateWarning}`. This is the **larger-blast-radius option**: ALL existing call sites (`finance-panel.tsx:1262,1279`, `opportunity-detail.tsx:411`, and **~71 integration-test call sites** in `apps/api/test/*` — red-team's grep count, revised down from the researcher's rough 73) must be updated to unwrap `.status === 'success'` before reading `.receipt.id/.code/...`. Budget this as the dominant cost of Phase 2.
- **D3 — decision doc.** `docs/DECISION_INDEX.md` already has a row for `finance-panel.tsx`/`opportunity-detail.tsx` → `docs/decisions/0024-commission-sale-draft-receipt-auto-o5.md`. Confirmed by red-team (read in full): **no contradiction**, complementary not overlapping. A **new** decision doc is still required before merge (union response shape + new CRM permission below) — author during Phase 2 implementation, before code review.
- **Permission approach for Phase 1 — REVISED after red-team.** Original plan ("grant `ke_toan` the full `crm.opportunityList` permission") was rejected after red-team found `nav-permissions.ts:94-96` gates the ENTIRE CRM tab (kanban board, all opportunities, contact PII, sale ownership) on exactly that permission key — granting it would expose the whole CRM section to ke_toan, not just enable a lookup. **New decision: add a narrow, purpose-built query `crm.opportunityLookupByPhone`** (facilityId+phone → minimal fields: id/studentName/contact.fullName/stage/closedAt/lostReason for OPEN opportunities only), gated by a **new** permission key `crm.opportunityLookup`, granted to `[ke_toan, giam_doc_kinh_doanh, sale]` (mirrors `finance.receiptCreate`'s role set post-decision-0024, `permissions.ts:156`). `nav-permissions.ts` is NOT touched — ke_toan still does not see the CRM tab. This also lets Phase 1 and Phase 2 share one server-side "open opportunity" definition (see below), closing a red-team High finding.
- **Shared "open opportunity" predicate (new, closes red-team High #1).** Red-team found Phase 1's client-side filter (`!closedAt && lostReason==null`) and Phase 2's server filter (`stage!=O5_ENROLLED && lostReason==null`) diverge whenever `closedAt` and `stage===O5_ENROLLED` don't coincide (confirmed possible via `crm.ts:414-434 opportunityReopen`, which can clear `closedAt` on a WON opp without resetting `stage`). Fix: define ONE helper, e.g. `isOpenOpportunity` / a shared Prisma `where` fragment `{ stage: { not: 'O5_ENROLLED' }, lostReason: null }`, used by BOTH the new `opportunityLookupByPhone` query (Phase 1) and the duplicate-check query (Phase 2). Single source, no divergence possible.

## Global acceptance criteria

- Phase 1: staff on new-student form types phone → sees matching open opportunity (parent+student+stage) → clicks to confirm → `opportunityId`+parentName+studentName autofilled. 0-match = today's manual flow unchanged. Multi-match = picker. No facility-crossing leak. **ke_toan does not gain visibility into the CRM tab/nav.**
- Phase 2: new-student receipt with phone matching an open opportunity (no `opportunityId`) → warning surfaced, no receipt created; "Vẫn lập phiếu" retries with `confirmDuplicate:true` and creates. Sibling shared-phone never hard-blocked.
- No schema/migration change. RLS facility-scoping preserved. Existing ~71 test call sites still compile. `permission-snapshot.json` fixture updated for the new `crm.opportunityLookup` key (see Phase 1 todo).
- Phase 1 and Phase 2 use the identical "open opportunity" predicate (shared helper/fragment) — no divergence.

## Resolved questions (previously open, updated after red-team)

1. D2: **union** chosen (user override of sentinel-throw recommendation) → budget full ~71-caller sweep in Phase 2.
2. D1: shared `@cmc/auth` normalizer chosen.
3. **Permission approach — REVISED:** new narrow `crm.opportunityLookup` permission + new `opportunityLookupByPhone` query (NOT granting the wide `crm.opportunityList`/CRM-tab permission to ke_toan). See plan.md Decisions section.
4. "Open" opportunity filter: `stage != O5_ENROLLED AND lostReason IS NULL` — confirmed AND now shared between both phases via one helper (red-team caught the original two-definitions divergence risk).
5. Race condition on concurrent duplicate-phone receipt creation: accepted as a pre-existing class of gap (no unique constraint on `Receipt.parentPhone`, consistent with "soft warning, siblings allowed" intent) — not fixed in this plan, documented in Phase 2 risk.

## Effort re-estimate

Phase 1 effort revised 3h → **4h** (new endpoint+permission instead of reusing an existing query — slightly more code, but avoids the nav-tab exposure). Phase 2 stays **8h** (union-return sweep across ~71 test files + 2 FE call sites, decision-doc authoring, shared open-opportunity helper). Total plan effort: **12h** (was 7h).

## Validation Summary

**Validated:** 2026-07-05 (4 questions, mode=prompt)

### Confirmed Decisions
- Decision doc: **author now, before `/ck:cook`** (not deferred into Phase 2 implementation) — matches `docs/FEATURE_INTAKE.md` high-risk-lane convention (decision doc precedes implementation, not follows).
- Implementation scope for the upcoming cook session: **both phases in one continuous run** (user accepted the larger single-session scope over a Phase-1-then-checkpoint split).
- Phase 1 lookup trigger: **auto-search on debounce once phone reaches 9-10 digits** (no extra button/blur requirement).
- Sibling-match result cap: **keep at 5** (no pagination needed at this scale).

### Action Items
- [x] Author `docs/decisions/0037-crm-finance-receipt-linkage.md` + `docs/DECISION_INDEX.md` row — done before implementation.
- [x] Phase 1 architecture note: lookup fires via debounced effect once `normalizeContactPhone(typedPhone)` yields a full local-format number (9-10 digits), not on blur/button.
- [x] 5-result cap kept as-is (`take: 5` in `opportunityLookupByPhone`).

**Recommendation:** proceed to decision-doc authoring, then `/ck:cook` both phases in this plan directory.

## Implementation Summary (2026-07-05)

Both phases implemented, red-teamed at the plan stage, code-reviewed at the implementation stage, and tested.

**Delivered:**
- `packages/auth/src/login-phone.ts` — new `normalizeContactPhone` (+84), exported via `index.ts`.
- `apps/api/src/routers/crm.ts` — `OPEN_OPPORTUNITY_WHERE` shared fragment (exported), new `opportunityLookupByPhone` query, `normalizePhone` replaced with the shared normalizer.
- `packages/auth/src/permissions.ts` + `apps/api/test/fixtures/permission-snapshot.json` — new `crm.opportunityLookup` permission (`ke_toan`, `giam_doc_kinh_doanh`, `sale`), decoupled from `crm.opportunityList`/CRM nav-tab.
- `apps/api/src/routers/finance.ts` — `receiptCreate` gains `confirmDuplicate` input + a pre-create duplicate-opportunity check (using the shared `OPEN_OPPORTUNITY_WHERE`); return type is now a discriminated union (`{status:'success',receipt}|{status:'warning',duplicateWarning}`), per user's explicit choice over the lower-blast-radius sentinel-throw alternative.
- `apps/admin/src/finance-panel.tsx` — debounced phone lookup UI (candidate card + sibling picker), `duplicateWarning` Modal with "Vẫn lập phiếu" retry.
- `apps/admin/src/opportunity-detail.tsx` — narrowed to the new union shape.
- `apps/api/test/helpers.ts` — new `assertSuccess` test helper.
- 17 existing integration test files swept (~70 call sites) to unwrap the union via `assertSuccess` — mechanical, no behavior change for existing tests.
- **New** `apps/api/test/crm-finance-receipt-linkage.int.test.ts` (10 tests) — closes the code-review's one High-priority gap: lookup 0/1/≥2-match + facility isolation, the `ke_toan`-can-lookup-but-not-list permission boundary (the decision's central claim), duplicate-warning trigger/bypass/sibling/opportunityId-present/existing-student-path.
- `docs/decisions/0037-crm-finance-receipt-linkage.md` + `docs/DECISION_INDEX.md` row.

**Verification:**
- `tsc --noEmit` clean on `@cmc/api`, `@cmc/admin`, `@cmc/auth`.
- `eslint` clean (0 errors; 2 pre-existing unrelated warnings).
- 105/109 relevant integration tests pass (4 skipped in `discount-tier-config.int.test.ts` — confirmed via `git stash` to be a pre-existing missing-facility-2 environment gap, unrelated to this change).
- 1 pre-existing unrelated failure in `permission-parity.test.ts` (`guardian.resetFamilyPassword` missing from snapshot, predates this session) — not touched, out of scope.
- All 10 new tests for decision 0037's behavior pass.

**Review trail:** brainstorm → plan → red-team (found 3 blocking issues, all fixed in the plan before coding: CRM-tab permission leak, divergent open-opportunity predicates, unclear response-shape blast radius) → decision doc → implementation → code-review (found 1 High gap: missing tests, closed by the new test file) → this test run.
