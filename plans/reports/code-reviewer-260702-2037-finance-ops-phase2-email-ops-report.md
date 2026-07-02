# Code Review — Finance-Ops Phase 2 (Email Ops)

## Scope
- `apps/api/src/services/email-outbox.ts` (SECRET_KINDS export, `enqueueEmail` → `Promise<boolean>`)
- `apps/api/src/services/email-templates.ts` (`receipt` kind)
- `apps/api/src/routers/finance.ts` — notif recipient union + `sendReceiptEmail` (rest of file is Phase 3/4, not reviewed)
- `packages/auth/src/permissions.ts` — `email.outboxList`/`outboxRetry`, `finance.sendReceiptEmail` lines only
- NEW `apps/api/src/routers/email.ts`, `apps/admin/src/email-outbox-panel.tsx`
- NEW `apps/api/test/email-outbox-router.int.test.ts`
- Nav wiring: `apps/admin/src/{shell,nav-permissions,App}.tsx` (email-outbox section only)

## Overall Assessment
Implementation matches the phase-02 spec. The self-reported P2002/25P02 transaction-abort bug is real and correctly fixed. All five adversarial checks (a–e) verified against actual code, not just tests. All requested test suites pass; typecheck clean on both packages.

## Verification of the reported out-of-scope bug (P2002 → 25P02)
Confirmed real. `withRls` (`packages/db/src/index.ts:56`) uses `prisma.$transaction(async (tx) => {...})` — a genuine interactive Postgres transaction. `enqueueEmail`'s `tx.emailOutbox.create` on a `dedupKey` collision throws Prisma P2002, which at the Postgres level is a failed statement that aborts the transaction (`current transaction is aborted, commands ignored until end of transaction block`, SQLSTATE 25P02). Catching the P2002 in JS does not undo this — any further query in the *same* transaction throws 25P02, and only COMMIT/ROLLBACK are valid afterward. Since `sendReceiptEmail`'s "automatic resend to the same address = no-op" scenario legitimately hits this dedup path, this was a live landmine, not a theoretical concern.

**Fix verification**: `enqueueEmail` now returns `Promise<boolean>` (email-outbox.ts:57-81); `finance.ts:1407-1429` calls it as the last statement and conditionally skips `logEvent` when `inserted === false`, with an explicit comment explaining why. This closes the gap for `sendReceiptEmail`. Confirmed by running the actual integration test twice-in-a-row against real Postgres (`email-outbox-router.int.test.ts`, "a same-address resend is a dedup no-op" case) — it passes, and would throw 25P02 on the second `sendReceiptEmail` call if `logEvent` still ran unconditionally after a dedup collision.

**Residual note (not a Phase-2 defect, informational only)**: `finance.ts:942` (`receiptApprove`, pre-existing code, untouched by this diff) also calls `enqueueEmail` mid-transaction (not last-statement) with `dedupKey: lms_account_ready:${resolvedStudentId}`, followed by several more writes (opportunity attribution, receipt update, logEvent) in the same tx. Today this is not reachable — the call only fires when `!existingLmsAcc && wasNewStudent`, i.e. a StudentAccount was just created fresh in the same tx, so the dedupKey cannot already exist. But the pattern is fragile: any future change that reuses this dedupKey format (e.g. a re-issue/re-provision flow keyed by studentId) would silently break the receipt-approval money path with an uncaught 25P02. Worth a follow-up ticket, not a blocker for this phase.

## Critical checks (a)–(e)

**(a) Secret-kind retry unconditional block — CONFIRMED, real test coverage.**
`email.ts:78-84`: guard is `SECRET_KINDS.has(row.templateKind as EmailTemplateKind)`, independent of `bodyHtml` state — matches spec exactly (body content is never inspected). Test `email-outbox-router.int.test.ts:127-155` creates an `otp_login` row with `bodyHtml: '<p>123456</p>'` (explicitly NOT scrubbed, comment confirms intent) and asserts `outboxRetry` rejects with BAD_REQUEST and the row is left untouched (`after.bodyHtml` still `'<p>123456</p>'`). This is a genuine test of the unscrubbed-secret case, not a normally-scrubbed row. A second test covers `lms_account_ready`.

**(b) outboxList explicit app-layer null-facility filter — CONFIRMED.**
`email.ts:29-37`: `isDirector = ctx.session.isSuperAdmin || ctx.session.roles.includes('giam_doc_kinh_doanh')`; query where-clause applies `isDirector ? {} : { facilityId: { not: null } }` — an explicit Prisma filter, not reliance on RLS. Matches spec's stated threat model (RLS admits all staff to null-facility rows).

