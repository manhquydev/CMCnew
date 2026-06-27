# 05 LMS, Assessment, Rewards

Status: DONE_WITH_CONCERNS

## Scope Reviewed

- `packages/domain-grading/**`
- `packages/domain-rewards/**`
- LMS-related API routers
- `apps/lms/src/**`
- relevant LMS tests/specs

## Findings

### High: Submission APIs leak unpublished grade data

Evidence:

- grade visibility spec: `docs/specs/phase-02-assessment-lms.md:83`
- `submissionSelect` includes grade: `apps/api/src/routers/submission.ts:13`, `:18`, `:30`
- API returns raw nested grade: `apps/api/src/routers/submission.ts:51`, `:65`
- UI only hides client-side: `apps/lms/src/student-view.tsx:366`, `apps/lms/src/parent-view.tsx:412`

Impact: direct API clients can see unpublished score/feedback.

### High: Students can save submissions for unpublished exercises by ID

Evidence:

- list filters published: `apps/api/src/routers/exercise.ts:24`
- `submission.save` uses `findUniqueOrThrow` without status/due guard: `apps/api/src/routers/submission.ts:99`, `:111`, `:116`
- RLS permits enrolled-class exercise access: `packages/db/prisma/migrations/20260623100000_principal_aware_rls/migration.sql:113`

Impact: hidden/draft/closed exercises can receive submissions if ID is known.

### High: Grade score can exceed maxScore

Evidence:

- spec: `docs/specs/phase-02-assessment-lms.md:82`
- zod only `min(0)`: `apps/api/src/routers/grade.ts:27`
- maxScore read but not enforced: `apps/api/src/routers/grade.ts:37`, `:54`

Impact: invalid grades persist and feed final grade/KPI.

### High: Term lock does not block source mutations

Evidence:

- lock enforced only in `computeFinalGrade`: `apps/api/src/routers/assessment.ts:190`
- `grade.grade` mutates after lock: `apps/api/src/routers/grade.ts:25`, `:41`
- qualitative upsert mutates after lock: `apps/api/src/routers/assessment.ts:119`, `:145`

Impact: locked term final output can be bypassed by mutating underlying grade/qualitative data.

### Medium: Gift program/minLevel gates stored but not enforced

Evidence:

- spec gate: `docs/specs/phase-02-assessment-lms.md:100`
- fields exist: `packages/db/prisma/schema.prisma:569`
- `giftCreate` lacks minLevel: `apps/api/src/routers/rewards.ts:20`
- redeem checks active/stock/balance only: `packages/domain-rewards/src/stars.ts:22`

### Medium: Manual certificates have no LMS read path

Evidence:

- manual-only decision: `docs/decisions/0008-lms-homework-platform-certificate-manual-only.md:17`
- certificate RLS staff-only: `packages/db/prisma/migrations/20260623182722_phase5_certificate/migration.sql:33`
- router staff-only: `apps/api/src/routers/certificate.ts:8`

Impact: if parent/student LMS should see certificates, product gap remains.

## Verification Gaps

- No tests for suppressing unpublished grade fields.
- No tests rejecting draft/closed/past-due exercise submissions.
- No test for score > maxScore.
- No source-mutation term-lock tests.
- No gift gate tests.

## Positive Controls

- Final grade aggregation filters published grades.
- Star earn is idempotent on publish.
- Redeem uses advisory lock and atomic stock decrement.
- Reward rejection refunds stars/restores stock.
- Guardian isolation has integration tests.

## Unresolved Questions

- Should certificates be visible in LMS now?
- Should term lock freeze source inputs or only final grade recompute?
- Should parents redeem gifts for children?

