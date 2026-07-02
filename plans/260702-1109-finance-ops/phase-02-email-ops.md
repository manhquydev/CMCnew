# Phase 2 — Email Ops (outbox admin surface + receipt email + notif fix)

## Context links
- Report §PLAN 4.2 (email ops).
- Outbox engine: `apps/api/src/services/email-outbox.ts` (5-attempt backoff `MAX_ATTEMPTS=5` :23, `dedupKey`, `SECRET_KINDS` scrub :30-34, `runEmailOutbox` drain).
- Cron drain: `apps/api/src/index.ts:407-413` (every minute, no-op when GRAPH_* unset).
- Templates: `apps/api/src/services/email-templates.ts:5-11` (`EmailTemplateKind` — NO `receipt` kind), `layout()` :38, `BRAND` :18-31.
- Schema: `packages/db/prisma/schema.prisma:755` (`EmailOutbox` — status/attempts/lastError/bodyHtml/scheduledFor/sentAt).
- Dead notif: `apps/api/src/routers/finance.ts:276-291` (`receiptCreate` emits `receipt_pending_approval` to role `ke_toan` — a role NO ONE holds → notif is dead).
- Perms: `packages/auth/src/permissions.ts` (`finance.*`).

## Overview
The outbox engine is solid but has NO admin read surface (grep confirms `emailOutbox` is never queried outside the worker). Operators cannot see a stuck/failed provisioning email or retry it. This phase adds: (1) a read-only outbox admin surface (list pending/failed + retry), (2) a scrubbed-secret warning so retrying a terminally-failed secret email does not send a blank body, (3) a new `receipt` template kind + a "send receipt by email" action, (4) a fix for the dead `ke_toan` notif recipient → GĐKD (`giam_doc_kinh_doanh`).

## Key Insights
- **Retry semantics**: `SECRET_KINDS` (`otp_login`, `lms_account_ready`) have their `bodyHtml` scrubbed to `''` once terminal. Retrying these delivers a BLANK email — the fix is to WARN + block naive retry, and route the operator to re-provision (which re-enqueues with a fresh secret) instead of re-sending the empty row.
- **Retry = reset, not re-create**: a retry sets `status=queued`, `attempts=0` (or bumps `scheduledFor`), `lastError=null` on the existing row. Do NOT create a new row (would violate the `dedupKey` unique). Let the existing cron worker drain it.
- **No new provider code**: the send path already exists. This phase only adds a read/retry surface + one template kind + a caller. If GRAPH_* is unset, retry re-queues and the worker stays a no-op (safe in prod).
- **Notif fix is a one-line recipient change** but is Existing-behavior + Audit-adjacent: `receipt_pending_approval` should reach GĐKD (who actually approves), matching the Plan 3 director-ownership model.

## Requirements
- New perms `email.outboxList`, `email.outboxRetry` → `['giam_doc_kinh_doanh']` (+ `ke_toan` for read if a finance clerk should monitor; confirm with existing finance role grants). Reuse existing `finance.*` grantee set for consistency.
- Query `email.outboxList({ status?, facilityId?, cursor? })`: returns id, toAddress, templateKind, subject, status, attempts, lastError, scheduledFor, sentAt, createdAt. RLS-scoped by facilityId (null-facility rows = system, super-admin only). Never return `bodyHtml` in the list (may contain PII / rendered secrets); a detail fetch may return it only for NON-secret kinds.
- Mutation `email.outboxRetry({ id })`: only `status IN (failed)`; if `templateKind ∈ SECRET_KINDS` AND `bodyHtml === ''` → REJECT with a clear message ("nội dung chứa bí mật đã bị xoá, hãy cấp lại tài khoản để gửi lại"). Otherwise reset to `queued`, `attempts=0`, `lastError=null`, `scheduledFor=now`; `logEvent` the retry.
- New template kind `receipt` in `EmailTemplateKind` + `TemplatePayloads` + `renderTemplate` case (payload: receiptCode, netAmount, studentName, facilityName, issuedAt; reuse `layout()`/`BRAND`). Non-secret → not added to `SECRET_KINDS`.
- Action `finance.sendReceiptEmail({ receiptId, to? })`: resolve payer email (default) → `enqueueEmail(tx, { kind:'receipt', dedupKey:'receipt:<receiptId>', to, mailbox:'notify', data })` inside its own txn; only for `status IN (approved,sent,reconciled)`; `logEvent`. Idempotent via dedupKey (re-send = no-op unless requeued).
- Fix `finance.ts:281-283`: filter `roles.includes('giam_doc_kinh_doanh')` instead of `'ke_toan'` (keep the facility scoping). Verify a GĐKD is seeded per facility so the notif lands.
- Outbox admin surface: a new admin component (own file, NOT finance-panel — P1 owns that) — a table with status filter, lastError column, retry button (disabled + tooltip for scrubbed-secret rows), and a "gửi phiếu qua email" button on the receipt row/detail wired to `sendReceiptEmail`.

