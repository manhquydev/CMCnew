# Phase 01: Decision And Schema Shape

## Context Links

- `docs/decisions/0038-session-level-exercises.md`
- `docs/decisions/0022-exercise-global-curriculum-asset-no-rls.md`
- `docs/stories/SESSION-LEVEL-EXERCISES/design.md`

## Requirements

- Supersede unit-level exercise ownership.
- Preserve `CurriculumUnit` as curriculum grouping.
- Add `CurriculumLesson` as lesson-template parent for exercises.

## Files

- Modify: `packages/db/prisma/schema.prisma`
- Create: Prisma migration under `packages/db/prisma/migrations/`
- Modify: `packages/db/src/seed-curriculum.ts`

## Steps

1. Add `CurriculumLesson`.
2. Add `ClassSession.curriculumLessonId`.
3. Move `Exercise` relation to `curriculumLessonId`.
4. Keep compatibility fields in API, not duplicated schema.

## Success Criteria

- Prisma schema validates.
- Migration is additive/backfilled, no data loss.
