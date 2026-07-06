# Exec Plan

## Goal

Move LMS exercises from unit-level assignment to lesson/session-level assignment
so a 12-unit / 48-session course can have 48 homework files and per-session
opening/grading.

## Scope

In scope:

- Data model and migration for `CurriculumLesson`.
- Seed generation for lesson slots.
- API changes for exercise upload/list/open/submission guard.
- Admin Teacher UI for per-lesson upload.
- LMS/teacher grading visibility updates.
- Focused integration and E2E tests.
- Dev/prod deploy and smoke after green tests.

Out of scope:

- Per-class custom override exercises.
- New online course delivery features.
- Full historical data cleanup beyond safe backfill.

## Risk Classification

Risk flags:

- Data model.
- Public contracts.
- Existing behavior.
- Multi-domain.
- Weak proof.

Hard gates:

- Schema migration.
- Behavior supersedes accepted decision `0022`.

## Work Phases

1. Planning and decision update.
2. Schema migration and seed/backfill.
3. API and open-guard rewrite.
4. Admin/LMS UI rewrite.
5. Focused tests and regression repair.
6. Deploy, smoke, docs/journal/watzup.

## Stop Conditions

Pause if:

- Existing production submissions cannot be safely backfilled.
- Tests imply grade/submission RLS must be weakened.
- Runtime data contradicts the lesson-template model.
