# Phase 1: Contracts and Impact

Status: complete

## Goal

Prepare implementation safely before code changes.

## Tasks

- Read governing decisions before touching matched files:
  - `0033-student-login-phone-identity`
  - `0038-session-level-exercises`
  - `0039-teacher-lite-direct-lms-mvp`
- Run GitNexus impact before modifying exported symbols.
- Identify exact existing helpers to reuse for:
  - phone normalization
  - password hashing
  - parent/student session creation
  - email outbox
  - class creation
  - enrollment
  - attendance
  - session evidence
  - grading/submission
- Confirm teacher-domain deploy entrypoint.
- Add `teacherLite` permission registry entries before adding router procedures.
- Decide exact direct student code allocator:
  - Preferred: `StudentCodeCounter` keyed by `(facilityId, year)`.
  - Format: `HS-YYYY-NNNN`.
  - Student LMS fallback loginCode remains `${facility.code}-${student.studentCode}`.
- Confirm whether audit-only `teacher_lite_direct` provenance is enough for MVP.

## Files Likely Touched

- `docs/DECISION_INDEX.md`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/*`
- `packages/auth/src/lms.ts`
- `packages/auth/src/permissions.ts`
- `apps/api/src/routers/index.ts`
- `apps/api/src/routers/teacher-lite.ts`
- `apps/admin` or new teacher-lite app files
- deployment config for `teacher.cmcvn.edu.vn`

## Validation

- GitNexus impact for every target symbol before edit.
- Baseline typecheck before behavior changes.
- No code behavior changes in this phase unless required by schema/permission preparation.

## Result

- Read governing decisions `0033` and `0039`.
- Ran GitNexus impact for `can` and `requirePermission`; both are CRITICAL shared gates, so implementation avoided changing their logic and added a new `teacherLite` namespace instead.
- GitNexus could not resolve `appRouter` as a symbol; router mount was verified by API typecheck.
- Confirmed `StudentCodeCounter` direct allocator is required because receipt code derivation is bypassed.
- Confirmed audit marker `teacher_lite_direct` is enough for MVP provenance; no finance/CRM source field added in this phase.
