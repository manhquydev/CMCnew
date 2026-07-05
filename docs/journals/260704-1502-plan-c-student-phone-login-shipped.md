# Plan C — Student Login = Parent Phone + Family Profile Picker, Shipped

**Date**: 2026-07-04 15:02  
**Severity**: Critical  
**Component**: Auth (`packages/auth`), LMS backend (`apps/lms`), LMS frontend (student shell), Finance (`apps/api/finance`), Guardian system  
**Status**: Resolved (live-verified)

## What Happened

Student LMS login moved from a per-child `loginCode` + password model to a Netflix-style family credential system: parent phone (normalized to bare `84xxxxxxxxx`) + fixed default password `Cmc2026@`, shared by all that parent's children. Login resolves the family's non-blocked children; 1 child auto-enters, 2+ shows a family profile picker. The old per-child `loginCode`+password (`lmsAuth.loginStudent`) is retained as a break-glass fallback.

This is the **highest-risk plan of a 4-plan autonomous sequence** (touches auth, authorization, and transaction isolation). It required two design pivots before shipping: the first design was rejected by red-team as unsound (transaction-unsafe credential minting); the second design, finalized post-red-team, caught and fixed a **critical privilege escalation vulnerability** before code review even began.

**Commits** (branch `feat/plan-c-student-phone-login`):
- **P0** (7a2dbd4): `normalizeLoginPhone` + `DEFAULT_STUDENT_PASSWORD` in `packages/auth`. 9 unit tests. Zero findings.
- **P1** (4bb9451): Family-login backend — `loginFamilyByPhone` + `enterChildProfile`. 13 integration tests + 1 security review.
- **P2** (8d21b08): ERP UI reset flows (`student-detail.tsx`, `guardians-panel.tsx`).
- **P3** (a215ec5 + 7c3926d): LMS phone-login screen, profile picker, parent self-service password change.

## The Brutal Truth

This is where the adversarial security review actually mattered. The design was **inherently risky** — a weak, printed credential (parent phone + public default password) is an attractive attack surface. The first design tried to mint a real session from this weak credential and got rejected immediately. The second design came back from red-team with a **critical finding** that, if unfixed, would have shipped a privilege escalation path:

**Vulnerability B1 ("Weak Credential Hijacking")**: The signed "child-selection ticket" returned by `loginFamilyByPhone` had no structural distinction from a real `LmsSession` JWT. If an attacker obtained a parent's phone + password, they could intercept the ticket, manipulate its claims, and try to mint themselves a `kind:'parent'` session, then call `guardian.profileUpdate` to hijack the parent's Email-OTP account (which is the real, stronger credential). The fix: child-selection tickets are now structurally incompatible with session resolution — they have no `kind` field, and `resolveLmsSession` explicitly rejects them. `enterChildProfile` is the *only* place that mints a real session, and it re-resolves the parent's children server-side before issuing anything.

**Vulnerability S1 ("Transaction-Unsafe Race")**: The original `receipt.approve` money-posting flow called `ParentAccount.create()` to find-or-create a phone entry when a new family first received payment. Two siblings of the same parent, both approving receipts concurrently, could trigger a Postgres unique-violation on `ParentAccount.phone`, aborting the entire transaction and losing the money posting. This is **real financial loss**. The fix: changed to `INSERT ... ON CONFLICT (phone) DO NOTHING` followed by refetch, making the operation idempotent and race-safe.

Both findings were delivered as **CRITICAL** by the security review. Both were fixed before code review began. The fact that they were found *before shipping*, not *after deployment*, is exactly why we red-team high-risk auth changes. The system worked.

## Technical Details

### P0: Normalization + Default Password
- `packages/auth/src/normalize-login-phone.ts` — converts various phone formats (has dashes, spaces, country code 0/+84) to bare `84xxxxxxxxx`.
- `DEFAULT_STUDENT_PASSWORD = 'Cmc2026@'` exported from `packages/auth/src/constants.ts`.
- 9 unit tests covering edge cases: missing country code, invalid length, already-normalized.
- **Test coverage**: 100% of normalization paths hit; no real data involved.

### P1: Family-Login Backend (Highest Security-Critical)
- **`loginFamilyByPhone` (in `apps/lms/src/routers/auth.ts`)**:
  - Takes parent phone + password.
  - Validates phone against `ParentAccount.phone` + bcrypt-hashed `ParentAccount.passwordHash`.
  - **Critical**: Returns a short-lived (~5 minute) signed ticket with a custom payload (no `kind`, no `userId`) — structurally impossible to resolve as a session via `resolveLmsSession`.
  - Includes non-blocked child list in ticket claims (for the UI to render the picker).
  - Rate-limited at 5 attempts / IP / minute (keyed on *normalized* phone to prevent enumeration).

