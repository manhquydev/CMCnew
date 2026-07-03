# Red-Team Plan Review — Failure Mode Analyst (Persona QA UX Audit)

Reviewer role: Failure Mode Analyst / Flow Tracer. Target: `plans/260703-1013-persona-qa-ux-audit/`.
Posture: hostile. All findings backed by codebase evidence.

## Finding 1: `STAFF_PASSWORD_LOGIN=true` opens password login for ALL real staff, not just QA accounts
- **Severity:** Critical
- **Location:** Phase 1, "Implementation Steps" step 1 (and the Overview's "temporarily enabled" framing)
- **Flaw:** The flag is a single global environment toggle with no per-account scoping. Enabling it to let 4 QA personas log in simultaneously converts every real staff account into a password-loginable target for the entire QA window.
- **Failure scenario:** While the flag is on, `admin@cmcvn.edu.vn`, `hongltn@cmcvn.edu.vn`, `nhungdt@cmcvn.edu.vn`, `quynm@cmcvn.edu.vn` (real accounts) can all be attacked via `authRouter.login` with only IP/email rate-limiting between an attacker and a real staff session. The SSO-only fail-closed design (the whole point of the flag) is globally defeated on live prod for the duration.
- **Evidence:** `apps/api/src/routers/auth.ts:34` — `if (!result.session.isSuperAdmin && process.env.STAFF_PASSWORD_LOGIN !== 'true')`. The guard checks only the global env var; there is no per-user allowlist. Phase 1 step 1 sets it in `/root/cmcnew/.env.production` for the whole `api` container.
- **Suggested fix:** State this exposure explicitly in the plan as an accepted risk with a hard time-box (e.g. run Phase 1→4 in one uninterrupted session), or better, provision the 4 staff personas as `super_admin`-free break-glass differently. At minimum, rotate/verify the 4 real staff passwords are strong before enabling, and shorten the window to minutes.

## Finding 2: Parent persona can never obtain the OTP on prod — Phase 1 success criterion is unachievable
- **Severity:** Critical
- **Location:** Phase 1 Success Criteria ("parent can complete OTP login"); Phase 2 persona table (Phụ huynh "Log in via OTP")
- **Flaw:** On production the OTP code is delivered ONLY by email; the dev-code fallback is disabled in prod, and the plan provisions no inbox the persona agent can read.
- **Failure scenario:** Parent persona calls `otpRequest`, an email is sent to the QA parent address, and the agent has no way to retrieve the 6-digit code (no inbox access is set up in Phase 1). The persona is hard-blocked at login; Phase 1's "parent can complete OTP login" gate can never pass, and Phase 2's parent run produces nothing.
- **Evidence:** `apps/api/src/services/login-otp.ts:65` — `if (transportDisabled && process.env.NODE_ENV !== 'production')` returns `devCode` only in non-prod. `apps/api/src/routers/lms-auth.ts:58` — `const { devCode } = await requestLoginOtp(input.email)` and the handler does not return the code to the client on prod. No step in Phase 1 provisions a readable mailbox.
- **Suggested fix:** Provision the QA parent account with a real, agent-accessible inbox (e.g. an IMAP/API-readable mailbox the agent can poll), or add an explicit ops step where a human relays the OTP. Otherwise drop the parent persona from this round.

## Finding 3: Student persona login method is factually wrong — students use loginCode+password, not OTP
- **Severity:** Critical
- **Location:** Phase 2 persona table (Học sinh "Log in via OTP"); Phase 1 provisioning (no student credential capture)
- **Flaw:** OTP is parent-only. Students authenticate via `loginStudent(loginCode, password)`. Phase 1 never records the student's loginCode or password, and Phase 2 tells the student persona to use OTP, which does not exist for students.
- **Failure scenario:** Student persona attempts OTP login, finds no such flow, and is blocked. Even if redirected to the real student login, Phase 1 captured no `loginCode`/password for the QA student, so it still cannot log in.
- **Evidence:** `apps/api/src/routers/lms-auth.ts:36-38` — `loginStudent: publicProcedure.input(z.object({ loginCode: z.string().min(1), password: z.string().min(1) }))`. `requestLoginOtp` resolves only `parentAccount` (`apps/api/src/services/login-otp.ts:35-38`), never students. Phase 1 Success Criteria lists parent OTP but no student loginCode/password.
- **Suggested fix:** Fix Phase 2 to say the student logs in with loginCode+password; add a Phase 1 step to capture and record the generated student loginCode + initial password.

## Finding 4: `[QA-TEST]` prefix is a naming convention with ZERO enforcement — personas can mutate/delete REAL data
- **Severity:** High
- **Location:** Phase 2 (personas told to act "realistically": create/convert/reassign/transition); plan.md Overview "`[QA-TEST]` prefix convention"
- **Flaw:** Mutations are id-targeted and gated only by RLS facility scope + role permission — nothing restricts a persona to rows whose name starts with `[QA-TEST]`. A QA persona placed in a facility that also holds real staff's data sees and can mutate those real rows.
- **Failure scenario:** The `sale`/`giam_doc_kinh_doanh` persona opens the CRM pipeline, sees real opportunities mixed with its QA ones, and (exploring "realistically") reassigns or stage-transitions a REAL opportunity by id. `opportunityTransition` to `O5_ENROLLED` stamps `closedAt` and mutates commission-attribution state on a real deal. Same exposure for `giam_doc_dao_tao` creating makeup sessions against real classes.
- **Evidence:** `apps/api/src/routers/crm.ts:306-327` (`opportunityReassign`, id-targeted `update`), `crm.ts:344-369` (`opportunityTransition`, id-targeted `update` setting `closedAt`). Both wrap only `withRls(rlsContextOf(ctx.session))` + `requirePermission` — no `[QA-TEST]` guard. The prefix appears nowhere in the router code.
- **Suggested fix:** Isolate QA personas into a dedicated throwaway facility that contains only QA data, so RLS scope itself prevents touching real rows. Naming prefixes cannot substitute for a tenant boundary.

## Finding 5: QA emails to fake/external recipients degrade the SHARED Brevo sender reputation
- **Severity:** High
- **Location:** Phase 1 step 3 (create parent/student "via real onboarding" with unspecified email), Phase 2 (flows that enqueue email)
- **Flaw:** External-domain recipients route to Brevo. The plan does not require the QA parent/student emails to be real, deliverable, controlled inboxes. Fake or typo'd addresses generate hard bounces on the same Brevo account the marketing site uses.
- **Failure scenario:** QA parent created as `qa-test-parent@example.com` (or any non-`cmcvn.edu.vn` address). OTP request / account-ready email routes to Brevo (`decideTransport` returns `brevo` for non-staff-domain). Brevo attempts delivery, hard-bounces, and repeated bounces raise the account's bounce rate → spam flagging / sending throttle that also hits real marketing/transactional mail. Real per-email cost is incurred too.
- **Evidence:** `apps/api/src/lib/email-routing.ts:6-10` routes any address not ending in `@cmcvn.edu.vn` (STAFF_EMAIL_DOMAIN, confirmed `.env.production.example:24`) to `brevo`. `apps/api/src/lib/brevo-client.ts:31-56` sends live to `msg.to` with no allowlist/sandbox guard. There is no test-recipient suppression anywhere in the send path.
- **Suggested fix:** Require QA non-staff accounts to use a real, controlled inbox (also needed for Finding 2), or add a temporary recipient allowlist/suppression for `[QA-TEST]` sends before Phase 2. Never point QA at invented addresses.

## Finding 6: No expiry / reminder / deadline on the security-regression revert — relies purely on memory
- **Severity:** High
- **Location:** Phase 4 (entire phase is manual and unscheduled)
- **Flaw:** `STAFF_PASSWORD_LOGIN=true` is a plain env var with no TTL. If the session ends, the agent crashes, or Phase 2/3 drags on, nothing forces or reminds anyone to revert. The "mandatory, not optional" language in Phase 4 has no mechanism behind it.
- **Failure scenario:** Phase 2 uncovers a blocker, the operator context-switches, the session ends. The flag stays `true` on live prod indefinitely (see Finding 1's exposure) with no alarm. There is no cron, no calendar entry, no automated re-disable.
- **Evidence:** Grep for `STAFF_PASSWORD_LOGIN` across the repo shows only the fail-closed check (`auth.ts:34`), compose passthrough (`docker/docker-compose.prod.tls.yml:97`), and docs — no timer/auto-revert. Phase 4 step 1 is a manual VPS env edit + restart.
- **Suggested fix:** Add a hard deadline and a fail-safe: e.g. schedule an automatic revert (a `at`/cron job on the VPS that unsets the var + restarts after N hours), or gate the whole run so Phase 4 executes even on abort. Track the enable time and set an explicit revert-by timestamp in the plan.

## Finding 7: `docker compose restart` does NOT re-read the env file — the flag may never apply, and the "revert" may silently no-op
- **Severity:** High
- **Location:** Phase 1 step 1 and Phase 4 step 1 (both use `restart api`)
- **Flaw:** Compose injects `environment:` values at container CREATE time via `${STAFF_PASSWORD_LOGIN:-}` interpolation from `--env-file`. `docker compose restart` restarts the existing container with its existing config; it does not re-interpolate the compose file or re-read `.env.production`. The command as written will not pick up the changed value.
- **Failure scenario (double-edged):** In Phase 1, staff persona logins keep failing because the flag never actually took effect — wasted debugging. Worse, in Phase 4 the operator runs `restart` to REVERT, sees the container bounce, ticks the box "reverted" — but if the container was previously recreated with `true`, a `restart` leaves it `true`. Operator believes prod is fail-closed again while it is still wide open (compounds Finding 1 + Finding 6).
- **Evidence:** `docker/docker-compose.prod.tls.yml:94-97` — `STAFF_EMAIL_DOMAIN: ${STAFF_EMAIL_DOMAIN:-}` / `STAFF_PASSWORD_LOGIN: ${STAFF_PASSWORD_LOGIN:-}` are interpolated at up-time, not runtime. Standard compose semantics: `restart` reuses container config. Phase 4 Success Criteria verifies via a failed login attempt, which would catch a still-open flag ONLY if the operator actually performs that verification and does not skip it.
- **Suggested fix:** Use `docker compose --env-file /root/cmcnew/.env.production up -d api` (recreates with new env) in both Phase 1 and Phase 4, not `restart`. Keep the Phase 4 "verify via a failed password-login" gate as the hard proof — and make it blocking.

## Finding 8: Phase 1 partial-failure has no rollback — orphan accounts + already-enabled flag
- **Severity:** Medium
- **Location:** Phase 1 (Implementation Steps 1-3, no failure/rollback path)
- **Flaw:** Steps run in sequence with no transaction and no defined recovery if a middle step fails (e.g. 3 of 4 staff accounts created, then the 4th fails, or student-create succeeds but guardian-link fails).
- **Failure scenario:** The flag is already `true` (step 1 done), 2-3 QA staff accounts exist, then a failure aborts the phase. The plan gives no guidance: is the run retried (risking duplicate accounts / dedupe collisions on phone per existing guardian dedupe), abandoned (leaving the flag on — Finding 6), or partially cleaned? A half-created student+parent may also leave a dangling guardian link.
- **Evidence:** Phase 1 has no "on failure" or rollback section; Success Criteria assume all-or-nothing success. Guardian/student creation is multi-step (`student.ts` + `guardian.ts` are separate routers, confirmed in the routers listing) so partial success is realistic.
- **Suggested fix:** Add an explicit rollback note to Phase 1: on any step failure, immediately jump to Phase 4's revert of `STAFF_PASSWORD_LOGIN` first, then remove whatever QA rows were created before retrying. Make "flag reverted" the first cleanup action, not the last.

## Unresolved Questions
1. Which facility will the 4 staff QA personas be scoped to? If it is a real operating facility, Finding 4's real-data-mutation risk is live; a dedicated empty QA facility neutralizes it.
2. Is the Brevo account confirmed shared with the marketing site (as the task states)? If a separate sub-account/IP pool, Finding 5's blast radius shrinks to cost + bounce-rate on that sub-account only.
3. Does the QA student even need LMS content to exist (enrollment, exercises) for its tasks to be meaningful, or will it hit empty-state everywhere and produce no signal?

Status: DONE_WITH_CONCERNS
Summary: 8 findings — 3 Critical (global staff-login exposure, parent OTP unretrievable on prod, student login method wrong), 4 High (no `[QA-TEST]` enforcement lets personas mutate real data, shared-Brevo reputation risk, no revert deadline/failsafe, `restart` won't apply/revert the env flag), 1 Medium (no Phase 1 partial-failure rollback).
Concerns/Blockers: Findings 1/6/7 chain into a plausible "prod left SSO-open indefinitely without anyone realizing" outcome; Findings 2/3 mean 2 of 6 personas cannot log in as specified.
