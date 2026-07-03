# Red-Team Security Adversary Review — Persona QA Fleet Plan

Role: Fact Checker / Security Adversary. Verdict: **the plan's core premise is factually false and cannot execute as written.** Two Critical findings independently block it before any UX value is produced.

---

## Finding 1: Staff QA accounts physically cannot password-login — admin UI never sets a usable password, and no staff password-set/reset endpoint exists

- **Severity:** Critical
- **Location:** Phase 1, step 2 ("use the real admin UI staff-creation flow ... Set a throwaway password for each")
- **Flaw:** The plan assumes the admin staff-creation UI can set a password. It cannot. `user.create` takes **no password input** and hard-codes an unknowable random hash. There is **no staff password reset/set endpoint anywhere** in the API.
- **Failure scenario:** Operator sets `STAFF_PASSWORD_LOGIN=true`, creates `qa-test-sale@…` etc. via the UI. Each account's `passwordHash = hashPassword(randomBytes(32))` — a value never returned or stored anywhere. The 4 staff personas have no password to log in with. `auth.ts:34` would even *permit* password login now, but there is no credential to present. Phase 1 success criterion "each logs in successfully with password auth" is unachievable. Phases 2–3 (the entire deliverable) never start.
- **Evidence:**
  - `apps/api/src/routers/user.ts:80-82` — input schema comment: "No password input: staff authenticate exclusively via Microsoft SSO."
  - `apps/api/src/routers/user.ts:147-149` — `passwordHash: await hashPassword(randomBytes(32).toString('base64url'))` "never returned or transmitted, so password login is impossible for staff."
  - Grep for `resetPassword|setPassword|changePassword|updatePassword` across `apps/api/src/routers` → **No matches** (only LMS student `resetLmsPassword` exists; `packages/auth/permissions.ts:257` is LMS-only).
