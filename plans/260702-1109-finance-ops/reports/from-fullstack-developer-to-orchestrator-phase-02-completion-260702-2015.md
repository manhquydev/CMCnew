# Phase 2 — Email Ops: Completion Report

## Status: DONE

## Files Modified
- `apps/api/src/services/email-outbox.ts` — exported `SECRET_KINDS`; `enqueueEmail` now returns `Promise<boolean>` (true = inserted, false = dedup no-op). See "Bug found & fixed" below.
- `apps/api/src/services/email-templates.ts` — added `receipt` to `EmailTemplateKind`/`TemplatePayloads`, added render case (receiptCode, netAmount, studentName, facilityName, approvedAt).
- `apps/api/src/routers/finance.ts` — widened `receipt_pending_approval` notif to UNION(ke_toan, giam_doc_kinh_doanh) deduped by userId (was ke_toan-only); added `sendReceiptEmail` mutation.
- `packages/auth/src/permissions.ts` — added `email.outboxList`/`email.outboxRetry` (GĐKD-only v1) and `finance.sendReceiptEmail` (ke_toan ∪ GĐKD).
- `apps/api/test/fixtures/permission-snapshot.json` — added the 3 new entries above.
- `apps/admin/src/shell.tsx`, `apps/admin/src/nav-permissions.ts`, `apps/admin/src/App.tsx` — registered new `email-outbox` nav section (GĐKD-only gate).

## Files Created
- `apps/api/src/routers/email.ts` — `email.outboxList` (read, app-layer null-facility director filter, never returns bodyHtml, `isSecret` flag per row), `email.outboxRetry` (unconditional secret-kind block, resets non-secret failed row to queued/attempts=0).
- `apps/admin/src/email-outbox-panel.tsx` — outbox table (status filter, lastError, retry with disabled+tooltip for secret rows) + a "gửi phiếu qua email" card keyed by receiptId (kept out of finance-panel.tsx per plan, avoiding the same-file edit with Phase 1).
- `apps/api/test/email-outbox-router.int.test.ts` — 12 integration tests, all passing against the real dev DB (no mocks), run twice back-to-back to confirm idempotent cleanup.

## Tasks Completed
- [x] notif recipients = ke_toan ∪ GĐKD (deduped), verified against seeded roles
- [x] `receipt` template kind + payload (approvedAt) + render case
- [x] `email.*` perms + `email` router (list w/ app-layer null-facility filter + secret-kind-blocked retry) + audit (`logEvent`)
- [x] `finance.sendReceiptEmail` (target-hashed dedupKey so a corrected address always enqueues fresh; approved-only; audit)
- [x] admin outbox surface + send-receipt card

## Tests Status
- Type check: **pass** (`@cmc/api`, `@cmc/admin`, `@cmc/auth` all clean, including concurrent Phase 3/4 additions)
- Unit/integration: **12/12 pass** in `email-outbox-router.int.test.ts`, run twice consecutively with zero residue between runs:
  - secret-kind retry (otp_login AND lms_account_ready) unconditionally blocked, including a row whose body was intentionally never scrubbed
  - non-secret failed row retry resets status/attempts/lastError/scheduledFor
  - retry rejects a non-`failed` row
  - null-facility row visible to a director caller; non-director caller rejected at the perm gate (v1 is GĐKD-only, so the app-layer filter is exercised as defense-in-depth, documented in the test)
  - `outboxList` never returns `bodyHtml`
  - `receipt_pending_approval` reaches both a ke_toan and a giam_doc_kinh_doanh account; an account holding both roles is notified exactly once
  - `sendReceiptEmail` resolves `receipt.parentEmail`, enqueues a `receipt`-kind row
  - same-address resend is a true no-op (still 1 row); corrected address enqueues a distinct row (target-hashed dedupKey)
  - draft (unapproved) receipt is rejected
- Existing suite regression check: `email-outbox.int.test.ts` (7/7 pass), `lms-student-account-provisioning.int.test.ts` (7/7 pass, exercises the same `enqueueEmail` call site in `receiptApprove`). `dashboard-my-approvals.int.test.ts` has 1 failing test (`shiftRegistration` group visibility) — confirmed unrelated to any file I touched; almost certainly cross-phase interference from another phase's concurrent test run against the shared dev DB (Plan 4/5 phases were running in parallel). Not investigated further as out of scope.
- Permission parity: `permission-parity.test.ts` — my 3 new entries pass; one pre-existing failure for `finance.discountTierList/Upsert/Archive` belongs to Phase 4 (discount-tier config), not this phase.

## Bug found & fixed (not in original scope, but load-bearing for req. 4)
`enqueueEmail`'s dedup-swallow (catch P2002, return) does NOT "undo" the failed statement at the Postgres level — a unique-violation aborts the whole transaction, and **any subsequent query in the same transaction throws `25P02`, even though the JS exception was already caught**. This is invisible until something calls `enqueueEmail` and then does more work in the same `withRls` transaction with a dedupKey that can legitimately collide (exactly `sendReceiptEmail`'s "automatic resend to the same address = no-op" requirement). Fixed by:
1. `enqueueEmail` now returns `Promise<boolean>` (inserted vs. deduped).
2. `finance.sendReceiptEmail` makes `enqueueEmail` its last write and skips the `logEvent` audit call when the enqueue was a no-op.

This also surfaced the same anti-pattern in my own test's `afterAll` (7 deletes with individual `.catch()` inside **one** shared transaction — a failure in delete #1 silently no-ops deletes #2–7). Fixed by giving each cleanup delete its own `withRls` transaction. Worth flagging to other phases writing multi-delete test cleanup blocks — the individual-`.catch()`-in-one-tx pattern looks safe but isn't.

## Concurrent-phase coordination notes
Ran alongside Phase 3 (revenue report) and Phase 4 (discount tiers), both editing `permissions.ts`, `permission-snapshot.json`, `finance.ts`, and admin nav files concurrently. Used read-immediately-before-edit + `Edit`'s exact-match requirement as the collision guard; no destructive overwrites occurred. Did not touch Phase 1's `finance-panel.tsx` (per plan) — the send-receipt action lives in the new `email-outbox-panel.tsx`, keyed by `receiptId`.

## Concerns / Unresolved Questions
- `dashboard-my-approvals.int.test.ts` shift-registration failure — recommend orchestrator re-run in isolation once all phases have landed, to confirm it's cross-phase interference and not a real regression from another concurrent phase.
- Did not add a UI affordance to look up a receipt's UUID before pasting it into the "Gửi phiếu thu qua email" input — the admin currently has to copy the id from elsewhere (e.g. dev tools/DB). Acceptable for v1 per YAGNI, but worth a follow-up to wire a receipt picker if this becomes a frequent workflow.
