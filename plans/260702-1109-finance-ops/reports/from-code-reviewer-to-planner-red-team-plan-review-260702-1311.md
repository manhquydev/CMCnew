# Red-Team Plan Review — Finance Ops (Plan 4, `260702-1109-finance-ops`)

Reviewer: code-reviewer | 2026-07-02 13:11 | Scope: plan.md + phases 01–05 vs current working tree (develop, uncommitted Plan-1 state = truth)

## Verdict: **FIX-FIRST**

Structure, lane classification (high-risk), decision-id reservation (0028 free — latest is 0023, Plan 3 at `plans/260702-1030-role-flows-completion/plan.md:22` reserves 0024–0027), and file-ownership serialization are sound. But the plan contains 2 CRITICAL money-out guard gaps and 7 MAJOR issues, including three factually wrong anchors/claims that would be built as specified. Fix the plan text before execution.

---

## CRITICAL

### C1 — Refund sum-cap guard has a concurrency hole (P1)
`phase-01:21` specifies `sum(existing refunds)+amount ≤ receipt.netAmount` with no locking strategy. Two concurrent `refundCreate` calls both read the same sum under READ COMMITTED, both pass, and the combined total exceeds `netAmount` — money-out overshoot on the exact invariant the phase exists to protect. The codebase already solves this class of race with atomic claims (`receiptApprove` claim at `apps/api/src/routers/finance.ts:343-349`; voucher consume at `:322-332`).
**Fix:** plan must mandate a receipt row lock before summing (`SELECT ... FOR UPDATE` on the receipt inside the txn) or an atomic conditional insert pattern, plus an int test with two concurrent refunds.

### C2 — Refund allowed on a never-approved cancelled receipt (P1)
`phase-01:21` guard: "validate receipt is cancelled OR being cancelled". `receiptCancel` accepts **draft** receipts (`finance.ts:742-747` — only rejects already-cancelled; `wasApproved` is a branch flag, not a gate). A draft receipt cancelled via the normal flow satisfies "is cancelled", so `refundCreate` as specified would record money-out against a receipt where **no money ever came in**. The UI hides the field for non-approved receipts (`phase-01:22`), but the mutation is the trust boundary, not the modal — and the "standalone refund on cancelled rows" action (`phase-01:39`) makes this reachable.
**Fix:** mutation guard must be `status === 'cancelled' AND approvedAt IS NOT NULL` (or `code IS NOT NULL`). Also drop "OR being cancelled" — in the chosen two-txn design (`phase-01:26`) refundCreate always runs after cancel commits; "being cancelled" is unimplementable and only invites a weaker guard.

---

## MAJOR

### M1 — Notif fix is built on a false premise; the specified fix removes real recipients (P2)
`phase-02:9` claims `receipt_pending_approval → ke_toan` is "a role NO ONE holds → notif is dead". False against the tree: `ke_toan` is a live role kept in the RBAC consolidation — seeded at `packages/db/src/seed.ts:119` (`ketoan@cmc.local`), grantable by GĐKD via `DIRECTOR_ROLE_GRANTS` (`packages/auth/src/permissions.ts:296`), and `finance.receiptApprove` = `['ke_toan','giam_doc_kinh_doanh']` (`permissions.ts:132`). "No one holds it" is at best a prod-seed snapshot, not repo truth. Replacing the filter (`finance.ts:281-283`) with GĐKD-only would silently drop notifs to any real kế-toán account the moment one is hired.
Additionally: GĐKD **already** receives pending receipts via `dashboard.myApprovals` (`apps/api/src/routers/dashboard.ts:204-205` → `receiptPendingItems`), so the fix as written creates a double surface for GĐKD while removing the only push channel for ke_toan.
**Fix:** notify the **union** of the approver set (`ke_toan` + `giam_doc_kinh_doanh`, i.e. mirror the `receiptApprove` grant), and state explicitly that myApprovals-inbox + push-notif duplication for GĐKD is accepted (or dedupe).

### M2 — `outboxList` RLS claim contradicts the actual policy (P2)
`phase-02:23` asserts "null-facility rows = system, super-admin only". The real policy (`packages/db/prisma/migrations/20260626150000_email_outbox/migration.sql:36-46`) grants **any staff** access to `facility_id IS NULL` rows: `app_principal_kind() = 'staff' AND ("facility_id" IS NULL OR ...)`. RLS will NOT hide system rows. Null-facility rows include `account_welcome` (staff emails, `user.ts:338-344`) and OTP rows — cross-facility PII (toAddress) visible to every `email.outboxList` holder.
**Fix:** the plan must specify an explicit app-layer filter (`facilityId: { not: null }` unless super-admin) or a policy migration; do not rely on the current RLS for this guarantee.