- **Suggested fix:** The premise is unworkable via the stated path. Options: (a) direct DB seed of a known `passwordHash` for the 4 QA accounts (contradicts the plan's "real UI onboarding" goal, but is the only way to get a known staff password); (b) drop staff personas entirely and audit only student/parent flows; (c) build a temporary super_admin-only "set QA password" path (scope creep, touches auth — high-risk lane). Whichever, Phase 1 as written must be rewritten, not tweaked.

---

## Finding 2: Student login is loginCode + password, NOT OTP; Phase 1 omits the required LMS-provisioning step

- **Severity:** Critical
- **Location:** Phase 1, step 3 + step 4; Phase 2 persona table ("Học sinh … Log in via OTP")
- **Flaw:** The plan states the student persona logs in "via OTP / passwordless." False. Only **parents** have OTP. **Students authenticate with `loginCode` + `password`** (`lms-auth.loginStudent`). A student account + password does not exist after plain student creation — it requires a separate director-gated `student.resetLmsPassword` call, which Phase 1 never performs.
- **Failure scenario:** Operator creates a `[QA-TEST]` student via the student-creation UI, then tries "OTP login" on hoc.cmcvn.edu.vn. There is no OTP path for students. Even the correct path (loginCode+password) fails because no `studentAccount` / password was provisioned. Student persona blocked at step 1.
- **Evidence:**
  - `apps/api/src/routers/lms-auth.ts:36-48` — `loginStudent` input `{ loginCode, password }`; OTP procedures (`otpRequest`/`otpVerify`, lines 53-73) mint a **parent** session only (`mintParentSession`).
  - `apps/api/src/routers/student.ts:139-188` — `resetLmsPassword` (gate: both directors) is what creates the `studentAccount` with `loginCode = studentCode` and returns `tempPassword` **once**. Plain `student.create` does not.
- **Suggested fix:** Rewrite Phase 1 to (1) call `resetLmsPassword` for the QA student and capture the one-time `tempPassword`, and (2) correct Phase 2's task list to "log in with loginCode + password," not OTP.

---

## Finding 3: Parent OTP is undeliverable to an automated agent on prod — devCode is suppressed in production, code only goes to the real email inbox

- **Severity:** High
- **Location:** Phase 1, success criterion "parent can complete OTP login"; Phase 2 ("Phụ huynh … Log in via OTP")
- **Flaw:** In production the OTP code is emailed via Brevo/Graph and the `devCode` return is explicitly suppressed. A browser-automation agent has no inbox access, so it can never read the 6-digit code.
- **Failure scenario:** Parent persona calls `otpRequest`; prod (`NODE_ENV=production`) returns `{ ok: true }` with **no** `devCode`. The code lands in whatever mailbox `qa-test-phuhuynh@…` maps to (a non-existent/unmonitored address → bounce, or a real CMC mailbox the agent can't open). Agent cannot complete `otpVerify`. Parent persona blocked; and welcome/OTP mail to a fake `@cmcvn.edu.vn` address hits real Brevo/Graph sending reputation.
- **Evidence:**
  - `apps/api/src/services/login-otp.ts:65-68` — `if (transportDisabled && process.env.NODE_ENV !== 'production') { … return { devCode: code }; }` — devCode only in non-prod with transport unconfigured.
  - `apps/api/src/services/login-otp.ts:47-63` — real send via `sendViaBrevo`/`sendViaGraph`, transport chosen by `decideTransport(to)`.
- **Suggested fix:** Provision the QA parent with an email inbox the agent can actually read (e.g. a mailbox exposed via an API the agent can query), or temporarily allow a devCode path for a whitelisted QA email — both are policy/scope decisions the plan must make explicit. As written, the parent persona cannot run on prod.

---

## Finding 4: STAFF_PASSWORD_LOGIN is a GLOBAL prod flag — it downgrades the fail-closed SSO invariant for every staff account for the whole run, with no scoping, time-box, or monitoring

- **Severity:** High
- **Location:** Phase 1, step 1; Phase 4, step 1 (revert)
- **Flaw:** The flag is not scoped to `[QA-TEST]` accounts — it is a process-wide env var gating the `auth.ts:34` branch for **all** non-super-admin staff. For the entire multi-hour persona run, prod is flipped from "SSO-only, fail-closed" (the documented deliberate posture) to "password login enabled for any staff email." Revert depends on a single manual step in Phase 4; if the session dies, the api container is restarted by ops, or the step is forgotten, prod is left fail-open indefinitely.
- **Failure scenario:** Flag is enabled; a redeploy/restart during the window re-reads the env and keeps it on; the session ends abnormally before Phase 4; prod silently remains password-login-enabled — exactly the drift `auth.ts:30-33` was written to prevent. (Residual brute-force risk is bounded because staff hashes are random 256-bit and the login limiter throttles per-IP/pair — but the deliberate security invariant is defeated.)
- **Evidence:**
  - `apps/api/src/routers/auth.ts:30-36` — comment: "must stay unset in production"; the guard keys solely on `process.env.STAFF_PASSWORD_LOGIN !== 'true'`, no per-account scope.
  - `docs/prod-deploy-security-runbook.md:39` — "Fail-closed: KHÔNG set STAFF_PASSWORD_LOGIN ở prod (chỉ super_admin break-glass)."
  - `docker/docker-compose.prod.yml:103-107` — "Set STAFF_PASSWORD_LOGIN=true ONLY for a local/seed environment."
- **Suggested fix:** Do not toggle a global auth flag on live prod. Prefer a disposable staging/prod-mirror stack for the persona run. If prod is mandatory, add a hard time-box + an automated revert (cron/timer that unsets and restarts), a health assertion that the flag is off in Phase 4, and explicit human sign-off (this is a Hard Gate — Auth — per `docs/FEATURE_INTAKE.md`, so high-risk lane with a durable decision is required, not a P2 pending plan).

---

## Finding 5: The only password-capable account is the seeded super_admin — falling back to it destroys the "blind role-realistic persona" premise and runs unsupervised automation at max blast radius

- **Severity:** Medium
- **Location:** Phase 2 (staff personas), consequence of Finding 1
- **Flaw:** Since created staff accounts have no usable password (Finding 1), the only staff identity that can password-login on prod is the bootstrap `super_admin` (`auth.ts:34` `isSuperAdmin` short-circuit). If the run silently falls back to super_admin, the four "role-scoped" personas all act as an omnipotent account — invalidating every RBAC/scope observation and pointing a browser-automation agent with full admin authority at live prod.
- **Failure scenario:** Operator, blocked by Finding 1, logs all staff personas in as `admin@cmcvn.edu.vn`. The "Sale can/can't see X" findings are meaningless (super_admin sees everything). Worse, an automated agent clicking through admin destructive actions (deactivate user, archive records) runs with no authorization ceiling.
- **Evidence:** `apps/api/src/routers/auth.ts:34` — `!result.session.isSuperAdmin && …` means super_admin bypasses the flag entirely; it is the one account that always password-logs-in.
- **Suggested fix:** Explicitly forbid super_admin as a persona identity in the plan; if staff personas can't get real scoped credentials, cut them rather than substitute super_admin.

---

## Finding 6: Cleanup (Phase 4) is under-specified — misses OTP rows, studentAccount/tokenVersion side effects, audit events, outbound mail, and the plaintext credential scratch file

- **Severity:** Medium
- **Location:** Phase 4, steps 2-3; Phase 1 success criterion (credentials in "a local scratch file")
- **Flaw:** Phase 4 only soft-archives `[QA-TEST]` accounts/leads. The run also produces: `loginOtp` rows (`login-otp.ts:42`), a `studentAccount` with bumped `tokenVersion` (`student.ts:163-176`), audit `logEvent` rows (`user.ts:156`, `student.ts:177`), and real welcome/OTP emails sent to fake `@cmcvn.edu.vn` addresses via Brevo/Graph. None are enumerated. The plaintext prod credentials written to a "local scratch file" (Phase 1) have **no deletion step** in Phase 4.
- **Failure scenario:** After "cleanup," prod retains QA audit noise and a studentAccount, real emails have bounced against sending reputation, and a scratch file with live prod credentials persists on the operator's disk indefinitely.
- **Evidence:** `apps/api/src/services/login-otp.ts:42`; `apps/api/src/routers/student.ts:163-176,177`; `apps/api/src/routers/user.ts:156,164-166`; Phase 4 steps 2-3 (no mention of these artifacts or the scratch file).
- **Suggested fix:** Enumerate every artifact class in Phase 4, and add "securely delete the credential scratch file" as an explicit, verified step.

---

## Finding 7: Six parallel agents behind one VPS/NAT egress IP will trip the per-IP login and OTP rate limiters, causing false "blocker" findings and cross-persona lockout

- **Severity:** Medium
- **Location:** Phase 2, step 1 ("Spawn all 6 as parallel Agent tool calls")
- **Flaw:** The login limiter is per-IP (20 failed logins / 15 min) and per-(IP+identifier) (5 / 15 min); OTP request is 5 / 15 min per IP. Six agents fumbling logins from a shared egress IP will exhaust the per-IP window and lock out unrelated personas — noise that masquerades as product bugs, and a self-inflicted blocker.
- **Failure scenario:** Two personas mistype/retry login a few times; the shared-IP counter hits 20; the remaining personas get `TOO_MANY_REQUESTS` on their first attempt and report a false "login is broken" blocker, polluting the UX audit.
- **Evidence:** `apps/api/src/rate-limit.ts:23-26` (`PAIR_LIMIT=5`, `IP_LIMIT=20`, window 15 min); `apps/api/src/routers/lms-auth.ts:10,56-57` (OTP `throttle` per-IP `OTP_RATE_LIMIT=5`).
- **Suggested fix:** Run personas from distinct egress IPs, or stagger/serialize the login step, or temporarily raise the limits for the QA window (and revert in Phase 4). At minimum, the plan should note that a `TOO_MANY_REQUESTS` during the run is an artifact, not a finding.

---

## Summary

Two Critical blockers make the plan non-executable as written: (1) staff QA accounts have no obtainable password because the admin UI deliberately never sets one and no reset endpoint exists, and (2) the student persona login method is misdescribed (loginCode+password, not OTP) with the required provisioning step omitted. The parent-OTP path is also undeliverable to an automated agent on prod (High), and the global `STAFF_PASSWORD_LOGIN` prod toggle is an unscoped auth-invariant downgrade that belongs in the high-risk lane with a durable decision, not a P2 pending plan.

**Unresolved questions for the planner:**
- Is a staging / prod-mirror stack available so this never touches live prod auth posture?
- How is the QA parent's email inbox made readable to the automation agent (or is a whitelisted devCode acceptable)?
- If staff personas can't get scoped credentials, is dropping them (vs. super_admin substitution) acceptable to preserve audit validity?

Status: DONE_WITH_CONCERNS
Summary: Plan is factually non-executable — 2 Critical blockers (no obtainable staff password; student login misdescribed) plus a High undeliverable parent-OTP path and a High unscoped global prod auth downgrade.
Concerns/Blockers: Phase 1 must be rewritten, not patched; the auth-flag toggle is a Hard Gate (FEATURE_INTAKE) requiring high-risk lane + durable decision.
