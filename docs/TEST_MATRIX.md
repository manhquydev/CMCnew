# Test Matrix

This file maps product behavior to proof.

## Status Values

| Status | Meaning |
| --- | --- |
| planned | Accepted as intended behavior, not implemented |
| in_progress | Actively being built |
| implemented | Implemented and proof exists |
| changed | Contract changed after earlier implementation |
| retired | No longer part of the product contract |

## Matrix

| Story | Contract | Unit | Integration | E2E | Platform | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-RLS-COV | RLS coverage — every facility-scoped table is isolated | no | yes | no | no | implemented | `apps/api/test/rls-coverage.int.test.ts` |
| SEC-RLS-TEN | RLS isolation — facility + principal (tenancy invariant) | no | yes | no | no | implemented | `apps/api/test/rls-tenancy.int.test.ts` |
| SEC-GUARD | Guardian principal isolation: own children only, cross-facility blocked (G1–G6) | no | yes | no | no | implemented | `apps/api/test/guardian-principal-isolation.int.test.ts` |
| SEC-AUD-FOL | audit.follow — facility-scoped visibility gate (tenancy) | no | yes | no | no | implemented | `apps/api/test/audit-follow-visibility.int.test.ts` |
| SEC-AUD-NOTE | audit.postNote — facility resolved server-side from the entity (tenancy) | no | yes | no | no | implemented | `apps/api/test/audit-postnote-tenancy.int.test.ts` |
| ACA-CADENCE | Parent-meeting auto-cadence generation (T13) | no | yes | no | no | implemented | `apps/api/test/parent-meeting-cadence-autogen.int.test.ts` |
| ACA-REMIND | Parent-meeting reminder idempotency (remindedAt dedup) | no | yes | no | no | implemented | `apps/api/test/parent-meeting-reminder-idempotency.int.test.ts` |
| ACA-TBD | Parent-meeting time TBD state | no | yes | no | no | implemented | `apps/api/test/parent-meeting-time-tbd.int.test.ts` |
| ACA-CLOSE | Class terminal state soft-cancels future parent meetings | no | yes | no | no | implemented | `apps/api/test/class-close-cancels-future-meetings.int.test.ts` |
| ACA-REOPEN | Class reopen restores future soft-cancelled parent meetings | no | yes | no | no | implemented | `apps/api/test/class-reopen-restores-meetings.int.test.ts` |
| ACA-WARN | Parent-meeting warns on unknown program (no cadence configured) | no | yes | no | no | implemented | `apps/api/test/parent-meeting-unknown-program-warns.int.test.ts` |
| AFS-LIFECYCLE | After-sale case: lifecycle transitions and student lifecycle change | no | yes | no | no | implemented | `apps/api/test/aftersale-student-lifecycle.int.test.ts` |
| FIN-VOUCHER | Voucher atomic consume (money invariant) | no | yes | no | no | implemented | `apps/api/test/voucher-atomic.int.test.ts` |
| FIN-VOW-WIN | receiptCreate — voucher validity window enforced early (T4) | no | yes | no | no | implemented | `apps/api/test/voucher-window-fail-early.int.test.ts` |
| FIN-RECEIPT | Receipt-kind-classification: history fallback (no opportunityId) | no | yes | no | no | implemented | `apps/api/test/receipt-kind-classification.int.test.ts` |
| FIN-COMM | Commission-for-sale: E2E attribution & computation | no | yes | no | no | implemented | `apps/api/test/commission-for-sale-e2e.int.test.ts` |
| PAY-FINAL | Payslip finalize gating + amount freeze (payroll invariant) | no | yes | no | no | implemented | `apps/api/test/payroll-finalize.int.test.ts` |
| PAY-MYSLIP | Payroll: myPayslips IDOR guard + draft visibility + bulk pay + period summary | no | yes | no | no | implemented | `apps/api/test/payroll-myslips-bulk.int.test.ts` |
| LMS-BADGE | Badge auto-award idempotency on grade publish | no | yes | no | no | implemented | `apps/api/test/badge-auto-award-idempotency.int.test.ts` |
| LMS-ASSESS | computeFinalGrade published-only filter (assessment invariant) | no | yes | no | no | implemented | `apps/api/test/assessment-final-grade-publish.int.test.ts` |
| LMS-LEVEL | Level-progress propose/decide authz (Phase 2 §2.10 invariant) | no | yes | no | no | implemented | `apps/api/test/level-progress-authz.int.test.ts` |
| LMS-NO-CERT | Level-up approve: updates level, does NOT auto-issue certificate (decision 0008) | no | yes | no | no | implemented | `apps/api/test/level-up-no-auto-certificate.int.test.ts` |
| LMS-STAR | Star redeem atomic (rewards invariant) | no | yes | no | no | implemented | `apps/api/test/star-redeem.int.test.ts` |
| LMS-REWARD | Reward review refund (rewards invariant) | no | yes | no | no | implemented | `apps/api/test/reward-review-refund.int.test.ts` |
| CRM-HOOKS | CRM auto-hooks + lead-ingest token | no | yes | no | no | implemented | `apps/api/test/crm-hooks.int.test.ts` |
| CRM-BATCH | Batch code atomicity (concurrent generation) | no | yes | no | no | implemented | `apps/api/test/batch-code-atomicity.int.test.ts` |

## Evidence Rules

- Unit proof covers pure domain and application rules.
- Integration proof covers backend enforcement, data integrity, provider
  behavior, jobs, or service contracts.
- E2E proof covers user-visible browser flows.
- Platform proof covers only shell, deployment, mobile, desktop, or runtime
  behavior that cannot be proven in lower layers.
- A story can be implemented without every proof column if the story packet
  explains why.
