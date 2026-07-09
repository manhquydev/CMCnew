# Auth & Session — Latent-Bug Audit (report-only)

Date: 2026-07-09
Scope: staff login, LMS login (student/family/OTP), session/JWT, tokenVersion revocation,
RLS context derivation, rate-limit, STAFF_PASSWORD_LOGIN gate (decision 0031), anti-escalation.
Branch: develop. No source files were modified.

Files read:
- `packages/auth/src/index.ts`, `packages/auth/src/lms.ts`, `packages/auth/src/jwt.ts`
- `apps/api/src/routers/auth.ts`, `apps/api/src/routers/lms-auth.ts`, `apps/api/src/trpc.ts`, `apps/api/src/context.ts`
- `apps/api/src/rate-limit.ts`, `apps/api/src/services/login-otp.ts`
- `apps/api/src/routers/user.ts`, `student.ts`, `guardian.ts`
- `packages/db/prisma/migrations/20260623053955_app_user_rls_and_token_trigger/migration.sql`
- `packages/db/src/index.ts` (withRls), `docker/nginx-prod.conf`, `docker/nginx.conf`

---

## HIGH-1 — Per-IP login limiter collapses onto Cloudflare edge IPs → trivial global login DoS + false lockout

**Where:** `apps/api/src/context.ts:21-27` (IP derivation) feeding `apps/api/src/rate-limit.ts:57,64-80` (`ipKey` / `checkLoginLimit` / `recordLoginFailure`); nginx configs `docker/nginx-prod.conf` (no `real_ip` restoration).

**The bug:** `context.ts` derives the client IP as `x-real-ip` (set by nginx to `$remote_addr`), documented as "the real peer … the client cannot forge." In the actual prod topology the real peer of nginx is **Cloudflare**, not the browser:
- `nginx-prod.conf` serves the tRPC API at `/api/` (`proxy_pass http://api_backend`) on the SAME hostnames that are Cloudflare-proxied (CSP at line 71 whitelists `static.cloudflareinsights.com` / `cloudflareinsights.com`; project memory: "erp+hoc.cmcvn.edu.vn live via Cloudflare").
- There is **no** `set_real_ip_from <CF ranges>` + `real_ip_header CF-Connecting-IP` anywhere in the nginx configs (grep for `real_ip`/`CF-Connecting-IP` returns nothing but comments/reports).

Therefore `$remote_addr` == a Cloudflare edge IP, and `ctx.ip` is the **same handful of CF edge IPs for every real user**.

Now look at the limiter: `ipKey(ip) = login:ip:<CFedge>` is bumped on **every** failed login regardless of identifier (`recordLoginFailure`, rate-limit.ts:76-80), and `clearLoginLimit` (rate-limit.ts:83-85) clears only the `pairKey`, **never** the `ipKey`. So the per-IP bucket accumulates ALL failures from ALL users behind that edge IP and is only released when the 15-min window expires.

**Failure scenario / repro:**
1. Attacker sends 20 failed `authRouter.login` (or `lms-auth.loginStudent`) requests in 15 min (any bogus email/password). `IP_LIMIT` default = 20 (rate-limit.ts:25).
2. `ipKey:<CFedge>` now `count >= 20`. `checkLoginLimit` (rate-limit.ts:67) throws `TOO_MANY_REQUESTS` for the CF edge IP.
3. **Every** legitimate parent/student/staff member routed through that same CF edge IP is now locked out of login for the rest of the window — a one-request-per-second, unauthenticated global DoS.
4. Same effect can trigger organically: a tuition center where dozens of parents log in from the same session — 20 accumulated typos across the whole user base in 15 min self-locks everyone. This is exactly the shared-NAT lockout the "only failures count" design (rate-limit.ts:15-17) tried to avoid, but that mitigation assumes distinct client IPs — which CF flattening destroys.

