---
type: brainstorm-report
title: "Teacher-Lite + LMS carve-out into a clean standalone (drop the ERP)"
date: "2026-07-08"
branch: develop
status: approved-design
supersedes_partial: docs/decisions/0039-teacher-lite-direct-lms-mvp.md
decision_needed: docs/decisions/0041-*.md (create in plan phase — high-risk hard-gate)
---

# Teacher-Lite + LMS carve-out → clean standalone

## Problem
User is abandoning the ERP (will rebuild elsewhere). Teacher-lite must become the SOLE
system linking to LMS — clean, simple, UI per the prototype. Current teacher-lite is
entangled with the ERP inside one monorepo/DB.

## Decision (approved by user, 2026-07-08)
**Monolith-lite carve-out (approach A, 1 shared DB).**
- Keep this repo + Postgres. DELETE all ERP code/data.
- Teacher app + LMS app = two separate FRONTENDS over one shared backend (`apps/api`) + one DB.
- Native data link (Student/Class/Session/Exercise/Submission shared) → **no sync layer, ever**.
- Keep all shipped teacher-lite + LMS work (chevron statusbar, students hub, cancel-inline,
  grading-shows-PDF, LMS-exercise-visible, linked-student drawer, time-derived status).

Rejected: (B) fresh repo/DB rewrite — throws away auth/RLS/audit/migrations/Jenkins/deploy,
weeks of rework, bug regression. (C) separate LMS DB + API sync — the exact sync-hell
Decision 0039 rejected; only justified if LMS must deploy independently (user said no).

## Why this reopens 0039
0039 rejected a separate backend/DB because it "duplicates core entities and creates sync
risk **with LMS**" — a concern rooted in an ERP coexisting. With the ERP GONE, that concern
is void. New decision KEEPS 0039's core (one DB, no separate LMS/DB) and ADDS: physically
remove the ERP. Record as decision 0041 (supersedes 0039's "keep ERP coexisting" clause).

## Architecture (current → target)
Current apps: `admin` (ERP + teacher surface), `api` (shared tRPC), `lms` (student/parent FE), `e2e`.
Current packages: `audit, auth, db, domain-academic, domain-finance, domain-grading, domain-payroll, domain-rewards, ui`.

Target (after carve-out):
- **Keep**: `apps/api` (slimmed), `apps/lms`, a clean teacher app, `packages/db` (academic+auth+audit+grading only), `auth`, `audit`, `ui`, `domain-academic`, `domain-grading`.
- **Delete**: `domain-finance`, `domain-payroll`, `domain-rewards`; ERP admin surfaces + biz/edu-director ERP panels; ERP routers (receipt/finance/commission/CRM/opportunity/payroll/HR); ERP Prisma models + their migrations/RLS.
- **Teacher app**: extract `apps/admin` `surface==='teacher'` into its own clean `apps/teacher` (recommended) OR strip ERP from `apps/admin` and repurpose it. (Plan-phase decision.)

## Scope boundaries (to lock in the plan)
- What counts as "ERP" to delete vs keep (esp. grading/rewards edge — LMS grading stays; ERP commission/payroll goes).
- Data: wipe ERP tables on dev/prod, or drop columns/tables via migration keeping teacher+LMS data intact (must preserve Student/Guardian/Class/Session/Exercise/Submission/Account).
- Auth: keep RBAC but prune ERP-only roles/permissions (ke_toan/hr/cskh/ctv_mkt/finance perms).
- Teacher app extraction vs in-place strip.
- Deployment: teacher.cmcvn.edu.vn + hoc.cmcvn.edu.vn stay; erp.cmcvn.edu.vn retired.

## Risks
- HIGH: deleting domains/tables/migrations = data-loss + authorization + public-contract changes → high-risk lane, red-team + validation required.
- RLS/migration drift: must keep 0-drift after pruning (prior migration-drift bug history).
- Shared code: `apps/api` routers + `packages/ui` are shared; deleting ERP routers must not break teacher/LMS imports.
- Prod is LIVE (erp+hoc.cmcvn.edu.vn) — carve-out must be staged, reversible, verified on dev first.

## Success criteria
- ERP code/domains/routes gone; `pnpm -r tsc` + build green; Jenkins develop green.
- Teacher app + LMS run on the shared DB with zero ERP references; all shipped teacher/LMS features intact.
- Auth pruned to teacher/LMS roles; RLS 0-drift; migrations apply clean on a fresh DB.
- Prototype-faithful teacher UI preserved.

## Next
`/ck:plan` (high-risk: --deep or --hard) → phased carve-out plan + decision 0041 + red-team + validation.

## Open questions (lock in plan)
1. New `apps/teacher` extraction vs strip-in-place on `apps/admin`?
2. Wipe ERP data vs migrate-drop keeping teacher/LMS rows?
3. Exact keep/delete line for grading vs rewards/commission.
4. Retire erp.cmcvn.edu.vn now or after teacher/LMS re-verified on prod?
