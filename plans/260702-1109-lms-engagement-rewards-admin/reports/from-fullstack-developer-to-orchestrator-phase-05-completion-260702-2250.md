# Phase 05 Completion Report — lms-engagement-rewards-admin

## Gap analysis: plan requirements vs existing tests

- P1 negatives (cancelled session / draft exercise / withdrawn enrollment → 0): already fully covered by test `(e)` in `apps/api/test/exercise-open-notify.int.test.ts` (3 sub-scenarios + a Trigger-A draft-publish negative). No gap, no change.
- P2 giftUpdate audit: already covered — asserts `recordEvent` rows with `entityType: 'gift', type: 'updated'`. No gap.
- P2 giftArchive audit: **gap found and closed.** The existing test only asserted entity-state removal (gift dropped from the active `gifts()` list) but never checked the audit log content, even though `giftArchive` in `apps/api/src/routers/rewards.ts:236-242` writes a `recordEvent` row with `type: 'archived'`. Added one assertion block to the same `it('giftArchive drops the gift from the active gifts list', ...)` test in `apps/api/test/rewards-gift-star-redeem-admin.int.test.ts` that queries `recordEvent` for `entityType: 'gift', entityId: giftId, type: 'archived'` and expects `>= 1` row. This is additive only — no existing assertions changed.
- P2 stockAdjust audit: reviewed router — it does log an `updated` event with a `stock` field diff (`rewards.ts:254-261`), but the plan's audit-row callout specifically named giftUpdate/giftArchive only; stockAdjust's effect (out_of_stock on redeem) is already proven end-to-end, which is the stronger assertion. Left as-is (no gap per plan wording).
- P4 (all four bullets — profileUpdate isolation, requestLink anti-takeover, staff approve/reject, linkRequestListMine own-only, email collision BAD_REQUEST): fully covered in `apps/api/test/guardian-link-request.int.test.ts` (13 tests). Cross-parent isolation test explicitly runs under `resolveParent()` (real `mintParentSession`-derived LMS session), not `SYSTEM_CTX`, satisfying the plan's RLS-mandatory risk mitigation. No gap.

Net change: **one assertion added** to `apps/api/test/rewards-gift-star-redeem-admin.int.test.ts` (giftArchive audit-row check). No other test files touched. No application source files touched.

## Validation gates (run in order per plan)

1. `pnpm --filter @cmc/db exec prisma migrate status` → **0 drift**, "Database schema is up to date!" (67 migrations found, all applied).
2. Narrow: the 3 phase int-test files run together (`exercise-open-notify.int.test.ts`, `rewards-gift-star-redeem-admin.int.test.ts`, `guardian-link-request.int.test.ts`) → **26/26 passed** (6 + 7 + 13).
3. Typecheck, all 5 packages → **clean**:
   - `@cmc/auth` — pass
   - `@cmc/db` — pass
   - `@cmc/api` — pass
   - `@cmc/admin` — pass
   - `@cmc/lms` — pass
4. Production builds:
   - `pnpm --filter @cmc/admin build` → **success** (7168 modules, dist emitted; pre-existing >500kB chunk-size warning only, not an error)
   - `pnpm --filter @cmc/lms build` → **success** (6988 modules, dist emitted; same pre-existing chunk-size warning)

## Broader regression check

- Full `apps/api` integration suite (`npx vitest run --config vitest.integration.config.ts`, no filter): **101 files / 538 tests passed**, 0 failures.
- Full `apps/api` unit suite (`npx vitest run`): **108/109 files, 624/625 tests passed**. The 1 failure is `test/email-graph-client.test.ts` ("renders otp_login with the code in subject + body" — expects `123456` in the email subject line, gets the static subject text instead). Confirmed **pre-existing and unrelated to Plan 6**: `git log` shows the file was last touched by commit `6b2a862` ("fix(security): close audit integrity/authz findings"), no uncommitted changes to it, and it belongs to the P4.5/email-ops area, not P1-P4 of this plan. Per validation-only scope, not fixed — flagged for the orchestrator to route to whoever owns email-ops.
- `apps/api/test/permission-parity.test.ts`: passed as part of the full unit run above (not in the failed list).
- Nav-consistency: no such suite exists under `apps/api`; located under `apps/admin/src/__tests__/` instead (`nav-director-kd-cockpit-consolidation.test.ts`, `nav-teacher-consolidation.test.ts`). Ran both directly: **12/12 passed**.

## Manual checklist (plan §"Manual checklist")

No browser/dev-server is available in this environment, so none of these were exercised live. Status per item:

- [ ] **Student/parent feed: new-exercise + meeting labels render friendly text.** DEFERRED — no browser access this session. Not claiming a UI pass. (Code-level: label strings exist in the notification-rendering component per prior P1 commit, but that is not equivalent to a rendered-UI check.)
- [ ] **KD director: gift edit/archive/stock, manual star adjust (with reason), mark delivered; non-director blocked.** Server-side authorization and mutation effects are proven by the P2 integration suite (7 tests, all director-gated procedures return FORBIDDEN for `giao_vien`; effects on gift/stock/star/reward state verified against the real dev DB). The interactive admin panel itself (`rewards-panel.tsx`) was NOT clicked through in a browser — DEFERRED for the UI-only portion.
- [ ] **Đào tạo director: badge create/archive/grant; GV grant only; other roles no badge nav.** Per the team-lead's brief, P3 was code-reviewed this session as manual-only-by-design (API pre-covered, no new test file). No new manual pass performed in this phase — DEFERRED. Nav-hiding logic for non-eligible roles was not independently re-verified here.
- [ ] **Parent: profile edit persists; link-request by phone + by code queues; staff approves → child appears; parent cannot create a link directly.** Server-side equivalents are proven by the P4 integration suite (profileUpdate persistence, requestLink by both `studentCode` and `studentPhone`, staff `linkRequestReview` approve creating exactly 1 Guardian / reject creating 0, and the anti-takeover invariant that `requestLink` alone never creates a Guardian row). The parent-facing UI flow itself was NOT click-tested — DEFERRED.

All four items are explicitly DEFERRED for the live-browser portion; only the underlying server behavior each item implies has been integration-tested this session.

## Files touched this phase

- `apps/api/test/rewards-gift-star-redeem-admin.int.test.ts` — added one audit-row assertion to the existing `giftArchive` test (additive, no rewrites).

No application source files modified.

Status: DONE_WITH_CONCERNS
Summary: Closed the one genuine test gap (giftArchive audit-row assertion); all validation gates (migrate status, 3-file int suite, 5 typechecks, 2 prod builds) pass clean; full regression is 101/101 int test files and 108/109 unit test files passing, with 1 pre-existing unrelated failure in email-graph-client.test.ts (email OTP subject line, last touched by an unrelated security-fix commit) flagged but not fixed per validation-only scope. All 4 manual-checklist items are explicitly DEFERRED (no browser available) rather than claimed as passed.
Concerns/Blockers: (1) email-graph-client.test.ts otp_login subject-line failure is pre-existing/out-of-scope but still a live regression on develop — recommend routing to email-ops owner. (2) All 4 manual UI checklist items remain unverified in a real browser; only server-side equivalents are proven.
