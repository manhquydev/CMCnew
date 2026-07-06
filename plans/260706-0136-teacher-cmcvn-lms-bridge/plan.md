---
title: "teacher.cmcvn LMS bridge"
description: "Formal teacher.cmcvn.edu.vn staff surface for director and teacher LMS operations, reusing admin/API/LMS stack."
status: completed
priority: P1
branch: "develop"
tags: [high-risk, lms, staff-shell, deployment, authz]
blockedBy: []
blocks: []
created: "2026-07-05T18:36:25.613Z"
createdBy: "ck:plan"
source: skill
---

# teacher.cmcvn LMS bridge

## Overview

Launch `teacher.cmcvn.edu.vn` as an explicit staff operations surface for:

- `giao_vien`
- `giam_doc_kinh_doanh`
- `giam_doc_dao_tao`

Architecture decision for this plan: do not create a new app, database, auth stack, or sync layer. Route `teacher.cmcvn.edu.vn` to the existing `apps/admin` staff bundle, then make host/role-specific landing and workflow shortcuts. The existing API, RLS, tRPC routers, `@cmc/auth` permissions, and `apps/lms` parent/student portal remain the source of truth.

Primary user journey:

1. Director creates staff in ERP/admin; teacher role can log into teacher domain.
2. Director creates parent+student from one form, including parent email for notifications.
3. Director creates class using the accepted auto class-code format and adds student to class.
4. Director uploads/publishes exercises against existing curriculum units.
5. Teacher opens assigned class, marks attendance, writes comments, uploads class photos, and grades homework.
6. Parent sees teacher actions in LMS; student enters LMS, completes homework, and receives grade feedback.
7. Develop and production domains are deployed and smoke-tested on the VPS.

This is high-risk because it touches authz, student provisioning, public domains, parent email notification, LMS session behavior, RLS-visible data, and production deployment.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Decision and story contracts](./phase-01-decision-and-story-contracts.md) | Complete |
| 2 | [Teacher domain and staff shell](./phase-02-teacher-domain-and-staff-shell.md) | Complete; prod/devteacher smoke, CORS, cert, and SSO redirect proof passed |
| 3 | [Director intake and class setup](./phase-03-director-intake-and-class-setup.md) | Verified draft/provisioning handoff; KD and DT can create draft intake, only KD/finance can approve |
| 4 | [Curriculum exercise publishing](./phase-04-curriculum-exercise-publishing.md) | Existing upload/exercise/LMS paths verified by focused tests; no new publish contract |
| 5 | [Teacher class day workflow](./phase-05-teacher-class-day-workflow.md) | Guard implemented and focused API/E2E validation passed |
| 6 | [Parent student validation](./phase-06-parent-student-validation.md) | Focused API/Playwright validation passed; production Brevo sent outbox proof passed |
| 7 | [Deploy docs handoff](./phase-07-deploy-docs-handoff.md) | Complete; verifier, docs, journal, trace, and watzup handoff recorded |

## Dependencies

- Brainstorm report: `plans/reports/brainstorm-260706-0129-teacher-cmcvn-lms-bridge-report.md`.
- Live audit report: `plans/reports/audit-260705-0105-teacher-parent-student-launch-readiness-report.md`.
- Existing full walkthrough plan/docs: `plans/260705-1006-e2e-full-lifecycle-walkthrough-guide/plan.md`, `docs/guides/e2e-walkthrough/README.md`.
- Existing decisions that govern this work:
  - `docs/decisions/0016-path-based-spa-routing.md` for admin SPA routing.
  - `docs/decisions/0021-curriculum-unit-global-no-rls.md` for curriculum units.
  - `docs/decisions/0022-exercise-global-curriculum-asset-no-rls.md` for exercise assets.
  - `docs/decisions/0029-canonical-origin-tls-self-signed-behind-cloudflare.md` for origin TLS.
  - `docs/decisions/0032-dev-prod-cicd-environment-split.md` for develop/prod stack separation.
  - `docs/decisions/0033-student-login-phone-identity.md` for family login and current receipt-based provisioning.
  - `docs/decisions/0036-class-code-facility-program-format.md` for class code format.

## Acceptance Criteria

- `teacher.cmcvn.edu.vn` is an explicit vhost/smoke, not a default-vhost accident.
- `devteacher.cmcvn.edu.vn` is included in the dev environment after explicit user request.
- Staff session, cookies, CORS, password login, and SSO work on teacher domain without regressing `erp`/`deverp`; SSO must return to the same validated staff host that initiated login.
- Teacher role lands on LMS operations, cannot access finance/CRM/director-only modules from the teacher host, and still uses server-side permissions for enforcement.
- Director setup authority is explicitly decided and tested: both directors can create the parent+student draft intake artifact without super_admin, while receipt approval remains a KD/finance handoff.
- One-form parent+student MVP creates a draft/provisioning handoff that preserves receipt/provisioning invariants. Direct active-student creation requires an accepted new decision before implementation.
- Class creation preserves decision 0036: `[Facility.code]-[ProgramAbbrev]-[YY]-[seq]`, counter by `(facility, program, year)`.
- Exercise upload/publish preserves decisions 0021/0022: global curriculum/exercise assets, app-layer write gates, LMS visibility query-time gated by enrollment/session state.
- Teacher can mark attendance, publish session evidence photos/comments, and grade submissions for assigned class flow.
- Parent LMS sees published session evidence/grades; student LMS can enter via family phone flow and submit homework.
- Focused integration tests pass, Playwright/e2e smoke covers teacher/parent/student, and deploy smoke passes on VPS.

