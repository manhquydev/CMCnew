# Red-Team Review — Persona QA Fleet + UX Audit Plan (Assumption Destroyer / Scope Auditor)

Reviewer role: Assumption Destroyer + Scope Auditor. Question under test: does the plan's stated
scope match what the codebase actually permits an automated agent to do? Answer: **no — two of the
six personas cannot authenticate at all as designed, and a third uses the wrong auth mechanism.**

All findings are backed by file:line evidence from the current tree.

---

## Finding 1: Created staff QA accounts have NO knowable password — the 4 staff personas cannot log in

- **Severity:** Critical
- **Location:** Phase 1, "Implementation Steps" step 2 ("Set a throwaway password for each")
- **Flaw:** The plan assumes the admin staff-creation UI lets you set a password. It does not.
  `user.create` writes `passwordHash: await hashPassword(randomBytes(32).toString('base64url'))`
  — a high-entropy secret that is *never returned or transmitted* — precisely so staff password
  login is impossible. There is no `setPassword` / `resetPassword` procedure anywhere in
  `user.ts`. Staff are SSO-only by construction; only the seeded bootstrap super_admin has a
  usable password.
- **Failure scenario:** Operator flips `STAFF_PASSWORD_LOGIN=true`, creates
  `qa-test-sale@…`, `qa-test-giaovien@…`, `qa-test-gdkd@…`, `qa-test-gddt@…` via the UI, then has
  no password to hand the persona agents. The env flag only relaxes the fail-closed gate at
  `auth.ts:34`; it cannot invent a password nobody knows. All 4 staff personas fail Phase 1
  success criterion "each logs in successfully with password auth" — Phase 2 never starts for them.
- **Evidence:**
  - `apps/api/src/routers/user.ts:149` — `passwordHash: await hashPassword(randomBytes(32).toString('base64url'))`; comment at `user.ts:81-82` "No password input: staff authenticate exclusively via Microsoft SSO."
  - `apps/api/src/routers/user.ts` — grep for `setPassword|resetPassword` returns nothing; the only password write is line 149.
  - `apps/api/src/routers/auth.ts:34` — the flag only bypasses the SSO-only guard, it does not set credentials.
- **Suggested fix:** Either (a) seed the 4 staff accounts directly in the DB / via a seed script that sets a known password hash, and drop the "create via admin UI" claim; or (b) log in the personas through real SSO (M365) accounts if any exist; or (c) add a break-glass staff password-set path (scope increase — high-risk gate). The plan must pick one before Phase 2 is runnable.

---

## Finding 2: Parent OTP is unreadable by an automated agent in production — no inbox access path exists

- **Severity:** Critical
- **Location:** Phase 1 step 3 + success criterion "parent can complete OTP login"; Phase 2 "Phụ huynh … Log in via OTP"
- **Flaw:** In production the OTP is *only* emailed. `requestLoginOtp` returns the raw code in
  `devCode` **only** when the decided transport is unconfigured AND `NODE_ENV !== 'production'`.
  On prod it returns `{}`. An agent driving a browser has no way to read the 6-digit code unless
  the QA-TEST parent's email address is a real mailbox the agent can programmatically open — the
  plan never establishes such a mailbox or any inbox-reading mechanism.
- **Failure scenario:** Persona agent submits the parent email, receives `{ ok: true }` with no
  code, and is stuck at the OTP entry screen forever. It cannot proceed, and (because of the
  no-enumeration design) it gets no signal distinguishing "email sent" from "email unknown."
- **Evidence:**
  - `apps/api/src/services/login-otp.ts:65-69` — `if (transportDisabled && process.env.NODE_ENV !== 'production') { … return { devCode: code }; } return {};`
  - `apps/api/src/routers/lms-auth.ts:58-59` — `const { devCode } = await requestLoginOtp(input.email); return { ok: true as const, ...(devCode ? { devCode } : {}) };`
  - `apps/api/src/lib/email-routing.ts:6-11` — external (parent) recipients route to Brevo; delivery depends on Brevo being configured and the mailbox being real/reachable.
- **Suggested fix:** Provision the QA-TEST parent on an email account the agent can actually read (e.g. a controlled Brevo-deliverable inbox with IMAP/API access), and add an explicit Phase-1 step + success check "agent can retrieve the OTP from the parent inbox." If no such inbox is available, cut the phụ huynh persona from this round. Do not claim OTP login "works" without a verified end-to-end code-retrieval path.

---

## Finding 3: Student login is loginCode + password, NOT OTP — plan specifies the wrong mechanism

- **Severity:** High
- **Location:** Phase 1 success criterion (line 32, "student/parent via LMS OTP flow"); Phase 2 persona table (line 33, "Học sinh … Log in via OTP")
- **Flaw:** The OTP flow resolves a `parentAccount` only. Students authenticate with
  `loginStudent(loginCode, password)`. The plan tells the học sinh persona to log in "via OTP,"
  which will never work — there is no student OTP endpoint. The real path requires staff to call
  `student.resetLmsPassword`, which returns a `tempPassword` exactly once; the plan never mentions
  obtaining or relaying that password.
- **Failure scenario:** The học sinh persona looks for an OTP field that doesn't exist on the
  student login screen (it wants loginCode + password), or requests an OTP that only ever resolves
  parent accounts, and is blocked at login through no fault of the UX.
- **Evidence:**
  - `apps/api/src/routers/lms-auth.ts:36-48` — `loginStudent` takes `{ loginCode, password }`.
  - `packages/auth/src/lms.ts:92-98` — `loginStudent` looks up `studentAccount.findUnique({ where: { loginCode } })` then `verifyPassword`.
  - `apps/api/src/services/login-otp.ts:35-36` — OTP issuance queries `parentAccount`, never `studentAccount`.
  - `apps/api/src/routers/student.ts:186` — `resetLmsPassword` returns `{ loginCode, tempPassword }` once.
