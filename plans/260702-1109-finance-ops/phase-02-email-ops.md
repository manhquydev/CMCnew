# Phase 2 — Email Ops (outbox admin surface + receipt email + notif fix)

## Context links
- Report §PLAN 4.2 (email ops).
- Outbox engine: `apps/api/src/services/email-outbox.ts` (5-attempt backoff `MAX_ATTEMPTS=5` :23, `dedupKey`, `SECRET_KINDS` scrub :30-34, `runEmailOutbox` drain).
- Cron drain: `apps/api/src/index.ts:407-413` (every minute, no-op when GRAPH_* unset).
- Templates: `apps/api/src/services/email-templates.ts:5-11` (`EmailTemplateKind` — NO `receipt` kind), `layout()` :38, `BRAND` :18-31.
- Schema: `packages/db/prisma/schema.prisma:755` (`EmailOutbox` — status/attempts/lastError/bodyHtml/scheduledFor/sentAt).
- Under-scoped notif: `apps/api/src/routers/finance.ts:276-291` (`receiptCreate` emits `receipt_pending_approval` to role `ke_toan` ONLY). `ke_toan` IS a live, seeded, grantable role (`seed.ts:119`, grantable via `permissions.ts:296`) and IS in the `receiptApprove` grant (`permissions.ts:132` = `['ke_toan','giam_doc_kinh_doanh']`) — it is NOT dead. The bug is that GĐKD, the other approver, gets no push here. Fix = UNION the recipient set, not replace it.
- GĐKD already sees pending receipts via `dashboard.myApprovals` (`dashboard.ts:204-205` → `receiptPendingItems`) — an inbox surface, separate from push. Dedupe recipient IDs before `emitStaffNotif` so a user holding both roles is not double-notified.
- Perms: `packages/auth/src/permissions.ts` (`finance.*`).

## Overview
The outbox engine is solid but has NO admin read surface (grep confirms `emailOutbox` is never queried outside the worker). Operators cannot see a stuck/failed provisioning email or retry it. This phase adds: (1) a read-only outbox admin surface (list pending/failed + retry), (2) a hard block on retrying ANY secret-kind row (re-provision instead), (3) a new `receipt` template kind + a "send receipt by email" action, (4) widening the `receipt_pending_approval` notif to the UNION of approvers (`ke_toan` ∪ `giam_doc_kinh_doanh`), deduped.

