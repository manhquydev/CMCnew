---
title: "Brainstorm: Connected ERP Schedule Detail + Entity Workspace"
date: 2026-06-29
lane: high-risk
status: completed
scope: report-only-no-implementation
intake: 27
requested_focus: schedule-detail-first
out_of_scope:
  - code changes
  - database schema changes
  - Microsoft Graph provisioning
  - visual redesign
---

# Brainstorm: Connected ERP Schedule Detail + Entity Workspace

## Summary

Current ERP already has connected data, but the UI still behaves too much like separated rooms: `/#schedule`, `/#classes`, `/#students`, `/#org`, `/#hr` each knows its own table first. The right product direction is not a giant merged screen. It is **Entity Workspace**: every important record has a detail surface, and every module can deep-link into the right record with the right tab open.

Recommended first slice: **Schedule Detail as the model**.

From `/#schedule`, staff should click a lesson/session and land on a rich session detail workspace:

```text
Schedule row
  -> Session Detail
      -> Class Detail
      -> Student Detail
      -> Staff Profile / Teacher
      -> Attendance
      -> Notes + activity log
```

This gives immediate value because schedule is where teachers/managers start their day, and it proves the navigation pattern before expanding to the full ERP.

## Problem-First Inversion

### 1. Solution-Jumping Diagnosis

The proposed solution mentions linked detail pages, `/#schedule`, student/class drill-downs, log UI, and module merging. The hidden problem is not “missing links” only. The deeper pain is: **operators cannot follow the real business story from one ERP object to the next without manually switching modules and re-searching.**

### 2. Underlying Problem

Staff need to move from the question they have now — “what happens in this lesson?” — to related records — class, students, teacher, attendance, payments/history — without guessing which module owns the next step.

### 3. Assumption Challenges

| Assumption | Risk if wrong | Validation test |
|---|---|---|
| `/#schedule` is the best first workflow | We optimize the wrong daily entry point | Interview teacher/manager: where do they start their day? |
| Detail pages are enough | Users may need cross-record tasks, not only read views | Prototype one session detail and observe clicks/tasks |
| Module merging improves UX | Over-merged screens can leak permissions or overwhelm staff | Gate tabs by permission and test each role |
| Chatter/log can be reused everywhere | Staff/user logs can leak role/facility history | Keep existing audit security boundary; build safe read path where needed |

### 4. Problem Statement

- Users: teachers, managers, admin staff, HR, finance, CSKH.
- Struggle: they see lists but cannot naturally follow relationships.
- Cause: modules are route-centered, not record-centered.
- Consequence: more search, more context switching, higher error risk, worse training experience.
- Success: from any important record, user sees related records and allowed actions in one place.

### 5. Three Alternative Framings

| Frame | Meaning | Matching solution |
|---|---|---|
| Navigation problem | Need links between existing screens | Add deep links and row actions |
| Record-context problem | Need one detail surface per entity | Entity Workspace pattern |
| Product-surface problem | Too many nav modules | Merge nav groups into task-oriented workspaces |

Verdict: use all three, but sequence them. Start with Entity Workspace for schedule/session, then reduce nav/module clutter after the pattern is proven.

### 6. Evidence Status

Evidence is **medium**: user pain is explicit, code confirms existing partial deep-link patterns, but no user clickstream/interview data yet.

### 7. Validation Plan

- Observe a teacher path: open today schedule -> mark attendance -> review student -> add note.
- Observe manager path: open facility schedule -> inspect class -> inspect teacher load -> handle conflict.
- Build no code in this brainstorm; next plan should define prototype acceptance.

### 8. Draft Stakeholder Message

“We should not solve this by adding scattered links only. The real issue is record context. Let’s use schedule as the first proof: a lesson detail page that connects class, students, teacher, attendance, and activity log. If it works, we apply the same workspace pattern across ERP.”

## Evidence From Current Code

### Existing Connected Navigation

| Evidence | Meaning |
|---|---|
| `apps/admin/src/schedule-panel.tsx:31-40` | `SchedulePanel` accepts `goToClass`, so schedule already knows how to jump to class workspace. |
| `apps/admin/src/schedule-panel.tsx:159-163` | Clicking a schedule row opens `goToClass(batch.id, 'sessions')`. This is a seed of deep-link behavior. |
| `apps/admin/src/App.tsx:714-719` | `goToClass` switches to `classes`, sets `NavAction`, and updates hash to `#classes`. |
| `apps/admin/src/class-workspace.tsx:55-65` | `NavAction` is an existing internal navigation object. Keep and evolve this pattern. |
| `apps/admin/src/class-workspace.tsx:853-863` | Workspace applies `NavAction` to preselect batch and tab. |
| `apps/admin/src/students-panel.tsx:75-81` | Student list already opens `StudentDetailPanel`. |
| `apps/admin/src/students-panel.tsx:201-210` | DataTable row click opens student detail. |
| `apps/admin/src/App.tsx:620-649` | Org list opens `StaffProfilePanel`; org/hr unification has started. |

### Existing Detail Surfaces

