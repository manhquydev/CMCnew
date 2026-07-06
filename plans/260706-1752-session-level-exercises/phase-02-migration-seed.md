# Phase 02: Migration, Seed, Backfill

## Requirements

- Create one `CurriculumLesson` row for each session count in each unit.
- Backfill existing class sessions in chronological order.
- Backfill existing exercises to first lesson in their old unit.

## Files

- Modify: `packages/db/src/seed-curriculum.ts`
- Modify/create: tests under `apps/api/test/`

## Steps

1. Expand seed to upsert lessons after units.
2. Update curriculum recompute service to assign lesson ids.
3. Write backfill SQL in migration.
4. Add integration proof for UCREA-L1 lesson count/order.

## Success Criteria

- `UCREA-L1` has 48 lessons.
- Existing tests that generate sessions still map units correctly.