**Why it's a real bug:** the security assumption written into `context.ts:21-24` ("client cannot forge … the real peer") does not hold once Cloudflare proxies the API; the code never restores `CF-Connecting-IP`. The result is both an availability defect (trivial DoS) and a correctness defect (per-IP throttle is effectively global, not per-source). Per-identifier (`pairKey`) throttling still works, so brute-force of a single account is still bounded — the damage is the shared per-IP bucket.

**Verification dependency:** confirm the API hostnames are Cloudflare-proxied (orange-cloud), not DNS-only, for the `/api` path. If DNS-only today, this is still a latent trap that arms itself the moment proxying is enabled. Fix direction (not applied): restore the real client IP at the edge (nginx `real_ip_header CF-Connecting-IP` + `set_real_ip_from` CF ranges) OR read `cf-connecting-ip` first in `context.ts`.

---

## MED-2 — Timing side-channel account enumeration in all three password logins (contradicts "no enumeration" claim)

**Where:** `packages/auth/src/index.ts:73-74` (staff `login`), `packages/auth/src/lms.ts:103-104` (`loginStudent`), `packages/auth/src/lms.ts:153-154` (`loginFamilyByPhone`).

**The bug:** each path returns early **before** calling the (deliberately slow) `verifyPassword` when the account is absent/inactive:
- `login`: `if (!user || !user.isActive) return null;` then `if (!(await verifyPassword(...)))`.
- `loginStudent`: `if (!acc || !acc.isActive) return null;` then `verifyPassword`.
- `loginFamilyByPhone`: `if (!acc || !acc.isActive || !acc.passwordHash) return null;` then `verifyPassword`.

A request for a **non-existent / inactive** identifier returns fast (one indexed lookup); a request for a **real active** identifier with a wrong password spends the full password-hash verification time. The response body/code is identical, but the latency is not.

`loginFamilyByPhone`'s own doc comment (lms.ts:145-146) asserts "callers must not distinguish 'wrong phone' from 'wrong password' (no account enumeration)" — the response is unified but the **timing is not**, so the guarantee is only half-implemented. The OTP path (`login-otp.ts:57-59`) explicitly hardened this exact class ("shrinking the timing side-channel between known/unknown email (MED-3)"), showing the project treats it as in-scope; the password paths were not given the same treatment.

**Failure scenario / repro:** attacker submits login attempts for a list of candidate emails/phones/loginCodes with an arbitrary password; measures round-trip time. Fast (~single-digit ms) ⇒ account does not exist / inactive; slow (hash cost, tens–hundreds of ms) ⇒ account exists and is active. Yields a validated roster of parent emails / student loginCodes / staff emails. Throttling (HIGH-1 aside) caps volume but not the signal.

**Why it's a real bug:** the "no enumeration" property is explicitly claimed and partially relied upon, but the early-return-before-hash pattern leaks existence via timing. A dummy `verifyPassword` against a constant hash on the not-found branch would equalize it.

---

## MED-3 — Student LMS account takeover: constant password + guessable loginCode (decision-0033-accepted residual risk)

**Where:** `apps/api/src/routers/student.ts:159-184` (`resetLmsPassword` sets `DEFAULT_STUDENT_PASSWORD`), login at `packages/auth/src/lms.ts:98-109` (`loginStudent` = loginCode + password), loginCode scheme `${facility.code}-${student.studentCode}` (student.ts:180).

**The bug (residual, accepted):** every student LMS credential is provisioned/reset to the same fixed constant `DEFAULT_STUDENT_PASSWORD` (`Cmc2026@`), and the only real secret is the `loginCode`, which is a deterministic `FACILITYCODE-STUDENTCODE` string printed on receipts. Anyone who learns/guesses a student's loginCode logs in as that student (password is a public constant). Decision 0033 D2 explicitly de-scopes student-credential secrecy and names the loginCode as "what actually protects account boundaries."

