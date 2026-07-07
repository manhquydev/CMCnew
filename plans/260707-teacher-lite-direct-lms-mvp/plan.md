---
title: "Teacher Lite Direct LMS MVP"
description: "Replace teacher.cmcvn.edu.vn with a simple LMS-linked internal workflow that bypasses finance/receipt for urgent MVP."
status: local-verified
priority: P0
branch: "develop"
tags: [high-risk, teacher-lite, lms, direct-provisioning, authz]
created: "2026-07-07"
source: brainstorm
---

# Teacher Lite Direct LMS MVP

## Overview

Build a dedicated Teacher Lite surface on `teacher.cmcvn.edu.vn`.

Use existing API/DB/LMS. Do not fork data. Bypass receipt/finance/CRM only for the new direct setup path.

## Governing Decision

- `docs/decisions/0039-teacher-lite-direct-lms-mvp.md`

Governing rule: Teacher Lite may direct-create parent/student/enrollment for MVP, bypassing receipt/finance/CRM. It must preserve decision `0033` LMS login: parent email OTP, student parent-phone + `Cmc2026@`.

## Phases

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Red-team and validation normalization | complete |
| 1 | [Contracts and impact](./phase-01-contracts-and-impact.md) | complete |
| 2 | [API direct provisioning](./phase-02-api-direct-provisioning.md) | complete |
| 3 | [Teacher Lite shell](./phase-03-teacher-lite-shell.md) | complete |
| 4 | [Director workflows](./phase-04-director-workflows.md) | complete |
| 5 | [Teacher class-day workflows](./phase-05-teacher-class-day-workflows.md) | local-verified |
| 6 | [LMS and email proof](./phase-06-lms-and-email-proof.md) | local-verified |
| 7 | [Deploy smoke and docs](./phase-07-deploy-smoke-and-docs.md) | local-verified |

## Acceptance Criteria

- `teacher.cmcvn.edu.vn` serves Teacher Lite, not ERP/admin bridge.
- Both directors can direct-create parent/student/enrollment.
- Teacher cannot direct-create parent/student/enrollment.
- Parent email OTP works for direct-created family.
- Student phone/default password works for direct-created student.
- Teacher can run assigned class-day workflow only.
- Parent/student LMS visibility remains scoped and publish-gated.
- Cancelled class/session is not treated as normal active work.
- Focused integration and E2E proof passes.

## ClaudeKit / Harness Workflow

Each implementation phase follows this loop:

1. `ck:scenario` lens before build: confirm edge cases for the phase.
2. `ck:cook` lens during build: implement only that phase's scoped files.
3. `ck:test` lens: run narrowest useful tests first, then broaden.
4. `ck:debug` / `ck:fix` lens: diagnose and fix failing proof without weakening tests.
5. `ck:code-review` lens: spec compliance, then quality review.
6. `ck:docs` lens: update docs only if behavior/contracts changed.
7. `ck:watzup` lens: write handoff/status after phase completion.
8. Harness: update story proof and record trace every phase.

Production setup can proceed after review/PR policy; local typecheck, strict lint, DB-backed integration, nav regression, local smoke, and production builds are green.

## Red-Team Findings Applied

Report: `./reports/red-team-260707-teacher-lite-direct-lms-mvp.md`

Accepted constraints:

- Direct setup must be a server-side transaction façade, not UI composition of existing routers.
- Add `teacherLite` permission namespace; do not broaden finance/CRM permissions for this MVP.
- Add transaction-safe direct student-code allocation because receipt code is bypassed.
- Normalize parent phone with LMS login rule; lowercase parent email.
- Map duplicate phone/email/enrollment conflicts to deterministic `CONFLICT`.
- Preserve decision `0033`: phone/default-password path never creates parent session.
- Update teacher-domain smoke assertions to prove Lite UI, not old teacher bridge.

## Phase 0 Validation

- Harness intake: `#76`, high-risk.
- Harness story: `TEACHER-LITE-DIRECT-LMS-MVP`.
- Harness decision: `0039-teacher-lite-direct-lms-mvp`.
- Baseline story verify: `pnpm --filter @cmc/api typecheck` passed before implementation.

## Phase 1/2 Implementation Proof

- Added `teacherLite.createFamilyStudentAndEnroll` permission and router mount.
- Added `StudentCodeCounter` schema/migration and direct `HS-YYYY-NNNN` allocator.
- Added direct provisioning transaction facade for parent/student/guardian/student-account/enrollment/email.
- Added focused permission parity and Teacher Lite integration specs.
- `pnpm --filter @cmc/db generate`: passed.
- `pnpm --filter @cmc/api typecheck`: passed.
- `pnpm --filter @cmc/db typecheck`: passed.
- `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts`: passed.
- `pnpm --filter @cmc/api exec eslint src --max-warnings 0`: passed.
- `teacher-lite-direct-provisioning.int.test.ts`: passed DB-backed via isolated verification Postgres.

## Phase 3 Implementation Proof