- **Suggested fix:** Rewrite Phase 1/2 for the học sinh persona: staff run `resetLmsPassword` (or read existing loginCode + set a temp password), record loginCode + tempPassword, and hand those to the persona. Remove all "student via OTP" wording.

---

## Finding 4: Phase 1 provisions no EmploymentProfile — giáo viên/staff Phase-2 tasks fail as setup gaps, not UX findings

- **Severity:** High
- **Location:** Phase 1 (account creation via admin UI) vs Phase 2 (giáo viên "check in for a session"; GĐ tasks touching payroll/attendance)
- **Flaw:** `user.create` does not create an `EmploymentProfile`. Check-in hard-requires one and
  throws `PRECONDITION_FAILED` when it's missing. So a brand-new QA-TEST giáo viên hitting the
  check-in task gets a precondition error that is an artifact of incomplete setup, not a UX defect
  — polluting the "blind first-time user" signal the audit is trying to collect.
- **Failure scenario:** Giáo viên persona clicks check-in, receives "Tài khoản chưa được thiết lập
  hồ sơ nhân sự — liên hệ HR," and (correctly, as a blind user) logs it as a blocker. The synthesis
  report then ranks a setup omission as a top product finding. Any payroll/shift task for the two
  director personas can be similarly confounded.
- **Evidence:**
  - `apps/api/src/routers/check-in-out.ts:90-99` — profile lookup + `if (!profile) throw PRECONDITION_FAILED`.
  - `apps/api/src/routers/user.ts:138-155` — `user.create` writes only `appUser` (+ facility links); no `employmentProfile.create`. Comment at `check-in-out.ts:87-88` confirms profiles are set up manually by HR via `payroll.upsertEmploymentProfile`, not at account creation.
- **Suggested fix:** In Phase 1, after creating each staff persona, run `payroll.upsertEmploymentProfile` (and any shift registration needed) so the accounts are actually operable — OR explicitly scope out check-in/payroll/attendance tasks and tell the synthesis pass to treat "no HR profile" errors as out-of-scope setup gaps, not findings.

---

## Finding 5: Parent OTP silently no-ops if the guardian email is missing/mismatched/inactive — agent gets no error to report

- **Severity:** Medium
- **Location:** Phase 1 step 3 ("create 1 test parent via the real admin UI … guardian-link flow")
- **Flaw:** OTP only issues for a parentAccount matching the exact normalized email AND `isActive:
  true`. The admin guardian-link flow can produce a guardian/parent record whose email is blank,
  differs from the mailbox the agent watches, or is inactive. In every such case `otpRequest`
  returns `{ ok: true }` and no code — indistinguishable from success by design (no enumeration).
- **Failure scenario:** Parent created with phone-only or a typo'd email; agent requests OTP, sees
  success, waits for an email that never arrives, and reports a phantom "OTP not delivered" bug.
- **Evidence:** `apps/api/src/services/login-otp.ts:35-38` — `findFirst({ where: { email: normEmail(email), isActive: true } })`; `if (!parent) return {};` (silent).
- **Suggested fix:** Add a Phase-1 verification that the parent account exists, is active, and its email exactly equals the agent-readable mailbox, before handoff — not just "parent can complete OTP login" as an afterthought.

---

## Finding 6: Phase 3 synthesis has no shared report schema — dedup/ranking across 6 free-form reports is unreliable

- **Severity:** Medium
- **Location:** Phase 2 step 3 (free-form "findings list") → Phase 3 step 2 (dedupe, rank, cross-map to design-system.md)
- **Flaw:** Phase 2 asks each of 6 independent agents to return findings "tagged technical/UI/UX +
  severity" but defines no field schema, no finding ID, no page/route anchor, no screenshot
  reference contract. Phase 3 then asks `ui-ux-designer` to dedupe "the same issue hit by multiple
  personas" and rank by frequency — which requires comparable, structured records. Six differently
  shaped prose reports make reliable dedup and cross-persona frequency counting guesswork.
- **Failure scenario:** Two personas describe the same broken screen in different words; the
  synthesis either double-counts it (inflating its rank) or misses the overlap (undercounting the
  "how many personas hit this" signal the plan explicitly wants to rank on).
- **Evidence:** Phase 2 `phase-02-run-persona-agents.md:42-43` (unstructured findings list) vs Phase 3 `phase-03-ux-audit-synthesis.md:20-22` (dedupe + rank-by-persona-count). `docs/design-system.md` exists (glob confirmed), so the cross-map target is real — but the input shape isn't pinned.
- **Suggested fix:** Define a minimal finding schema in Phase 2 (route/URL, persona, category, severity, one-line title, repro, screenshot path) so Phase 3 can group by route+title. Cheap, and it's the difference between a rankable dataset and prose.

---

## Unresolved Questions

1. Is there any agent-readable inbox for the QA-TEST parent (IMAP/Brevo API), or must the phụ huynh persona be cut? (Blocks Finding 2.)
2. Do real M365 SSO staff test accounts exist that the personas could use instead of password login? (Alternative for Finding 1.)
3. Is Brevo actually configured and deliverable on prod, or is external parent mail a no-op there too? (`STAFF_EMAIL_DOMAIN` / Brevo creds not verified in this review.)

Status: DONE_WITH_CONCERNS
Summary: Two personas (staff ×4 via password, phụ huynh via OTP) cannot authenticate as the plan
describes, and the học sinh persona uses the wrong auth mechanism — the plan's scope exceeds what
the codebase permits an automated agent to do. 6 findings, all file:line-backed.
Concerns/Blockers: Findings 1 and 2 are Critical and block Phase 1 success criteria as written.