**(c) outboxList never returns bodyHtml — CONFIRMED.**
`select` block (email.ts:38-50) enumerates exact fields; `bodyHtml` is absent. Test at line 270-276 asserts `bodyHtml` is `undefined` on every row.

**(d) sendReceiptEmail dedupKey includes target — CONFIRMED.**
`finance.ts:1398-1409`: `targetHash = sha256(to.trim().toLowerCase()).slice(0,16)`; `dedupKey: receipt:${receipt.id}:${targetHash}`. A corrected address produces a different hash → fresh row. Verified end-to-end by the "same-address resend is a dedup no-op; a CORRECTED address enqueues a fresh row" integration test — same address stays at 1 row, corrected address produces a second distinct row.

**(e) receipt_pending_approval reaches UNION(ke_toan, giam_doc_kinh_doanh), deduped by user — CONFIRMED.**
`finance.ts:575-589`: queries `userFacility` for the facility, filters users whose `roles` includes `ke_toan` OR `giam_doc_kinh_doanh`, wraps `.map(uf => uf.userId)` in `new Set(...)` before spreading to `approverIds`. This is genuine dedup-by-id, not just role-string dedup. Verified by two integration tests: one asserting both a ke_toan-only and a GĐKD-only account receive the notif, and a second asserting an account holding both roles receives exactly 1 notification (`notifs.length === 1`).

## Test & build verification (all re-run directly, not taken on faith)
- `email-outbox-router.int.test.ts`: 12/12 pass (~1.7s) against real dev Postgres, no mocks.
- Regression: `email-outbox.int.test.ts` 7/7 pass, `lms-student-account-provisioning.int.test.ts` 7/7 pass (exercises the same `enqueueEmail` call site in `receiptApprove` — confirms the `Promise<boolean>` signature change didn't break the existing caller, since that call site ignores the return value, which is fine — it doesn't need the guard).
- `pnpm --filter @cmc/api typecheck`: clean.
- `pnpm --filter @cmc/admin typecheck`: clean.
- Did not re-run `dashboard-my-approvals.int.test.ts` (implementer flagged 1 pre-existing failure there, attributed to cross-phase interference on shared dev DB, not in this phase's file scope) — out of scope for this review per task instructions (Phase 3/4 concern).

## Nav/permission wiring (informational)
`packages/auth/src/permissions.ts:154,317-318` — `sendReceiptEmail: ['ke_toan','giam_doc_kinh_doanh']`, `outboxList`/`outboxRetry: ['giam_doc_kinh_doanh']` — matches spec's GĐKD-only v1 decision. `apps/admin/src/nav-permissions.ts` gates the `email-outbox` nav section on `email.outboxList`, consistent. Client-side `disabled={r.isSecret}` on the retry button in `email-outbox-panel.tsx:209` is UI convenience only — the real enforcement is server-side and unconditional (verified in (a)), so this is correctly defense-in-depth, not the sole control.

## Medium/Low observations (non-blocking)
1. **Pre-existing enqueueEmail call site fragility** (see "Residual note" above) — not introduced by this diff, but the exported `SECRET_KINDS`/boolean-return refactor didn't retrofit `receiptApprove`'s call site with the same last-statement discipline. Recommend a follow-up ticket to harden that call site (or all `enqueueEmail` call sites) rather than relying on "currently unreachable."
2. **Admin `EmailOutboxPanel`'s "Gửi phiếu thu qua email" input requires manually pasting a receipt UUID** — implementer flagged this themselves as an accepted YAGNI gap in the completion report. Confirmed accurate; not a regression, just a UX rough edge for v1.
3. `lastError` is rendered in the admin table (`email-outbox-panel.tsx:192-195`) — reviewed for leak risk: this is a Graph API/network error message (e.g. rate-limit, delivery failure), not template body content, so no PII/secret exposure via this column. No action needed.

## Recommended Actions
1. (Optional, low urgency) File a follow-up to make all `enqueueEmail` call sites last-statement-safe, or add a lint/comment convention requiring it, so future dedupKey reuse doesn't silently break a transaction elsewhere.
2. No blocking changes required for Phase 2 to land.

## Unresolved Questions
- None for Phase 2 scope. The `dashboard-my-approvals.int.test.ts` shift-registration failure flagged by the implementer is Phase 3/4-adjacent and was explicitly out of scope for this review — orchestrator should re-run it once all phases have landed.
