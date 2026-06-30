---
title: "Plan: Connected Schedule Detail + Cross-Entity Navigation"
date: 2026-06-29
status: implemented-qc-passed
lane: high-risk
scope: plan-first-then-implement-after-approval
intake: 27
inputs:
  - ../reports/brainstorm-260629-2030-connected-erp-schedule-workspace-report.md
defers_to:
  - ../260629-2054-staff-record-page-redesign/plan.md   # staff/org + activity log already owned there
validated_by: direct re-audit on branch develop (nav + audit + data-model claims), figures match report
---

# Plan: Connected Schedule Detail + Cross-Entity Navigation

## Overview

Make `/#schedule` the first proof of an Entity Workspace: clicking a lesson opens a **Session Detail** read view that connects class, students, teacher, attendance, and activity log. Then wire the missing cross-entity deep links (student↔class, teacher→staff). No database schema change. No Microsoft Graph. No visual redesign beyond what these views need.

Staff/org record page and secure staff activity log are OUT — they are owned by plan `260629-2054-staff-record-page-redesign` (already in flight; `audit.staffTimeline` + `user.viewActivity` already exist). This plan only consumes that work via a gated link.

## Validated Facts (re-audited on develop)

- `/#schedule` row click calls `goToClass(batch.id,'sessions')` → opens class workspace sessions tab; NO session-detail page exists (`schedule-panel.tsx:159-163`, `App.tsx:714-719`).
- Internal navigation uses `NavAction {batchId,tab,ts}` + hash `SectionKey`; no query-param entity routing (`class-workspace.tsx:55-65`, `App.tsx:680-725`).
- `ClassDetail` tabs = schedule/sessions/enroll/attendance/meetings/log; enroll rows do NOT link to student detail (`class-workspace.tsx:478-496`).
- `StudentDetailPanel` exists with tabs + `Chatter` history; enrollment rows do NOT link to class (`student-detail.tsx:262-283,542-546`).
- `AttendanceRoster` component already renders a per-session roster (`class-workspace.tsx:601-608`).
- API: `schedule.listSessions({classBatchId})` returns sessions for a batch; `enrollment.listByBatch` returns roster; `schedule.mySessions` returns batch include + roomName but NO per-session roster/attendance. No single "session detail" query exists (`schedule.ts:71-130`).
- Data model supports a session-detail read via existing relations — `ClassSession`→`batch`, `Enrollment`→`student`, `Attendance`→`session` (`schema.prisma:286-333`). No schema change needed.
- Audit: open `Chatter` whitelist (`audit.timeline`) covers `class_batch`/`student`; user/facility deliberately excluded; secure `audit.staffTimeline` exists for staff (`audit.ts`).

## Core Design Decisions (locked)

1. **Session Detail is a READ view first** — header (date/time/status/room/teacher) + class card + student roster + attendance + activity log. No new write power.
2. **Reuse existing data paths before adding endpoints.** A Session Detail can be assembled from `schedule.listSessions` (or one session) + `enrollment.listByBatch` + existing `AttendanceRoster`. A dedicated `schedule.sessionDetail` query is OPTIONAL (decide in P1) — only add it if assembling client-side causes N+1 or permission leak.
3. **Navigation evolves `NavAction`, not the app shell.** Keep hash `SectionKey`; extend the in-memory nav object to carry `sessionId`. Shareable query-param links are a later, separate concern.
4. **Activity log uses existing safe channels only.** Session/class log = `class_batch` Chatter (already whitelisted). NEVER widen `NOTE_TARGETS` for `user`/`facility`. Teacher→staff link reuses the gated staff record page from plan 260629-2054.
5. **Permission parity preserved.** Every deep-link target must already be permitted for the viewer; a teacher link is shown only when the viewer can open the staff record (`user.viewActivity`/staff visibility from the other plan).

## Phases

| Phase | File | Risk | Purpose | Status |
|---|---|---|---|---|
| P1 | `phase-01-session-detail-read.md` | normal | Session Detail read view reachable from `/#schedule`; header + class card + roster + attendance + class log. | DONE — `schedule-detail.tsx` (new); client-side assembly from existing queries; admin typecheck green; code review PASS. |
| P2 | `phase-02-cross-entity-deeplinks.md` | normal | Roster/EnrollTab student row → Student Detail; class card → Class Detail. | DONE for schedule roster→student, class card→class, EnrollTab row→student. DEFERRED: student-detail enrollment row → class (needs goToClass across overlay contexts) — follow-up. |
| P3 | `phase-03-session-activity-surface.md` | high-risk (audit read authz) | Class activity log inside Session Detail via existing `class_batch` Chatter; no NOTE_TARGETS widening. | DONE — `Chatter entityType="class_batch"`; reviewer confirmed user/facility timeline untouched. |

