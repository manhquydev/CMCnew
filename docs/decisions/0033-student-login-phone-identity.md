# Decision 0033 — Student LMS login = parent phone (84xxx) + family profile picker, fixed default password

- Status: accepted
- Date: 2026-07-04 (RE-AUTHORED — supersedes an earlier per-child-suffix draft of the same feature)
- Lane: HIGH-RISK (FEATURE_INTAKE.md — Auth + Authorization hard gates)
- Supersedes behavior in: `finance.ts` receipt-approve LMS provisioning, `student.resetLmsPassword`,
  LMS login gate "Học sinh" tab
- Related: decision 0031 (staff password login), curriculum/LMS identity model

## Pivot rationale — why the per-child-suffix design was rejected

The prior draft made the student login identity = the parent phone with a per-child
**suffix** for siblings (`84xxx`, `84xxx-2`, `84xxx-3`, …) allocated inside the
`receipt.approve` money transaction, backstopped by the global `@unique` on
`student_account.login_code`. A red-team found two blocking flaws:

1. **Money-transaction abort under concurrent sibling approval.** Two directors approving two
   NEW children of the SAME brand-new phone concurrently both compute suffix `-2` → the second
   `StudentAccount.create` raises a Postgres `unique_violation` INSIDE the approve transaction.
   In Postgres a constraint violation aborts the whole transaction (the tx enters a failed
   state — you cannot catch-and-continue without a SAVEPOINT). So the loser's ENTIRE
   `receipt.approve` (money posting, enrollment, lifecycle) rolls back. A per-INSERT SAVEPOINT
   + retry loop is possible but adds real concurrency complexity to the money path.
2. **No parent-facing way to communicate the suffix.** Parents never see `-2`; staff would have
   to relay per-child opaque codes out of band — defeating the "just use your phone" goal.

**The profile-picker model removes the per-sibling credential entirely:** the login credential is
the parent phone (already `@unique` on `ParentAccount.phone`); once a ParentAccount exists, a 2nd
child just links to it (idempotent find-or-create), so NO new credential row and NO suffix is
minted per sibling. The child is chosen AFTER login by tapping a profile tile (Netflix-style).

**Residual race (2nd red-team — corrects an earlier over-claim).** This design does NOT fully
"eliminate the unique race" and does NOT make the money path lock-free. Provisioning still does
`findFirst({where:{phone}})` then `create({phone})` against `ParentAccount.phone @unique`
(`schema.prisma:554`, `finance.ts:722-735`). Two brand-new siblings of a NOT-yet-existing parent
approved concurrently → both `findFirst` miss → both `create` → the loser hits a Postgres
`unique_violation`, which (as in the rejected suffix design) aborts the whole `receipt.approve`
MONEY transaction. It is the SAME failure class, just moved from `student_account.login_code` up
to `parent_account.phone`, and it is narrower — it can only fire on the FIRST-EVER sibling pair
of a brand-new phone (once the ParentAccount row exists, `findFirst` hits and no `create` runs).
It is also pre-existing (the current find-or-create already has it). But it is real and must be
handled, not claimed away. **Handling:** wrap the ParentAccount `create` in a SAVEPOINT and
catch `P2002` → refetch the now-existing row, OR use raw
`INSERT ... ON CONFLICT (phone) DO NOTHING` + refetch (`ON CONFLICT DO NOTHING` does not abort the
transaction). Both keep the money tx alive and converge both siblings onto the one ParentAccount.
The remaining win over the suffix design stands: no per-sibling credential and a parent-relayable
login (just the phone), not an opaque `-2` suffix.

## Confirmed decisions (user, 2026-07-04)

- **Login identity = parent phone normalized to bare `84xxxxxxxxx` (no leading `+`).** ONE
  credential per phone, shared across all that parent's children.
- **Default password = fixed literal `Cmc2026@`** (student security de-scoped by the user).
  Hashed at rest (bcrypt via `hashPassword`), never stored/asserted plaintext.
- **2-step login (profile picker):** authenticate phone + password → resolve the parent's
  children → if exactly 1 child, auto-enter that child's student view (skip the picker); if 2+,
  show a tap-to-enter picker. NO per-child PIN.
