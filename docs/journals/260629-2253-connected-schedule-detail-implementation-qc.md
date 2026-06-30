---
title: "Connected Schedule Detail — Implementation + 3-Persona QC"
date: 2026-06-29
scope: implementation + product-experience QC
story: ERP-SCHED-DETAIL
intake: 27
plan: ../../plans/260629-2102-connected-schedule-detail-navigation/plan.md
commits: [de1fab5, 6f030b3, 1b64e9c, 2fc8c1d]
---

# Connected Schedule Detail — Implementation + 3-Persona QC

## Context

Built the first slice of the Entity-Workspace direction: `/#schedule` now opens a connected
Session Detail (header, class card, roster, attendance, class activity log) with cross-entity
deep-links, reusing existing queries — no new endpoint, no schema change.

## What happened

- New `schedule-detail.tsx` (`ScheduleDetailPanel`); wired `schedule-panel.tsx` (row→session, title→class),
  `App.tsx` (selectedSession state + render), `class-workspace.tsx` (EnrollTab student→Student Detail).
- Activity log reuses `class_batch` Chatter only — the open `audit.timeline` whitelist was NOT widened
  (user/facility timelines stay closed). Code review confirmed this trap was avoided.
- Admin typecheck green; code-review PASS (one MEDIUM: duplicate `listByBatch` fetch in Session Detail — deferred).

## Verification (real product experience, not code tests)

Three QC personas drove the live app (`localhost:5173`) through **chrome-devtools MCP (real Chrome)**,
logged in as super_admin:

- QC-A (teacher): feature works end-to-end; attendance persists; 2 clicks schedule→student.
- QC-B (manager/cross-entity): deep-links connected, no dead-ends; 24/24 network 200.
- QC-C (edge/UX): empty-week, reload-mid-detail, section-switch-clears-detail all PASS.

## Key findings & decisions

- **B1 (401-after-first-call) was a Playwright-MCP cookie artifact, NOT a product bug.** Proven from code:
  the session is a stateless JWT re-checked against `tokenVersion` (`packages/auth/src/index.ts:94-102`);
  the same cookie that returns 200 must return 200 again. Dev config is correct (`COOKIE_SECURE=false`,
  CORS allows `:5173` with credentials, SameSite=Lax). Switched QC to chrome-devtools MCP; session stayed stable.
- **M1**: staff are SSO-only (`auth.ts:34`); only super_admin can password-login unless `STAFF_PASSWORD_LOGIN=true`.
  So role-diverse QC was limited to super_admin this round.
- **B0**: dev DB had no academic data; extended `seed-demo.ts` with a class batch + this-week sessions + enrollments.
- **Bug fixed (found by QC-A)**: `Workspace` navAction consumed the deep-link before `batches` loaded, so
  schedule "Mở lớp học" landed on an empty list. Now it waits for batches and opens the class first-click;
  verified by QC-B.

## Pre-existing issues surfaced (NOT this feature's regressions → separate story)

- AttendanceRoster allows Present + "Có phép" (excused) contradictory state (data integrity → payroll). [backlog #7]
- Schedule date filter leaks raw Zod JSON to the user. [backlog #8]
- Mantine DateInput typed entry swaps day/month; no from>to guard. [backlog #9]

## Next

- A high-risk story to fix the 3 surfaced Majors (attendance integrity is the priority).
- Optional later: dedupe the Session Detail roster fetch; localize status enums; teacher→staff link
  (pairs with plan 260629-2054); student-detail enrollment row → class deep-link.
