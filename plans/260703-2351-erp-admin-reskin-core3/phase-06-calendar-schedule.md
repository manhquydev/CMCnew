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