### M3 — Scrubbed-secret retry guard is too narrow: stale-secret re-send (P2)
`phase-02:24` blocks retry only when `templateKind ∈ SECRET_KINDS AND bodyHtml === ''`. Scrubbing happens only on terminal transitions (`email-outbox.ts:171,206`). A failed secret row whose body was NOT scrubbed (rows predating the scrub logic, partial-write edge, or any future code path that misses `scrubPatch`) passes the guard and re-sends a **stale live OTP / temp password**. The blank-email case is the benign failure; the intact-body case is the dangerous one.
**Fix:** block retry for `templateKind ∈ SECRET_KINDS` unconditionally. Secret kinds are re-provision-only, body content irrelevant.

### M4 — `dedupKey: 'receipt:<receiptId>'` makes corrected-address re-send impossible (P2)
`enqueueEmail` silently swallows the unique violation (`email-outbox.ts:70-74`), and `outboxRetry` only accepts `status = failed` (`phase-02:24`). Once a receipt email is **sent** to a wrong address (typo in `parentEmail`), there is no path to send it again: re-send is a silent no-op, retry refuses non-failed rows. The success criterion "re-send = no-op" (`phase-02:59`) enshrines the bug as a feature.
**Fix:** include the recipient in the key (`receipt:<id>:<to>`) or add an explicit requeue-sent path for the non-secret `receipt` kind. Surface "already sent to X at T" in the UI instead of a silent success.

### M5 — Decision 0028's correction mechanism does not exist in the implementation (P1/P5)
Plan.md:23 and `phase-05:26` define correction = "compensating negative entry", but `phase-01:62` rejects negative amounts and calls compensating entries "not a UI path in this phase", with **no other write path** (append-only, no update/delete). Net: a fat-fingered refund amount (10x typo on a money record) is uncorrectable except by raw SQL — the durable decision documents a mechanism the system cannot perform.
**Fix:** either (a) add a perm-gated `refundReverse` (server-writes the negative row referencing the original, GĐKD-only, audited), or (b) amend decision 0028 to state correction is a DBA/operator SQL procedure — but don't ship a decision record that promises an inoperable path. Note the sum-cap guard must include negative rows in the sum either way.

### M6 — P3 period-key anchor is factually wrong: `Receipt.issuedAt` does not exist
`phase-03:14` ("Grouping keys already exist (`createdAt`/`issuedAt` for month)") is false — `issuedAt` exists only on `Certificate` (`schema.prisma:1303`). Receipt timestamps: `createdAt` (draft creation), `approvedAt`, `sentAt`, `reconciledAt` (`schema.prisma:1053-1059`). `createdAt` as default skews revenue to draft-entry time; a receipt drafted 30/6 and approved 2/7 lands in June. Since the report filters `status IN (approved,sent,reconciled)`, every qualifying row has `approvedAt`.
**Fix:** correct the anchor and commit to `approvedAt` as the default period key (recognition at approval = when money is accepted + code allocated). The same key must apply to `reconcileWorklist` period filtering.

### M7 — Revenue report ignores the refund ledger P1 just built; cancellation is retroactive erasure (P3)
`revenueReport` sums `status IN (approved,sent,reconciled)`, so a receipt approved in June and cancelled in August **retroactively disappears from June's total** — a previously exported June CSV can never be reproduced. Meanwhile P1's `RefundRecord` (the actual cash-out event, timestamped in August) is not referenced anywhere in P3. The report can't reconcile against cash: cash-in exists in June's drawer, cash-out in August's, and the report shows neither.
**Fix (minimum):** document the chosen semantics in decision 0028 (or a P3 note): either (a) gross revenue by approvedAt regardless of later cancel, minus a refund column sourced from RefundRecord by refund `createdAt`; or (b) current point-in-time semantics, explicitly stating exports are non-reproducible. Silently shipping (b) as an accounting report is the trap.

---

## MINOR