**Failure scenario:** knowing a facility prefix and iterating/guessing `studentCode` values (sequential or receipt-derived) yields working student logins, bounded only by the per-loginCode rate limit. Student sessions are `kind:'student'` (read-only to their own transcripts/exercises), so blast radius is one student's LMS data, not parent-portal or staff data (the decision-0033 D4 invariant in lms.ts:135-141 keeps this path from ever minting a parent session).

**Why it's listed:** it is a genuine standing weakness in the auth domain, but it is an explicit, documented user/product decision (0033). Per `.claude/rules/review-audit-self-decision.md` I am not reversing it — flagging as accepted residual risk. If/when student PII sensitivity is re-evaluated, the fix is per-student random temp passwords (the pattern already used for staff `setPassword` and parents).

---

## LOW-4 — Non-atomic tokenVersion bump in `student.resetLmsPassword` (comment claims atomic; it isn't)

**Where:** `apps/api/src/routers/student.ts:155-167`.

**The bug:** the reset reads `existing.tokenVersion` then writes `tokenVersion: existing.tokenVersion + 1` (read-then-write). Every other revocation site uses the atomic Prisma `{ increment: 1 }` (`user.setRoles` user.ts:239, `user.setPassword` user.ts:337, `user.setActive` user.ts:303, `guardian.changeFamilyPassword`/`resetFamilyPassword` guardian.ts:338,370). The comment at student.ts:333-334 even asserts this pattern "matches setRoles/setFacilities/setActive" — but here it does not; it is the one place doing a lost-update-prone computed write. `withRls` is a real `$transaction` (packages/db/src/index.ts:54) at READ COMMITTED, so two concurrent resets both read version N and both write N+1.

