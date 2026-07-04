# Phase 6 — Calendar/schedule restyle implementation report

## Executed Phase
- Phase: phase-06-calendar-schedule
- Plan: D:\project\CMCnew\plans\260703-2351-erp-admin-reskin-core3
- Status: completed

## Files Modified
- `packages/ui/src/calendar-view.tsx` (+139/-92 lines net across whole file diff, primarily in
  `WeekGrid`/`MonthGrid`)
- `apps/admin/src/schedule-panel.tsx`
- `apps/admin/src/meetings-panel.tsx`
- `apps/admin/src/attendance-panel.tsx`

## Tasks Completed

### calendar-view.tsx (primitive)
- [x] `rowHeight` 48px → 60px (WeekGrid hour rows) — matches Core 3 time-grid.
- [x] Header row height set explicitly to 40px in both WeekGrid (day-of-week header) and MonthGrid
      (weekday label row); previously implicit/padding-driven.
- [x] Event cards (WeekGrid): 4px colored left accent border (`borderLeft: 4px solid ${accent}`)
      over a `color-mix(in srgb, ${accent} 14%, var(--cmc-surface))` tinted background, text colored
      with the accent itself instead of solid-fill white-on-color. `accent` = `event.color ??
      'var(--cmc-brand)'` — reused the existing color-per-event scheme, did not invent a new one.
- [x] Event chips (MonthGrid): same tint + 3px left accent treatment (chip is smaller, used 3px not
      4px to stay proportionate at 10px font / cell density).
- [x] Today indicator: `boxShadow: inset 0 0 0 2px var(--cmc-brand)` applied to WeekGrid's today
      header cell, WeekGrid's today day-column (`inset 2px 0 0 0 var(--cmc-brand)`, left-edge only
      since header already rings the top), and MonthGrid's today cell (full inset ring, matches
      `.today { box-shadow: inset 0 0 0 2px #0071e3 }` in the `xem_theo_thang` wireframe).
- [x] Borders: audited — file already used `var(--cmc-border)` / `var(--cmc-border-faint)`
      consistently, no hardcoded `#D2D2D7`-equivalent literal existed. Nothing to change here
      (confirms the plan's own audit note).

### Consumer panels
- `meetings-panel.tsx`: replaced the two Mantine `Badge` status chips (meeting-detail modal status
  + "Chưa chốt" unconfirmed flag) with `StatusBadge`. Split the old `MEETING_ST` map into
  `MEETING_STATUS_DEF` (label+tone, for `StatusBadge`) and `MEETING_EVENT_COLOR` (status→mantine
  color slug, for `CalendarEvent.color` passed into the primitive) since `StatusDef` has no color
  field and the calendar accent needs an actual CSS color. Removed the now-unused `Badge` import.
  All parent-meeting mutation handlers (`setStatus`, `setSchedule`, `setNote`) untouched.
- `schedule-panel.tsx`: replaced the session-status `Badge` (STATUS_COLOR map) with `StatusBadge`
  (new `SESSION_STATUS_DEF` map: planned→draft, open→info, running→active, closed→inactive,
  cancelled→rejected — reused existing `StatusTone` values, no new colors invented). **No
  CalendarView/month-week-day toggle exists in this file** — it renders a date-range table, not the
  calendar primitive. Per the styling-only/no-new-feature constraint I did not add one; flagging
  this as a plan-vs-code mismatch (the phase file's wireframe mapping assumed this file used
  `CalendarView`, but `gitnexus`/grep confirms `CalendarView` has exactly one consumer:
  `meetings-panel.tsx`).
- `attendance-panel.tsx`: added a `StatusBadge` for the selected session's `status` field next to
  the card title (data already present on `selectedSession`, fetched by the existing untouched
  `trpc.schedule.mySessions.query` call — no new query, no logic change). This is the only "session
  chip" surface that existed in this file; there was no prior status display to convert. Left
  `trpc.schedule.mySessions.query`, session-selection state, and `AttendanceRoster` (attendance
  marking) completely untouched, as required.

## Tests Status
- Type check: PASS (`pnpm -w typecheck`, 12/12 packages, incl. `@cmc/ui` and `@cmc/admin`)
- Unit tests: PASS — `pnpm --filter @cmc/ui test` 55/55 (calendar-view.test.ts 11/11, run both
  before and after the primitive edit, no geometry regression); `pnpm --filter @cmc/admin test`
  27/27
- ESLint: PASS on all 4 modified files, no warnings/errors
- `git status --porcelain` confirms the diff is scoped to exactly the 4 owned files (other
  repo-root changes visible in status predate this task)

## Geometry-vs-cosmetic ambiguity (explicitly investigated)
`calendar-view.test.ts` only unit-tests the three pure functions (`getWeekRange`,
`getMonthGridCells`, `placeEventsInDay`) and asserts **proportional** math — `top`/`height` as
fractions of the hour-window's total minutes (e.g. `expect(placed!.top).toBeCloseTo(240 / 840, 5)`).
It contains zero assertions on literal pixel values (`rowHeight`, header height, `56px` time-gutter
column, etc.) and zero DOM/render assertions. So changing `rowHeight` from 48→60 and adding an
explicit 40px header height did not touch anything the test locks — confirmed by running the suite
unchanged (11/11) both before and after. No ambiguous case was left un-changed out of caution; I did
not need to hold back on any geometry value.

## Issues Encountered
- Plan's per-panel mapping for `schedule-panel.tsx` (view toggle/mini-month, wireframe #14) doesn't
  match the actual file — it has no `CalendarView` usage at all. Resolved by treating it as
  out-of-scope for the toggle requirement (styling-only pass, "skip if it would require non-trivial
  new logic") and applying the StatusBadge conversion instead, which was in-scope and applicable.

## Next Steps
- A human/orchestrator visual check against the two wireframe screenshots (time-grid + month-grid)
  is still recommended, as instructed — I did not have Playwright/browser access in this task.
- If `schedule-panel.tsx` is later meant to actually adopt `CalendarView` (matching wireframe #14's
  time-grid), that's a real feature addition, not a styling pass — should go through its own
  phase/story.

Status: DONE
Summary: Restyled calendar-view.tsx primitive (60px rows, 40px headers, 4px accent+tint event cards, inset brand-color today ring) with 0 geometry-test regressions (test only asserts proportional math, no locked pixel values); converted meetings/schedule/attendance panels' status chips to StatusBadge; typecheck/tests/lint all green; diff scoped to exactly the 4 owned files.
Concerns/Blockers: schedule-panel.tsx has no CalendarView/view-toggle to restyle (plan's wireframe mapping assumed one existed) — documented as a plan-vs-code mismatch, not fixed since adding one would be new feature work outside a styling-only phase.