| Surface | Current state | Good pattern | Gap |
|---|---|---|---|
| Student Detail | `apps/admin/src/student-detail.tsx:446-551` | Multi-tab detail + Chatter history | Enrollment rows do not deep-link to class yet. |
| Class Detail | `apps/admin/src/class-workspace.tsx:615-731` | Tabs: schedule, sessions, enroll, attendance, meetings, log | It is embedded in class workspace, not addressable as its own route/hash detail. |
| Staff Profile | `apps/admin/src/staff-profile.tsx:233-286` | Multi-tab profile, salary gated | Activity log still placeholder. |
| Session Detail | Missing | Would connect schedule, class, students, attendance, room, teacher, log | Highest-value first gap. |
| Facility Detail | Partial | Facility edit exists in UI from recent work | Needs detail/log strategy later. |

### Existing Audit/Log Constraints

| Evidence | Meaning |
|---|---|
| `apps/api/src/routers/audit.ts:12-24` | Chatter whitelist includes `receipt`, `opportunity`, `class_batch`, `student`, `after_sale_case`. It excludes `user` and `facility`. |
| `apps/api/src/routers/audit.ts:32-39` | Comment explains user/facility timeline leak risk. This is a security boundary. |
| `packages/ui/src/chatter.tsx:34-73` | Chatter is a reusable UI for timeline + manual notes. Good for allowed record types. |
| `packages/audit/src/index.ts:93-111` | `getTimeline` filters by entity type/id, not by viewer permission by itself. Router must enforce visibility. |
| `apps/api/src/routers/schedule.ts:59-66` | Schedule slot changes log to `class_batch`. |
| `apps/api/src/routers/schedule.ts:222-229` | Generated sessions log to `class_batch`. |
| `apps/api/src/routers/student.ts:127-134`, `177-184`, `222-231` | Student create/LMS reset/update log to `student`, so Student Detail history is meaningful. |

## Design Recommendation

### Core Pattern: Entity Workspace

Entity Workspace means each important business object gets a detail screen with:

1. Header: identity, status, main metadata.
2. Smart links: related record counts and direct jumps.
3. Tabs: allowed context/actions.
4. Activity log: audit timeline + notes where safe.
5. Role-gated actions: buttons shown only when user can act.

Think of it as a dossier. A list is the filing cabinet. A workspace is the folder opened on the desk.

### First Implementation Target: Session Detail

Session Detail should be the first proof because `/#schedule` already contains the daily operational path.

Proposed Session Detail content:

| Area | Content | Source today | Notes |
|---|---|---|---|
| Header | Date, time, status, room, teacher | `ClassSession` in `schema.prisma:286-307`; `schedule.mySessions` partially returns this | Add only API shape later, no schema needed. |
| Class card | Batch code/name/course/status | `ClassSession.batch`, `ClassBatch` | Link to Class Detail tab. |
| Student roster | Active enrollments for class | `Enrollment` model and `enrollment.listByBatch` | Each student row links to Student Detail. |
| Attendance | Current session attendance roster | `AttendanceRoster` already exists | Reuse in detail context. |
| Teacher | Assigned teacher | `ClassSession.teacherId`, `user.listTeachers` for names | Link to Staff Profile when permission allows. |
| Log | Session-specific timeline if introduced; fallback to class log | Existing Chatter is on `class_batch` | For MVP, class log is acceptable; session-level log can be later if API supports it. |

Important: no database schema change in this brainstorm. A later implementation can derive Session Detail from existing `ClassSession`, `Enrollment`, `Student`, and `Attendance` relationships.

## Navigation Blueprint

### Near-Term Blueprint

```text
/#schedule
  row click: session date/time
  -> Session Detail
      class code button -> /#classes with selected batch + tab=sessions
      student row -> Student Detail
      teacher chip -> Staff Profile if viewer can access org/staff
      attendance block -> AttendanceRoster for this session
      log block -> class/session timeline
```

### Existing Hash Behavior To Preserve

`App.tsx` already uses hash sections such as `#schedule`, `#classes`, `#students`, `#org`. Keep this style for now. It is simple and matches current app architecture.

Recommended future hash/deep-link style:

| Target | Example | Why |
|---|---|---|
| Section only | `/#schedule` | Current behavior. |
| Class detail | `/#classes?batch=<id>&tab=sessions` or internal `NavAction` equivalent | Stable link from schedule/student. |
| Student detail | `/#students?student=<id>` or shared detail state | Needed from class roster and session roster. |
| Staff detail | `/#org?user=<id>` | Needed from teacher/session/staff links. |
| Session detail | `/#schedule?session=<id>` | Needed for direct share/bookmark later. |

Current app does not parse query params; it uses hash section + in-memory state. For MVP, evolving `NavAction` is lower effort. For durable shareable links, query parsing becomes useful later.

## Module Merge / Consolidation List

### Recommended Merges