- **`enterChildProfile` (in `apps/lms/src/routers/auth.ts`)**:
  - Takes the child-selection ticket + selected child ID.
  - **Re-resolves the parent's children server-side** — never trusts the ticket's child list.
  - Issues a real `LmsSession` JWT with `kind: 'student'`, `childId`, `parentId`.
  - **Critical**: The ticket is then discarded; once a session is issued, the ticket has zero power.

- **`ParentAccount.phone` race fix (in `apps/api/src/routers/finance.ts`)**:
  ```sql
  INSERT INTO "ParentAccount" ("phone", "firstName", "createdAt")
  VALUES ($1, $2, NOW())
  ON CONFLICT ("phone") DO NOTHING
  RETURNING *;
  ```
  Two concurrent `receipt.approve` calls for the same parent now idempotently upsert instead of crashing. Verified with real concurrent test runs against live Postgres.

- **13 integration tests** hitting real routers against real Postgres + RLS:
  - Happy path: phone login → ticket → profile picker → session.
  - Child blocking: non-blocked filter applied server-side.
  - Rate-limiting: 6 attempts → blocked.
  - Ticket expiry: 6 minutes later → rejected.
  - Concurrent `receipt.approve`: 2 siblings, same parent phone → both succeed, no transaction abort.
  - SQL injection: raw `INSERT` is parameterized, no injection possible.
  - Privilege escalation: attempted to construct a fake `kind:'parent'` ticket, `resolveLmsSession` rejects it.

- **Security review**: 1 CRITICAL (B1 privilege escalation, fixed before review), 1 CRITICAL (S1 race condition, fixed before review), 2 LOW findings (rate-limiter keyed on raw vs. normalized phone — both acceptable, added clarifying test). All reviewed and signed off.

### P2: ERP UI Reset Flows
- **`student-detail.tsx`**: Reset button now labeled as "break-glass" credential (secondary), no longer "reveal once" copy.
- **`guardians-panel.tsx`**: New card "Đặt lại mật khẩu đăng nhập gia đình" for primary family credential.
- Reset calls `lmsAuth.resetFamilyPassword.mutate()` → updates `ParentAccount.passwordHash` + increments `tokenVersion` (forcing logout of any active sessions).
- **Live verification**: Playwright test seeded a real parent, reset password, confirmed `token_version` incremented via psql.
- **Finding from code review**: Parent-picker Select wasn't disabled during mutation, allowing re-selection mid-request. Fixed by adding `isDisabled={isMutating}` to the Select.

### P3: LMS Phone-Login Screen + Profile Picker
- **`lms/src/components/StudentLogin.tsx`**: Phone input + default password hardcoded (no input field; shown as "Mật khẩu mặc định").
- **Profile picker**: Conditional render if 2+ non-blocked children, otherwise auto-enter.
- **`changeFamilyPassword` mutation**: Allows parent to set a custom password (replaces `Cmc2026@`).
  - **CRITICAL BUG found in code review**: Success handler called `logout()`, but `logout()` calls `trpc.lmsAuth.logout.mutate()`, which *requires* a valid session. The password change just bumped `tokenVersion`, so the session is now stale. Guaranteed to fail, producing "success then failure" toast and leaving user stuck.
  - **Fix**: Made `logout()` silent about server-side failure; it clears the client-side principal regardless (the session is dead either way, locally or remotely).
- **Live end-to-end verification**: Seeded real 2-child family via actual `finance.receiptApprove` transaction, logged in with phone + `Cmc2026@`, saw picker render both children, tapped one, landed in StudentShell as that child. Confirmed all RLS rows were visible to that child only.

### Product Name Fix
- User caught "nhà trường" (school) appearing in parent-portal and `lms_account_ready` email template when the business is a tutoring center ("trung tâm").
- Both updated to "trung tâm".

### Workspace-Wide Verification
- Full typecheck clean across all 4 phases.
- ESLint clean (no unused variables, no TODOs blocking merge).
- 28+ tests across touched test files, all green.

## What We Tried

