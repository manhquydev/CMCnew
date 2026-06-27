# Code Review — F0 RBAC Permission Registry Refactor

Branch: `feature/erp-unify-rbac-f0` vs `develop`
Date: 2026-06-27
Reviewer: code-reviewer (read-only)

## VERDICT: SHIP

Zero BLOCKERS. The authorization refactor is correct: all 90 migrated procedures
preserve their original role-sets, exactly the 5 intended diffs exist, super_admin
bypass semantics are unchanged, no procedure was left ungated, no auth/SSO/OTP/Graph/LMS
code was touched, typecheck shows exactly the 18 documented pre-existing errors, and the
parity test passes 6/6. Findings below are MEDIUM/LOW improvements, not landing blockers.

## Scope

- Changed: `apps/api/src/trpc.ts` (+`requirePermission`), `packages/auth/src/{permissions.ts(new),index.ts}`,
  24 routers under `apps/api/src/routers/`, plus new test `apps/api/test/permission-parity.test.ts`
  and fixture `apps/api/test/fixtures/permission-snapshot.json`.
- Note: `permissions.ts`, the snapshot, and the parity test are **untracked** (not yet committed) —
  they do not appear in `git diff develop`. Confirm they are staged before the PR, or the safety
  net ships missing.

## Acceptance Criteria Verification

**1. No unintended permission drift — VERIFIED (full audit, not spot-check).**
I compared the original `requireRole(...)` args against the registry for every migrated procedure.
All match. Representative before→after (original requireRole args → registry `Role[]`):

| Procedure | Original requireRole | Registry | Result |
|---|---|---|---|
| finance.receiptApprove | ke_toan, quan_ly | [ke_toan, quan_ly] | same |
| finance.priceCreate | quan_ly, ke_toan | [quan_ly, ke_toan] | same |
| payroll.kpiEvalConfirm | quan_ly, bgd | [quan_ly, bgd] | same |
| payroll.kpiEvalApprove | bgd | [bgd] | same |
| payroll.roster (HR_ROLES) | hr, ke_toan | [hr, ke_toan] | same |
| crm.opportunityTransition (CRM_ROLES) | sale, cskh, quan_ly | [sale, cskh, quan_ly] | same |
| crm.testGrade (TEST_GRADE_ROLES) | giao_vien, head_teacher, quan_ly | same | same |
| class-batch.setStatus | quan_ly | [quan_ly] | same |
| schedule.generateSessions | quan_ly | [quan_ly, head_teacher] | **intended diff 1b** |
| student.create | quan_ly, sale | [quan_ly, sale] | same |
| guardian.link (LEAD_ROLES) | bgd, quan_ly | [bgd, quan_ly] | same |
| level-progress.decide | head_teacher | [head_teacher] | same |
| afterSale.setStudentLifecycle | quan_ly | [quan_ly] | same |
| certificate.issue (ISSUE_ROLES) | head_teacher, quan_ly | same | same |

**2. Only the 5 intended diffs — VERIFIED.** head_teacher added to `classBatch.create`,
`schedule.addSlot`, `schedule.generateSessions`; ctv_mkt added to `crm.opportunityList`,
`crm.opportunityCreate`. No other procedure gained/lost a role. The parity test encodes both the
non-diff equality check and explicit negative assertions (ctv_mkt must not leak onto other CRM or
non-CRM actions; head_teacher must not reach classBatch setStatus/cancel/reopen). Not vacuous **for
the registry↔snapshot seam** (see MEDIUM-1 for the seam it does NOT cover).

**3. super_admin bypass preserved — VERIFIED.** `requirePermission` (trpc.ts:70-77) checks
`if (ctx.session.isSuperAdmin) return next();` before consulting `can()` — identical short-circuit
to `requireRole` (trpc.ts:56). `can()` also re-checks `isSuperAdmin` internally (defense in depth).

**4. No procedure left ungated — VERIFIED.** `grep requireRole apps/api/src/routers/` returns
nothing — every migrated site now uses `requirePermission`, and no in-scope procedure silently
dropped to bare `protectedProcedure`. superAdminProcedure sites were NOT migrated (compensation
list/defaults/create, user list/create/setRoles/setFacilities/setActive, facility.*,
parentMeeting.runReminders/runCadence all remain `superAdminProcedure`) — confirmed not widened.

