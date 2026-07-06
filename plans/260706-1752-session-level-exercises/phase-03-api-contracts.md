# Phase 03: API Contracts

## Requirements

- Exercise upsert/list accepts lesson ids.
- LMS opens by ended class sessions' lesson ids.
- Submission guard validates lesson-level access.
- Notifications dedup by exercise/student remains.

## Files

- Modify: `apps/api/src/routers/exercise.ts`
- Modify: `apps/api/src/lib/exercise-open.ts`
- Modify: `apps/api/src/services/exercise-open-notify.ts`
- Modify: `apps/api/src/routers/submission.ts`
- Modify: `apps/api/src/routers/grade.ts`

## Steps

1. Replace opened-unit helpers with opened-lesson helpers.
2. Keep flattened response unit metadata.
3. Add class/session context where grading needs it.
4. Update integration tests.

## Success Criteria

- Two exercises in same unit but different lessons are independent.
- Student cannot submit for unopened lesson.
