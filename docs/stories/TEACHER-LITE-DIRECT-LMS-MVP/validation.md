# Validation

## Proof Strategy

Prove the smallest safe vertical slice first:

1. Director direct-creates parent/student and enrolls into class.
2. Student logs into LMS with parent phone + `Cmc2026@`.
3. Parent logs into LMS with email OTP.
4. Teacher marks attendance and publishes evidence.
5. Student submits homework; teacher grades and publishes score/stars.
6. Parent sees only own child's published output.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | phone normalization, default password constant, DTO parsing |
| Integration | direct provisioning success, duplicate phone, duplicate email, enrollment duplicate, teacher denial, director allow, cross-facility deny |
| E2E | teacher domain director setup, teacher class day, student submit, parent view |
| Platform | teacher domain serves Lite UI; erp and hoc unaffected |
| Performance | no broad polling; list endpoints paginated |
| Logs/Audit | direct provisioning, cancellation, publish, email queue have audit/outbox proof |

## Fixtures

- Director KD user.
- Director DT user.
- Teacher user.
- Facility.
- Course/curriculum lesson.
- Class batch.
- Parent email.
- Parent phone normalized to `84xxx`.
- Student.

## Commands

```text
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-teacher-lite-direct-lms-mvp.ps1
.\scripts\bin\harness-cli.exe story verify TEACHER-LITE-DIRECT-LMS-MVP
```

## Acceptance Evidence

- Baseline pre-implementation verify: `pnpm --filter @cmc/api typecheck` passed via Harness story verify.
- Red-team/scenario report: `plans/260707-teacher-lite-direct-lms-mvp/reports/red-team-260707-teacher-lite-direct-lms-mvp.md`.
- Phase 1/2 compile proof:
  - `pnpm --filter @cmc/db generate`: passed.
  - `pnpm --filter @cmc/api typecheck`: passed.
  - `pnpm --filter @cmc/db typecheck`: passed.
  - `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts`: passed.
  - `pnpm --filter @cmc/api lint`: passed with unrelated existing warnings.
- Phase 2 DB proof:
  - `scripts/verify-teacher-lite-direct-lms-mvp.ps1` now starts an isolated Postgres container on `55433`, runs all migrations + seed, then runs the Teacher Lite/LMS integration tests against a real DB.
  - `teacher-lite-direct-provisioning.int.test.ts`: passed DB-backed.
- Phase 3 shell proof:
  - `pnpm --filter @cmc/admin typecheck`: passed.
  - `pnpm --filter @cmc/admin exec vitest run src/__tests__/nav-teacher-consolidation.test.ts src/__tests__/nav-consistency.test.ts src/__tests__/nav-director-kd-cockpit-consolidation.test.ts src/__tests__/nav-director-dt-cockpit-consolidation.test.ts`: passed.
  - `pnpm --filter @cmc/admin lint`: passed with unrelated existing warning.
  - `pnpm --filter @cmc/admin build`: passed with Vite chunk-size warning.
- Phase 3 browser proof pending:
  - Teacher surface E2E updated but not run because local app + DB are not running in this session.
- Teacher Lite local verification script:
  - `scripts/verify-teacher-lite-direct-lms-mvp.ps1` runs DB client generation when API is not listening, API/DB/Admin/LMS typecheck, API/Admin/LMS strict lint (`--max-warnings 0`), permission parity, isolated Postgres migrate/seed, Teacher Lite provisioning integration, LMS published-output invariants, attendance/final-grade invariants, Teacher Lite nav regression, and Admin/LMS production builds.
  - When API dev server is listening on `:4000`, the script skips Prisma generate to avoid Windows DLL lock on `query_engine-windows.dll.node`.
  - DB-backed assertions no longer depend on local `5433`; the script owns its verification DB and removes it after the run.
  - The DB-backed run exposed a cross-facility session-evidence write gap; fixed by making `assertTeachingSessionMutationAllowed` require staff facility membership before teacher/director authorization.
  - Current non-blocking warnings are Vite chunk-size warnings and PDF legacy-build notices from nav tests.
- Harness story verify:
  - Story `TEACHER-LITE-DIRECT-LMS-MVP` now uses `scripts/verify-teacher-lite-direct-lms-mvp.ps1` as its verify command.
  - `harness-cli story verify TEACHER-LITE-DIRECT-LMS-MVP`: passed with strict lint, DB-backed tests, nav regression, and production builds.
