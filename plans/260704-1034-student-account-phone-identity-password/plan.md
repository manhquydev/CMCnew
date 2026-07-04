---
title: "Plan C — Student login = parent phone + family profile picker (Netflix-style)"
description: "Student LMS login = parent phone (84xxx) + fixed pw Cmc2026@; 2-step profile picker → per-child student session; parent self-service change + ERP reset-to-default."
status: implemented
priority: P2
effort: ~11h
lane: high-risk
branch: feat/phase-d-facility-picker-and-stitch-wireframes
tags: [auth, lms, student-account, family-profile, high-risk]
created: 2026-07-04
updated: 2026-07-04
sourceReports:
  - plans/reports/brainstorm-260704-1034-four-plan-decomposition-ux-auth-nav-report.md
  - plans/260704-1034-student-account-phone-identity-password/reports/planner-260704-1038-student-phone-identity-scout-notes-report.md
  - "RE-AUTHOR: per-child-suffix design red-teamed out (money-tx abort under concurrent sibling approval + no parent-facing suffix comms) → profile-picker model chosen 2026-07-04"
decision: plans/260704-1034-student-account-phone-identity-password/decisions/0032-student-login-phone-identity.md
---

# Plan C — Student login = parent phone + family profile picker

HIGH-RISK lane (FEATURE_INTAKE.md — Auth + Authorization hard gates). Authoring only; no code
this session.

## Summary

Student LMS login model (replaces the per-child-suffix design — see decision 0032 pivot):

- **Login = parent phone → bare `84xxxxxxxxx`** + fixed password `Cmc2026@`. ONE credential per
  phone (lives on `ParentAccount`, which is already `@unique` on phone), shared across siblings.
- **2-step (Netflix picker):** phone+password → resolve the parent's non-blocked children → if 1
  child, auto-enter that child's student view; if 2+, show a tap-to-enter profile picker. Picking
  a child mints the EXISTING per-child student session, so all gamified student code runs
  unchanged. No per-child PIN.
- **Family password change:** (a) parent self-service in the LMS portal (no old pw); (b) ERP reset
  to `Cmc2026@` (confirm-only).
- Break-glass fallback (parent has no phone): the child keeps a per-child `loginStudent`
  (facility-code loginCode + `Cmc2026@`).
- Pre-launch → NO legacy backfill. **NO Prisma migration** (`ParentAccount.passwordHash?` +
  `tokenVersion` already exist — `schema.prisma:557,560`).

Why the pivot: the per-child suffix minted a credential per sibling inside `receipt.approve`,
which under concurrent sibling approval hit a Postgres `unique_violation` that aborts the whole
money transaction, and gave parents no way to learn their suffix. The picker keeps the login on
the already-unique parent phone (idempotent find-or-create → 2nd child just links, no new
credential, no suffix). NOTE (2nd red-team S1): the picker does NOT fully remove the unique race —
provisioning still find-first→create on `ParentAccount.phone @unique`, so a concurrent FIRST
sibling pair of a brand-new phone can still hit `unique_violation`; P1 makes that create race-safe
(SAVEPOINT+`P2002` refetch or `ON CONFLICT DO NOTHING`). SECURITY (2nd red-team B1): phone-login is
child-view ONLY — it must NOT mint a parent-portal-capable session (see below). Full detail:
decision 0032.

## Blocking design decision (needs sign-off before P1)

**Cascade revocation on family password change/reset.** Default design bumps only
`ParentAccount.tokenVersion` (revokes live family sessions, forces re-login). Already-entered
child STUDENT sessions carry `StudentAccount.tokenVersion` and stay valid ≤12h. Cascade-bumping
every guardianed child's `StudentAccount.tokenVersion` would also kick out in-flight kids.
Recommendation: **NO cascade** (YAGNI — student security de-scoped). Confirm before P1.
(Schema home = reuse `ParentAccount.passwordHash`, no migration — recommended, decision 0032 D3.)

## Phases