## QC — product-experience (3 personas, real Chrome via chrome-devtools MCP, super_admin)

Reports: `../reports/qc-a-260629-2119-session-detail-teacher-lens-report.md`,
`../reports/qc-b-260629-2119-manager-cross-entity-report.md`,
`../reports/qc-c-260629-2119-edge-ux-report.md`. Charter: `../reports/qc-charter-260629-2119-connected-schedule-detail-product-experience.md`.

- QC-A (teacher): feature works end-to-end; session stable in real Chrome; attendance persists; 2 clicks schedule→student. The prior "401 after first call" was a Playwright artifact (session is a stateless JWT), NOT a product bug.
- QC-B (manager/cross-entity): "Mở lớp học" deep-link fix VERIFIED (opens class workspace directly); all cross-entity chains connected, no dead-ends; 24/24 network 200.
- QC-C (edge/UX): empty-week, reload-mid-detail, section-switch-clears-detail all PASS.

### Pre-existing issues surfaced by QC (NOT regressions of this feature)

These live in reused components; recommend separate stories, not silent fixes here:

- MAJOR (data integrity): `AttendanceRoster` lets a student be Present + "Có phép" (excused) simultaneously; toggling status does not reset excused. Touches attendance→payroll data → its own high-risk story.
- MAJOR (UX): schedule date-range filter shows raw Zod JSON ("Lỗi tải lịch: [{code:invalid_string…}]") on a malformed date; needs a friendly message.
- MAJOR (UX): Mantine `DateInput` typed entry swaps day/month and there is no from>to guard.
- MINOR: raw English enum labels ("planned"/"running"/"active") in the Vietnamese UI (app-wide; Students section localizes — inconsistent); repo-wide "Unsupported style property" console warnings; a11y form-field id/name warnings; browser BACK exits to prior section rather than closing the in-memory detail; "Quay lại danh sách" label on Student Detail when reached from a session.

### Fix applied during QC

- `class-workspace.tsx` `Workspace` navAction effect no longer consumes the nav action before `batches` load, so schedule "Mở lớp học" opens the class directly first-click (was landing on an empty list). Typecheck clean; verified by QC-B.

## Known follow-ups (non-blocking)

- MEDIUM: `SessionRoster` and `AttendanceRoster` both fetch `enrollment.listByBatch` (2 constant calls) in Session Detail — deferred per "reuse AttendanceRoster as-is"; dedupe later if the view is opened frequently.
- Teacher chip → staff record link (gated) not yet wired in Session Detail (teacher name not resolved client-side); pairs with plan 260629-2054.
- Student Detail enrollment row → Class Detail deep link deferred.

## Dependencies

- P2 and P3 depend on P1's Session Detail shell.
- P2 teacher→staff link depends on plan `260629-2054` staff record page existing (already in progress); if not ready, render teacher as non-link text.
- No dependency on ADR 0015 / Graph.

## Success Criteria

- From `/#schedule`, a lesson opens a Session Detail showing date/time/status/room/teacher/class + enrolled students + attendance + activity log.
- Student row in Session Detail opens Student Detail; class card opens Class Detail.
- Teacher chip opens staff record only when viewer is permitted; otherwise plain text.
- No new DB schema; no salary/user sensitive data fetched by unprivileged roles.
- Open `audit.timeline` / `NOTE_TARGETS` byte-for-byte unchanged.
- Admin typecheck clean; existing schedule/class/student/audit tests pass; new behavior covered.

## Out of Scope

- Staff/org record page + secure staff activity log (owned by plan 260629-2054).
- Query-param shareable deep links (later).
- Module sidebar consolidation (Academic Operations grouping) — design noted in brainstorm, deferred.
- Microsoft Graph G-phases (ADR 0015).
- Any database schema change.

## Stop Conditions

- Pause if Session Detail would require returning data a role cannot already read.
- Pause if any step proposes widening Chatter `NOTE_TARGETS` to `user`/`facility`.
- Pause if a per-session roster needs a new endpoint that duplicates `enrollment.listByBatch` — prefer reuse.

## Open Decisions (confirm before P1)

1. Session Detail placement: a new `ScheduleDetailPanel` rendered within the `schedule` section, OR a selected-session sub-view inside the existing Class Workspace? (Recommend: new panel in `schedule` section, reusing child components.)
2. Data path: assemble client-side from existing queries (recommend for MVP) OR add one `schedule.sessionDetail` server query (only if needed for perf/permission)?
3. Should P1 land read-only first and defer attendance editing to the existing attendance flow, or embed the editable `AttendanceRoster` directly in Session Detail?