## Architecture
Data flow (retry): admin table → `email.outboxRetry` (guard scrubbed-secret → reset row to queued) → existing cron `runEmailOutbox` (index.ts:407) drains next tick → Graph or no-op. Data flow (send receipt): finance UI → `finance.sendReceiptEmail` → `enqueueEmail` (renders now, stores self-contained row) → same cron drains. No change to the worker or provider. The `receipt` kind is additive to the discriminated union; `renderTemplate` gains one case — exhaustiveness check will flag if a case is missed.

## Related code files
- MODIFY `apps/api/src/services/email-templates.ts` (add `receipt` to `EmailTemplateKind`, `TemplatePayloads`, `renderTemplate`).
- MODIFY `apps/api/src/routers/finance.ts` (fix notif recipient :281-283; add `sendReceiptEmail`).
- CREATE `apps/api/src/routers/email.ts` (outbox `outboxList`/`outboxRetry`) + register in root router.
- MODIFY `packages/auth/src/permissions.ts` (2 new `email.*` perms).
- CREATE admin surface component (e.g. `apps/admin/src/email-outbox-panel.tsx`) + route entry.
- MODIFY receipt row/detail UI (send-by-email button) — file owned by P1's finance-panel; SERIALIZE after P1 lands, or place the button in the new email panel keyed by receiptId to avoid the same-file edit.

## Implementation Steps
1. Fix the dead notif recipient (`ke_toan` → `giam_doc_kinh_doanh`); verify a GĐKD exists per facility.
2. Add `receipt` template kind + payload + render case + a snapshot of the rendered HTML in the int test.
3. Add `email.*` perms; create `email` router (`outboxList` read-only, `outboxRetry` with scrubbed-secret guard) + audit.
4. Add `finance.sendReceiptEmail` (approved-only, dedupKey, audit).
5. Build the outbox admin surface (status filter, lastError, retry with disabled-for-scrubbed tooltip) + send-receipt button.

## Todo list
- [ ] notif recipient fix + GĐKD-seeded verification
- [ ] `receipt` template kind + payload + render case
- [ ] `email.*` perms + `email` router (list + guarded retry) + audit
- [ ] `finance.sendReceiptEmail` (dedupKey, approved-only, audit)
- [ ] admin outbox surface + send-receipt button

## Success Criteria
- A failed provisioning email is visible in the admin surface with its `lastError`.
- Retrying a non-secret failed row re-queues it; the worker drains it next tick.
- Retrying a scrubbed-secret row is BLOCKED with a clear re-provision message (never sends blank).
- A parent can receive an approved receipt by email; re-send with same receipt is a no-op (dedupKey).
- `receipt_pending_approval` reaches a real recipient (GĐKD), verified by a seeded query.

## Risk Assessment
- **Blank-secret send (Med×High)**: retrying scrubbed row → blank email → mitigate with the explicit `SECRET_KINDS` + empty-body guard that blocks and routes to re-provision.
- **PII leak via list (Med×High)**: `bodyHtml` may hold PII/secret → never return it in list; detail returns body only for non-secret kinds; RLS on facilityId; system (null-facility) rows super-admin only.
- **Notif over-broad (Low)**: changing recipient role could spam if GĐKD count is large → scope stays per-facility (existing `where facilityId`), unchanged blast radius.
- **dedupKey collision (Low)**: re-send uses stable `receipt:<id>` → intended no-op, not an error.

## Security Considerations
- Retry never exposes or reconstructs a scrubbed secret; it refuses.
- `sendReceiptEmail` recipient defaults to the bound payer; an override `to` (if allowed) must be perm-gated and audited.
- All list/retry/send are perm-gated + RLS-scoped; no raw `bodyHtml` over the wire in lists.

## Rollback
- No schema change → revert is pure code. Remove `email` router registration, revert template union (safe: no stored row references a removed kind if none were enqueued), revert notif recipient line. If `receipt` rows were enqueued, they remain valid rows; leave the render case until drained.

## Next steps
P3 (revenue report + reconciliation worklist) — independent of email; new components only, no finance-panel edit.
