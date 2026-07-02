# Exercise Global Curriculum Asset Without RLS

Date: 2026-07-02

## Status

Accepted

## Context

Exercises were originally facility/class-scoped rows. The real operating model is different:
an exercise is academic content attached to a curriculum unit, uploaded once by directors, then
auto-opened per class after that class finishes the session for the unit.

The old class/facility shape duplicated content, relied on Exercise RLS for LMS visibility, and
allowed teacher write ownership over content that affects the whole course.

## Decision

`Exercise` is a global curriculum-unit asset, mirroring the no-RLS precedent for `course` and
`curriculum_unit`.

- `Exercise.curriculumUnitId` is required.
- `Exercise` no longer stores `facilityId`, `classBatchId`, or `dueAt`.
- The database disables RLS on `exercise`.
- Writes are app-layer gated through director-only exercise permissions.
- Student/guardian visibility is query-time, derived from owned students, active enrollments,
  non-cancelled class sessions for the unit, and session end time in Asia/Saigon.
- Submission rows remain facility/student-scoped and retain RLS.

The `/files/exercise/:ref` serving semantics loosen from enrolled-class-only to any authenticated
principal. This is accepted because exercise files are worksheet content, not PII; student data
remains in Submission and Grade.

## Alternatives Considered

1. Keep per-class Exercise rows. Rejected: creates duplicate uploads and manual publish workflow.
2. Template plus per-class instances. Rejected: more moving parts than the current business needs.
3. Global Exercise with a read-all RLS policy. Rejected: adds no tenant protection for academic content.

## Consequences

Positive:

- One canonical exercise per curriculum unit and type.
- No manual per-class publish step.
- LMS visibility follows actual class progress.

Tradeoffs:

- No database-level backstop on Exercise writes.
- Every Exercise write path and every Submission write path must enforce app-layer visibility and authorization.
- Tests must cover cross-student visibility and before-open submission denial.

## Follow-Up

- P2 implements the director-only `exercise.upsert` path and the opened-unit guard.
- P7 verifies Exercise has no RLS policy and Submission keeps isolation.
