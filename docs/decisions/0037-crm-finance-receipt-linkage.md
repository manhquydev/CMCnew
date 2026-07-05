# 0037 CRM ↔ Finance receipt linkage (phone lookup + duplicate warning)

Date: 2026-07-05

## Status

Accepted

## Context

The standalone "Học sinh mới" new-student receipt form (`finance-panel.tsx`) requires staff (mainly `ke_toan`) to
retype parent phone/name and student name by hand, even when a matching CRM `Opportunity`/`Contact` already exists.
This creates typo/duplicate risk and leaves receipts unlinked to their originating opportunity — commission
attribution (`finance.ts:1017-1048`) and win/O5 auto-advance (decision 0024) never fire for these receipts.

Decision 0024 (`0024-commission-sale-draft-receipt-auto-o5.md`) already solved this for the "sale creates draft from
the opportunity's own page" path (`opportunity-detail.tsx` "Tạo phiếu thu" button, always forwards `opportunityId`).
It did not touch the *other* entry point — the standalone finance-panel form used for walk-ins or by staff who
start from Tài chính directly. This decision covers that second entry point.

Two changes are needed, discovered via brainstorm + planning + red-team review
(`plans/reports/brainstorm-260705-1407-crm-finance-data-linkage-report.md`,
`plans/260705-1418-crm-finance-receipt-linkage/`):

1. A phone-lookup convenience in the standalone form (so staff can find+link an existing opportunity instead of
   retyping). The primary user of this form, `ke_toan`, does not currently hold any CRM permission
   (`packages/auth/src/permissions.ts:111`: `crm.opportunityList` = `[sale, cskh, ctv_mkt, giam_doc_kinh_doanh]`).
   Granting `ke_toan` that existing permission was considered and **rejected**: `nav-permissions.ts:94-96` gates the
   entire CRM nav tab (kanban board, all opportunities, contact PII, sale ownership) on exactly that permission key —
   granting it would expose the whole CRM section to `ke_toan`, not just enable a lookup.
2. A server-side safety net: `receiptCreate` should warn (not silently proceed) when a new-student receipt's phone
   matches an OPEN opportunity but no `opportunityId` was supplied — catching the case where staff forget to use the
   lookup, at every entry point (UI today, any future API/import), not just the one form.

## Decision

1. **New narrow permission `crm.opportunityLookup`**, decoupled from `crm.opportunityList`/the CRM nav tab. Granted to
   `[ke_toan, giam_doc_kinh_doanh, sale]` — mirrors `finance.receiptCreate`'s role set (`permissions.ts:156`, per
   decision 0024). `nav-permissions.ts` is unchanged; `ke_toan` still cannot see the CRM board.

2. **New query `crm.opportunityLookupByPhone(facilityId, phone)`**, gated by the permission above, returns only
   `{id, studentName, stage, contact.fullName}` for OPEN opportunities matching the (normalized) phone in the
   caller's facility, capped at 5 results (sibling case). Facility+RLS scoped like every other CRM query.

3. **Canonical phone normalizer**: export `normalizeContactPhone` (+84 format) from `@cmc/auth`, replacing the local
   `normalizePhone` in `crm.ts`. `@cmc/auth`'s existing `normalizeLoginPhone` produces a *different* format (`84…`,
   no `+`) and must never be used for this matching — using it would silently produce zero matches.

4. **Canonical "open opportunity" predicate**, shared between the lookup query and the duplicate-warning query below:
   `{ stage: { not: 'O5_ENROLLED' }, lostReason: null }`. Two independently-written filters were found during
   red-team review to diverge (`!closedAt` vs `stage != O5_ENROLLED` are not equivalent, since
   `crm.ts` `opportunityReopen` can clear `closedAt` on a WON opportunity without resetting `stage`) — one shared
   fragment eliminates that class of bug.

5. **`receiptCreate` response shape changes to a discriminated union**:
   `{status:'success'; receipt: Receipt} | {status:'warning'; duplicateWarning: {opportunityId, parentName, studentName}}`.
   When creating a new-student receipt (`parentPhone` set, no `opportunityId`, no `confirmDuplicate`) whose phone
   matches an open opportunity, the mutation returns the warning variant instead of creating a receipt. The caller
   (FE) shows a confirm modal; retrying with `confirmDuplicate: true` always proceeds — this is a soft nudge, never a
   hard block, because two children sharing one parent phone is a legitimate case.
   This is a public-contract change: **every existing caller of `receiptCreate`** (`finance-panel.tsx`,
   `opportunity-detail.tsx`, and all integration tests that call it) must narrow `status === 'success'` before
   reading `.receipt`. The simpler alternative (return type unchanged, surface the warning via a thrown `TRPCError`
   with a typed `cause`) was recommended during planning specifically to avoid this blast radius, but was
   **explicitly overridden by the product owner**, who chose the union for a cleaner API shape going forward.

## Alternatives Considered

1. Grant `ke_toan` the existing `crm.opportunityList` permission directly. Rejected: exposes the entire CRM nav
   tab/kanban board to a role that should only see "does a matching opportunity exist", not the whole pipeline.
2. Sentinel-throw (`TRPCError` with typed `cause`) instead of a union return for the duplicate warning. Rejected by
   product owner despite being the lower-blast-radius option (would have left the return type unchanged, avoiding
   updates to ~74 existing call sites including ~71 integration tests).
3. Hard-block receipt creation when a duplicate phone is found. Rejected: siblings sharing one parent phone are a
   real, legitimate case — a hard block would break a valid workflow.
4. Leave the standalone form as-is, rely only on staff discipline to start from the opportunity page when one
   exists. Rejected: this is the status quo that motivated the brainstorm — no defense against typos or forgetting.

## Consequences

Positive:

- Staff using the standalone form get the same `opportunityId`-linking benefit that decision 0024 gave to the
  opportunity-detail entry point, without retyping.
- `ke_toan`'s CRM read access stays minimal (existence-check only) — no authorization creep into the full CRM board.
- One shared "open opportunity" definition removes a class of silent-divergence bug between the two new code paths.
- The duplicate-warning check runs at the API layer, so it protects every future caller of `receiptCreate`, not just
  the one UI form.

Tradeoffs:

- The union return type requires updating every existing caller of `receiptCreate` (~71 integration test call sites
  plus 2 frontend call sites) to narrow the result before use — a wide, mechanical, but real one-time cost, larger
  than the alternative (sentinel-throw) would have been.
- The duplicate-check-then-create sequence has an accepted (unfixed) race window: two concurrent receipt creations
  for the same phone could both pass the check and both succeed, since there is no unique constraint on
  `Receipt.parentPhone` and no cross-request locking. This is consistent with the "soft warning, never hard-block"
  design intent and is not fixed here — a future decision would be needed if this proves to cause real duplicate
  receipts in practice.
- `crm.opportunityLookup` is a second CRM-adjacent permission key (alongside `crm.opportunityList`) to maintain going
  forward.

## Follow-Up

- Integration tests: lookup returns correct candidates (0/1/≥2 matches) scoped to facility; `ke_toan` can call the
  new lookup but still cannot access the CRM nav tab; duplicate-warning fires and blocks nothing on confirm; sibling
  phone reuse never hard-blocks; opportunityId-present receipts never warn; full existing `receiptCreate` test suite
  green after the union-return sweep.
- `permission-snapshot.json` fixture must include the new `crm.opportunityLookup` permission's expected role list, or
  `permission-parity.test.ts` fails CI.
- Revisit the accepted race-condition gap if duplicate-phone receipts are observed in production data.
