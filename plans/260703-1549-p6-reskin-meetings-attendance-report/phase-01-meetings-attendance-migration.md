# Phase 1 — Migrate meetings-panel.tsx onto calendar-view.tsx + redesign attendance report

**Lane**: normal (meetings calendar adoption + attendance report redesign are both additive/replacement, not refactoring critical business logic)

## Context links

- `plans/260703-1549-p3-calendar-view-primitive/` — the primitive this consumes, now built and committed (`09aee0a`)
- `apps/admin/src/meetings-panel.tsx`, `apps/admin/src/attendance-report-panel.tsx` — target files
- `plans/260703-1549-p1-token-remap-zero-elevation/` — tokens dependency, committed

## Known facts from P3's build (do not re-derive, use directly)

- `CalendarEvent.end` is REQUIRED — `parentMeeting` has only `scheduledAt` (no duration field). This plan must synthesize a default `end` when mapping `ParentMeeting` rows to `CalendarEvent` (e.g. `scheduledAt + 60min` — confirm actual typical meeting duration with the user/product context if available, otherwise default 60min is a reasonable placeholder).
- **`attendance` does NOT map to `CalendarEvent` 1:1** — per `schema.prisma`, `Attendance` has no scheduling field at all (only `markedAt`), and one `ClassSession` has MANY `Attendance` rows (one per enrolled student). If this plan's attendance work involves a calendar surface at all, it must be `ClassSession`-level (one event block per session, status/color showing an aggregate like "12/15 present"), requiring a new/adapted tRPC query — NOT a passthrough of raw `Attendance` rows. **Re-scope check**: the original plan's #29 finding (attendance report redesign) is about the REPORT view (trend chart + KPI cards + drill-down table), not necessarily a calendar view — confirm at implementation time whether attendance actually needs `calendar-view.tsx` at all, or whether #29 is satisfied by the report redesign alone without touching the calendar primitive.
- `CalendarView` defaults to week view; month is togglable secondary.

## Scope

### A. Meetings → calendar-view.tsx (admin/staff side only — finding #11 DROPPED)
- `meetings-panel.tsx` (admin, staff-facing): adopt `CalendarView` for `ParentMeeting` rows, synthesizing `end` per the note above.
- **Finding #11 dropped (plan.md, user-confirmed 2026-07-03)**: `apps/lms/src/parent-view.tsx`'s
  `MeetingsCard` (shipped `ce2c7ba`, hardened `7d3f2d2`) already surfaces upcoming/past parent
  meetings via `trpc.parentMeeting.myMeetings.query()` — no new LMS screen needed. This sub-part is
  admin-side only.

### B. Attendance report redesign (finding #29)
- `attendance-report-panel.tsx`: redesign from flat monthly table into trend/summary report — KPI cards (attendance rate this month vs last, trend arrows), line/bar chart over last 6 months, facility/class breakdown drill-down table. Per the approved `/stitch` wireframe from earlier review.
- Per the note above: evaluate whether this needs `calendar-view.tsx` at all, or is purely a reporting/chart component (likely the latter — a trend report is not a calendar).

### C. Attendance discoverability (finding #32)
- LMS-side: "Buổi học (ảnh & nhận xét)" label doesn't read as "attendance" for parent/student personas — relabel or restructure for discoverability.

## Implementation steps

1. Sub-part A: migrate `meetings-panel.tsx` onto `CalendarView`, synthesizing event `end` (admin-side only — finding #11 dropped).
2. Sub-part B: redesign `attendance-report-panel.tsx` per wireframe — extend the existing `byMonth`/`ictMonthKey` aggregation pattern in `apps/api/src/routers/attendance.ts`'s `report` procedure with a facility-wide trailing-6-month scope (check before assuming new aggregation logic is needed).
3. Sub-part C: relabel/restructure the LMS attendance surface for discoverability — small, isolated change.

## Todo list

- [x] Confirm P1+P3 committed (both are)
- [x] Resolve finding #11 scope question — dropped, admin-only (plan.md)
- [x] Sub-part A: meetings-panel → CalendarView migration
- [x] Sub-part B: attendance-report-panel redesign (extended existing trend-data endpoint)
- [x] Sub-part C: LMS attendance discoverability relabel (+ student-side data gap fixed)
- [x] `pnpm -w typecheck` clean

## Success criteria

- Meetings surface uses the new calendar primitive with correctly-synthesized event durations.
- Attendance report is a genuine trend/summary report, not a re-skinned version of the old flat table.
- Parent/student personas can find attendance without the current mislabeling.

## Resolved decision (default applied, sound/uncontested recommendation)

**Attendance calendar scope**: #29 (attendance report redesign) is satisfied by the report-only redesign (KPI cards + trend chart + drill-down table) WITHOUT touching `calendar-view.tsx` — attendance's session-level aggregation requirement (see note above) is out of scope for this phase; if a calendar view of attendance is wanted later, it's a separate follow-up, not bundled here.

## Risk assessment

- Moderate — sub-part B likely requires new backend aggregation work (6-month trend query), which is a bigger lift than "just re-skin the UI" and should be scoped honestly at implementation time, not assumed to be UI-only.
- Sub-part A now has 2 surfaces (admin re-skin + new LMS screen) — genuinely 2 independent pieces of work within one sub-part; consider implementing/reviewing them as 2 separable units even though they're in one phase file.

## Next steps

None — P6 is a leaf in the dependency graph other than depending on P1+P3.
