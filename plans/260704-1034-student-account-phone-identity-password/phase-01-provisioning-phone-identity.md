# Phase 1 — Family-login backend + provisioning idempotency + deep integration tests

Status: pending · Depends: P0 (helper + const; decision 0032 D3 + cascade-Q confirmed).
Owns: `packages/auth/src/lms.ts` (incl. the new child-selection ticket sign/verify path — or, if
the `kind:'family'` alternative is chosen, the `LmsSession.kind` union at `:9`),
`apps/api/src/trpc.ts` ONLY IF the `kind:'family'` alternative is chosen (add the explicit
`parentProcedure` rejection — otherwise trpc.ts is untouched),
`apps/api/src/routers/lms-auth.ts`, `apps/api/src/routers/guardian.ts`,
`apps/api/src/routers/student.ts`, `apps/api/src/routers/finance.ts` (provisioning block only),
+ integration tests.

All new backend + all deep adversarial tests land here so the composed non-vacuous reset test and
the two `guardian.ts` procedures share one owner (no cross-phase file conflict). P2/P3 are UI-only.

## SECURITY INVARIANT (BLOCKING — 2nd red-team B1)

Phone-login is CHILD-VIEW ONLY. It must NEVER mint or set a `kind:'parent'` (parent-portal-capable)
LMS session. Rationale: the phone (printed on receipts) + the public default `Cmc2026@` is a weak
credential; `parentProcedure` (`trpc.ts:86-89`) authorizes `guardian.profileUpdate`
(`guardian.ts:130-159`), which rewrites `ParentAccount.email`, and Email-OTP login resolves the
parent by email (`services/login-otp.ts:36,102`) — so a parent-capable phone-login cookie would
let an attacker hijack the parent's stronger Email-OTP account. See decision 0032 D4.

RECOMMENDED implementation = a short-lived signed **child-selection ticket** (not an LmsSession, not
the LMS cookie): `loginFamilyByPhone` returns it; `enterChildProfile` consumes it and only THEN sets
the real `kind:'student'` cookie. ALTERNATIVE = a restricted `kind:'family'` in the
`LmsSession.kind` union that `parentProcedure` explicitly REJECTS. Final choice confirmed at
implementation; the invariant + its tests (below) are mandatory either way.

## Data flow

`loginFamilyByPhone(phone, pw)` → normalize → `ParentAccount.findUnique({phone})` →
`verifyPassword(pw, passwordHash)` → reuse `parentSession()` (non-blocked children) → return a
signed **child-selection ticket** `{parentAccountId, tokenVersion, exp}` (~5 min) + the child list.
NO LMS cookie set, NO `kind:'parent'` JWT minted. Client auto-enters if 1, else picker.
`enterChildProfile(ticket, studentId)` (publicProcedure) → verify ticket sig+exp → re-resolve the
parent's non-blocked children server-side from `Guardian` → assert `studentId ∈ resolvedChildren`
(else FORBIDDEN) → reuse `studentSession()` → mint STUDENT JWT → set LMS cookie.

## Requirements

### 1. `packages/auth/src/lms.ts`

- `loginFamilyByPhone(phone, password): Promise<{ ticket; children } | null>`:
  `normalizeLoginPhone(phone)` (null → return null); `withRls(SYSTEM_RLS, tx =>
  tx.parentAccount.findUnique({ where: { phone } }))`; if `!acc || !acc.isActive || !acc.passwordHash`
  → null; `verifyPassword(password, acc.passwordHash)` false → null; reuse the existing
  `parentSession(acc.id)` to resolve non-blocked children; return null when ZERO non-blocked
  children. On success return `{ ticket: signChildSelectionTicket(acc.id, acc.tokenVersion),
  children: session.students }`. **Do NOT mint a `kind:'parent'` JWT and do NOT set the LMS cookie
  here** (B1 invariant).
- `signChildSelectionTicket(parentAccountId, tokenVersion)` / `verifyChildSelectionTicket(ticket):
  { parentAccountId, tokenVersion } | null`: HMAC-sign `{ parentAccountId, tokenVersion, exp }`
  (~5 min TTL) with the existing LMS/JWT secret. This is NOT an `LmsSession`; `resolveLmsSession`
  MUST NOT accept it and it MUST NOT be usable as the LMS cookie. (If the `kind:'family'`
  alternative is chosen instead: add `'family'` to the `LmsSession.kind` union `:9`, have
  `signLmsSession`/`resolveLmsSession` carry it, and add the explicit `parentProcedure` rejection
  in `trpc.ts` — but the ticket is recommended.)
