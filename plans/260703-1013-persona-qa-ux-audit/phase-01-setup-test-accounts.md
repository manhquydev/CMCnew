---
phase: 1
title: Setup Test Accounts
status: completed
effort: ''
---

# Phase 1: Setup Test Accounts

## Overview

**Revised 2026-07-03 after red-team invalidated the original design (decision 0031 fallout).**
Create dedicated `[QA-TEST]`-tagged accounts using mechanisms that actually exist and work:
- 4 staff personas (sale, giáo viên, giám đốc kinh doanh, giám đốc đào tạo): `user.setPassword`
  (now live — decision 0031, `STAFF_PASSWORD_LOGIN=true` confirmed active on prod).
- Học sinh persona: `student.resetLmsPassword` → real `loginCode`+password (NOT OTP — the
  original plan's OTP assumption for students was wrong).
- Phụ huynh persona: **still blocked** — OTP `devCode` is suppressed in prod, no agent-readable
  inbox provisioned. Deferred until resolved (see Open Question below).
- QA isolation: personas scoped to a dedicated facility (not an existing operating facility) —
  neutralizes the real-data-mutation risk red-team flagged (`[QA-TEST]` naming alone doesn't
  guard against a persona mutating real rows it can see via RLS-facility scope).

## Implementation Steps

1. Create a dedicated QA facility (e.g. `[QA-TEST] Facility`) via `super_admin` — this is the RLS
   boundary that actually prevents a persona from touching real CRM/class/attendance data (naming
   prefix alone does not, per red-team Finding 4/security-adversary+failure-mode-analyst).
2. As `super_admin`, create 4 staff accounts scoped to the QA facility:
   `qa-test-sale@cmcvn.edu.vn` (sale), `qa-test-giaovien@cmcvn.edu.vn` (giao_vien),
   `qa-test-gdkd@cmcvn.edu.vn` (giam_doc_kinh_doanh), `qa-test-gddt@cmcvn.edu.vn`
   (giam_doc_dao_tao). Call `user.setPassword` for each — record the returned one-time temp
   password (session scratchpad only, never committed).
3. Create 1 test student (`[QA-TEST] Nguyễn Văn A`) in the QA facility, enroll in a QA-only class
   batch with at least one scheduled session (empty-state screens produce no UX signal — per
   assumption-destroyer Unresolved Question 3). Call `student.resetLmsPassword` (director/
   super_admin-gated) — record the returned `loginCode` + temp password.
4. Verify each of the 5 working accounts can actually log in before handing off to Phase 2 — a
   broken login blocks that persona's entire run. Test via the real endpoints (`auth.login` for
   staff, `lms-auth.loginStudent` for the student), not just DB state.
5. Phụ huynh persona (RESOLVED 2026-07-03, user decision): create a QA parent account with email
   `manhquydev@gmail.com` in the QA facility, linked to the QA student. At Phase 2's OTP step,
   the agent pauses and asks the user (via a question tool) to relay the 6-digit code from that
   inbox — semi-automated, not a broken/dropped persona.

## Success Criteria — ALL DONE, verified live 2026-07-03

- [x] QA-only facility created (`facility.id=2`, code `QATEST`), isolates all QA data from real
      facilities.
- [x] 4 staff QA-TEST accounts created + password set via `user.setPassword`, each logs in
      successfully through `auth.login` (verified: `qa-test-sale`, `qa-test-giaovien`,
      `qa-test-gdkd`, `qa-test-gddt` @cmcvn.edu.vn).
- [x] 1 student QA-TEST account (`QATEST-S1`) created + enrolled in QA class batch (3 sessions
      generated), password set via `student.resetLmsPassword`, logs in successfully through
      `lms-auth.loginStudent`.
- [x] Phụ huynh persona resolved: real inbox `manhquydev@gmail.com`, semi-automated OTP relay by
      user. **Verified live end-to-end** — `lmsAuth.otpVerify` returned a valid parent session.
- [x] Credentials recorded in this session's working memory only, never committed to git.

## Critical finding during setup (unplanned, high-severity)

Parent OTP send failed on the FIRST attempt with Brevo HTTP 401 "unrecognised IP address" —
**Brevo's IP-authorization security feature blocked the VPS's outbound IP
(`152.42.167.189`) entirely.** This means Brevo (decision 0030's external-recipient transport,
configured earlier this session in PR #19) had **never actually delivered a single email** since
being wired up — not just for this QA test, but for any real parent-facing email that would have
routed through it (OTP, receipts, LMS account-ready). User added the VPS IP to Brevo's authorized
list (`app.brevo.com/security/authorised_ips`); retry succeeded, OTP delivered and verified.
**Action needed**: confirm this is documented as a known prod fragility (a VPS IP change, e.g. VPS
migration, would silently break Brevo delivery again with no code-level error visible to a
non-technical operator).

## Secondary finding (self-inflicted, fixed)

While setting `STAFF_PASSWORD_LOGIN=true` on prod, discovered `/root/cmcnew` (the manual-ops
checkout used for `docker compose up -d` outside the Jenkins pipeline) was **stale since
2026-06-30** — pre-dates PR #19's Brevo env wiring. Fixed by `scp`-ing the current
`docker-compose.prod.tls.yml` from the local repo (same pattern already used for
`jenkins-casc.yaml`). No git credentials exist on the VPS for `/root/cmcnew` to `git pull`
directly — worth fixing properly later (deploy key or PAT) so this class of drift can't recur.
