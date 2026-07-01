# LMS Session Evidence Design

## Current Vertical Slice

- `ClassBatch` remains the class aggregate.
- `ScheduleSlot` remains the recurring timetable source.
- `ClassSession` remains the concrete lesson occurrence generated from slots.
- The first class schedule slot can be captured during class creation through `classBatch.create.initialSlot`.
- Staff session detail is the UI center for the teaching workflow, not `/grading`.

Rules already enforced:

- `initialSlot.startTime` must be before `initialSlot.endTime`.
- The first slot is created in the same DB transaction as the class.
- Facility-scoping of room/teacher refs is enforced at the API layer: `assertSlotRefsInFacility` (apps/api/src/lib/slot-refs-guard.ts) rejects cross-facility/inactive/fabricated room+teacher refs in `classBatch.create.initialSlot` and `schedule.addSlot`, inside the same transaction (not just the UI).
- The DB FK on schedule_slot.room_id/teacher_id is still deferred (no @relation yet, unlike class_session); the app guard is the current enforcement layer.
- Attendance continues to use the existing real attendance surface.
- Post-class LMS evidence now uses persisted drafts, photo refs, structured comments, publish status, and LMS read APIs.

## Domain Model

Persisted evidence:

- `SessionEvidence`: one draft/published learning diary per `ClassSession`.
- `SessionEvidencePhoto`: image refs attached to a session diary.
- `SessionStudentComment`: teacher comment per `(sessionEvidence, student)`.

Rules:

- Staff reads/writes by facility.
- LMS reads only published evidence.
- LMS comment selection is by owned student; no classmate comments leak.
- Photo read endpoint must authorize before existence check.
- Teacher comments use predefined/template form options; no manager approval gate is required.

## Application Flow

- Class setup: create class and optional first weekly lesson slot.
- Timetable: staff opens a generated `ClassSession`.
- Session detail: system derives phase from schedule time.
- Attendance: opens from 15 minutes before start through the session.
- Post-class workflow: opens after session end.
- Staff query: list class sessions with evidence summary.
- Staff command: upsert draft evidence with summary, photos, and per-student comments.
- Staff command: publish evidence.
- LMS query: list/detail published evidence for owned `studentId`.

## Interface Contract

Implemented tRPC:

- `classBatch.create({ facilityId, courseId, name, startDate?, endDate?, capacity?, initialSlot? })`

Implemented file routes:

- `POST /upload/session-photo` — staff session only; stores local content-addressed JPEG/PNG/WebP refs via `SESSION_PHOTO_STORE_DIR` or `.data/session-photos`.
- `GET /files/session-photo/:ref` — authorizes staff/LMS visibility before reading the local file.

Implemented `initialSlot` shape:

- `dayOfWeek: 0..6`
- `startTime: HH:mm`
- `endTime: HH:mm`
- `roomId?: uuid`
- `teacherId?: uuid`

Implemented tRPC:

- `sessionEvidence.listByClass({ classBatchId })`
- `sessionEvidence.detailForStaff({ classSessionId })`
- `sessionEvidence.upsertDraft({ classSessionId, summary, internalNote, photos, comments })`
- `sessionEvidence.publish({ classSessionId })`
- `sessionEvidence.listForPrincipal({ studentId })`
- `sessionEvidence.detailForPrincipal({ sessionEvidenceId, studentId })`

## Data Model

Indexes:

- `session_evidence(class_session_id)` unique.
- `session_evidence(facility_id, published_at)`.
- `session_student_comment(session_evidence_id, student_id)` unique.
- photo refs indexed by evidence.

Retention:

- Soft archive evidence when session/class archived.
- Keep photos private; no public buckets.

## UI / Platform Impact

- Admin class workspace: create-class modal includes first weekly lesson slot.
- Admin schedule detail: Session 360 workflow panel keeps phase cards and renders the real evidence editor for photos, structured comments, draft save, and LMS publish.
- Admin `/grading`: remains focused on exercise grading in the current slice.
- LMS: `Buổi học` tab added for student and parent shells; parent view is scoped to selected child.

## Observability

- Audit log on class creation and first schedule slot creation.
- Audit log on evidence draft update and publish.
- Trace high-risk proof through Harness story.

## Alternatives Considered

1. Attach photos/comments to `Exercise`: rejected because session evidence is not homework and should exist even without an exercise.
2. Store photo URLs directly from browser: rejected because PH visibility must be server-authorized.
3. Put all workflow under `/grading`: rejected for this slice because timetable/session is the natural center for attendance, homework release, comments, and session photos.