- `mintStudentSessionForStudent(studentId, parentAccountId): Promise<{ token; session } | null>`:
  re-resolve the parent's non-blocked children server-side (reuse `parentSession(parentAccountId)`)
  and confirm `studentId` is among them (else return null → caller maps to FORBIDDEN); `withRls
  (SYSTEM_RLS, tx => tx.studentAccount.findUnique({ where: { studentId } }))`; if none → null;
  reuse `studentSession(acc.id)` + `signLmsSession({sub:acc.id, kind:'student', tokenVersion})`.
- Do NOT change `parentSession`/`studentSession`/`loginStudent`/`resolveLmsSession` (beyond the
  `kind:'family'` union support ONLY if that alternative is chosen).

### 2. `apps/api/src/routers/lms-auth.ts`

- `loginFamilyByPhone` (publicProcedure, input `{ phone, password }`): rate-limit by
  `(ctx.ip, normalizedPhone)` reusing `checkLoginLimit`/`recordLoginFailure`/`clearLoginLimit`;
  on success return `{ ticket, children }` (the parent's `[{id,fullName}]`). **Does NOT call
  `setLmsCookie`** (no session is established until a child is picked — B1 invariant). On failure
  throw `UNAUTHORIZED` (same copy as `loginStudent`). No account enumeration in the error.
- `enterChildProfile` (**publicProcedure**, input `{ ticket, studentId }`): `verifyChildSelection
  Ticket(ticket)` → null (bad sig / expired / stale tokenVersion) → `UNAUTHORIZED`;
  `mintStudentSessionForStudent(studentId, ticket.parentAccountId)` — returns null both when the
  student is not among the parent's non-blocked children (→ `FORBIDDEN`) and when the child has no
  StudentAccount (→ `NOT_FOUND` "Con chưa có tài khoản LMS — nhờ trung tâm cấp"); on success
  `setLmsCookie(ctx.c, result.token)` (student token) and return `{ principal: publicLms
  (result.session) }`. This is the ONLY place the phone-login path sets a cookie, and it is always
  a `kind:'student'` cookie.
- Keep `loginStudent`, `otpRequest`, `otpVerify`, `me`, `logout` UNCHANGED (break-glass + parent
  portal preserved).

### 3. `apps/api/src/routers/guardian.ts`

- `changeFamilyPassword` (**parentProcedure**, input `{ newPassword: z.string().min(?) }`): update
  `ParentAccount` where `id = ctx.lms.accountId` under SYSTEM_CTX: `passwordHash =
  hashPassword(newPassword)`, `tokenVersion += 1`. No old password. `logEvent`. Cannot target
  another account (id from session). Consider a `throttle` mirroring `requestLink`.
- `resetFamilyPassword` (staff, `requirePermission(...)` mirroring `student.resetLmsPassword`'s
  gate — confirm the exact resource/action): input `{ parentAccountId }`; facility-scoped
  visibility check FIRST (NOT_FOUND if the caller cannot see it); set `passwordHash =
  hashPassword(DEFAULT_STUDENT_PASSWORD)`, `tokenVersion += 1`; `logEvent`. Confirm-only.
- Cascade (only if P1 blocking-Q answered YES): also bump `StudentAccount.tokenVersion` for every
  guardianed child. Default = NO cascade.

### 4. `apps/api/src/routers/student.ts` — `resetLmsPassword`

- Replace `randomBytes(6).toString('hex')` (`:160`) with `DEFAULT_STUDENT_PASSWORD`. Keep the
  create-or-reset shape + tokenVersion bump. Return field name `tempPassword` kept (now a fixed
  constant) — see plan open-Q 3.
- **M1 loginCode reconciliation:** the create-branch currently sets the BARE
  `student.studentCode` (`:171`), diverging from provisioning's facility-prefixed
  `${facility.code}-${student.studentCode}` (`finance.ts:935`). Since `login_code` is GLOBAL
  `@unique` (`schema.prisma:575`), align this create-branch to the SAME facility-prefixed form so
  the break-glass code is consistent + collision-safe cross-facility. Resolve the facility from
  the student's enrollment/facility relation as provisioning does.

### 5. `apps/api/src/routers/finance.ts` — provisioning (`:710-972`)

- Compute `const loginPhone = normalizeLoginPhone(receipt.parentPhone)` at the top of the
  new-student path.
- Parent find-or-create (`:722-744`): look up + store `phone` using `loginPhone ?? receipt
  .parentPhone` (canonical `84xxx` when valid). Keep the same value for BOTH the find-first and
  the create so a returning parent dedupes (D5).
- **Race-safe create (S1 — BLOCKING for money-tx integrity):** `ParentAccount.phone` is `@unique`
  (`schema.prisma:554`). Two brand-new siblings of a not-yet-existing parent approved concurrently
  both miss the find-first then both `create` → the loser hits Postgres `unique_violation`, which
  ABORTS the whole `receipt.approve` money transaction. Make the create race-safe: wrap the
  `create` in a SAVEPOINT and catch `P2002` → refetch the now-existing ParentAccount, OR use raw
  `INSERT ... ON CONFLICT (phone) DO NOTHING` + refetch (`ON CONFLICT DO NOTHING` does not abort
  the tx). A bare `unique_violation` MUST NOT propagate. Both siblings then converge onto the one
  ParentAccount.
- After find-or-create, **set the family password once (idempotent):** if `parentAcc.passwordHash
  == null`, `tx.parentAccount.update({ where:{id}, data:{ passwordHash: hashPassword
  (DEFAULT_STUDENT_PASSWORD) }})`. NEVER overwrite an existing family password (this is the new
  "sibling" handling — the 2nd child links to the existing credential).
- StudentAccount provision (`:918-972`): replace `genTempPassword()` (`:924`) with
  `DEFAULT_STUDENT_PASSWORD`. KEEP loginCode = `${facility.code}-${student.studentCode}`
  (`:935`) — unchanged; it backs only break-glass `loginStudent`. Provisioning must NOT throw on
  a null/garbage phone (fallback: no family password set, break-glass account still created).
- `lms_account_ready` email (`:956-971`): the payload still carries `loginCode`+password; update
  copy so it communicates "đăng nhập bằng SĐT phụ huynh + mật khẩu Cmc2026@" (family login) with
  the break-glass code as secondary. Keep `enqueueEmail` atomic-with-tx behavior.

## Files

- Modify: the 5 files above (backend only).
- Modify: `apps/api/test/lms-student-account-provisioning.int.test.ts` — fix stale asserts (scout
  notes): `:104` loginCode `/^HQ-HS-/` still valid for the break-glass code; `:105` password
  length 12 → `Cmc2026@`; `:290-291` reset random → fixed default; `:327` create-branch fallback.
- Create: `apps/api/test/lms-family-login.int.test.ts` (new deep tests).
- Re-grep + fix `lms-full-lifecycle-e2e`, `lms-lifecycle-gating`, `director-user-create` int
  tests for any loginCode/password asserts.

## Tests (integration — deep/adversarial)

Use `staffCaller()`/`lmsCaller()`/`uniq()`/`withRls`/`SUPER` (`apps/api/test/helpers.ts`).

1. **Provision + login (1 child):** approve a new-student receipt → assert `ParentAccount.phone`
   matches `/^84\d{9}$/`, `passwordHash` verifies `Cmc2026@` → `loginFamilyByPhone(phone,
   'Cmc2026@')` returns exactly 1 child → `enterChildProfile(child)` yields a `kind:'student'`
   session for that student.
2. **Picker (2+ children):** approve two new children on the SAME phone → `loginFamilyByPhone`
   returns BOTH; assert NO 2nd ParentAccount created and the 2nd approve did NOT throw
   (idempotent sibling attach — the core replacement for the old suffix race).
3. **Family password set once:** the 2nd child's approve does NOT overwrite the family password
   (seed a changed pw before the 2nd approve; assert it survives).
4. **No-phone fallback:** approve a receipt whose parentPhone normalizes to null → provisioning
   succeeds, no family login, break-glass `loginStudent(facilityCode-studentCode, 'Cmc2026@')`
   works.
5. **enterChildProfile cross-family FORBIDDEN:** family A logs in (gets ticket A), calls
   `enterChildProfile(ticketA, childOfFamilyB)` → `FORBIDDEN`; assert NO cookie was set (no
   student session established). Uses server-side re-resolution, not a client-supplied list.
6. **Blocked child hidden:** set a child `on_hold`/`withdrawn` → absent from `loginFamilyByPhone`
   children; `enterChildProfile(ticket, blockedChildId)` → FORBIDDEN (server re-resolve excludes
   blocked lifecycle).
7. **Non-vacuous reset (family):** seed `ParentAccount.passwordHash = hash('NotDefault9@')` →
   `resetFamilyPassword` → `loginFamilyByPhone('NotDefault9@')` fails AND
   `loginFamilyByPhone('Cmc2026@')` succeeds AND `tokenVersion` incremented.
8. **changeFamilyPassword happy + revoke:** authenticated family session → change to `'New9@abc'`
   → `tokenVersion` bumped (old family JWT rejected by `resolveLmsSession`), `loginFamilyByPhone
   ('New9@abc')` works, `'Cmc2026@'` fails.
9. **RLS isolation:** a parent principal cannot read/write `student_account`/`parent_account`
   directly (negative test); the change path only works through `changeFamilyPassword` under
   system context.
10. **student.resetLmsPassword** returns the fixed default (not random) + bumps tokenVersion +
    (M1) create-branch loginCode is facility-prefixed `${facility.code}-${studentCode}`, not bare.
11. **[MANDATORY — B1] phone-login principal rejected by every `parentProcedure` mutation:** obtain
    a `loginFamilyByPhone` result (ticket). Assert that whatever the phone-login path yields CANNOT
    authorize a `parentProcedure` mutation — specifically `guardian.profileUpdate` AND
    `guardian.requestLink` return `FORBIDDEN`/`UNAUTHORIZED` (never succeed). This is the core
    security gate: phone+`Cmc2026@` must not reach `profileUpdate` (which rewrites the parent email
    that Email-OTP resolves by).
12. **[MANDATORY — B1] selection ticket is not a session:** assert the `loginFamilyByPhone` ticket
    cannot be used as the LMS cookie / is rejected by `resolveLmsSession`, and cannot reach any
    parent-portal READ (`me` returns no parent principal / unauthenticated). Only `enterChildProfile`
    accepts it, and only to mint a `kind:'student'` cookie. Also: a tampered/expired ticket →
    `UNAUTHORIZED`.
13. **[S1] concurrent first-sibling approve does not roll back money tx:** approve TWO brand-new
    siblings of the SAME brand-new phone concurrently → BOTH `receipt.approve` transactions commit
    (no `unique_violation` rollback), exactly ONE ParentAccount exists for the phone, and both
    children link to it.

## Impact / risk

- `gitnexus_impact` on `loginStudent`, `parentSession`, `studentSession`, `resetLmsPassword`,
  `finance.approve` BEFORE editing; report blast radius. HIGH likely on `finance.approve` (money
  path) — the change is additive/idempotent and must never throw.
- Risk matrix: money-path edit = High-impact/Low-likelihood → mitigation = fallback-never-throw +
  race-safe create (SAVEPOINT/`ON CONFLICT`) + tests #4,#13; parent-portal-hijack via weak
  phone-login = **High-impact/High-likelihood if unmitigated (B1)** → mitigation = ticket (no
  parent-capable session) + mandatory tests #11,#12; new authz surface = Med/Med → mitigation =
  tests #5,#6,#9.
- Rollback: revert the backend commits (auth helper + ticket + 5 routers) + test files; no
  schema/migration to undo.

## Done =

All 13 integration tests green (incl. mandatory B1 tests #11–#12 and S1 test #13); code-reviewer
(security) clean; gitnexus `detect_changes` scope = the backend files (auth helper + ticket + 5
routers; `trpc.ts` only if the `kind:'family'` alternative was chosen) + tests only; no
HIGH/CRITICAL impact ignored; curl live-verify loginFamilyByPhone→enterChildProfile after a real
approve, AND a curl check that the ticket cannot drive `guardian.profileUpdate`.
