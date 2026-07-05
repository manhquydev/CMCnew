# Phase 1 — Phone-lookup UI in new-student receipt form (Option B)

## Context links
- Plan: [plan.md](plan.md)
- Research: `reports/researcher-260705-1420-opportunity-lookup-research-report.md`
- Red-team: `reports/code-reviewer-260705-1436-crm-finance-receipt-linkage-red-team-plan-review-report.md`
- Brainstorm: `../reports/brainstorm-260705-1407-crm-finance-data-linkage-report.md`

## Overview
Add an opt-in "tìm cơ hội theo SĐT" lookup above the parentPhone field in the standalone new-student form. On phone entry,
call a NEW narrow server query; show candidate(s); staff confirms → autofill `studentName` + `parentName` + hidden
`opportunityId`. Read-only. **Revised after red-team:** does NOT reuse `crm.opportunityList` (that permission gates the
entire CRM nav tab — see Risk). Adds one small purpose-built endpoint instead.

## Key insights (verified, revised after red-team)
- `receiptCreate` already accepts `opportunityId` (`finance.ts:483`) and links commission on it (`finance.ts:1017-1048`). The value of Phase 1 is capturing that link on the standalone form, not just prefilling text.
- Standalone new-student form currently sends only `parentPhone`+`studentName` (`finance-panel.tsx:1279-1290`) — **no `parentName`, no `opportunityId`**. Autofill must ADD these to the mutation payload (new state), mirroring `opportunity-detail.tsx:411-421`.
- **`crm.opportunityList` is NOT reused (reversed from original plan).** Red-team found `nav-permissions.ts:94-96` gates the entire "CRM" nav tab (kanban board, all opportunities, contact PII, sale ownership) on exactly the `crm.opportunityList` permission. Granting it to `ke_toan` would expose the whole CRM section, not just enable a lookup. Instead: a new narrow query + new permission key (see Architecture).
- `Contact.phone` stored `+84…` via `normalizePhone` (`crm.ts:62`). Staff-typed phone is raw → MUST normalize to `+84` before compare (D1).
- "Open" opportunity definition is now a **shared server-side helper**, also used by Phase 2 — see plan.md's shared-predicate decision. Do not reimplement the filter client-side or independently in two places (this is what caused red-team's divergence finding).

