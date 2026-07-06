# Brainstorm: Session-Level Exercises

Date: 2026-07-06

## Problem

Teacher workflow needs homework/test upload, student access, and grading at the
lesson/session level. Current code attaches `Exercise` to `CurriculumUnit`, so a
unit with 4 sessions can only hold one homework row per type.

## What Code Shows

- `CurriculumUnit.sessions` already says one unit expands into N real sessions.
- `ClassSession` is the operational lesson record with date/time/teacher,
  attendance, and evidence.
- `SessionEvidence` already uses `classSessionId`; photos/comments are correctly
  per session.
- `Exercise` uses `curriculumUnitId` and `@@unique([curriculumUnitId, type])`.
- LMS open logic uses ended sessions, but opens the whole unit, so every exercise
  in that unit opens together.

## Correct Framing

Keep the curriculum hierarchy:

```text
Course -> CurriculumUnit -> CurriculumLesson -> ClassSession
```

Then attach exercises to `CurriculumLesson`.

`CurriculumUnit` remains the chapter/topic. `CurriculumLesson` is the 1..N
concrete lesson slot inside the unit. `ClassSession` is the dated class instance
of that lesson.

## Options

### Option A: Exercise directly on ClassSession

Fast and literal. One session has its own exercise rows.

Rejected as primary direction because every class would duplicate the same PDF
uploads. Useful only for future class-specific override.

### Option B: Exercise on CurriculumLesson template

Recommended. One global exercise per lesson slot/type, reusable across classes.
ClassSession maps to that lesson and opens it when the session ends.

### Option C: Keep unit-level exercise with added sequence field

Too ambiguous. It avoids a new table but creates a hidden lesson concept anyway.
Harder to reason about and test.

## Recommendation

Implement Option B.

Acceptance:

- UCREA-L1 has 12 units, 48 curriculum lessons.
- Director upload UI shows per-lesson rows, not just per-unit rows.
- One unit with 4 sessions can have 4 homework files.
- Student sees only exercises for ended class sessions.
- Teacher grading list is grouped by class/session/lesson.

## Risks

- Schema migration touches existing submitted work. Must preserve old rows by
  backfilling unit-level exercise to first lesson in the unit.
- API response fields currently named `curriculumUnitId` need compatibility or
  coordinated UI/test updates.
- Decision `0022` must be superseded to avoid future agents restoring unit-level
  behavior.