## Validation Settings

- Mode: high-risk, deep, TDD.
- Questions: 4-6.
- Red-team tier: full because the plan has 7 phases.

## Decision State

1. Direct parent+student one-form creates real `Student` immediately, or creates a finance/provisioning draft and activates only at receipt approval? Default: draft/provisioning handoff.
2. Add `devteacher.cmcvn.edu.vn` for develop smoke now, or defer it as a separate infra story? Default was defer; later user explicitly requested devteacher, so it is implemented.
3. On teacher host, should directors see the full admin navigation or an LMS-focused navigation with escape hatch back to ERP?
4. Director intake authority: both directors may create the draft parent+student intake artifact; `receiptApprove` remains a KD/finance handoff.

## Red Team Review

### Session - 2026-07-06

**Findings:** 10 reviewed, 9 accepted, 1 narrowed.
**Severity breakdown:** 3 Critical, 6 High, 1 Medium.

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | SSO callback is single-origin today | Critical | Accept | Phase 2, 7 |
| 2 | Direct intake can recreate transaction-abort bugs | Critical | Accept | Phase 3 |
| 3 | Direct-created rows lack rollback provenance | High | Accept | Phase 1, 3, 7 |
| 4 | Enrollment duplicate-safe claim misses concurrency | High | Accept | Phase 3 |
| 5 | Teacher attendance/evidence/grading authority is UI-only in key paths | Critical | Accept | Phase 5, 6 |
| 6 | Exercise publish notification is not durable enough | High | Accept | Phase 4 |
| 7 | Parent email validation only checks queued rows | High | Accept | Phase 6, 7 |
| 8 | Current RBAC split blocks one-director setup | High | Accept | Phase 1, 3 |
| 9 | Public domains need Cloudflare/DNS/SSL preflight | High | Accept | Phase 2, 7 |
| 10 | Exercise publish permission split | Medium | Narrow | Phase 4 |
| 11 | Plan reimplements existing workflows instead of bridge/smoke/fix | High | Accept | Phase 2, 4, 5, 6 |
| 12 | `devteacher` is unresolved but baked into deploy scope | High | Accept | Phase 2, 7 |
| 13 | Exercise direct PDF route exception is not acknowledged | Medium | Accept | Phase 4 |
| 14 | Audit/email plan lacks PII minimization guard | Medium | Accept | Phase 3, 6 |

### Whole-Plan Consistency Sweep

- Files reread: `plan.md`, all `phase-*.md` files.
- Decision deltas checked: 14.
- Reconciled stale references: 10.
- Unresolved contradictions at review time: 2; resolved for MVP by applying planning defaults in Session 2.

Contradictions before implementation, resolved by MVP defaults:

1. Direct intake versus finance receipt ownership: preserve existing receipt/provisioning path.
2. One-director setup versus KD/DT handoff: resolved as shared draft intake plus KD/finance receipt approval handoff.

## Validation Log

### Session 2 - 2026-07-06

**Trigger:** implementation/test/deploy evidence sync after live prod smoke.

#### Current Evidence

- High-risk story docs exist under `docs/stories/TEACHER-CMCVN-LMS-BRIDGE/`.
- Plan default was applied: no new `apps/teacher`, database, auth stack, sync layer, direct active-student intake, or broad `.cmcvn.edu.vn` cookie.
- `teacher.cmcvn.edu.vn` is wired as a supported prod staff host and health/root smoke passes with `erp` and `hoc`.
- Staff SSO start is host-aware:
  - ERP start uses `https://erp.cmcvn.edu.vn/api/auth/sso/callback`.
  - Teacher start uses `https://teacher.cmcvn.edu.vn/api/auth/sso/callback`.
  - Transaction cookie is host-only.
  - Microsoft authorize pre-login returns 200 for both staff callback URLs without `AADSTS50011`/`AADSTS900971`.
- Local focused verifier passed:
  - API typecheck.
  - UI typecheck.
  - throwaway Postgres migrate/seed.
  - focused API integration: attendance, session evidence publish, LMS security invariants.
  - focused LMS Playwright: LMS smoke, session evidence parent/student visibility, student homework autosave, parent read-only homework view.
- VPS `/root/cmcnew` has the fail-fast verifier, live smoke, corrected Playwright fixture, and interactive SSO verifier.

#### Residual Optional Proof