- **m1** `phase-03:28` frets about an indirect receipt→enrollment→course join — unnecessary: `Receipt.courseId` is a direct FK (`schema.prisma:1030-1031`). 1 receipt = 1 course; no double-count risk. Simplify the plan step.
- **m2** `sendReceiptEmail` "resolve payer email (default)" is unspecified: `receipt.parentEmail` is populated only on new-student receipts (`schema.prisma:1063`); renewals need student→guardian→parent_account. Note: identity tables are global-RLS (no facility scope) — scope must come from the student join, and the resolved address must be facility-validated before send.
- **m3** `paidById` naming: labeled "payer" but set to `ctx.session.userId` (the staff recorder, `phase-01:21`). The refund *recipient* is never captured (derivable via receipt→student→guardian, but say so). Rename to `recordedById`/`disbursedById` or document.
- **m4** `DiscountTier @@unique([facilityId, years])` includes **archived** rows (`schema.prisma:991`): re-adding an archived year must go through upsert that clears `archivedAt` and overwrites `percent` in place — so "archive keeps the pricing audit trail" (`phase-04:14`) is partially illusory at the row level. Fine because `receipt.tierPercent` is frozen per receipt (`schema.prisma:1036`) + audit log, but the plan should state that's where reconstruction lives.
- **m5** Outbox detail returning `bodyHtml` for non-secret kinds exposes `payslip_ready` / `account_welcome` staff PII; acceptable at GĐKD-only grant — if `ke_toan` gets the read grant (`phase-02:22` leaves it open), exclude `payroll`-mailbox rows or keep detail GĐKD-only.
- **m6** Retry resets `attempts=0` → each manual retry buys 5 fresh sends with 5 cron-driven failures. Unbounded but audited; acceptable, note a per-row retry cap if it ever loops.
- **m7** Tier edits and in-flight drafts: a draft priced under old tiers approves later at the stale price (`receiptApprove` never reprices, verified `finance.ts:308-349`). Plan's "existing receipts unaffected" covers approved rows; add one sentence covering the draft-in-flight case so the operator isn't surprised.

## Verified-good (no action)

- Anchors correct: `receiptCancel` `finance.ts:737-844` ✓; `receiptReconcile` `:702-725` ✓; notif block `:276-291` ✓; `tiersFor` `:28-37` ✓; perms `permissions.ts:125-136` ✓; cancel modal `finance-panel.tsx:626-645` ✓; `EmailOutbox` `schema.prisma:755` ✓; `DiscountTier` `:983-994` ✓; `SECRET_KINDS` `email-outbox.ts:30` ✓; `MAX_ATTEMPTS=5` `:23` ✓.
- Decision-id math checks out (0028 free).
- Retry-as-reset (not re-create) is the right call given the `dedupKey` unique (`schema.prisma:758`).
- New `receipt` email kind reusing `layout()`/inline styles (not `receipt-html.ts`, whose `<style>` block mail clients strip — `receipt-html.ts:32`) is correct; no data-URLs in either renderer.
- Amounts are integer VND end-to-end (Receipt Int fields); `RefundRecord.amount Int` is consistent; max Int4 ≈ 2.1B VND per row is fine at this scale.
- Two-txn cancel→refund with standalone-retry fallback is a defensible partial-failure design (given C2 is fixed).
- Plan 3 serialization on `finance-panel.tsx`/`permissions.ts` is explicitly stated and matches the file-ownership rule; `opportunityId` pass-through lives in `receiptCreate` (`finance.ts:258`), untouched by this plan.

## Unresolved Questions (for planner/operator)

1. M7 semantics: is the revenue report an accounting artifact (reproducible per period, refunds as separate rows) or a live dashboard (point-in-time)? Decides the whole P3 query shape.
2. M1: is push-notif + myApprovals double-surface for GĐKD acceptable, or should the notif go to ke_toan-only-when-present with GĐKD relying on the inbox?
3. M5: negative-entry endpoint now, or decision text amended to "operator SQL procedure"?
4. `email.outboxRetry` grant: GĐKD-only, or also ke_toan? (Affects m5 detail-body exposure.)
5. Should `sendReceiptEmail` allow an override `to` at all in v1 (audited), given M4 shows the wrong-address case is the realistic one?

---

Status: DONE
Summary: Red-team review of Plan 4 complete — verdict FIX-FIRST: 2 CRITICAL refund-guard gaps (concurrency, never-approved-receipt refund), 7 MAJOR including three false anchors/claims (ke_toan "dead role", outbox null-facility RLS, Receipt.issuedAt); all findings verified against the current tree with file:line evidence.