- After a child is picked the session is a normal **per-child STUDENT session** (existing shape)
  so all gamified student-LMS code runs unchanged. The picker is only a front door.
- **Password change is now FAMILY-level (one password per phone-account, not per child):**
  (a) parent self-service change in the LMS parent portal — NO old password required;
  (b) ERP reset — force back to `Cmc2026@`, confirm-only, no input field.
- Pre-launch → NO legacy `HQ-HS-xxx` backfill.
- **Cascade revocation on family password change/reset: NO cascade** (YAGNI — student session
  security is de-scoped). Family reset bumps only `ParentAccount.tokenVersion`; already-entered
  child STUDENT sessions stay valid until their own natural expiry.

## Intake classification

| Flag | Applies | Why |
|---|---|---|
| Auth | YES | new phone+password login path for a whole principal class |
| Authorization | YES | new parent-authenticated `enterChildProfile` (child-ownership gate) + parent self-service credential write |
| Data model | NO | **no new column, no migration** — `ParentAccount.passwordHash?`+`tokenVersion` already exist (see D3) |
| Public contracts | YES | new `lmsAuth.loginFamilyByPhone`/`enterChildProfile`, `guardian.changeFamilyPassword`/`resetFamilyPassword`; `student.resetLmsPassword` default-value change |
| Existing behavior | YES | provisioning + reset + login gate are test-covered today |
| Weak proof | NO | strong existing integration coverage; extend it |

Count ≥ 4 + Auth/Authz hard gates → **high-risk lane**.

## Context (re-verified in the working tree)

