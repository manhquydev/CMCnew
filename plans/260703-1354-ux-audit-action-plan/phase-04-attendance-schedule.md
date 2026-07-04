# Phase 4 — Attendance & teaching schedule

**Findings resolved:** #8, #9, #27, #28
**Effort:** 2.5h (was 2h; #27/#28 confirmed owned here, moved from Phase 5's original draft) · **Lane:** normal

`schedule-panel.tsx` is owned entirely by this phase — confirmed by reading the file (both #27's
empty-state and #28's facility-flash live here). Phase 5 no longer lists #27/#28.

## Context links

- `plans/reports/ui-ux-designer-260703-persona-qa-master-findings-report.md` (#8 attendance markable for unassigned/future sessions with no warning; #9 "Lịch dạy" default range = "this week"; #27 empty-state guidance; #28 "Cơ sở" field flash)
- Memory: `work-shift-missing-create-table-migration` (attendance state model context)
- Prior audit: `plans/reports/debugger-260701-1008-work-shift-attendance-state-audit-report.md`, `plans/reports/qc-c-260629-2119-edge-ux-report.md` (edge UX around attendance)

## Current code shape (verified)

- Attendance surfaces: `apps/admin/src/attendance-panel.tsx`, `attendance-roster.tsx`, `checkin-panel.tsx`. "Lịch dạy" nav (`shell.tsx:409` `key: 'schedule'`) renders `SchedulePanel` (`apps/admin/src/schedule-panel.tsx`, imported `App.tsx:60`); attendance is embedded in the schedule ("Lịch 360" — `shell.tsx:410` comment: điểm danh nhúng sẵn). Session detail = `schedule-detail.tsx`.
- The exact week-range default and the attendance-enable condition must be read in `schedule-panel.tsx` / `attendance-roster.tsx` at implementation time — a grep for `startOfWeek`/`weekStart` returned no hits, so the range is computed differently (dayjs range state, a `range`/`from`/`to` prop, or server default). **Confirm the range mechanism before editing.**

## Implementation steps

### #8 — guard attendance for unassigned / future-dated sessions
1. In the attendance marking UI (`attendance-roster.tsx` / wherever the "điểm danh" action lives inside session detail), identify the condition that enables marking. Add a guard:
   - **Future-dated session**: if `session.scheduledAt` (or date) is in the future, disable the mark action and show an inline warning ("Buổi học chưa diễn ra — chưa thể điểm danh") instead of silently allowing it.
   - **Unassigned session** (no teacher assigned / current user not the assigned teacher): show a warning and either disable or require explicit confirm, matching whatever the server already enforces. Mirror the server gate — do not add client-only enforcement that the API contradicts.
2. Prefer surfacing a `<Alert>`/disabled-state (design-system warn tokens) over a hard block if the server still permits it; the finding is "no warning", so the minimum fix is a visible warning + disabled primary action.
3. Verify against the attendance state audit report so this doesn't re-introduce a previously-fixed behavior.

### #9 + #27 — widen "Lịch dạy" default range + empty-state guidance
1. In `schedule-panel.tsx`, locate the default date range (currently "this week"). Two-option, pick the smaller:
   - **Recommended (KISS):** widen the default to "this week + next week" (or a rolling 14-day window) so upcoming sessions are visible without changing the range picker; OR
   - keep "this week" but ensure the empty-state (#27) clearly says sessions exist later and offers a "Xem tuần sau"/range control.
2. Confirm no server-side range cap forces the "this week" limit (if the query hard-caps to week bounds, widen the query input, not just the picker default).
3. #27: whichever option is chosen, the empty-state copy must give a concrete next step (not a bare "không có dữ liệu") — either "chưa có buổi học tuần này, xem tuần sau" (if keeping narrow range) or nothing extra needed (if range widened, empty genuinely means empty).

### #28 — "Cơ sở" field flash
1. Locate the facility `Select` init pattern in `schedule-panel.tsx` (mirrors `crm-panel.tsx:151` `setFacilityId((cur) => cur ?? fs[0]?.id ?? null)` — starts `null`, flashes required/empty, then auto-populates once facilities load).
2. Fix: hold the "required" validation error until `facilities` has loaded (guard on a `loading` flag), or initialize from a synchronously-available default (e.g. `useSession`'s current facility) instead of waiting on the async list. Prefer the loading-guard (smaller change).

## Validation / tests

- [ ] #8: attempting to mark attendance on a future-dated session shows a warning and the mark action is disabled (no silent save).
- [ ] #8: marking on an unassigned/non-owned session warns the user; behavior matches the server gate (no client/server divergence).
- [ ] #9: opening "Lịch dạy" surfaces upcoming (next-week) sessions by default, or the empty-state clearly guides to them (#27).
- [ ] #28: no required-flash on the "Cơ sở" field while facilities are loading.
- [ ] Existing attendance flows for a valid current session still work.
- [ ] `pnpm -w typecheck` clean; relevant work-shift/attendance tests green.

## Risks & rollback

- **#8 must mirror server authorization**, not replace it — a client-only block that the API would reject differently creates confusion. Read the server condition first.
- Rollback: revert the guard (restore prior enable condition), the range default, and the facility-flash fix independently.