- Teacher surface copy changed to `CMC Teacher Lite`.
- Teacher-domain intake route now renders direct Teacher Lite LMS setup panel instead of receipt draft handoff.
- Nav gate for `family-intake` now uses `teacherLite.createFamilyStudentAndEnroll`.
- Jenkins teacher smoke markers updated to `CMC Teacher Lite` and `Tạo học viên LMS`.
- `pnpm --filter @cmc/admin typecheck`: passed.
- `pnpm --filter @cmc/admin exec vitest run src/__tests__/nav-teacher-consolidation.test.ts src/__tests__/nav-consistency.test.ts src/__tests__/nav-director-kd-cockpit-consolidation.test.ts src/__tests__/nav-director-dt-cockpit-consolidation.test.ts`: passed.
- `pnpm --filter @cmc/admin exec eslint src --max-warnings 0`: passed.
- `pnpm --filter @cmc/admin build`: passed with Vite chunk-size warning.

## Phase 4 Implementation Proof

- Added Teacher Lite class/session mutations:
  - `teacherLite.createClass`
  - `teacherLite.cancelClass`
  - `teacherLite.cancelSession`
- Added `apps/api/src/services/teacher-lite-class-workflows.ts` as a server-side facade; no broadening of legacy `classBatch.*`, `schedule.*`, finance, or CRM permissions.
- Added `apps/admin/src/teacher-lite-class-control-panel.tsx` on the Teacher Lite intake surface.
- Kept lesson material upload on existing Courses / lesson exercise workflow (`exercise.upsert`), already allowed for both directors.
- `pnpm --filter @cmc/api typecheck`: passed.
- `pnpm --filter @cmc/admin typecheck`: passed.
- `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts`: passed.
- `pnpm --filter @cmc/api exec vitest run test/teacher-lite-direct-provisioning.int.test.ts`: passed DB-backed through the verification script.
- `pnpm --filter @cmc/admin exec vitest run src/__tests__/nav-teacher-consolidation.test.ts src/__tests__/nav-consistency.test.ts src/__tests__/nav-director-kd-cockpit-consolidation.test.ts src/__tests__/nav-director-dt-cockpit-consolidation.test.ts`: passed.
- `pnpm --filter @cmc/api exec eslint src --max-warnings 0`: passed.
- `pnpm --filter @cmc/admin exec eslint src --max-warnings 0`: passed.
- `pnpm --filter @cmc/admin build`: passed with Vite chunk-size warning.
- `gitnexus_detect_changes(scope=all)`: medium; expected shell/dashboard/nav metadata impact. New Teacher Lite files need next GitNexus analyze to appear in graph.

## Phase 5/6 Proof

- Existing teacher workflows cover attendance, session evidence photos/comments/publish, submissions, grading, grade publish, stars, and LMS published visibility.
- `pnpm --filter @cmc/lms typecheck`: passed.
- `pnpm --filter @cmc/lms build`: passed with Vite chunk-size warning.
- `pnpm --filter @cmc/admin exec vitest run src/__tests__/nav-teacher-consolidation.test.ts`: passed.
- `scripts/verify-teacher-lite-direct-lms-mvp.ps1` starts isolated Postgres on `55433`, migrates, seeds, and runs DB-backed tests:
  - `teacher-lite-direct-provisioning.int.test.ts`
  - `session-evidence-publish-to-lms.int.test.ts`
  - `submission-guardian-layer.int.test.ts`
  - `lms-security-invariants.int.test.ts`
  - `attendance-report-markall.int.test.ts`
  - `assessment-final-grade-publish.int.test.ts`
- DB-backed run found and fixed a cross-facility evidence write gap in `assertTeachingSessionMutationAllowed`.

## Phase 7 Local Smoke

- Dev servers running:
  - API: `http://localhost:4000`
  - Teacher/admin: `http://localhost:5173/?surface=teacher`
  - LMS: `http://localhost:5175`
- `GET http://localhost:4000/health`: passed.
- Playwright Teacher/admin smoke:
  - title `CMC Teacher Lite Portal`
  - body includes `CMC Teacher Lite`
  - nonblank DOM
- Playwright LMS smoke:
  - title `Học tập CMC EDU`
  - nonblank DOM
- Screenshot saved: `.playwright-mcp/teacher-lite-login-smoke.png`.

## Harness Verification Command

- Added `scripts/verify-teacher-lite-direct-lms-mvp.ps1`.
- Updated Harness story `TEACHER-LITE-DIRECT-LMS-MVP` verify command to run that script.
- `harness-cli story verify TEACHER-LITE-DIRECT-LMS-MVP`: passed with the script after DB-backed verification was added.
- Script coverage:
  - DB client generation when API is not holding the Prisma engine DLL.
  - API/DB/Admin/LMS typecheck.
  - API/Admin/LMS strict lint (`--max-warnings 0`).
  - Permission parity.
  - Isolated Postgres migrate + seed on port `55433`.
  - Teacher Lite direct provisioning integration surface.
  - LMS published-output invariants.
  - Attendance/final-grade invariants.
  - Teacher Lite nav regression.
  - Admin/LMS production builds.
- Current non-blocking warnings:
  - Admin/LMS build: Vite chunk-size warnings.
  - Admin nav tests: PDF legacy-build notice.

## Dependencies

- Brainstorm report: `plans/reports/brainstorm-260707-teacher-lite-direct-lms-mvp-report.md`
- Story: `docs/stories/TEACHER-LITE-DIRECT-LMS-MVP/`
- Decision: `docs/decisions/0039-teacher-lite-direct-lms-mvp.md`
- Red-team report: `plans/260707-teacher-lite-direct-lms-mvp/reports/red-team-260707-teacher-lite-direct-lms-mvp.md`
- Watzup report: `plans/reports/watzup-260707-teacher-lite-direct-lms-mvp.md`

## Unresolved Questions

- None for MVP direction.
