# Phase 2: API Direct Provisioning

Status: in-progress

## Goal

Add Teacher Lite API procedures for direct parent/student/enrollment setup.

## Requirements

- Allow `giam_doc_kinh_doanh` and `giam_doc_dao_tao`.
- Deny `giao_vien`.
- Create/reuse parent account by normalized phone/email policy.
- Create student, guardian link, student account, optional enrollment in one transaction.
- Set student/family password behavior to `Cmc2026@` per decision `0033`.
- Queue parent LMS email using existing outbox.
- Audit with masked contact values.
- Do not call existing routers from the client to compose the workflow.
- Do not use receipt, finance approval, CRM opportunity, or O5 logic.
- Use a transaction-safe direct student-code allocator.
- Use `${facility.code}-${student.studentCode}` for `StudentAccount.loginCode`.
- Set `ParentAccount.passwordHash` only if missing; do not overwrite a returning family password.
- Store parent phone normalized to bare `84xxxxxxxxx`.
- Store parent email lowercased and trimmed.

## Risks

- Duplicate email/phone conflicts.
- Cross-facility leakage.
- Transaction partial creation.
- P2002 after a failed insert aborts current transaction; avoid catch-and-continue inside same tx.

## Tests

- Success for both director roles.
- Denial for teacher.
- Duplicate phone same family attaches child.
- Duplicate email conflict deterministic.
- Cross-facility deny.
- Enrollment duplicate deterministic.
- Concurrent same-phone create converges or cleanly conflicts.
- Student phone/default-password login works for created child.
- Parent email OTP works for created parent.

## Implementation Result

- Implemented `apps/api/src/routers/teacher-lite.ts`.
- Implemented `apps/api/src/services/teacher-lite-direct-provisioning.ts`.
- Implemented `apps/api/src/services/student-code.ts`.
- Implemented `packages/db/prisma/migrations/20260707113000_teacher_lite_student_code_counter/migration.sql`.
- Updated `packages/auth/src/permissions.ts` and permission snapshot.

## Proof So Far

- `pnpm --filter @cmc/db generate`: passed.
- `pnpm --filter @cmc/api typecheck`: passed.
- `pnpm --filter @cmc/db typecheck`: passed.
- `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts`: passed.
- `pnpm --filter @cmc/api lint`: passed with unrelated existing warnings in `emit-staff-notif.ts` and `shift-registration.ts`.
- `pnpm --filter @cmc/api exec vitest run test/teacher-lite-direct-provisioning.int.test.ts`: file ran, but DB-backed assertions skipped because local Postgres was not reachable.

## Remaining Proof Before Marking Complete

- Run dev DB with migrations applied.
- Re-run `teacher-lite-direct-provisioning.int.test.ts` against real Postgres and confirm no skip.
- Add duplicate-email/cross-facility/concurrency cases if Phase 2 remains the API hardening phase before UI work.
