# Code Review — CRM↔Finance Receipt Linkage Implementation (decision 0037)

## Scope
- Files: `packages/auth/src/{login-phone.ts,index.ts,permissions.ts}`, `apps/api/src/routers/{crm.ts,finance.ts}`,
  `apps/admin/src/{finance-panel.tsx,opportunity-detail.tsx}`, `apps/api/test/helpers.ts`,
  `apps/api/test/fixtures/permission-snapshot.json`, 17 swept int-test files, `docs/decisions/0037-*.md` + `docs/DECISION_INDEX.md`.
- Verification method: read every changed file in full, traced the 4 `receiptCreate` trigger-condition branches by hand,
  grepped all `finance.receiptCreate(` call sites (70 across 17 test files) and confirmed each is either wrapped in
  `assertSuccess`/`.then(assertSuccess)` or is an intentional pre-narrowing error-path test, ran `tsc --noEmit` on
  `@cmc/api`/`@cmc/admin`/`@cmc/auth` (all clean) and `eslint` on `@cmc/api` (0 errors, 2 pre-existing unrelated warnings).

## Overall Assessment
Code matches the plan and decision doc closely — permission scoping, phone normalization, the shared open-opportunity
predicate, and the union-return sweep are all implemented correctly and match every claim in the plan/decision docs
verbatim. However, **the feature's own new behavior has zero integration-test coverage** — this is a real gap against
the plan's own acceptance criteria, not a nitpick.

## Critical Issues
None. No RLS leak, no authz bypass, no data exposure found.

## High Priority

