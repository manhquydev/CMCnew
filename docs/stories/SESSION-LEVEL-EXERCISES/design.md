# Design

## Domain Model

```text
Course
  -> CurriculumUnit
      -> CurriculumLesson
          -> ClassSession
              -> Attendance / SessionEvidence
          -> Exercise
              -> Submission
                  -> Grade
```

Rules:

- `CurriculumLesson` is global reference data, generated from each
  `CurriculumUnit.sessions`.
- `Exercise` belongs to one `CurriculumLesson` and one type.
- `ClassSession.curriculumLessonId` identifies the exact lesson slot taught.
- `curriculumUnitId` remains on `ClassSession` for grouping/read compatibility.

## Application Flow

Director upload:

1. Select course.
2. See rows grouped by unit, expanded into lesson slots.
3. Upload/publish exercise for each lesson/type.

Class generation:

1. Existing recompute maps sessions by curriculum unit coverage.
2. New mapping also assigns `curriculumLessonId` in chronological order.

Student access:

1. Resolve owned/enrolled students.
2. Find ended non-cancelled sessions mapped to curriculum lessons.
3. List published exercises for those lessons.

Teacher grading:

1. List submissions for exercises opened in the selected class/session context.
2. Preserve existing submission/grade publish behavior.

## Interface Contract

Exercise API changes:

- `listByCourse` or replacement returns lesson rows with exercises.
- `listByUnit` becomes deprecated or returns lesson-level grouped data.
- `upsert` input changes from `curriculumUnitId` to `curriculumLessonId`.
- LMS `listForPrincipal` includes lesson metadata and class/session open context.

Compatibility:

- Keep `unitCode`, `unitType`, `program`, `courseName` in flattened exercise
  responses.
- Add `curriculumLessonId`, `lessonSeqInUnit`, `lessonOrderGlobal`.

## Data Model

Add `CurriculumLesson`:

- `id uuid`
- `curriculumUnitId uuid`
- `courseId uuid`
- `lessonCode unique`
- `seqInUnit int`
- `orderGlobal int`
- `createdAt`

Modify:

- `ClassSession.curriculumLessonId nullable SetNull`.
- `Exercise.curriculumLessonId required`.
- Replace unique `(curriculumUnitId, type)` with `(curriculumLessonId, type)`.

Migration:

- Create lessons from existing units: one row per unit session.
- Backfill sessions by chronological order within class.
- Backfill existing exercises to the first lesson of their unit.
- Keep old columns only as needed during migration; final shape removes direct
  `Exercise.curriculumUnitId`.

## UI / Platform Impact

- `CourseExerciseManager`: table becomes unit groups with lesson rows.
- `ScheduleDetailPanel`: exercise indicator reads by session/lesson.
- `GradingPanel`: list context should expose class/session/lesson labels.
- LMS student/parent views keep exercise cards but show lesson/session context.

## Observability

- Audit exercise create/update remains `entityType=exercise`.
- Migration should be idempotent and logged by Prisma migration.
- Harness story proof records unit/integration/e2e/platform status.

## Alternatives Considered

1. Exercise on `ClassSession`: too much duplicate upload per class.
2. Add sequence to `Exercise` but keep unit parent: hidden lesson model, weaker
   integrity.
3. Lesson template model: selected.
