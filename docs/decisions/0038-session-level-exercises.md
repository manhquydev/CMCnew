# Session-Level Exercises

Date: 2026-07-06

## Status

Accepted

## Context

Decision `0022` made `Exercise` a global asset attached to one `CurriculumUnit`.
That fit a "one worksheet per unit" assumption.

The actual Teacher workflow is different. A course level can have 12 units but 48
real sessions. Directors need to upload separate homework/test assets for each
session. Teachers grade the exercise assigned to the session they taught.
Students/parents see work opened by the concrete class session, not by the whole
unit.

Current unit-level uniqueness (`Exercise.curriculumUnitId + type`) compresses 48
session-level assignments into 12 unit-level slots and makes multiple homework
files inside a multi-session unit impossible.

## Decision

Exercise assignment moves from curriculum-unit level to session-template/session
level.

- `CurriculumUnit` remains the global curriculum grouping and content frame.
- Add a per-course session template concept (`CurriculumLesson`) representing
  each concrete lesson slot inside the unit sequence.
- `ClassSession` maps to `CurriculumLesson` as well as `CurriculumUnit`.
- `Exercise` attaches to `CurriculumLesson` instead of directly to
  `CurriculumUnit`.
- Exercise visibility, submission guards, notifications, and grading derive from
  ended `ClassSession.curriculumLessonId`.
- Write access stays app-layer gated to the director roles already allowed to
  manage exercises.
- Submission and Grade remain facility/student scoped and RLS-protected.

This supersedes `0022` for exercise ownership. The no-RLS global academic-asset
principle remains, but its parent key changes from unit to lesson template.

## Alternatives Considered

1. Attach `Exercise` directly to `ClassSession`.
   - Pro: simplest to reason about for one class.
   - Con: duplicates uploads per class and loses reuse across classes following
     the same curriculum.
2. Keep unit-level exercises and add `seqInUnit` as metadata only.
   - Pro: smaller migration.
   - Con: still needs a uniqueness change and leaves class-session mapping
     ambiguous.
3. Add `CurriculumLesson` template and map sessions to it.
   - Accepted: preserves global curriculum reuse while allowing 48 exercises for
     48 sessions.

## Consequences

Positive:

- Directors can upload one file per lesson/session slot.
- Students only see work for lessons their class has actually finished.
- Teachers grade work in the context of the concrete session/class.
- Multiple classes can reuse the same lesson template exercise.

Tradeoffs:

- Requires schema migration and backfill from existing unit-level exercises.
- Requires API/UI contract changes across exercise, submission, LMS, grading, and
  schedule detail flows.
- Existing tests expecting one exercise per unit must be rewritten.

## Follow-Up

- Create `CurriculumLesson` records from `CurriculumUnit.sessions`.
- Backfill existing `Exercise` rows to the first lesson of their unit.
- Update `docs/DECISION_INDEX.md` to point exercise/schema ownership to this
  decision.
- Add integration and E2E coverage proving 48 per-session exercise slots for a
  12-unit / 48-session course.
