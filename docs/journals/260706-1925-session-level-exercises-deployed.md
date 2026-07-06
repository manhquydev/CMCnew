# Session-Level Exercises Deployed

Date: 2026-07-06

## Summary

Teacher/LMS homework moved from unit-level upload to lesson/session-slot upload. The old model allowed one homework per unit, which compressed a 12-unit / 48-session course into 12 upload slots. The new model adds `CurriculumLesson` under each `CurriculumUnit`; `ClassSession` maps to both unit and lesson; `Exercise` is canonically attached to `curriculumLessonId`.

## What Changed

- DB: migration `20260706175200_session_level_exercises` creates `curriculum_lesson`, backfills sessions/exercises, and changes exercise uniqueness to `(curriculumLessonId, type)`.
- Seed: `seed-curriculum` now creates 240 lesson slots for the current 60 curriculum units.
- API: exercise list/upsert/opening, notification, grade authorization, schedule session reads, and curriculum reads now carry lesson context.
- UI: director course exercise manager groups upload rows by unit but saves per lesson; schedule detail and LMS/parent views label work by lesson when available.
- Tests: added `session-level-exercises.int.test.ts` and updated curriculum/schedule/LMS/open-notify coverage.

## Verification

- Local verifier: `scripts/verify-session-level-exercises.ps1 -SkipMigrate` PASS: db/api/admin/lms typecheck, 12 integration files, 55 tests.
- Admin and LMS production builds PASS, with only existing Vite chunk-size warnings.
- Dev deploy: `deverp/devteacher/devlms` health returned commit `2c5ee68-session-level-exercises-20260706`; dev DB has `curriculum_lesson=240`; dev seed has `courses=11`.
- Prod deploy: pre-migration backup `/root/cmcnew/backups/session-level-preprod-20260706-121700.sql.gz`; migration applied; prod DB has `curriculum_lesson=240`; `erp/teacher/hoc` health returned commit `2c5ee68-session-level-exercises-20260706`.
- Edge smoke: root pages 200; teacher CORS exact-origin 204; prod/devteacher SSO start 302 with host-correct callback.

## Operational Notes

- `/root/cmcnew-devsrc` is a broken git worktree on the VPS, so manual dev deploy used `/root/cmcnew` source with the dev compose file. Fix or recreate that worktree before relying on Jenkins/manual develop checkout parity.
- Prod nginx needed `nginx -s reload` after app container recreation to clear stale upstream IPs.

## Unresolved Questions

- None for the shipped session-level exercise scope.
