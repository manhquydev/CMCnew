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
| LMS-SESSION-EVIDENCE | Session 360 vertical slice: class create can create first schedule slot; post-class evidence cards are mock pending persisted LMS evidence | no | yes | no | no | planned | `apps/api/test/class-create-initial-slot.int.test.ts`; `docs/stories/LMS-SESSION-EVIDENCE/` |
| LMS-STAR | Star redeem atomic (rewards invariant) | no | yes | no | no | implemented | `apps/api/test/star-redeem.int.test.ts` |
| LMS-REWARD | Reward review refund (rewards invariant) | no | yes | no | no | implemented | `apps/api/test/reward-review-refund.int.test.ts` |
| CRM-HOOKS | CRM auto-hooks + lead-ingest token | no | yes | no | no | implemented | `apps/api/test/crm-hooks.int.test.ts` |
| CRM-BATCH | Batch code atomicity (concurrent generation) | no | yes | no | no | implemented | `apps/api/test/batch-code-atomicity.int.test.ts` |
| CRM-SALESOPS | Sales-ops: opportunity assignment log + reassign (manager-only, owner validated), channel attribution, lost-reason enum, hot-table indexes | no | yes | no | no | implemented | `apps/api/test/crm-sales-ops.int.test.ts` |
| BELL-NOTIF | Bell icon shows unread badge from polling; dropdown lists notifications and marks all read (unified admin staff shell) | no | no | no — not covered by current E2E specs | no | implemented | `apps/admin/src/shell.tsx`, `packages/ui/src/use-staff-notif.ts` |
| HR-PANEL-UI | Admin HR tab renders staff roster table; clicking a row opens payslip drawer with bulk-pay | no | no | planned — admin-hr-panel.spec.ts | no | implemented | `apps/admin/src/payroll-panel.tsx` (StaffTable + StaffDetailDrawer) |
| TEACH-SHELL | Grouped NavLink sidebar in the unified admin staff shell (back-office + teaching-origin modules under one role-filtered nav). _apps/teaching retired; consolidated into apps/admin._ | no | no | yes — `apps/e2e/tests/unified-staff-shell.spec.ts` | no | changed | `apps/admin/src/shell.tsx` |
| DOCKER-PROD | Each app builds as a self-contained Docker image; nginx reverse proxies /api to api container and serves SPA bundles | no | no | no — infra only | no | implemented | `apps/*/Dockerfile`, `docker/docker-compose.prod.yml`, `docker/nginx.conf` |
| TEACH-PAGINATE | Class list shows at most 20 rows per page; search input resets to page 1; Pagination navigates pages. _apps/teaching retired; ported into admin class workspace._ | no | no | no — not covered by current E2E specs | no | changed | `apps/admin/src/class-workspace.tsx` (PAGE_SIZE=20, classPage, setClassPage, Pagination) |

## Evidence Rules

- Unit proof covers pure domain and application rules.
- Integration proof covers backend enforcement, data integrity, provider
  behavior, jobs, or service contracts.
- E2E proof covers user-visible browser flows.
- Platform proof covers only shell, deployment, mobile, desktop, or runtime
  behavior that cannot be proven in lower layers.
- A story can be implemented without every proof column if the story packet
  explains why.