- `ParentAccount.phone String? @unique` (`schema.prisma:554`), `email String? @unique` (`:553`),
  **`passwordHash String? @map("password_hash")` ALREADY EXISTS** (`:557`, comment: "mật khẩu chỉ
  còn cho tài khoản cũ"), `tokenVersion Int @default(0)` (`:560`). → the family credential needs
  NO schema change.
- `StudentAccount`: `studentId @unique` (`:573`), `loginCode String @unique` GLOBAL (`:575`),
  `passwordHash String` required (`:576`), `tokenVersion` (`:578`).
- `Guardian @@unique([parentAccountId, studentId])` (`:595`) — M:N; one phone (= one
  ParentAccount) can have many children. A student may have >1 guardian ParentAccount.
- `packages/auth/src/lms.ts`:
  - `parentSession(accountId)` (`:39-65`) reads the ParentAccount, resolves guardianed children,
    **filters `BLOCKED_LMS_LIFECYCLE`** (`:52-54`, set = on_hold/withdrawn/transferred, `:6`),
    returns `studentIds`. Reused for the family session + picker child-list.
  - `studentSession(accountId)` (`:67-85`) resolves ONE student, blocks blocked lifecycle.
    Reused by `enterChildProfile`.
  - `mintParentSession(accountId)` (`:109-116`) mints a parent JWT WITHOUT a password (OTP path).
  - `loginStudent(loginCode, password)` (`:92-103`) — per-child login; `findUnique({loginCode})` +
    password verify + student JWT. **Kept as the break-glass / no-parent-phone fallback** (D5).
  - `signLmsSession`, `SYSTEM_RLS` super context (`:35`), `resolveLmsSession` tokenVersion recheck
    (`:118-127`).
- `apps/api/src/routers/lms-auth.ts`: `loginStudent` publicProcedure rate-limited by (ip,
  loginCode) (`:36-48`); `otpRequest`/`otpVerify` email-OTP parent path (`:53-73`) — **must stay
  untouched**; `setLmsCookie` helper (`:23-32`), 12h cookie.
- `apps/api/src/trpc.ts`: `parentProcedure` requires `ctx.lms.kind === 'parent'` (`:86-89`);
  `studentProcedure` requires `'student'` (`:92-95`).
- `finance.ts` receipt-approve: parent find-or-create by RAW `receipt.parentPhone`
  (`:722-744`); StudentAccount provision block (`:918-972`), loginCode =
  `${facility.code}-${student.studentCode}` (`:935`), password = random `genTempPassword()`
  (`:23-26,924`); new-student path already guards non-null phone (`:712-717`).
- `student.resetLmsPassword` (`student.ts:143-187`): `requirePermission('student',
  'resetLmsPassword')`, random 12-hex, bumps StudentAccount.tokenVersion (`:165`), create-branch
  loginCode = studentCode (`:171`).
- RLS: `student_account` + `parent_account` are staff/super-only writable
  (`20260624090000_identity_system_wide_rls`); a `parent` principal CANNOT write them → the
  parent self-service change updates ParentAccount under a **SYSTEM (super) context** after an
  app-level ownership check (mirrors `guardian.ts:13` SYSTEM_CTX / `lms.ts:35` SYSTEM_RLS).
- `crm.ts:62 normalizePhone` emits `+84…` for CRM dedupe — MUST NOT be reused or altered.
- LMS login gate `packages/ui/src/lms-login-gate.tsx`: "Học sinh" tab calls
  `lmsAuth.loginStudent` (`:113`); parent tab = email OTP (`:77,98`). This is where the
  phone-login + picker replace the loginCode field.

## Decisions

### D1. Login-identity phone format = bare `84xxxxxxxxx`

Pure helper `normalizeLoginPhone(raw): string | null` in `packages/auth` (NOT `crm.ts`
normalizePhone). Strip non-digits; `0xxxxxxxxx → 84xxxxxxxxx`; `+84xxx`/`0084xxx → 84xxx`;
`84xxx → 84xxx`. Returns `null` when the result is not a plausible VN mobile (`/^84\d{9}$/`), so
callers fall back rather than store garbage. Exhaustively unit-tested.

### D2. Default password = fixed literal `Cmc2026@`

`DEFAULT_STUDENT_PASSWORD = 'Cmc2026@'` const in `packages/auth`. Replaces `genTempPassword()`
at the StudentAccount provisioning site, the ParentAccount family-password set (D4), and the
random password in `student.resetLmsPassword`. Always bcrypt-hashed. Security is an accepted
non-concern for the student LMS (user decision). The "reveal once" UI becomes "here is the
standard password" (a known constant).

### D3. Schema home = REUSE `ParentAccount.passwordHash` — NO migration

The family login credential = `ParentAccount.phone` (unique) + `ParentAccount.passwordHash`
(already nullable at `schema.prisma:557`) + `ParentAccount.tokenVersion` (already at `:560`).
No new column, no Prisma migration.

Reuse vs new entity — reuse wins:
- The field EXISTS and was designed for exactly this (a parent-account password); `guardian.
  parentCreate` already sets it (`guardian.ts:46`). We are giving a dormant field a live purpose.
- One phone = one ParentAccount = one credential — the natural home. A new `FamilyLogin` entity
  would duplicate phone+password+tokenVersion already on ParentAccount (DRY violation) and add a
  join for zero benefit.
- KISS: `loginFamilyByPhone` = `findUnique({where:{phone}})` + verify — a single indexed lookup.

`StudentAccount` is **retained** as the per-child session anchor (tokenVersion, isActive,
loginCode-as-internal-id). Its `loginCode` KEEPS the `${facility.code}-${studentCode}` scheme
(globally unique, no sibling collision, unchanged) and is no longer the primary login credential
— it now backs only the break-glass `loginStudent` fallback (D5). `StudentAccount.passwordHash`
stays `Cmc2026@` for that fallback.

### D4. Two auth paths, kept distinct; session minting

**SECURITY REQUIREMENT (BLOCKING):** the phone-login path must NEVER produce a parent-portal-capable
session. The weak, publicly-known default credential (parent phone is printed on receipts + fixed
`Cmc2026@`) must not grant access to the parent portal. Concretely, `parentProcedure` today gates
only on `kind==='parent'` (`trpc.ts:86-89`) and thus authorizes `guardian.profileUpdate`
(`guardian.ts:130-159`), which can REWRITE `ParentAccount.email`; Email-OTP login resolves the
parent by that email (`services/login-otp.ts:36,102`). So a `kind:'parent'` cookie minted from
phone+`Cmc2026@` would let anyone who knows the parent's phone hijack the parent's STRONGER
Email-OTP account (change its email, lock the parent out). Phone-login is therefore child-view
ONLY; it must not reach any `parentProcedure` mutation.

- **EXISTING parent portal (untouched):** email OTP → `mintParentSession` → parent view
  (meetings, child progress). No change.
- **NEW family student login (`lms.ts` + `lms-auth.ts` + auth ticket layer):**
  1. `loginFamilyByPhone(phone, password)` (packages/auth): `normalizeLoginPhone` → find
     ParentAccount by phone → `verifyPassword` against `ParentAccount.passwordHash` → resolve
     non-blocked children via the existing `parentSession` logic → if 0 children → `null`
     (UNAUTHORIZED). On success it does NOT set the LMS cookie and does NOT mint a
     `kind:'parent'` session. Instead it returns a short-lived signed **child-selection ticket**
     (carrying only `{ parentAccountId, tokenVersion, exp }`, ~5 min TTL, HMAC-signed with the
     LMS/JWT secret) PLUS the child list `[{ id, fullName }]` (avatar optional/future).
     Rate-limited by (ip, phone). The ticket is NOT a `LmsSession` and is NOT accepted by
     `resolveLmsSession` / the LMS cookie — it is a one-purpose token consumable only by
     `enterChildProfile`.
  2. `enterChildProfile(ticket, studentId)` (lms-auth router, **publicProcedure** — it must run
     BEFORE any parent session exists): verify the ticket signature + expiry → re-resolve the
     parent's non-blocked children server-side from `Guardian` (do NOT trust a client-supplied
     child list) → assert `studentId ∈ resolvedChildren` else `FORBIDDEN`; look up the child's
     StudentAccount by studentId (NOT_FOUND if none — staff must provision); mint a **student
     JWT** via the existing `studentSession`; set the LMS cookie to that student token; return
     the student principal. This reuses `studentSession` + `signLmsSession` exactly. No
     parent-portal-capable session ever exists on this path.