| # | Phase | Owns files | Status | Depends |
|---|---|---|---|---|
| 0 | [Decision sign-off + `normalizeLoginPhone` + `DEFAULT_STUDENT_PASSWORD` + unit tests](phase-00-decision-and-login-normalize-helper.md) | packages/auth (new helper + index + unit test) + decision doc | pending | — |
| 1 | [Family-login backend + provisioning idempotency + deep integration tests](phase-01-provisioning-phone-identity.md) | packages/auth/src/lms.ts (+ child-selection ticket sign/verify), apps/api/src/trpc.ts (only if `kind:'family'` alt chosen), lms-auth.ts, guardian.ts, student.ts, finance.ts + int tests | pending | P0 |
| 2 | [ERP reset-to-default UI (student + parent admin)](phase-02-erp-reset-to-default.md) | apps/admin/src/student-detail.tsx (+ parent admin detail) + int/e2e | pending | P1 |
| 3 | [LMS phone-login screen + profile picker + parent self-service change UI](phase-03-parent-self-service-change.md) | packages/ui/src/lms-login-gate.tsx, apps/lms/src/parent-view.tsx + e2e | pending | P1 |

Dependency graph: **P0 → P1 → {P2, P3}**. P2 and P3 are mutually independent — disjoint file
ownership (P2 = apps/admin, P3 = packages/ui + apps/lms), and both only consume endpoints authored
in P1. They may run in parallel after P1.

Deliberate deviation from the brainstorm's "endpoint-in-each-UI-phase" split: ALL new backend
(login, enter-child, changeFamilyPassword, resetFamilyPassword, provisioning) lands in P1. Reason:
(1) `changeFamilyPassword` and `resetFamilyPassword` both live in `guardian.ts` — splitting them
across two parallel UI phases would make both edit the same file (ownership conflict); (2) the
non-vacuous reset test composes change+reset and belongs where both exist. UI phases stay thin +
full-stack-wired.

Each phase = full harness loop (impact → implement → deep adversarial tests → code-review
security-focus → gitnexus detect_changes → live verify → commit) per AGENTS.md CK_WORKFLOW.

## Data flow (new login)

```
[LMS "Học sinh" tab]  phone + Cmc2026@
      │  lmsAuth.loginFamilyByPhone
      ▼
normalizeLoginPhone → ParentAccount.findUnique({phone}) → verifyPassword(passwordHash)
      │  reuse parentSession() → non-blocked children
      │  RETURN signed child-selection TICKET {parentAccountId,tokenVersion,exp}  (NO cookie,
      │  NO kind:'parent' session — B1)
      ▼
 children.length === 1 ? ──yes──► enterChildProfile(ticket, child) ──► [student view]
      │ no
      ▼
 [profile picker]  tap child
      │  enterChildProfile(ticket, studentId)  [publicProcedure]
      ▼
 verify ticket sig+exp → RE-RESOLVE parent's non-blocked children server-side
 assert studentId ∈ resolved (else FORBIDDEN)
      │  reuse studentSession() → mint STUDENT JWT → SET cookie (first cookie on this path)
      ▼
 [gamified per-child student view — unchanged]
```
Invariant (B1): no parent-portal-capable (`kind:'parent'`) session is ever created on the
phone-login path — a phone-login principal is rejected by every `parentProcedure` mutation.

## Test matrix

| Layer | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| Unit | `normalizeLoginPhone` (0/84/+84/0084/spaces/malformed/null), `DEFAULT_STUDENT_PASSWORD` value | — | — | — |
| Integration | — | auto-enter-1-child; picker-2+-children; **idempotent sibling attach (no 2nd credential, no throw)**; **[S1] concurrent first-sibling approve does not roll back money tx (one ParentAccount, both link)**; provisioning sets family pw once (no overwrite); no-phone fallback→loginStudent; **enterChildProfile cross-family FORBIDDEN (server re-resolve)**; **[B1 MANDATORY] phone-login/ticket principal rejected by `guardian.profileUpdate` + `guardian.requestLink` (FORBIDDEN)**; **[B1 MANDATORY] selection ticket not usable as LMS cookie / rejected by resolveLmsSession**; blocked-child hidden from picker; RLS isolation; **non-vacuous reset (seed non-default → resetFamilyPassword → old pw fails + Cmc2026@ works + tokenVersion bumped)**; changeFamilyPassword own-account happy + tokenVersion bump | resetFamilyPassword permission gate + RLS NOT_FOUND; student.resetLmsPassword returns fixed default + facility-prefixed loginCode (M1) | — |
| Component/E2E | — | curl loginFamilyByPhone→enterChildProfile after approve | ERP reset → family re-login with default | phone-login→picker→child view; parent portal change→family re-login |