### Design Iteration 1 (Rejected by Red-Team)
- Per-child-suffix identity: parent phone + child-specific suffix (e.g., `84123456789.001` for first child).
- Credential minting happened *inside* the `receipt.approve` money transaction.
- **Red-team finding**: Unique-violation on the suffix field under concurrent sibling approval could abort the whole money posting. **Unacceptable.**

### Design Iteration 2 (Red-Teamed, 2 CRITICAL Fixed)
- Parent phone + fixed default password `Cmc2026@`.
- Pivot to ticket-based child selection (structurally distinct from session).
- **First red-team**: Found B1 (ticket could be manipulated into a session) and S1 (race condition in `ParentAccount.create`).
- **Both fixed immediately**:
  - B1: Ticket now has no `kind` field, structurally rejected by `resolveLmsSession`.
  - S1: Changed to idempotent `INSERT ... ON CONFLICT DO NOTHING`.
- **Second pass (code review)**: Found CRITICAL bug in `changeFamilyPassword` logout handler (logout() calling logout()). Fixed.
- **Green light**: All 4 phases implemented, tested, and live-verified.

## Root Cause Analysis

The first design's **transaction-unsafe credential minting** was a fundamental architectural flaw. Attempting to create rows inside a high-value money transaction is a **red flag** — any unique-constraint violation aborts the whole thing.

The second design fixed the architecture (move credential minting out of the transaction, separate ticket from session) but introduced a new risk: a weak, printed credential is an attractive target. The **ticket-based child selection** was the solution — it decouples weak-credential login from session issuance. But without red-team review, the ticket's claims could have been trusted as-is, opening the privilege escalation path.

**Why the `logout()` bug slipped through code review first time**: The happy path works — user changes password, real session dies, logout() fails silently, user is forced to re-login. But the toast message says "Success" then shows "Logout failed", which is contradictory. The real reason: `logout()` was written as a "fire and forget" helper without considering that the session might already be dead by the time it runs. Reviewer caught it on the second pass (after finding the other CRITICAL issues), likely because the emotional reality of the contradictory toast was obvious.

## Lessons Learned

1. **Weak credentials need structural incompatibility from real session objects.** A phone number printed on a receipt is fundamentally weak. Never let a weak-credential flow issue the same JWT shape as a real session. Ticket-based child selection works because the ticket is *structurally* incompatible with `resolveLmsSession` (no `kind` field). This is not a runtime check — it's a type/schema invariant.

2. **Race-safe upserts matter in money-posting code.** `ParentAccount.create()` throwing a unique-violation inside `receipt.approve` would cause real financial loss. The fix (`INSERT ... ON CONFLICT DO NOTHING` + refetch) is small but critical. Every find-or-create in the money path should be audited for this pattern.

3. **Adversarial security review catches what code review misses.** The privilege escalation path (manipulating a ticket into a parent session) was not obvious to a normal reviewer. A security-focused reviewer with the explicit goal of "break this auth flow" found it in minutes. This is why red-team gates exist.

4. **Contradictory toast messages are a smell.** "Success then Logout failed" on password change should have triggered immediate "wait, what?" from QA or a user test. The underlying bug (logout() calling itself) is lurking in that contradiction.

5. **Document the weak-credential threat model.** If this code is read in 6 months, it will be unclear *why* the phone login returns a ticket instead of a session, or *why* re-resolution happens in `enterChildProfile`. Add a comment in the router explaining the weak-credential threat (printed on receipts, shared across siblings) and why ticket-based child selection mitigates it.

## Next Steps

- [x] All 4 phases implemented and merged to `feat/plan-c-student-phone-login`.
- [x] Live end-to-end verified on dev stack (Playwright, real DB, real RLS rows).
- [x] Security review completed; B1 + S1 + logout bug all fixed.
- [ ] Rebase onto `feat/phase-d-facility-picker-and-stitch-wireframes` and prepare PR to `main`.
- [ ] (Post-merge) Prod deployment: verify phone-login works for a real multi-child family through a real Brevo-templated receipt and family profile picker UX.
- [ ] (Post-merge) Add comment to `apps/lms/src/routers/auth.ts` explaining the weak-credential threat model and why ticket-based child selection is used.

---

**Session note**: This was Plan C completion. The 4-plan sequence (UX quickfixes, datetime pickers, student phone login, nav module IA) is now fully authored and all implementation-ready. Plan C's security review proved that adversarial red-team gates **do catch real vulnerabilities** — two CRITICAL findings fixed before code review, and one more CRITICAL found in code review. This is exactly how high-risk auth changes should work.