**5. No auth/SSO/OTP/Graph/LMS touched — VERIFIED.** `auth.ts`, `lms-auth.ts`, `lib/sso.ts`,
`login-otp.ts`, `graph-client.ts` are absent from the diff.

**6. No new typecheck errors — VERIFIED.** `tsc --noEmit` (apps/api) = exactly 18 errors, all in
the documented pre-existing files (graph-client, sso, parent-email, email-outbox, login-otp, and
the single guardian.ts:46 `string | null` nullable — which is in the parentCreate body, outside the
refactor's changed hunks). `packages/auth` typecheck = 0 errors.

**7. Registry modules map to real mounts — VERIFIED.** Every registry top-level key matches a mount
in `routers/index.ts` (afterSale, classBatch, levelProgress, parentMeeting, etc.).

## Findings

### MEDIUM-1 — Parity test guards the registry↔snapshot seam, not the router↔registry seam
`apps/api/test/permission-parity.test.ts` compares the registry against a hand-authored snapshot.
Both files live in/near `packages/auth` and are maintained by hand. The test never reads router
source, so it cannot detect the security-relevant binding: which `requirePermission('module','action')`
string keys each procedure actually passes. Consequences for future changes:
- A router pointing a procedure at the wrong-but-valid action key (copy/paste) whose role-set differs
  would not be caught.
- A new procedure added with `requireRole` or no gate would not be caught.
- A typo'd action key fails closed (FORBIDDEN for all non-super) — availability bug, not escalation.

The test docstring claims "If any of these fail the registry has drifted from the codebase" — that is
overstated; the registry can drift from the router bindings without any test failing. Today there is
no live defect (I manually verified all 90 bindings). Recommendation: add a test that imports the
built `appRouter` and asserts each gated procedure's middleware resolves to a registry key, or a
lint/AST check that every `requirePermission(a,b)` call has `PERMISSIONS[a][b]` defined. Not a blocker.

### MEDIUM-2 — Advisory `super_admin` entries create a dual source of truth
`PERMISSIONS` lists entries like `user.create: [super_admin]`, `compensation.list: [super_admin]`,
`facility.*`, `parentMeeting.runReminders/runCadence` for procedures still gated by
`superAdminProcedure`. `requirePermission` never consults these (those procedures don't call it), so
they are documentation embedded as policy. They are harmless today (and `[super_admin]` would behave
as deny-all-but-super if ever wired, equivalent to superAdminProcedure), but a future maintainer could
reasonably assume editing the registry changes enforcement for those procedures. Consider either
removing the advisory entries or annotating them as non-enforced in a way the test asserts.

### LOW-1 — `requirePermission(module: string, action: string)` is stringly-typed
No compile-time guarantee the key exists in `PERMISSIONS`. Fail-closed (`can()` returns false for
unknown keys → FORBIDDEN) contains the blast radius, but a `keyof`-based signature would catch typos
at build time. YAGNI-acceptable; note for later.

### LOW-2 — Snapshot entry count
The task context states 107 procedures; the snapshot/registry actually contain 109 entries (test
enforces registry↔snapshot key parity, so the two agree). Documentation-only discrepancy.

## KISS/YAGNI Assessment
Clean. No ABAC, no role inheritance, no wildcards — flat `module.action → Role[]` map plus a 5-line
`can()` with explicit fail-closed. `requirePermission` is a thin binding mirroring `requireRole`.
Comments explain the invariant (the 2 diff groups, why setStatus/cancel/reopen stay quan_ly-only)
rather than plan IDs. Code style matches surrounding routers.

## Unresolved Questions
1. Are `permissions.ts`, the snapshot, and the parity test intended to be committed in this PR? They
   are currently untracked — stage them or the safety net is absent on the branch.
2. Is MEDIUM-2's advisory-entry pattern a deliberate audit-map decision? If so, a one-line note in the
   registry header would prevent future confusion.
