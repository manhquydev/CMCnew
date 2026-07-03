# Phase 6 — Calendar / schedule

## Context
- Wireframe refs: `template_l_ch_erp_vietnamese_core` (#14, canonical: time-grid 60px rows, event
  cards with 4px colored left accent, 8px 12px density, mini-month sidebar widget, Tháng/Tuần/Ngày
  toggle) and `template_l_ch_erp_xem_theo_th_ng` (#15, month grid: `.today` inset ring `#0071e3`,
  event chips in cells).
- Existing primitive: `calendar-view.tsx` (+ `calendar-view.test.ts`). Audit confirmed it uses
  `--cmc-border`/`--cmc-brand` tokens consistently and hardcodes pixel values equal to tokens — safe.
- `meetings-panel.tsx` maps to `l_ch_h_p_ph_huynh` (#5) but that wireframe is the mobile PARENT
  portal (Plus Jakarta Sans, not admin) — treat as loose reference; keep admin Core 3 styling.

## Requirements
- `calendar-view.tsx`: event cards 4px colored left accent + tinted bg; today ring `--cmc-brand`;
  header row 40px, hour rows 60px; borders `--cmc-border` (now #E5E7EB). Keep hardcoded-equals-token
  style (established precedent) but align any stale `#D2D2D7`-equivalent to the border token var.
- `schedule-panel.tsx` (Lịch dạy): view toggle (month/week/day) styled per #14; mini-month optional.
- `meetings-panel.tsx`, `attendance-panel.tsx`: event/status chips → `StatusBadge`; card density polish.

## Files
- Modify: `packages/ui/src/calendar-view.tsx`, `apps/admin/src/schedule-panel.tsx`,
  `meetings-panel.tsx`, `attendance-panel.tsx`.

## Steps
1. `gitnexus_impact` on `CalendarView` (upstream consumers); warn if HIGH.
2. Restyle primitive; re-run `calendar-view.test.ts`; screenshot a consumer.
3. Apply schedule/meetings/attendance polish; keep all event data, click-to-open, and attendance
   logic intact.

## Tests / validation
- `pnpm --filter @cmc/ui test` (`calendar-view.test.ts` green); `pnpm -w typecheck`.
- Playwright: schedule week + month vs #14/#15.
- `gitnexus_detect_changes`; reviewer confirms styling-only.

## Risks / rollback
- Risk: event absolute-positioning math altered by padding change. Mitigation: change colors/borders/
  radius only, not the grid geometry constants the test locks.
- Rollback: primitive + per-panel reverts.

## Status (implemented 2026-07-04)
- `calendar-view.tsx`: rowHeight 48→60px, header row 40px (both week+month), event cards get
  4px left accent + `color-mix` tint (was solid fill), today ring `inset 0 0 0 2px var(--cmc-brand)`
  on header/day-column/month-cell. `calendar-view.test.ts` only asserts pure-function proportional
  math (fractions of window minutes) — no pixel/DOM geometry assertions exist, so rowHeight/header
  height were safe to change; 11/11 tests green before and after.
- `meetings-panel.tsx`: status Badge → `StatusBadge` (modal detail + "Chưa chốt" flag); calendar
  event tint color kept as a separate mantine-color-slug map since `StatusDef` has no color field.
- `schedule-panel.tsx`: status Badge → `StatusBadge`. No CalendarView/view-toggle exists in this
  file (it's table-based, not the calendar primitive) — skipped inventing a toggle per styling-only
  scope.
- `attendance-panel.tsx`: added a display-only `StatusBadge` for the selected session's status next
  to the card title (data already fetched by existing `mySessions` query, no new fetch/logic).
  `trpc.schedule.mySessions.query` / session-selection / attendance-marking logic untouched.
- Validation: `pnpm --filter @cmc/ui test` 55/55 pass, `pnpm -w typecheck` clean (12/12 packages),
  `pnpm --filter @cmc/admin test` 27/27 pass, ESLint clean on all 4 files, `git status` confirms
  diff scoped to exactly the 4 owned files.
