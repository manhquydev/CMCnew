# Validation

## Proof Strategy

Prove the model with a vertical slice:

- Seed UCREA-L1 -> 12 units -> 48 lessons.
- Create/generate class sessions -> each session maps to one lesson.
- Upload at least 2 homework exercises in the same unit but different lessons.
- Before session end: student cannot see/submit.
- After session end: student sees/submits only that lesson's exercise.
- Teacher grades by exercise/session context; parent sees published grade.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Curriculum lesson expansion count/order from unit sessions |
| Integration | exercise upsert/list/open guard/submission/grade by lesson |
| E2E | Director upload per lesson; student sees per-session work; teacher grades |
| Platform | devteacher + teacher smoke after deploy |
| Performance | Course exercise list avoids N+1 per lesson where practical |
| Logs/Audit | exercise create/update audit remains present |

## Fixtures

- Seeded course `UCREA-L1`.
- A class with at least 2 sessions inside the same unit.
- One active student/parent pair.
- One giam_doc_dao_tao and one giao_vien.

## Commands

```text
pnpm --filter @cmc/db generate
pnpm --filter @cmc/db migrate
pnpm --filter @cmc/api test:integration -- test/curriculum-lesson-exercise*.int.test.ts
pnpm --filter @cmc/admin typecheck
pnpm --filter @cmc/lms typecheck
pnpm --filter @cmc/e2e test -- tests/session-level-exercises.spec.ts
```

## Acceptance Evidence

Implemented and deployed on 2026-07-06.

| Gate | Evidence |
| --- | --- |
| Local verifier | `scripts/verify-session-level-exercises.ps1 -SkipMigrate`: db/api/admin/lms typecheck PASS; 12 focused integration files PASS; 55 tests PASS. |
| Harness verifier | `harness-cli story verify SESSION-LEVEL-EXERCISES`: migration deploy had no pending migrations; db/api/admin/lms typecheck PASS; 12 integration files PASS; 55 tests PASS. |
| Build | `pnpm --filter @cmc/admin build` PASS; `pnpm --filter @cmc/lms build` PASS. Both keep the existing Vite chunk-size warning only. |
| Data model | Prisma migration `20260706175200_session_level_exercises` adds `curriculum_lesson`, maps `ClassSession.curriculumLessonId`, and changes canonical exercise uniqueness to `(curriculumLessonId, type)`. |
| Dev deploy | `deverp`, `devteacher`, `devlms` health returned commit `2c5ee68-session-level-exercises-20260706`; dev DB `curriculum_lesson=240`; dev seed reported `courses=11`. |
| Prod deploy | Pre-migration DB backup: `/root/cmcnew/backups/session-level-preprod-20260706-121700.sql.gz`; prod migration applied; prod DB `curriculum_lesson=240`; `erp`, `teacher`, `hoc` health returned commit `2c5ee68-session-level-exercises-20260706`. |
| Edge smoke | Root pages returned 200 for `erp`, `teacher`, `hoc`, `devteacher`; teacher CORS preflight returned `204` with exact origin; prod/devteacher SSO start returned `302` to Microsoft with host-correct callback URI. |

Notes:

- Full local API integration on the long-lived developer DB was not a clean signal: unrelated tests depend on fixture facility id `2` while the local DB has drifted to another id, and one staff-password test required overriding local `STAFF_PASSWORD_LOGIN`. The focused verifier and live deploy smoke are the authoritative evidence for this story.
- After prod container recreation, nginx initially returned 502 until `nginx -s reload` re-resolved upstream container IPs. This matches the documented dev/prod runbook gotcha.