## Acceptance criteria (DB-verified)

- New student: `ParentAccount.phone` matches `/^84\d{9}$/`; `ParentAccount.passwordHash` verifies
  `Cmc2026@`; child `StudentAccount` exists (loginCode = `${facility.code}-${studentCode}`).
- `loginFamilyByPhone(84xxx, 'Cmc2026@')` returns the parent's non-blocked children; a 1-child
  family auto-enters; a 2+ family returns ≥2 tiles.
- **Sibling:** approving a 2nd new child on the same phone does NOT create a 2nd credential and
  does NOT throw; both children appear in the one family picker.
- `loginFamilyByPhone` returns a signed child-selection ticket + child list and sets NO cookie;
  `enterChildProfile(ticket, ownChild)` mints a `kind:'student'` session (first cookie on the path);
  `enterChildProfile(ticket, otherFamily)` → `FORBIDDEN` (server re-resolve) with no cookie set.
- **[B1]** No phone-login artifact (ticket or family principal) authorizes any `parentProcedure`
  mutation — `guardian.profileUpdate` and `guardian.requestLink` return FORBIDDEN; the ticket is
  rejected by `resolveLmsSession` and unusable as the LMS cookie.
- **[M1]** Break-glass loginCode is facility-prefixed (`${facility.code}-${studentCode}`) on BOTH
  provisioning and the `student.resetLmsPassword` create-branch (globally unique, collision-safe).
- Blocked-lifecycle child (on_hold/withdrawn/transferred) absent from the picker.
- ERP reset: `ParentAccount.passwordHash` back to `Cmc2026@`, `tokenVersion` bumped; prior
  non-default password stops authenticating (non-vacuous).
- Parent self-service change: family password updated, `tokenVersion` bumped, new password
  authenticates; no old-password required; cannot target another family (uses session accountId).
- Full-stack completeness: every endpoint has a wired UI; every button hits a live endpoint.
- Per-phase: code-reviewer (security focus) clean; gitnexus `detect_changes` scope matches owned
  files; no HIGH/CRITICAL impact ignored.

## Non-goals / accepted risks

- No legacy `HQ-HS-xxx` backfill (pre-launch). No Prisma migration.
- Student LMS password security is an accepted non-concern (fixed shared default) — but
  cross-family access IS a real gate (`enterChildProfile`, `changeFamilyPassword`).
- Two different parents sharing one phone collapse into one ParentAccount (pre-existing `@unique`)
  — documented, out of scope.
- **[B1 — NOT accepted; now a P1 requirement]** Phone-login must NOT create a parent-portal-capable
  (`kind:'parent'`) session. The weak public credential (phone on receipts + `Cmc2026@`) reaching
  `parentProcedure` would let an attacker hijack the parent's stronger Email-OTP account via
  `guardian.profileUpdate` (rewrites the email OTP resolves by). Mitigation: child-selection ticket
  (recommended) or a rejected `kind:'family'` sub-kind. Mandatory tests enforce it. Decision 0032 D4.
- **[S1]** Provisioning's ParentAccount find-or-create still has a residual `@unique` race on the
  first-ever sibling pair of a brand-new phone → handled race-safe in P1 (not "no race"). Decision 0032.
- No cascade revocation of in-flight child sessions on family reset (default; see blocking Q). A
  family change/reset DOES evict any live family/parent OTP session (ParentAccount.tokenVersion
  bump, `lms.ts:125`) — good property.

## Open questions

1. **[Blocking P1]** Cascade revocation on family change/reset — bump child StudentAccount
   tokenVersions too? Recommend NO (YAGNI). Everything else user-confirmed 2026-07-04.
2. Keep `loginStudent` break-glass path indefinitely, or retire once phone-login proves out?
   Recommend keep (it is the documented no-parent-phone fallback).
3. `student.resetLmsPassword` return field name `tempPassword` (now a fixed constant) — keep vs
   rename `defaultPassword`? Recommend keep (DRY, smaller blast radius).