| Current modules | Recommended workspace | Why | Risk control |
|---|---|---|---|
| `schedule` + class sessions + attendance | Academic Operations | These are one daily workflow: lesson -> class -> roster -> attendance. | Keep permission gates from `NAV_GATES`; do not expose attendance action to roles without `attendance.mark`. |
| `students` + guardians + enrollments + receipts + grades | Student 360 | Student Detail already has these tabs; make it the canonical student surface. | Keep financial tabs read-only unless finance permission says otherwise. |
| `org` + `hr` + selected staff payroll/profile | Staff Workspace | Data already joins on `AppUser.id`; U1 started this. | Salary tab lazy-load + permission-gated; no combined payload. |
| `classes` + meetings + class log | Class Workspace | Already implemented as tabs in `ClassDetail`. | Make it linkable; do not over-merge course catalog or room management. |

### Do Not Merge Blindly

| Do not merge | Reason |
|---|---|
| Payroll salary into general org list | Salary is sensitive; tab must stay gated. |
| User/facility log into open Chatter | Existing code warns this can leak role/facility history. |
| Course catalog into class operations | Course is product setup; class is operational instance. Link them, but keep separate. |
| CRM/finance/student as one mega page | They share records, but each has separate owner and permission model. Use links/tabs, not one giant form. |

## Audit / Log Design

### Principle

Audit log is not decoration. It is a product safety record. It answers: who changed what, when, and why.

### Use Existing Chatter Where Safe

Safe current Chatter entities:

- `student`
- `class_batch`
- `opportunity`
- `receipt`
- `after_sale_case`

These already pass through `audit.timeline` visibility pre-checks.

### Do Not Reuse Chatter For Staff/User/Facility

For staff/user/facility activity, use a separate secure timeline endpoint later. Reason: `record_event.facility_id` can be null for global/user events, and current code intentionally blocks open user/facility timelines.

### Session Detail Log Options

| Option | What | Pros | Cons | Recommendation |
|---|---|---|---|---|
| L1 Class-level log only | Show `class_batch` Chatter in session detail | No new audit path | Session-specific events are mixed with class events | Good MVP fallback. |
| L2 Read-only session timeline | Add safe timeline for `class_session` events only | More precise | Needs endpoint + event writes | Good phase 2. |
| L3 Notes on session | Staff can add notes to session | Useful in operations | Needs NOTE_TARGETS extension and visibility gate | Later, after session read timeline is safe. |

## Implementation Phases For Later Plan

No code is changed by this brainstorm. If approved later, plan should split like this:

### Phase 1 — Schedule Detail Read Workspace

Goal: from `/#schedule`, click a lesson/session and open Session Detail.

Acceptance:

- Schedule row opens a session-focused detail view, not only class sessions tab.
- Detail shows date/time/status/room/teacher/class.
- Detail shows enrolled students for that class.
- Student row can open Student Detail.
- Class code can open Class Detail.
- No schema change.
- No salary/user sensitive data involved.

### Phase 2 — Cross-Entity Deep Links

Goal: make existing detail pages link to each other.

Acceptance:

- Student enrollment row opens Class Detail.
- Class enrollment row opens Student Detail.
- Teacher chip opens Staff Profile only when permission allows.
- Back behavior remains clear.
- Hash/internal navigation stays compatible with current `SectionKey` system.

### Phase 3 — Audit/Log Surface Hardening

Goal: make logs visible where safe, without widening existing Chatter risk.

Acceptance:

- Session Detail shows class-level log or safe session timeline.
- Student Detail keeps existing Chatter.
- Staff/Profile log remains separate secure path, not open Chatter.
- Tests should prove unauthorized staff cannot read user/facility role history.

### Phase 4 — Module Consolidation UX

Goal: reduce sidebar clutter only after detail-link pattern works.

Acceptance:

- `schedule`, `classes`, `attendance`, `meetings` can be presented as one Academic Operations group/workspace.
- `org` + `hr` trend toward Staff Workspace, preserving permission-gated tabs.
- Old modules either remain as entry points or redirect to workspace tabs.
- No role loses required access.

## Success Metrics

| Metric | Target |
|---|---|
| Teacher daily path | Schedule -> session -> attendance/student in <= 3 clicks. |
| Manager inspection path | Facility schedule -> session -> class/student/teacher in <= 3 clicks. |
| Search reduction | Staff should not need to copy class/student codes between modules. |
| Permission safety | Hidden tabs must not fetch restricted data. |
| Audit safety | No user/facility timeline through open Chatter. |

## Recommendation

Choose **Schedule Detail first + Entity Workspace as north star**.

Reason:

- It solves the user's concrete example.
- It builds on current `goToClass` / `NavAction` pattern instead of replacing the app shell.
- It avoids database changes.
- It avoids Microsoft Graph scope.
- It creates a reusable pattern for students, classes, staff, and later CRM/finance records.

## Unresolved Questions For Next Planning Session

1. Should Session Detail be a new `ScheduleDetailPanel` inside `/#schedule`, or should it live inside Class Workspace as a selected session tab first?
2. Should direct shareable links use query params now, or should MVP stay with in-memory `NavAction` and add shareable links later?
3. Which roles may open teacher Staff Profile from a session: all staff who can see the session, or only org/hr/director roles?
4. Should session notes be in MVP, or should MVP show read-only log only?
