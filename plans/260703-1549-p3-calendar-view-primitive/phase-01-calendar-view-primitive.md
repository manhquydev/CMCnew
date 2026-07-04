# Phase 1 — Build hand-built calendar-view.tsx primitive

**Lane**: normal (new component)

## Context links

- `plans/260703-1543-erp-ui-rebuild-phase-ab-token-primitives/reports/researcher-260703-1549-record-detail-calendar-primitives-report.md` — confirms `@mantine/dates` has no week/month/day view, must hand-build (version corrected below)
- `plans/260703-1549-p1-token-remap-zero-elevation/` — P1 must be committed first (tokens dependency)
- `apps/admin/src/view-defaults.ts` — first 4 consumer entities: `testAppointment`, `scheduleSession`, `parentMeeting`, `attendance`
- `packages/db/prisma/schema.prisma` — actual entity schemas (see red-team correction #3 below, the naive generic-event-shape assumption doesn't hold for all 4)

## Red-team corrections (2026-07-03, 4 real issues fixed)

1. **Version citation corrected**: `@mantine/dates` package.json specifier is `^7.15.2` but `pnpm-lock.yaml` resolves it to **7.17.8** installed. No week/month/scheduler view exists in either version (not independently re-verified against 7.17.8's actual type defs due to a scout-block on `node_modules`, but no evidence contradicts the prior claim — proceed with hand-build as planned).
2. **dayjs locale claim was FALSE — real bug, fixed here**: `packages/ui/package.json` has **zero `dayjs` dependency**, and relying on `apps/admin/src/main.tsx`'s `dayjs.locale('vi')` side effect from a *different workspace package* is a phantom-dependency/layering violation — `packages/ui` is meant to be host-app-agnostic. **Fix**: add `dayjs` as an explicit `packages/ui/package.json` dependency; `calendar-view.tsx` imports `dayjs/locale/vi` and calls `dayjs.locale('vi')` itself at module scope — the package owns its own locale correctness, does not borrow the host app's.
3. **`CalendarEvent` generic-shape claim was overstated — real schema mismatch, scope corrected**: per `schema.prisma`, `TestAppointment` and `ParentMeeting` have only `scheduledAt DateTime` — **no end-time field at all**. `Attendance` has **no scheduling field whatsoever** (only `markedAt DateTime?`) — its real time comes transitively through `classSessionId → ClassSession.sessionDate/startTime/endTime`, and one `ClassSession` has MANY `Attendance` rows (one per enrolled student). A 1:1 attendance-row-to-calendar-event mapping doesn't exist. **Fix**: `attendance`'s calendar view is a `ClassSession`-level aggregation (e.g. "12/15 present" rolled into one event block's `status`/`color`), requiring a join/aggregation query — this is P6's concern when it becomes the first real consumer, not solvable generically inside this primitive. `testAppointment`/`parentMeeting` callers must synthesize a default `end` (e.g. `scheduledAt + 30min`) since the entity has no duration field — this is caller-side mapping, not free, and the acceptance criteria below is corrected to say so.
4. **Overlap/collision layout was unaddressed — real complexity gap, MVP behavior committed**: naive time-based positioning breaks when 2+ events overlap in the same day/hour range (double-booked sessions, etc.) — this is normally the hardest part of a hand-rolled week-view calendar. **Fix, committed as explicit MVP scope**: use a **fixed even-split column-width algorithm** keyed by concurrent-overlap-count (NOT measured/dynamic width via ResizeObserver) — this keeps the event-placement function pure and unit-testable per the test strategy below. Variable-duration blocks get proportional height/offset within the hour-row grid (pixel/rem math, not clean Grid cell semantics — acceptable, still no external library needed).

## Resolved decision (default applied, YAGNI — override if disagreed)

**Locale/week-start**: hardcode Vietnamese (Monday week-start, VN day/month names). Per correction #2, this is now self-contained in `calendar-view.tsx` (not borrowed from `apps/admin`). No `localeCode`/`weekStartDay` prop — VN-only ERP, a configurable locale prop would be speculative generality with no real consumer.

**Timezone**: not handled — single-timezone system (VN-only ERP), explicit assumption, not silently absent.

## Scope

Week view (default, per prior `/stitch` review — all 4 first-consumer entities are time-slotted/operational, need hour-of-day granularity). Month view as togglable secondary mode (per the same review).

## Implementation steps

1. Add `dayjs` to `packages/ui/package.json` dependencies (correction #2).
2. Create `packages/ui/src/calendar-view.tsx`; import `dayjs/locale/vi`, call `dayjs.locale('vi')` at module scope.
3. Week grid: 7 day-columns (Mon-Sun), hour-of-day rows (configurable start/end hour, default business hours). Events outside the rendered hour window: clip at the window edge (do not auto-expand the window — keeps grid height predictable).
4. **Event placement as a pure function**: `placeEventsInDay(events, dayStart, dayEnd, hourWindow) => PlacedEvent[]` where `PlacedEvent` includes `top`/`height` (proportional to hour-row grid) AND `columnIndex`/`columnCount` (even-split overlap algorithm per correction #4). Component only consumes `PlacedEvent[]` for rendering — never folds live selection/hover/DOM-measurement state into this function.
5. Month grid: 6-week × 7-day grid via a pure `getMonthGridCells(date) => Date[][]` function (handles leading/trailing days — the classic off-by-one bug surface), event chips per day cell (cap ~3 visible + "+N khác" overflow), today highlighted per P1's finalized brand-color token.
6. Shared props: `events: CalendarEvent[]` where `CalendarEvent = {id, title, start: Date, end: Date, status, color?}` — **`end` is REQUIRED input to this primitive; callers with no native duration field (testAppointment, parentMeeting) synthesize it before passing in** (correction #3). `attendance`'s session-level aggregation is P6's data-fetch concern, out of scope here.
7. `view: 'week'|'month'`, `onViewChange`, `onEventClick`, `date`/`onDateChange` for navigation, "Hôm nay" button + prev/next, matching the approved `/stitch` wireframe layout.
8. Export from `packages/ui/src/index.tsx` using the `.js`-extension convention (`export { CalendarView, type CalendarEvent } from './calendar-view.js';`).
9. Unit tests for the pure date-math helpers: `getWeekRange`, `getMonthGridCells`, `placeEventsInDay` (including an overlap case — 2-3 concurrent events, assert even-split column widths) — genuinely pure functions per correction #4's commitment, testable without jsdom (confirmed: `packages/ui/vitest.config.ts` is `environment: 'node'`, matches existing `data-table-utils.test.ts`/`theme.test.ts` convention).

## Todo list

- [ ] Confirm P1 committed (token dependency)
- [ ] Add `dayjs` to `packages/ui/package.json`
- [ ] Build week grid + month grid + pure placement/grid-cell helpers
- [ ] Unit tests for date-math helpers, including an overlap-layout case
- [ ] Export from index.tsx
- [ ] `pnpm --filter @cmc/ui exec tsc --noEmit` clean

## Success criteria

- `CalendarEvent` shape works for `testAppointment`/`parentMeeting`/`scheduleSession` as a direct passthrough (with caller-synthesized `end` for the first two); `attendance` is explicitly NOT a direct passthrough — documented as P6's session-aggregation concern, not claimed as "generic, no entity-specific logic" (correction #3).
- Week view shows hour-of-day granularity with correct even-split layout for overlapping events; month view shows day-level overview with overflow handling.
- No explicit shadow override on internal containers (inherits P1's flat/functional-minimum doctrine).
- Locale is self-contained in `calendar-view.tsx`, not dependent on host-app side effects.

## Risk assessment

- Low-moderate (upgraded from Low — red-team found real scope gaps, not just polish items).
- Main risks: date-math bugs (week-start-day off-by-one, month-grid leading/trailing-week calculation, overlap-column math) — mitigated by the pure-function unit tests in step 9, including an explicit overlap case.
- `attendance`'s session-aggregation requirement means P6 will need a new/adapted tRPC query, not just a UI wiring — flag this to P6's plan when it's detailed.

## Next steps

P6 (meetings/attendance-report re-skin) is the first real consumer — for `parentMeeting` (synthesized-duration passthrough) and `attendance` (session-aggregation, needs its own data-fetch work). P6's plan should be updated to note this when detailed.
