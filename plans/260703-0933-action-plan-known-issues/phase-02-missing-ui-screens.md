---
phase: 2
title: Missing UI Screens
status: completed
effort: ''
---

# Phase 2: Missing UI Screens

## Overview

3 backend endpoints are complete, permission-gated, and integration-tested but have no admin UI
caller (per `DEBT.md`, opened 2026-07-02): `attendance.report` (`apps/api/src/routers/attendance.ts:209`),
`enrollment.transfer` (`apps/api/src/routers/enrollment.ts:137`), `schedule.createMakeupSession`
(`apps/api/src/routers/schedule.ts:259`). Build the minimal admin UI to call each — no new backend
logic, this phase is UI-only.

## Related Code Files

- Create: `apps/admin/src/attendance-report-panel.tsx` (or similar — check for an existing
  attendance-adjacent panel to extend instead of a new file, per YAGNI).
- Modify: `apps/admin/src/class-workspace.tsx` (add a "chuyển lớp" / transfer action per `DEBT.md`'s
  own suggested close condition — a class-workspace transfer action).
- Modify: `apps/admin/src/schedule-detail.tsx` or `apps/admin/src/schedule-panel.tsx` (add a
  "tạo buổi học bù" / makeup-session action per `DEBT.md`'s own suggested close condition).
- Modify: `apps/admin/src/shell.tsx` / `App.tsx` if a new route/nav entry is needed for the
  attendance report screen.

## Implementation Steps

1. Read each of the 3 router procedures' input/output zod schemas to know the exact request shape the UI must send.
2. Read `apps/api/test/attendance-report-markall.int.test.ts`, `enrollment-transfer.int.test.ts`, `schedule-makeup-session.int.test.ts` to understand the expected real-world call shape and edge cases already covered.
3. `gitnexus_impact` on each of the 3 procedures before wiring a new caller (confirm no unexpected existing callers, verify permission requirements).
4. Build each UI piece as a minimal, existing-pattern-matching admin panel/action — reuse `DataTable`, `PageHeader`, existing modal patterns from `class-workspace.tsx`/`schedule-detail.tsx`. Do not introduce a new UI framework or pattern (YAGNI — this is 3 small additions, not a redesign).
5. Wire each into the existing shell/nav only if it doesn't already have a natural home (transfer/makeup-session actions likely belong inside existing class-workspace/schedule-detail panels, not new top-level nav items).

## Success Criteria

- [ ] `attendance.report` callable from an admin screen, returns and renders correctly for a real facility/period.
- [ ] `enrollment.transfer` callable from class-workspace, moves a student between class batches correctly.
- [ ] `schedule.createMakeupSession` callable from schedule/class-workspace, creates a makeup session correctly.
- [ ] `pnpm --filter @cmc/admin typecheck` clean.
- [ ] `DEBT.md` updated: mark all 3 items `[x] PAID` with the date and file(s) shipped, matching the existing convention in that file.
