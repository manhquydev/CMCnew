# Summary

Date: 2026-06-27

## Execution

- Requested: `ck:cook` + Harness-compliant parallel `ck:code-review` across whole project with 10 independent agents.
- Actual: 10 independent read-only reviewer agents completed.
- Concurrency: runtime allowed 6 concurrent agents, so work ran in batches. Two batch-2 agents disappeared from runtime and were relaunched for the same missing scopes.
- Output folder: `plans/reports/20260627-103314-10-agent-code-review/`.
- Product code changed: none.
- Tests run: none for this audit; reviewers were read-only and most integration/E2E suites mutate DB/browser state.
- Harness intake: #15.

## Top Risks

### Critical/High Cluster: Authorization and privacy boundaries

- Student detail is too broad for any authenticated staff, exposing guardian PII, receipts, grades, and LMS account metadata.
- Submission APIs return unpublished grade fields even though UI hides them.
- Students can submit to unpublished exercises by direct ID.
- Staff notification RLS is facility-only, relying on route-level recipient filters.
- Payroll RLS does not enforce payroll secrecy promised by spec.
- Admin hash deep links can render hidden panels outside nav gating.

### Critical/High Cluster: Money, KPI, and attribution integrity

- Receipt commission attribution can point to unrelated opportunities.
- CRM users can set arbitrary opportunity owner and affect commission.
- KPI revenue prefill excludes sent/reconciled receipts while commission includes them.
- KPI confirm/approve lacks manager-tree/self checks.
- Approved KPI can still be overridden.

### Critical/High Cluster: Academic/LMS data correctness

- Attendance can attach an enrollment to the wrong class session.
- Class reopen can restore manually-cancelled future sessions/meetings.
- Class lifecycle date cutoff uses UTC, not ICT business day.
- Grade score can exceed exercise maxScore.
- Term lock only blocks final-grade recompute, not source grade/qualitative edits.

### Critical/High Cluster: DB and async operational safety

- Facility-scoped code counters collide with globally unique class/receipt codes.
- OTP request can return success when Graph email send fails.
- Email outbox claim is not DB-safe across multiple API replicas.
- Public CRM lead ingest is unthrottled and caller chooses facility.

### Governance and proof gaps

- App topology docs still reference retired `apps/teaching`.
- Test matrix and roadmap overstate E2E/browser proof.
- CI omits lint and Playwright E2E.
- Production SSO/Graph env docs/templates are incomplete.

## Counts By Severity

Approximate after dedupe:

- High: 28
- Medium: 25
- Resolved during report creation: 1

## Recommended Fix Order

1. Lock auth/privacy leaks: student detail permissions, unpublished grade suppression, draft exercise submission rejection, staff notification RLS, OTP dev/failure behavior.
2. Lock money/KPI integrity: opportunity ownership/receipt attribution, KPI workflow tree checks, KPI revenue status parity, approved KPI immutability.
3. Lock academic correctness: attendance tuple validation/DB constraint, reopen provenance, ICT cutoff, grade maxScore, term-lock source mutation policy.
4. Lock DB invariants: facility code uniqueness strategy, payroll role-aware RLS, grading template nullable uniqueness, DB checks for money/score ranges.
5. Lock async/deploy: outbox multi-replica claim, Callio retry/backoff, production env template/compose, lead ingest rate limiting.
6. Align docs/CI/proof: remove stale teaching topology, fix test matrix states, add lint/E2E CI or explicitly document manual gate.

## Files

- `01-auth-rbac-rls.md`
- `02-api-contracts.md`
- `03-database-migrations-integrity.md`
- `04-finance-crm-payroll.md`
- `05-lms-assessment-rewards.md`
- `06-academic-scheduling.md`
- `07-admin-ui.md`
- `08-teaching-lms-ui.md`
- `09-integrations-async.md`
- `10-harness-ops-tests.md`

## Unresolved Questions

- Is canonical topology now permanently `admin + lms + api`, with `apps/teaching` retired?
- Should staff notification privacy and payroll secrecy be enforced in DB RLS, not only app layer?
- Should term lock freeze all source academic inputs or only final grade recompute?
- Should CI enforce Playwright E2E now, or keep it manual until infra stabilizes?
- Should production run multiple API replicas? If yes, outbox locking is a release blocker.