**1. Missing integration tests for the new behavior (plan acceptance criteria not met).**
Grepped `apps/api/test/**` for `opportunityLookupByPhone`, `confirmDuplicate`, `duplicateWarning` — matches found only
in `helpers.ts` (the `assertSuccess` helper's own doc comment) and `finance-panel.tsx`. **No test file calls
`crm.opportunityLookupByPhone` and no test exercises the `receiptCreate` duplicate-warning branch.** This directly
contradicts:
- Plan's Phase 2 Todo: `[ ] int test: warning / retry / sibling-bypass / opportunityId-present-no-warn` — unchecked, not done.
- Plan's Phase 1 Todo: `[ ] manual verify: 0/1/≥2 match paths; cross-facility isolation; ke_toan can use lookup but
  still cannot see CRM nav tab` — no evidence this was done (no test, no note).
- Decision doc's own Follow-Up: "Integration tests: lookup returns correct candidates (0/1/≥2 matches) scoped to
  facility; ke_toan can call the new lookup but still cannot access the CRM nav tab; duplicate-warning fires and
  blocks nothing on confirm; sibling phone reuse never hard-blocks; opportunityId-present receipts never warn."

The existing 71-site `assertSuccess` sweep only proves old behavior still compiles/passes — it is a mechanical
regression guard, not a test of the new logic. The new duplicate-check branch (`finance.ts:508-528`) and the new
query (`crm.ts:220-236`) are currently unverified by any automated test. I traced the logic by hand (see below) and it
looks correct, but hand-tracing is not a substitute for the tests the plan explicitly committed to, especially for:
- RLS/facility-scoping on `opportunityLookupByPhone` (cross-facility leak risk if `facilityId` filter or RLS session
  scoping regresses later — no test would catch it).
- `ke_toan` calling the lookup while still being denied the CRM nav tab (this is the core authorization claim of the
  whole decision — currently backed only by `permission-parity.test.ts`'s static role-list check, which does not
  prove nav-gating actually holds at runtime).
- The warning→confirm round trip end-to-end (server side).

**Recommendation:** add a focused int-test file (e.g. `crm-finance-receipt-linkage.int.test.ts`) covering the 5 cases
above before merging. This is the single most important gap in an otherwise faithful implementation.

## Medium Priority

None found that aren't already covered above. Everything else — permission key, RLS pattern, phone normalizer, shared
predicate, union-return trigger conditions, FE modal wiring, test sweep — matches the plan and reads correctly.

## Low Priority

None.

## Verified-Correct Findings (explicit, per review posture)

1. **RLS/facility scoping** — `opportunityLookupByPhone` (`crm.ts:220-236`) runs under `withRls(rlsContextOf(ctx.session), ...)`
   with an explicit `facilityId: input.facilityId` filter, same pattern as every other CRM query (e.g.
   `opportunityList` at `crm.ts:203-214`). No cross-facility leak by inspection.
2. **`nav-permissions.ts` unchanged** — `nav-permissions.ts:94-96` still gates the CRM tab on `crm.opportunityList`
   only; `crm.opportunityLookup` does not appear there. `ke_toan` gains the narrow lookup permission
   (`permissions.ts:116`) but not CRM nav visibility, matching decision 0037 exactly.
3. **Shared `OPEN_OPPORTUNITY_WHERE`** — defined once in `crm.ts:67-70`, imported by `finance.ts:6` via
   `import { OPEN_OPPORTUNITY_WHERE } from './crm.js'` and spread identically (`...OPEN_OPPORTUNITY_WHERE`) into both
   `opportunityLookupByPhone`'s where (`crm.ts:228`) and the duplicate-check query (`finance.ts:513`). No drift possible
   — single source, not reimplemented.
4. **Phone normalization** — `normalizeContactPhone` (not `normalizeLoginPhone`) is used consistently: `crm.ts:86`
   (contact upsert dedupe), `crm.ts:229` (lookup query), `finance.ts:514` (duplicate check), and
   `finance-panel.tsx:1273` (client-side digit-length gate before firing the lookup). `normalizeLoginPhone` is untouched
   and not conflated anywhere in the diff.
5. **Union return correctness** — traced all 4 scenarios in `finance.ts:503-528` by hand:
   - (a) existing-student (`studentId` set) → `!input.studentId` is `false` → guard skipped entirely, confirmed.
   - (b) new-student, open-opp match, no `confirmDuplicate` → guard fires, `dup` found → returns
     `{status:'warning', duplicateWarning:{...}}` **before** `tx.receipt.create` is ever reached — no receipt created.
   - (c) new-student, `confirmDuplicate:true` → `!input.confirmDuplicate` is `false` → guard skipped, receipt created
     even if a dup exists.
   - (d) `opportunityId` already set → `!input.opportunityId` is `false` → guard skipped regardless of `confirmDuplicate`.
   All four match the plan's intended trigger table exactly.
6. **Test sweep completeness** — all 70 `finance.receiptCreate(` call sites across 17 test files are wrapped through
   `assertSuccess` or `.then(assertSuccess)`, except 2 intentional error-path tests
   (`student-provisioning-edge-cases.int.test.ts:295`, an EC3 guard-rejection test that expects the mutation to throw
   before returning, so no result to narrow) — correctly left unwrapped. No leftover unwrapped success-path call found.
7. **Sibling-receipt tests remain safe** — checked `lms-family-login.int.test.ts:406-434` (`13. two brand-new siblings
   ... concurrently`) and `student-provisioning-edge-cases.int.test.ts:157-194` (EC1 sibling differentiation): both
   create two receipts with the same `parentPhone` but **no CRM `Opportunity`** exists for that phone in either test,
   so the duplicate-check query (which only matches against `tx.opportunity`, never `tx.receipt`) never fires. Neither
   test was broken by the new guard. This is correct but was verified by me manually, not by a dedicated new test (see
   High Priority #1).
8. **`opportunity-detail.tsx`** — `createOpportunityReceipt` (`:407-440`) always passes `opportunityId: opp.id`, so the
   guard never triggers there by construction; the `result.status !== 'success'` branch (`:424-427`) still narrows
   before reading `.receipt.code` and shows a real (if theoretically unreachable) error message rather than silently
   swallowing — acceptable defensive code, not dead/misleading.
9. **Frontend state hygiene** — `finance-panel.tsx`'s lookup-reset `useEffect` (`:1268-1279`) has deps
   `[debouncedPhone, newFacilityId, mode]` and unconditionally clears `pickedOpportunityId`/`pickedParentName`/
   `opportunityMatches` on every run before deciding whether to re-fire the lookup — correctly prevents a stale
   `opportunityId` from riding along after a phone edit. `confirmCreateDespiteDuplicate` (`:1383-1394`) retries with
   `{...duplicateWarning.payload, confirmDuplicate: true}` — the exact original payload object captured at
   warning-time in `submitReceipt` (`:1318-1334`), not re-derived from current form state, so no stale-closure risk
   from the user editing fields between warning and retry.
10. **`permission-snapshot.json`** — `"crm.opportunityLookup": ["ke_toan", "giam_doc_kinh_doanh", "sale"]` matches
    `permissions.ts:116` exactly, role order included (not that order matters for the parity check, but no typo).
11. **No invented conventions** — Mantine `Modal`/`Alert`/`Radio` all pre-imported and used per existing patterns in
    the same file; `useDebouncedValue` already used elsewhere in the codebase; `requirePermission('crm',
    'opportunityLookup')` follows the exact same call shape as every other procedure in `crm.ts`.
12. **TypeScript/lint** — `pnpm -F @cmc/api typecheck`, `pnpm -F @cmc/admin typecheck`, `pnpm -F @cmc/auth typecheck`
    all clean (0 errors). `pnpm -F @cmc/api lint` — 0 errors, 2 pre-existing warnings in unrelated files
    (`emit-staff-notif.ts:32`, `shift-registration.ts:22`), unrelated to this change.
13. **No circular import** — `finance.ts` imports `OPEN_OPPORTUNITY_WHERE` from `./crm.js`; confirmed `crm.ts` does
    not import from `./finance.js` anywhere.
14. **Transaction correctness of the early-return warning path** — `withRls` wraps the whole handler in
    `prisma.$transaction`; the warning branch returns before any writes, so it just commits an empty (read-only)
    transaction — no dangling transaction or side effect.
15. **`docs/DECISION_INDEX.md`** row added correctly, points at `docs/decisions/0037-crm-finance-receipt-linkage.md`,
    correctly lists both `finance.ts`/`crm.ts` as affected files.

## Recommended Actions
1. **Blocking:** add the missing integration test(s) for `opportunityLookupByPhone` (0/1/≥2 match, cross-facility
   isolation) and `receiptCreate`'s duplicate-warning branch (warn-without-create, confirmDuplicate bypass,
   opportunityId-present never-warns, sibling non-block) before shipping. This is explicitly required by both the
   plan and the decision doc's own Follow-Up section — treat as an unmet acceptance criterion, not an optional nice-to-have.
2. Non-blocking: consider a runtime assertion or a one-line integration test that a `ke_toan` caller can invoke
   `crm.opportunityLookupByPhone` successfully while `crm.opportunityList` still throws `FORBIDDEN` for the same
   caller — this is the single authorization claim the whole decision doc rests on and currently has no runtime proof.

## Verdict
**Not yet safe to proceed to a final ship without addressing High Priority #1.** The implementation logic itself is
correct by hand-trace and matches the plan/decision precisely — no security, RLS, or contract-correctness defects
found. But the plan's own required test coverage for the new behavior (lookup query, duplicate-warning trigger/bypass,
ke_toan-can-lookup-but-not-nav) was not written. Recommend: author the missing int-test(s), run them, then this is
ready to ship.

## Unresolved Questions
- Was manual browser verification done for Phase 1's "0/1/≥2 match + cross-facility isolation + ke_toan nav-tab
  invisibility" acceptance criteria (per Phase 1 Todo), even though no automated test exists? If so, where is that
  recorded? I found no note/journal referencing this.
