# Story Backlog

## Candidate Epics

| Epic | Description | Status |
| --- | --- | --- |
| E01-security-rls | RLS tenancy, coverage, guardian isolation, audit visibility | sliced |
| E02-lms-assessment | Grades, badges, level progress, certificates | sliced |
| E03-lms-parent | Parent meetings, cadence, reminders, class lifecycle | sliced |
| E04-finance | Receipts, vouchers, commissions | sliced |
| E05-payroll | Payslip lifecycle, bulk pay, myslips IDOR | sliced |
| E06-rewards | Stars, redemption, reward review | sliced |
| E07-crm-aftersale | CRM hooks, batch codes, after-sale lifecycle | sliced |

## Implemented Stories (evidence: int-test)

| ID | Title | Lane | Epic | Evidence file |
| --- | --- | --- | --- | --- |
| SEC-RLS-COV | RLS coverage: every facility-scoped table is isolated | normal | E01-security-rls | `apps/api/test/rls-coverage.int.test.ts` |
| SEC-RLS-TEN | RLS isolation: facility + principal tenancy invariant | normal | E01-security-rls | `apps/api/test/rls-tenancy.int.test.ts` |
| SEC-GUARD | Guardian principal isolation: own children only, cross-facility blocked | normal | E01-security-rls | `apps/api/test/guardian-principal-isolation.int.test.ts` |
| SEC-AUD-FOL | audit.follow blocked by facility-scoped visibility gate | normal | E01-security-rls | `apps/api/test/audit-follow-visibility.int.test.ts` |
| SEC-AUD-NOTE | audit.postNote facilityId sourced from server session, not client | normal | E01-security-rls | `apps/api/test/audit-postnote-tenancy.int.test.ts` |
| ACA-CADENCE | Parent meetings auto-generated on program cadence (T13) | normal | E03-lms-parent | `apps/api/test/parent-meeting-cadence-autogen.int.test.ts` |
| ACA-REMIND | Parent meeting reminders are idempotent (remindedAt dedup) | normal | E03-lms-parent | `apps/api/test/parent-meeting-reminder-idempotency.int.test.ts` |
| ACA-TBD | Auto-gen meetings set time-TBD until staff confirms | normal | E03-lms-parent | `apps/api/test/parent-meeting-time-tbd.int.test.ts` |
| ACA-CLOSE | Class close (terminal state) soft-cancels future parent meetings | normal | E03-lms-parent | `apps/api/test/class-close-cancels-future-meetings.int.test.ts` |
| ACA-REOPEN | Class reopen restores previously soft-cancelled parent meetings | normal | E03-lms-parent | `apps/api/test/class-reopen-restores-meetings.int.test.ts` |
| ACA-WARN | Unknown program cadence emits warning, not exception | normal | E03-lms-parent | `apps/api/test/parent-meeting-unknown-program-warns.int.test.ts` |
| AFS-LIFECYCLE | AfterSale case lifecycle + student lifecycle transitions | normal | E07-crm-aftersale | `apps/api/test/aftersale-student-lifecycle.int.test.ts` |
| FIN-VOUCHER | Voucher consume is atomic: concurrent use yields 1 ok, 1 CONFLICT | normal | E04-finance | `apps/api/test/voucher-atomic.int.test.ts` |
| FIN-VOW-WIN | Out-of-window vouchers rejected at receipt create (T4) | normal | E04-finance | `apps/api/test/voucher-window-fail-early.int.test.ts` |
| FIN-RECEIPT | Receipt kind classified correctly (new/renewal/win-back) | normal | E04-finance | `apps/api/test/receipt-kind-classification.int.test.ts` |
| FIN-COMM | Commission attribution and computation end-to-end | normal | E04-finance | `apps/api/test/commission-for-sale-e2e.int.test.ts` |
| PAY-FINAL | Payslip finalize gate: amount freezes, PIT is marginal | normal | E05-payroll | `apps/api/test/payroll-finalize.int.test.ts` |
| PAY-MYSLIP | myPayslips IDOR guard + bulk payment + period summary | normal | E05-payroll | `apps/api/test/payroll-myslips-bulk.int.test.ts` |
| LMS-BADGE | Badge auto-award is idempotent on grade publish | normal | E02-lms-assessment | `apps/api/test/badge-auto-award-idempotency.int.test.ts` |
| LMS-ASSESS | Final grade publish: published-only filter enforced | normal | E02-lms-assessment | `apps/api/test/assessment-final-grade-publish.int.test.ts` |
| LMS-LEVEL | Level progress propose/decide authz (Phase 2 §2.10 invariant) | normal | E02-lms-assessment | `apps/api/test/level-progress-authz.int.test.ts` |
| LMS-NO-CERT | Level-up does not auto-issue certificate (decision 0008) | normal | E02-lms-assessment | `apps/api/test/level-up-no-auto-certificate.int.test.ts` |
| LMS-STAR | Star redemption is atomic (no double-spend) | normal | E06-rewards | `apps/api/test/star-redeem.int.test.ts` |
| LMS-REWARD | Reward review + star refund on rejection | normal | E06-rewards | `apps/api/test/reward-review-refund.int.test.ts` |
| CRM-HOOKS | CRM stage hooks fire on opportunity transitions | normal | E07-crm-aftersale | `apps/api/test/crm-hooks.int.test.ts` |
| CRM-BATCH | Batch code counter is atomic (concurrent generation) | normal | E07-crm-aftersale | `apps/api/test/batch-code-atomicity.int.test.ts` |
| BELL-NOTIF | Staff bell notification: SSE-fed unread badge + dropdown in admin and teaching shells | normal | UI/Infra | `packages/ui/src/use-staff-notif.ts`, `apps/admin/src/shell.tsx`, `apps/teaching/src/shell.tsx` |
| HR-PANEL-UI | Admin HR panel: StaffTable roster view + StaffDetailDrawer with payslip list and bulk-pay | normal | UI/Infra | `apps/admin/src/payroll-panel.tsx`, `apps/api/src/routers/payroll.ts` |
| TEACH-SHELL | Teaching AppShell: grouped NavLink sidebar wired into App.tsx replacing flat Workbench layout | normal | UI/Infra | `apps/teaching/src/shell.tsx`, `apps/teaching/src/App.tsx` |
| DOCKER-PROD | Full-stack Docker production setup: per-app Dockerfiles, docker-compose.prod.yml, nginx reverse proxy | normal | UI/Infra | `apps/*/Dockerfile`, `docker/docker-compose.prod.yml`, `docker/nginx.conf` |
| TEACH-PAGINATE | Teaching class list: PAGE_SIZE=20 pagination, Pagination component, search filter with page-reset | normal | UI/Infra | `apps/teaching/src/App.tsx` (Workspace: classPage, setClassPage, Pagination) |