- **Auto-enter (1 child):** client receives the ticket + a 1-element child list → immediately
  calls `enterChildProfile(ticket, children[0].id)` (skips the picker). `≥2` → render picker,
  each tile calls `enterChildProfile(ticket, id)`.
- **Ticket vs `kind:'family'` — ticket chosen.** The alternative was adding a restricted
  `kind:'family'` to the `LmsSession.kind` union (`lms.ts:9`) that `signLmsSession` /
  `resolveLmsSession` support and that `parentProcedure` EXPLICITLY REJECTS. The ticket approach
  was chosen: smaller blast radius — it introduces a separate short-lived token consumed by
  exactly one endpoint and touches no existing `parentProcedure` consumer, whereas the
  `kind:'family'` union change would need to be audited against every place that reads
  `ctx.lms.kind`. The invariant is enforced either way — a phone-login principal is REJECTED by
  every `parentProcedure` mutation.

### D5. Fallbacks (never throw mid-money-transaction)

- **Provisioning:** compute `loginPhone = normalizeLoginPhone(receipt.parentPhone)`. Use it for
  the ParentAccount find-or-create (store `phone` canonically as `84xxx`) AND set
  `passwordHash = hash(DEFAULT_STUDENT_PASSWORD)` **once** — only if the ParentAccount has no
  passwordHash yet (idempotent; a returning parent's existing family password is NEVER
  overwritten). Always also create the child's StudentAccount (facility-code loginCode + default
  password) → break-glass path always exists.
- **Parent has no / malformed phone** (`normalizeLoginPhone` → null): no family login for that
  child; the child logs in via the break-glass `loginStudent` (facility-code loginCode +
  `Cmc2026@`). Provisioning still succeeds — never throws on a bad phone.
- **Dedupe consistency:** provisioning's existing find-first-by-phone (`finance.ts:722`) must use
  the SAME normalized `84xxx` value, else a returning parent whose phone was entered in a
  different format spawns a duplicate ParentAccount. Pre-launch → no existing rows to reconcile.
- **Concurrent first-sibling race (see pivot rationale):** the find-first→create on
  `ParentAccount.phone @unique` must be race-safe so a concurrent second sibling of a brand-new
  phone cannot abort the money tx. Wrap the `create` in a SAVEPOINT + catch `P2002` + refetch, OR
  `INSERT ... ON CONFLICT (phone) DO NOTHING` + refetch. MUST NOT let a `unique_violation`
  propagate and roll back `receipt.approve`.