## Key Insights
- **Secret-kind retry is unconditionally blocked**: `SECRET_KINDS` (`otp_login`, `lms_account_ready`) rows are re-provision-only regardless of body state. Scrubbing only happens on terminal transitions (`email-outbox.ts:171,206`), so a failed secret row whose body was NOT scrubbed (rows predating scrub, partial-write, any future path missing `scrubPatch`) would re-send a STALE LIVE secret if we only checked `bodyHtml === ''`. Guard on `templateKind ∈ SECRET_KINDS` alone — body content is irrelevant. Route the operator to a "re-issue" action that re-triggers the ORIGINAL business flow (e.g. re-run provisioning's credential-mint step, which enqueues a fresh secret), never a resend of the old row.
- **Retry = reset, not re-create**: a retry sets `status=queued`, `attempts=0` (or bumps `scheduledFor`), `lastError=null` on the existing row. Do NOT create a new row (would violate the `dedupKey` unique). Let the existing cron worker drain it.
- **No new provider code**: the send path already exists. This phase only adds a read/retry surface + one template kind + a caller. If GRAPH_* is unset, retry re-queues and the worker stays a no-op (safe in prod).
- **Notif fix = widen recipients, not swap**: `receipt_pending_approval` must reach the UNION of the `receiptApprove` grant (`ke_toan` ∪ `giam_doc_kinh_doanh`). Replacing `ke_toan` with GĐKD (as originally drafted) would drop the push to any real kế-toán account. Dedupe IDs before emit; accept GĐKD's push+inbox double-surface (documented) or suppress GĐKD push since myApprovals already covers it — default: union+dedupe, keep push.

## Requirements
- New perms `email.outboxList`, `email.outboxRetry` → `['giam_doc_kinh_doanh']`. Default GĐKD-only. If `ke_toan` gets the read grant, the null-facility director-only filter (above) and the non-secret-detail-body rule still apply — but `payroll`/`account_welcome` staff-PII rows should then be excluded from ke_toan's view. Keep GĐKD-only in v1 to avoid that branch (YAGNI).
- Query `email.outboxList({ status?, facilityId?, cursor? })`: returns id, toAddress, templateKind, subject, status, attempts, lastError, scheduledFor, sentAt, createdAt. **RLS will NOT hide system rows** — the real policy (`migrations/20260626150000_email_outbox/migration.sql:36-46`) admits ANY staff to `facility_id IS NULL` rows (welcome/OTP → cross-facility PII in `toAddress`). Add an EXPLICIT app-layer filter: `facilityId: { not: null }` is excluded unless the caller is a director/super-admin. Do not rely on RLS for the null-facility guarantee. Never return `bodyHtml` in the list; a detail fetch may return it only for NON-secret kinds.
- Mutation `email.outboxRetry({ id })`: only `status IN (failed)`; if `templateKind ∈ SECRET_KINDS` → REJECT UNCONDITIONALLY (regardless of scrubbed/intact body) with a clear message ("email chứa bí mật không thể gửi lại; hãy dùng 'Cấp lại' để phát hành lại tài khoản"). Otherwise reset to `queued`, `attempts=0`, `lastError=null`, `scheduledFor=now`; `logEvent` the retry.
- "Re-issue" (secret rows): surface a separate action that re-triggers the ORIGINAL business flow (re-run provisioning's credential-mint, which enqueues a fresh secret under a new dedupKey) — NOT a resend of the stored row. May live in the user/provisioning surface; the outbox panel only links/points to it.
- New template kind `receipt` in `EmailTemplateKind` + `TemplatePayloads` + `renderTemplate` case (payload: receiptCode, netAmount, studentName, facilityName, approvedAt; reuse `layout()`/`BRAND`). Non-secret → not added to `SECRET_KINDS`.
- Action `finance.sendReceiptEmail({ receiptId, to? })`: resolve recipient email → `enqueueEmail`. **dedupKey must not block a corrected re-send**: `enqueueEmail` silently swallows the P2002 unique violation (`email-outbox.ts:70-74`) and retry refuses non-failed rows, so a receipt sent to a typo'd address is otherwise unrecoverable. Include the target in the key (`receipt:<receiptId>:<sha of to>`) so a different/corrected address enqueues a fresh row, OR keep `receipt:<id>` plus an explicit staff-initiated "gửi lại" path that bypasses dedup deliberately (audited). Automatic re-send stays a no-op; corrected re-send is a deliberate action. Only for `status IN (approved,sent,reconciled)`; `logEvent`. Surface "đã gửi tới X lúc T" in the UI instead of a silent success.
- Recipient resolution: `receipt.parentEmail` is populated only on new-student receipts (`schema.prisma:1063`); renewals resolve via student→guardian→parent_account. Identity tables are global-RLS (no facility scope), so scope comes from the student join; validate the resolved address belongs to the receipt's facility context before send.
- Fix `finance.ts:281-291`: compute `recipientIds` as the UNION of `ke_toan` ∪ `giam_doc_kinh_doanh` holders in the facility (mirror the `receiptApprove` grant `permissions.ts:132`), dedupe the IDs before `emitStaffNotif`, keep the facility scoping. Do NOT drop `ke_toan`. Verify at least one approver is seeded per facility.
- Outbox admin surface: a new admin component (own file, NOT finance-panel — P1 owns that) — a table with status filter, lastError column, retry button (disabled + tooltip for scrubbed-secret rows), and a "gửi phiếu qua email" button on the receipt row/detail wired to `sendReceiptEmail`.

## Architecture
Data flow (retry): admin table → `email.outboxRetry` (block if `kind ∈ SECRET_KINDS`; else reset row to queued) → existing cron `runEmailOutbox` (index.ts:407) drains next tick → Graph or no-op. Secret rows route to re-issue (re-mint), never resend. Data flow (send receipt): finance UI → `finance.sendReceiptEmail` → `enqueueEmail` (renders now, stores self-contained row) → same cron drains. No change to the worker or provider. The `receipt` kind is additive to the discriminated union; `renderTemplate` gains one case — exhaustiveness check will flag if a case is missed.

## Related code files
- MODIFY `apps/api/src/services/email-templates.ts` (add `receipt` to `EmailTemplateKind`, `TemplatePayloads`, `renderTemplate`).
- MODIFY `apps/api/src/routers/finance.ts` (widen notif recipients :281-291 to ke_toan∪GĐKD deduped; add `sendReceiptEmail`).
- CREATE `apps/api/src/routers/email.ts` (outbox `outboxList`/`outboxRetry`) + register in root router.
- MODIFY `packages/auth/src/permissions.ts` (2 new `email.*` perms).
- CREATE admin surface component (e.g. `apps/admin/src/email-outbox-panel.tsx`) + route entry.
- MODIFY receipt row/detail UI (send-by-email button) — file owned by P1's finance-panel; SERIALIZE after P1 lands, or place the button in the new email panel keyed by receiptId to avoid the same-file edit.

## Implementation Steps
1. Widen notif recipients to `ke_toan` ∪ `giam_doc_kinh_doanh` (deduped); verify ≥1 approver seeded per facility.
2. Add `receipt` template kind + payload + render case + a snapshot of the rendered HTML in the int test.
3. Add `email.*` perms; create `email` router (`outboxList` read-only, `outboxRetry` with scrubbed-secret guard) + audit.
4. Add `finance.sendReceiptEmail` (approved-only, dedupKey, audit).
5. Build the outbox admin surface (status filter, lastError, retry with disabled-for-scrubbed tooltip) + send-receipt button.

## Todo list
- [ ] notif recipients = ke_toan ∪ GĐKD (deduped) + approver-seeded verification
- [ ] `receipt` template kind + payload (approvedAt) + render case
- [ ] `email.*` perms + `email` router (list w/ app-layer null-facility filter + secret-kind-blocked retry) + audit
- [ ] `finance.sendReceiptEmail` (versioned/force-able dedupKey, recipient resolution, approved-only, audit)
- [ ] admin outbox surface + send-receipt button + link to re-issue for secret rows

## Success Criteria
- A failed provisioning email is visible in the admin surface with its `lastError`.
- Retrying a non-secret failed row re-queues it; the worker drains it next tick.
- Retrying ANY secret-kind row is BLOCKED (whether body is scrubbed or intact); operator is routed to re-issue. A never-scrubbed failed secret row is also blocked.
- Null-facility system rows (welcome/OTP) are hidden from a non-director staff caller by the app-layer filter, not just RLS.
- A parent can receive an approved receipt by email; automatic re-send is a no-op, but a corrected-address re-send succeeds via the versioned key or explicit force path.
- `receipt_pending_approval` reaches BOTH ke_toan and GĐKD holders (deduped), verified by a seeded query.

## Risk Assessment
- **Stale-secret re-send (High×High)**: a failed but UN-scrubbed secret row would resend a live OTP/temp password if only `bodyHtml===''` were checked → mitigate by blocking retry on `templateKind ∈ SECRET_KINDS` unconditionally; re-issue re-mints instead.
- **PII leak via list (Med×High)**: current RLS admits all staff to null-facility rows (welcome/OTP toAddress) → mitigate with an EXPLICIT app-layer director-only filter on null-facility rows; never return `bodyHtml` in list; detail body only for non-secret kinds.
- **Corrected re-send blocked (Med×High)**: `receipt:<id>` dedupKey + silent P2002 swallow makes a typo'd-address receipt unrecoverable → mitigate with target-in-key or an explicit force-resend path.
- **Notif recipient (Low)**: union stays per-facility (existing `where facilityId`), deduped IDs → no spam, unchanged blast radius; do not drop ke_toan.

## Security Considerations
- Retry refuses ALL secret-kind rows unconditionally; secrets are re-minted via re-issue, never resent.
- `sendReceiptEmail` recipient defaults to the resolved payer; an override/force `to` must be perm-gated and audited (this is the realistic wrong-address fix path).
- All list/retry/send are perm-gated; null-facility rows filtered to directors at the app layer (RLS alone admits all staff); no raw `bodyHtml` over the wire in lists.

## Rollback
- No schema change → revert is pure code. Remove `email` router registration, revert template union (safe: no stored row references a removed kind if none were enqueued), revert notif recipient line. If `receipt` rows were enqueued, they remain valid rows; leave the render case until drained.

## Next steps
P3 (revenue report + reconciliation worklist) — independent of email; new components only, no finance-panel edit.
