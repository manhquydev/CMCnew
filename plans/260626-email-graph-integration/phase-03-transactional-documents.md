# Phase 03 — Transactional document emails (payslip)

**Goal:** Email the staff member when their payslip is finalized.

> **Scope decision 2026-06-26:** Receipt (phiếu thu) and certificate emails are **DEFERRED** at the
> user's request — design retained below for a later round, but NOT implemented now. v1 ships only
> the **payslip_ready** email. The `parent-email.ts` helper is still built here (Phase 05 needs it).

**Depends on:** Phase 01. **Risk:** Public contracts (adds side-effects to existing procedures).

## Anchor points (from audit)

| Document | Created/finalized at | Existing render | Recipient |
|----------|----------------------|-----------------|-----------|
| Payslip | `payroll.ts:439–449` `payslipFinalize` | — (HTML render TBD) | Staff (`AppUser.email`), `payroll` mailbox |
| Receipt | `finance.ts:264` `receiptApprove` | `services/receipt-html.ts`, served at `/files/receipt/:id` | Parent (`ParentAccount.email`), `notify` |
| Certificate | `certificate.ts:34` issue | `services/certificate-html.ts`, served at `/files/certificate/:id` | Parent (`ParentAccount.email`), `notify` |

## Work items

1. **Email contains a secure link, not the raw document**, to avoid mailing sensitive PDFs and to
   reuse the existing RLS-guarded `/files/...` endpoints. For external recipients (parent on Gmail),
   the link requires LMS login — acceptable and more secure. *Decision to confirm with user:* link vs
   attached PDF for receipts/certificates (attachment is friendlier but heavier; see open question).
2. **payroll.ts `payslipFinalize`**: after finalize, resolve the staff `AppUser.email`; if present →
   `enqueueEmail(tx, { dedupKey:'payslip_ready:'+payslipId, mailbox:'payroll', templateKind:'payslip_ready', … })`.
3. **finance.ts `receiptApprove`**: resolve the student's parent (`Guardian → ParentAccount.email`);
   if present → enqueue `receipt_approved` (link to `/files/receipt/:id`).
4. **certificate.ts** issue: resolve parent email → enqueue `certificate_issued` (link to `/files/certificate/:id`).
5. **Templates**: `payslip_ready`, `receipt_approved`, `certificate_issued` (Vietnamese).
6. **Parent resolution helper** `apps/api/src/lib/parent-email.ts`: `parentEmailForStudent(tx, studentId)`
   → walks `Guardian → ParentAccount.email` (primary guardian; null-safe). Reused by Phases 03 & 05.

## Tests
- `payslipFinalize` enqueues exactly one `payslip_ready` to the staff email; no email when email null.
- `receiptApprove` enqueues `receipt_approved` to the parent; re-approve is idempotent (`dedupKey`).
- Certificate issue enqueues to parent; student with no parent email → no email, no error.
- Each enqueue is inside the business txn: if the business write rolls back, no outbox row remains.

## Risks / rollback
- These procedures gain a side-effect. Keep it **best-effort & non-blocking**: a failure to resolve
  an email must NOT fail the payslip/receipt/certificate action (wrap resolution defensively; only the
  enqueue participates in the txn, and enqueue can't fail except on dedup which is swallowed).
- Rollback: remove the enqueue calls; document procedures unchanged otherwise.