- **Two different parents sharing one phone:** `ParentAccount.phone` is `@unique` → find-or-create
  collapses them into ONE ParentAccount (pre-existing behavior). Their children then appear under
  one family login — a data-hygiene concern, documented, out of scope.
- **Blocked child (on_hold/withdrawn/transferred):** hidden from the family picker automatically
  because `parentSession` already filters `BLOCKED_LMS_LIFECYCLE` (`lms.ts:52-54`). No extra code.

### D6. Password change / reset (family-level)

- **(a) Parent self-service change** — `guardian.changeFamilyPassword({ newPassword })`,
  **parentProcedure**. The caller IS the family credential (authenticated parent session); no old
  password required. Update `ParentAccount.passwordHash` under SYSTEM context + bump
  `ParentAccount.tokenVersion` (revokes live family/parent sessions → forces re-login). Own
  account by definition — no cross-account write possible (uses `ctx.lms.accountId`).
- **(b) ERP reset** — `guardian.resetFamilyPassword({ parentAccountId })`, staff permission
  (mirror the `student.resetLmsPassword` gate). Force `ParentAccount.passwordHash =
  hash('Cmc2026@')` + bump `ParentAccount.tokenVersion`. Confirm-only, no input field. Surfaced
  on parent admin detail. Additionally, the existing **`student.resetLmsPassword`** stays on
  student detail but switches random→fixed default (resets the break-glass per-child credential).
- **loginCode scheme reconciliation.** The break-glass loginCode is created in
  TWO places with DIVERGENT schemes: provisioning uses the facility-prefixed
  `${facility.code}-${student.studentCode}` (`finance.ts:935`), but `student.resetLmsPassword`'s
  create-branch sets the BARE `student.studentCode` (`student.ts:171`). `login_code` is a GLOBAL
  `@unique` (`schema.prisma:575`), so the bare form drops the facility prefix that keeps it
  collision-free — two facilities with the same `HS-2026-0001` studentCode would collide. Align
  BOTH creation paths to the facility-prefixed `${facility.code}-${studentCode}` form so the
  break-glass login staff relay to parents is consistent and globally unique.
- **Cascade revocation — CONFIRMED: NO cascade.** Family change/reset bumps ONLY
  `ParentAccount.tokenVersion`. Already-entered child STUDENT sessions (minted via
  `enterChildProfile`) carry the child's own `StudentAccount.tokenVersion` and are NOT revoked
  (valid until natural cookie expiry). Given student session security is de-scoped, this is
  accepted (YAGNI) — cascading would also require bumping every guardianed child's
  `StudentAccount.tokenVersion`, adding complexity for a de-scoped threat.
  **Good property (kept):** bumping `ParentAccount.tokenVersion` DOES evict any live family/parent
  (email-OTP) session, since `resolveLmsSession` rechecks that version (`lms.ts:125`). So a family
  password change/reset immediately invalidates the parent-portal OTP session too — no-cascade
  only leaves already-entered per-child STUDENT sessions live.

### D7. Legacy — no backfill. Pre-launch; new provisioning + changed reset/login only.

## Consequences

- No Prisma migration (credential + value-scheme + new routers + a signed selection ticket only).
  Low blast radius, easy rollback (revert router/helper/UI commits).
- New auth-layer surface: the child-selection ticket sign/verify path in `packages/auth`.
- The genuinely new authz surface = `enterChildProfile` (ticket-gated child selection) +
  `changeFamilyPassword` (parent self-write). Both MUST have explicit cross-family FORBIDDEN
  tests, and `enterChildProfile` MUST re-resolve children server-side (never trust a client list).
- `loginStudent` retained (break-glass) → its tests stay but assert the fixed default, not random,
  and the facility-prefixed loginCode.
- Provisioning's ParentAccount find-or-create is race-safe (SAVEPOINT+`P2002` refetch or
  `ON CONFLICT DO NOTHING`+refetch) so a concurrent first-sibling approve cannot roll back the
  money tx.
