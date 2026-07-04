# Scout notes — Plan C student account phone-identity + password (verified file:line)

Author: planner · 2026-07-04 · all citations re-verified against working tree.

## Provisioning (money path) — finance.ts

- `genTempPassword()` = `randomBytes(6).toString('hex')` (12 hex) — `finance.ts:23-26`.
- LMS provisioning block — `finance.ts:910-973`. Guarded by `!existingLmsAcc && wasNewStudent`
  (`:923`); only a brand-new student gets an auto-account.
- Current loginCode = `${facility.code}-${student.studentCode}` — `finance.ts:931-935`.
- Password mint + hash — `finance.ts:924-925`. `hashPassword` from `@cmc/db`.
- `lmsAccount` returned to caller `{ loginCode, tempPassword }` — `finance.ts:916,944`.
- `lms_account_ready` email uses `tempPassword` — `finance.ts:956-971`.
- New-student path requires parentPhone + studentName (throws otherwise) — `finance.ts:712-717`.
- Parent find-or-create by phone — `finance.ts:722-735`. Dedupe existing child by
  case-insensitive name — `finance.ts:746-762`.

## ERP reset — student.ts

- `resetLmsPassword` = `requirePermission('student','resetLmsPassword')` — `student.ts:143`.
- Random temp password — `student.ts:160`. Create-or-reset: update bumps tokenVersion
  (`:163-167`) OR create with `loginCode = student.studentCode` (`:168-176`).
- Returns `{ loginCode, tempPassword }` — `student.ts:186`.
- Facility-scoped lookup first via `withRls(rlsContextOf(ctx.session))` — `student.ts:146-152`.

## Auth — packages/auth/src/lms.ts

- `loginStudent(loginCode, password)` → `findUnique({ where: { loginCode } })`, single-student
  session — `lms.ts:92-103`. Lookup key is a single unique string; a `84xxx` value works
  unchanged.
- `studentSession` resolves exactly ONE student — `lms.ts:67-85`.
- `parentSession` resolves ALL guardianed children (multi-child) — `lms.ts:39-65`;
  `session.studentIds` = resolved guardian set — `lms.ts:60`.
- `SYSTEM_RLS` super context for trusted identity reads — `lms.ts:35`.
- tokenVersion re-checked on every request — `resolveLmsSession` `lms.ts:118-127`.

## LMS auth router — lms-auth.ts

- `loginStudent` input `{ loginCode, password }` — `lms-auth.ts:36-48`. Rate-limited by
  (ip, loginCode). No format assumption on loginCode.
- Parent login is Email OTP (`otpRequest`/`otpVerify`) — `lms-auth.ts:53-73`; `parentProcedure`
  in guardian router keys off the resulting parent session.

## Schema — schema.prisma

- `ParentAccount.phone String? @unique` (`:554`), `email String? @unique` (`:553`).
- `StudentAccount`: `studentId @unique` (`:573`), `loginCode String @unique` GLOBAL (`:575`),
  `passwordHash String` required (`:576`), `tokenVersion` (`:578`).
- `Guardian @@unique([parentAccountId, studentId])` (`:595`) — M:N.

## RLS — student_account is staff/super only

- `student_account_staff_rw`: `app_is_super_admin() OR app_principal_kind() = 'staff'` —
  `20260624090000_identity_system_wide_rls/migration.sql:17-20`. **Parent principal CANNOT
  write student_account.** Parent self-edit relaxation (`20260702152400`) is on
  `parent_account` only (`migration.sql:63-77`). → parent password-change updates the
  StudentAccount under a SYSTEM (super) context after an app-level `studentIds` ownership check
  (mirrors `guardian.requestLink`'s SYSTEM_CTX pattern, `guardian.ts:13,179`).

## Host surfaces for UI

- ERP reset button already exists — `apps/admin/src/student-detail.tsx:117-174`
  (`LmsAccountSection`, calls `trpc.student.resetLmsPassword` at `:127`). Change copy +
  reveal to fixed default.
- Parent self-service host = `ProfileTab` in `apps/lms/src/parent-view.tsx:398-519`
  (account-level tab, already does `guardian.profileUpdate` / `guardian.requestLink`). Add a
  "Đổi mật khẩu của con" card with a child `Select` (from `principal.students`) + new-password
  `TextInput`. Parent tab wiring: `parent-shell.tsx:23-31` (`profile` nav entry).
- `principal.students` = `[{ id, fullName }]` (parent's children) — `lms.ts:59`, consumed at
  `parent-view.tsx:975,1044`.

## crm.ts normalizePhone (DO NOT reuse)

- `normalizePhone(raw)` → `+84…` for CRM dedupe — `crm.ts:62-68`. Must stay untouched.

## Tests that assert current behavior (WILL break — update in P1/P2)

- `apps/api/test/lms-student-account-provisioning.int.test.ts`:
  - `:104` `expect(loginCode).toMatch(/^HQ-HS-/)` → change to `84…` scheme.
  - `:105` `expect(tempPassword).toHaveLength(12)` → change to `Cmc2026@`.
  - `:290-291` reset returns a DIFFERENT random 12-hex → change to fixed default.
  - `:327` create-branch loginCode = studentCode (no guardian) → keep as studentCode fallback.
- `apps/api/test/lms-full-lifecycle-e2e.int.test.ts`, `lms-lifecycle-gating.int.test.ts`,
  `director-user-create.int.test.ts` reference loginCode/studentAccount — re-grep + fix any
  format/password assertions in P1.
- `apps/e2e/tests/lms-autosave-and-parent-readonly.spec.ts` builds an LMS session with
  `hashPassword`/`mintParentSession` — pattern to copy for the parent-change E2E.

## Test helpers

- `staffCaller()` / `lmsCaller(lms)` / `uniq()` / `withRls`,`SUPER` — `apps/api/test/helpers.ts`.