**Impact (why LOW):** the write sets an absolute value derived from a stale read, so concurrent resets can "lose" a bump (final N+1 instead of N+2). Revocation still works for the common case — any outstanding JWT at version N is rejected because N ≠ N+1. It only degrades if bump-count precision ever mattered (it doesn't for revocation), and student sessions are de-scoped (decision 0033). Real defect + misleading comment, but low blast radius.

---

## LOW-5 — OTP / passwordless parent login mints a `kind:'parent'` session even with zero accessible children (inconsistent with family login)

**Where:** `packages/auth/src/lms.ts:45-71` (`parentSession`), `mintParentSession` (lms.ts:115-122) via `otpVerify` (lms-auth.ts:120-131); contrast `loginFamilyByPhone` (lms.ts:156) which rejects `resolved.students.length === 0`.

**The bug:** `parentSession` returns a valid session when **every** guardianed child is in `BLOCKED_LMS_LIFECYCLE` (on_hold/withdrawn/transferred) — `students`/`studentIds`/`facilityIds` all empty. `loginFamilyByPhone` guards against this (`if (!resolved || resolved.students.length === 0) return null`), but the OTP path (`mintParentSession` → `otpVerify`) and `resolveLmsSession` do **not**. So a parent whose children are all withdrawn can still obtain a `kind:'parent'` session with empty scope via Email OTP.

**Failure scenario:** all children withdrawn → family-phone login is refused, but Email-OTP login succeeds and returns a parent session. `lmsRlsContextOf` (lms.ts:28-36) then yields `facilityIds: [], studentIds: []`.

**Impact (why LOW):** the empty RLS scope means the parent sees nothing (facility-scoped and ownership-scoped tables both resolve to zero rows). No data exposure identified — it is a behavioral inconsistency (one entry point admits a session the other rejects) and a latent trap if any parent-scoped query ever treats "empty studentIds" permissively. Worth aligning the zero-children guard across `parentSession` consumers.

---

## LOW-6 — Logout does not revoke the token; captured JWT remains valid until 12h expiry

**Where:** `apps/api/src/routers/auth.ts:51-54` and `apps/api/src/routers/lms-auth.ts:135-138` (both just `deleteCookie`).

**The bug:** logout only clears the cookie; it does **not** bump `tokenVersion`. The session JWT (12h TTL, `jwt.ts:24,54`) stays valid server-side. A token captured before logout (e.g. copied off a shared/kiosk machine, exfiltrated via a log, or a proxy) can be replayed until natural expiry despite the user "logging out."

**Impact (why LOW):** cookies are `httpOnly` (no JS exfil) and `secure`; the standard stateless-JWT trade-off. For the kiosk case, deleting the cookie does stop the next local user. Noting it because the codebase otherwise treats `tokenVersion` as the revocation primitive (setPassword/setActive/role change all bump it) — logout is the one "end this session" action that does not, so it is not true revocation.

---

## INFO-7 — Double tokenVersion increment on staff deactivate (app increment + DB trigger)

**Where:** `apps/api/src/routers/user.ts:303` (`setActive` does `tokenVersion: { increment: 1 }`) **and** `packages/db/prisma/migrations/20260623053955_.../migration.sql:16-27` (`BEFORE UPDATE` trigger `bump_token_version_on_deactivate` adds another +1 when `is_active` flips true→false).

**Detail:** a single `setActive(false)` increments the version twice (app → N+1, trigger → N+2). Harmless for correctness (any old token ≠ new version is still rejected; the trigger is valuable as a defense-in-depth guarantee for any code path that forgets the app-level bump). Flagged only so a future reader does not treat the version number as a reliable "number of security events" counter. No action needed.

---

## Notes on things checked and found NOT to be bugs

- **Roles/primaryRole in JWT going stale:** not a bug. `resolveSession` (index.ts:110-115) re-reads the AppUser every request and `toSession` uses DB roles/facilities, so role and facility changes take effect immediately; `setRoles`/`setActive` also bump tokenVersion. `setFacilities` intentionally not bumping is safe for the same reason (facility scope is DB-resolved, never trusted from the token — jwt.ts:4-5).
- **Cross-domain token confusion (staff ↔ LMS ↔ child-selection ticket):** isolation holds. `verifyLmsToken` requires `kind ∈ {parent,student}` (jwt.ts:66-67); the ticket carries no `kind` and is gated by `typ === 'child-selection-ticket'` (jwt.ts:106); a staff token presented as an LMS cookie has no `kind` → rejected; an LMS/staff token's `sub` won't resolve against the other identity table. `enterChildProfile` re-resolves ownership server-side and only ever mints `kind:'student'` (decision 0033 D4 invariant upheld — lms.ts:189-201).
- **JWT alg confusion / `alg:none`:** not exploitable. jose verifies with a symmetric `Uint8Array` key (jwt.ts:15-22), which only admits HMAC algs and rejects `none` by default. `JWT_SECRET` length is enforced ≥32 chars.
- **OTP brute force / TOCTOU:** correctly handled — hashed single-use codes, atomic `updateMany` guards for attempts and consume (login-otp.ts:90-101).
- **Child-selection ticket replay after family password change:** correctly handled — `verifyChildSelectionTicket` re-checks parent `isActive` + `tokenVersion` (lms.ts:166-179), and password changes bump `tokenVersion`.
- **CSRF:** cookies are `SameSite=Lax` and tRPC mutations are POST; cross-site POST does not carry the cookie, so the Lax setting provides baseline CSRF protection for state-changing calls.

---

## Unresolved questions

1. Is the `/api` path on erp/teacher/hoc actually Cloudflare-proxied (orange-cloud) in prod? That determines whether HIGH-1 is live today or a latent trap. (CSP + project memory strongly indicate proxied.)
2. Should the zero-children parent case (LOW-5) be a hard login refusal everywhere, or is an empty-scope parent session an intended state for re-enrollment UX?
3. Is timing-equalization (MED-2) in scope given the OTP path already invested in it, or is per-account rate-limiting considered sufficient mitigation?

Status: DONE
Findings: HIGH 1, MED 2, LOW 3, INFO 1 (7 total). No source files edited.
