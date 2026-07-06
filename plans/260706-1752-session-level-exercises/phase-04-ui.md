# Phase 04: Teacher And LMS UI

## Requirements

- Director uploads by lesson row.
- Schedule detail shows exercise for the current session's lesson.
- LMS cards show correct lesson/session context.
- Grading screen can identify class/session/lesson.

## Files

- Modify: `apps/admin/src/course-exercise-manager.tsx`
- Modify: `apps/admin/src/schedule-detail.tsx`
- Modify: `apps/admin/src/grading.tsx`
- Modify: `apps/lms/src/student-view.tsx`
- Modify: `apps/lms/src/parent-view.tsx`

## Steps

1. Replace unit exercise table with grouped lesson table.
2. Change editor payload to `curriculumLessonId`.
3. Update schedule detail indicator to query by session/lesson.
4. Adjust LMS display labels.

## Success Criteria

- A 4-session unit shows 4 homework upload actions.
- Current session shows only its lesson exercise.