- Full browser Microsoft login/MFA callback proof still needs a real staff account. This is an
  operator-assisted proof beyond the automated scope; non-interactive SSO redirect/cert/CORS smoke
  and Teacher host bundle/render proof are green.
- Parent-facing external email delivery-equivalent proof is closed: production `.env.production` has Brevo config set and `email_outbox` shows `brevo|sent|4`, `failed=0`, `queued=0`.
- Direct one-form active parent+student intake was not implemented because it would contradict the accepted receipt/provisioning path without a new decision. Current proof covers the supported receipt/provisioning/family LMS path, and the receipt new-student intake now captures parent phone/name/email plus student fields in one form. `giam_doc_dao_tao` now holds only the draft-creation gate (`finance.receiptCreate`) and matching narrow CRM lookup; `receiptApprove` stays with `ke_toan`/`giam_doc_kinh_doanh`.

#### Operator Command For Final SSO Proof

```powershell
$env:SSO_ORIGINS='https://teacher.cmcvn.edu.vn,https://erp.cmcvn.edu.vn'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-teacher-cmcvn-interactive-sso.ps1
```

### Session 1 - 2026-07-06

**Trigger:** `/ck:plan validate` pass after full red-team.
**Questions asked:** 4. Later implementation applied the planning defaults without adding the higher-risk alternatives.

#### Verification Results

- **Tier:** Full
- **Claims checked:** 42
- **Verified:** 36 | **Failed:** 0 | **Unverified:** 6

Verified with code/docs evidence:

- `teacher.cmcvn.edu.vn` is not explicit in nginx yet; current nginx has `erp/hoc/ci/deverp/devlms` only.
- `apps/admin` is the current unified staff shell; `apps/teaching` is retired.
- SSO callback currently uses one configured staff origin and must be made host-aware before teacher-domain SSO is claimed.
- Teacher session listing already has server-side own-session filtering, but mutating attendance/evidence/grading paths need additional assigned-teacher guards.
- Exercise upload/publish already exists through admin course exercise manager and `exercise.upsert`.
- Parent/student LMS family login is governed by decision 0033 and must not be bypassed.

Unverified alternatives not implemented in this MVP:

- Whether direct active-student intake is acceptable.
- Whether one director should get full end-to-end setup authority remains future scope; MVP uses shared draft intake plus KD/finance approval handoff.
- Whether `devteacher.cmcvn.edu.vn` should be added now.
- Whether teacher host directors need focused-only nav or full admin nav with shortcuts.

#### Questions & Answers

1. **[Architecture]** Should parent+student one-form create active `Student`/`Enrollment` directly, or create a draft/provisioning handoff that preserves `receiptApprove` as the activation path?
   - Options: Draft/provisioning handoff (recommended) | Direct active intake with new decision/provenance | Keep existing separate flows
   - **MVP result:** Planning default applied: Draft/provisioning handoff.
   - **Rationale:** Direct active intake contradicts current receipt-owned provisioning and needs a new accepted decision plus provenance.

2. **[Authz]** Should one director role complete setup end-to-end, or should setup be a deliberate KD/DT handoff?
   - Options: KD/DT handoff (recommended) | Expand both director roles end-to-end | Pick one lead director role
   - **MVP result:** Shared draft intake plus KD/finance approval handoff.
   - **Rationale:** `receiptCreate` is non-money draft creation; `receiptApprove` remains the activation/money gate.

3. **[Infrastructure]** Should `devteacher.cmcvn.edu.vn` be in MVP?
   - Options: Defer devteacher (recommended) | Add devteacher now | Use existing deverp for pre-prod smoke
   - **MVP result:** Initially deferred; later implemented after explicit user request.
   - **Rationale:** Devteacher became required to avoid testing teacher flows against production data.

4. **[UX]** What should directors see on teacher host?
   - Options: Focused LMS shortcuts with escape back to ERP (recommended) | Full admin nav unchanged | Separate director landing by KD/DT
   - **MVP result:** Planning default applied: focused shortcuts plus ERP escape, without making host detection an authz boundary.
   - **Rationale:** Existing admin shell already works; MVP should reduce friction without forking authz.

#### Confirmed Planning Defaults

- Use existing admin app as teacher host target.
- Do not create a standalone teacher app.
- Keep host-only cookies.
- Fix server-side teacher mutation ownership before claiming teacher flow is safe.
- Use smoke/fix approach for exercise/class day/LMS flows already present.

#### Action Items

- [x] Apply planning defaults for MVP.
- [x] Proceed without a new direct-intake decision.
- [x] Do not create/update decision docs for direct active intake or role expansion because those alternatives were not implemented.

### Whole-Plan Consistency Sweep

- Files reread: `plan.md`, all phase files, story docs.
- Decision deltas checked: 4 validation defaults plus 14 red-team findings.
- Reconciled stale references: `devteacher` is now implemented, exercise/class-day phases are smoke/fix-only, direct intake defaults to draft/provisioning, privacy guard added.
- Unresolved contradictions after Session 2 defaults: 0 for this MVP. Higher-risk alternatives remain future product decisions only.