## Requirements
- Lookup appears only in `mode === 'new'`.
- On phone entry (debounced), call the new lookup query with normalized phone + facilityId.
- 0 matches → no UI change, manual flow unchanged (today's behavior).
- 1 match → show card (parentName + studentName + stage), explicit "Dùng thông tin này" button. Never autofill silently.
- ≥2 matches (siblings) → show a picker (Radio/Select), staff picks one.
- On confirm: set `studentName`, stash `parentName`+`opportunityId` in state; include all three in the `receiptCreate` call. Staff can still edit before submitting.
- Clearing/changing phone resets the stashed `opportunityId` (avoid stale link).
- ke_toan must be able to use this lookup WITHOUT gaining access to the CRM nav tab/kanban board.

## Architecture / data flow
1. **New tRPC query `crm.opportunityLookupByPhone`** in `crm.ts`, gated by **new permission `crm.opportunityLookup`**:
   ```ts
   opportunityLookupByPhone: requirePermission('crm', 'opportunityLookup')
     .input(z.object({ facilityId: z.number().int().positive(), phone: z.string().min(1) }))
     .query(({ ctx, input }) => withRls(rlsContextOf(ctx.session), (tx) =>
       tx.opportunity.findMany({
         where: { facilityId: input.facilityId, ...OPEN_OPPORTUNITY_WHERE,
                  contact: { phone: normalizeContactPhone(input.phone) } },
         select: { id: true, studentName: true, stage: true, contact: { select: { fullName: true } } },
         take: 5,
       })))
   ```
   `OPEN_OPPORTUNITY_WHERE` = the shared fragment `{ stage: { not: 'O5_ENROLLED' }, lostReason: null }` defined once (e.g. exported from `crm.ts` or a small shared module) and imported by Phase 2's duplicate-check query too.
2. Grant new permission `crm.opportunityLookup` to `[ke_toan, giam_doc_kinh_doanh, sale]` (mirrors `finance.receiptCreate`'s role set, `permissions.ts:156`) — a NEW row in `permissions.ts`, does not touch `crm.opportunityList`'s existing role list or `nav-permissions.ts`.
3. FE: debounced call to `trpc.crm.opportunityLookupByPhone.query({...})` on phone entry in `ReceiptCreateCard`; render candidate(s); on confirm, set `studentName`, `pickedOpportunityId`, `pickedParentName`.
4. Confirm handler payload at `finance-panel.tsx:1279-1290` gains `parentName: pickedParentName, opportunityId: pickedOpportunityId`.

## Related code files (exact)
- `apps/admin/src/finance-panel.tsx:1218-1246` (new-student state + opportunityContext effect), `:1279-1290` (payload), `:1382-1396` (parentPhone input — insert lookup above).
- `apps/api/src/routers/crm.ts:62-68` (normalizePhone, to replace with shared `normalizeContactPhone`), `:201-212` (existing opportunityList, for pattern reference only — NOT reused for auth).
- `apps/admin/src/nav-permissions.ts:94-96` (confirms `crm` tab gated by `crm.opportunityList` — do not touch this file).
- `packages/auth/src/permissions.ts:111` (`crm.opportunityList` role list, unchanged), `:156` (`finance.receiptCreate` role list, mirror for new `crm.opportunityLookup` grant).
- `apps/api/test/fixtures/permission-snapshot.json` (must add the new `crm.opportunityLookup` key's expected role list — `permission-parity.test.ts` fails CI otherwise).
- `apps/admin/src/opportunity-detail.tsx:411-421` (canonical field mapping to mirror).
- `packages/auth/src/login-phone.ts:8` (existing `normalizeLoginPhone` — WRONG format, do not use for matching).

## Implementation steps
1. Export `normalizeContactPhone` (+84) from `@cmc/auth`; replace `crm.ts:62` local `normalizePhone` with it (D1).
2. Define the shared `OPEN_OPPORTUNITY_WHERE` fragment/helper (used by this phase AND Phase 2).
3. Add `crm.opportunityLookup` permission key to `permissions.ts`, granted `[ke_toan, giam_doc_kinh_doanh, sale]`.
4. Add the new `crm.opportunityLookupByPhone` query to `crm.ts` per Architecture above.
5. Update `apps/api/test/fixtures/permission-snapshot.json` with the new permission's expected role list.
6. Add lookup state + debounced call + candidate rendering in `ReceiptCreateCard`.
7. Add lookup UI (candidate card / sibling picker + confirm button) above parentPhone input.
8. Extend new-student payload with `parentName` + `opportunityId` on confirm.
9. Reset stash on phone/facility change.

## Todo
- [x] `normalizeContactPhone` exported from @cmc/auth, reused in crm.ts
- [x] shared `OPEN_OPPORTUNITY_WHERE` helper defined (used by Phase 1 + Phase 2)
- [x] `crm.opportunityLookup` permission added, granted `[ke_toan, gdkd, sale]`
- [x] `permission-snapshot.json` updated with new key
- [x] `crm.opportunityLookupByPhone` query added (facility+RLS scoped, take 5, minimal fields)
- [x] lookup state + debounced call + candidate rendering in ReceiptCreateCard
- [x] candidate card + sibling picker + confirm
- [x] payload extended (parentName, opportunityId)
- [x] stash reset on phone/facility change
- [x] manual verify: 0/1/≥2 match paths; cross-facility isolation; ke_toan can use lookup but still cannot see CRM nav tab

## Success criteria
- Typing a phone that matches an open opp in the selected facility shows the candidate; confirming autofills and links `opportunityId` (verifiable: created receipt carries opportunityId → commission attributes on approve).
- No match leaves the form identical to today. Siblings produce a picker, never a wrong silent autofill.
- No opportunity from another facility ever appears (RLS + facility filter).
- **ke_toan can use the lookup but the CRM nav tab remains invisible to them** (verify via nav-permissions test/manual check).

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| **Permission-widening side effect (RESOLVED by architecture change):** original plan to grant `ke_toan` the full `crm.opportunityList` permission would have exposed the entire CRM nav tab (`nav-permissions.ts:94-96`) — a much bigger authorization change than intended. | H×H | Fixed by design: new narrow `crm.opportunityLookup` permission + new `opportunityLookupByPhone` query, decoupled from `crm.opportunityList`/nav gating. No nav-tab exposure. |
| Phone-normalization mismatch (silent no-match) | M×H | D1: use +84 `normalizeContactPhone` both sides; unit-check `0901…`, `+84901…`, `84901…`, spaced. Never use `normalizeLoginPhone` (84, no +). |
| Divergent "open" definition vs Phase 2 | M×H | Shared `OPEN_OPPORTUNITY_WHERE` helper used by both phases — no independent reimplementation. |
| Stale opportunityId after phone edit | M×M | Reset stash on phone/facility change. |
| Forgetting the `permission-snapshot.json` fixture update | M×M | Explicit todo item; `permission-parity.test.ts` will fail CI as a backstop if missed. |

## Security considerations
- RLS: the new query runs under `withRls(rlsContextOf(...))`, facility-scoped via `where.facilityId` — same pattern as every other CRM query. No cross-facility leak.
- New permission `crm.opportunityLookup` is scoped to exactly this query — it does not grant read access to the CRM board, contact directory, or any other CRM screen. ke_toan's visibility stays limited to "does a matching open opportunity exist + its parent/student name/stage" — strictly less than what sale/cskh see today in the full CRM board.
- Response fields kept minimal (id, studentName, stage, contact.fullName) — no phone/owner/source/campaign exposed back to the client beyond what's needed to confirm a match.

## Next steps
- Implement Phase 1 (shippable independently of Phase 2). Phase 2 depends on the shared `OPEN_OPPORTUNITY_WHERE` helper introduced here.
