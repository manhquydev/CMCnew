# 03 Database, Migrations, Integrity

Status: DONE_WITH_CONCERNS

## Scope Reviewed

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/**`
- `packages/db/src/seed-demo.ts`
- `packages/db/src/verify-rls.ts`
- DB invariant tests under `apps/api/test/**`

## Findings

### High: Payroll RLS does not enforce documented payroll secrecy

Evidence:

- spec: `docs/specs/phase-04-payroll.md:31`, `:45`, `:58`
- migration comment: `packages/db/prisma/migrations/20260623184505_phase4_payroll/migration.sql:86`
- facility-wide policy: `packages/db/prisma/migrations/20260623184505_phase4_payroll/migration.sql:93`

Impact: any SQL path using staff RLS in facility can read/write payroll rows if app-layer role gate is missed.

### High: Facility-scoped counters collide with global unique codes

Evidence:

- batch code per facility/year: `apps/api/src/services/batch-code.ts:12`
- batch counter key: `packages/db/prisma/schema.prisma:349`
- global `ClassBatch.code`: `packages/db/prisma/schema.prisma:189`
- receipt code per facility/year: `apps/api/src/services/receipt-code.ts:4`
- global `Receipt.code`: `packages/db/prisma/schema.prisma:931`

Impact: first class/receipt in facility A and B can both generate same code, causing unique violation.

### Medium: `GradingTemplate` nullable `level` defeats intended uniqueness

Evidence:

- schema unique intent: `packages/db/prisma/schema.prisma:759`
- seed workaround: `packages/db/src/seed-demo.ts:43`

Impact: duplicate default templates can exist and `findFirst` can become nondeterministic.

### Medium: Receipt/class course consistency is API-only

Evidence:

- `Receipt.courseId` and `classBatchId`: `packages/db/prisma/schema.prisma:943`, `:979`
- FK only to class batch id: `packages/db/prisma/migrations/20260627000000_student_provisioning/migration.sql:29`
- app-layer test: `apps/api/test/receipt-batch-course-guard.int.test.ts:3`

Impact: scripts or future paths can create a receipt for Course A enrolling into ClassBatch for Course B.

### Medium: Core numeric ranges lack DB CHECK constraints

Examples:

- voucher fields: `packages/db/prisma/migrations/20260623170152_phase3_revenue_s1/migration.sql:31`
- receipt money/discount fields: same migration `:55`
- grade score/maxScore: `packages/db/prisma/migrations/20260623090658_phase2_lms_core/migration.sql:97`
- KPI scores: `packages/db/prisma/migrations/20260625064603_phase4_kpi_score/migration.sql:8`

Impact: invalid money, discounts, grade scores, KPI scores can persist if app validation is bypassed.

## Verification Gaps

- No cross-facility code collision tests.
- RLS coverage checks table/policy presence, not role-specific payroll secrecy.
- No DB uniqueness test for nullable grading template default row.

## Positive Controls

- Facility-scoped tables have RLS coverage tests.
- Parent/student principal isolation has tests.
- Voucher atomic consume has integration coverage.
- Login OTP and activation token store hashes under super-only RLS.

## Unresolved Questions

- Should codes include facility code, or should uniqueness become `(facility_id, code)`?
- Should DB RLS include role GUC for payroll?
- Should nullable uniqueness use partial indexes or `NULLS NOT DISTINCT`?

