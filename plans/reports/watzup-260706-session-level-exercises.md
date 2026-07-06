# Watzup: Session-Level Exercises

## Current State

- Branch: `develop`.
- Worktree: dirty, with this story plus earlier teacher/devteacher changes still uncommitted.
- Story: `SESSION-LEVEL-EXERCISES` implemented, verified, and deployed to dev + prod.

## Recent Work

- Added `CurriculumLesson` as the session-slot layer under `CurriculumUnit`.
- Moved exercise upload/opening/grading flows to lesson context while keeping unit as grouping.
- Rebuilt dev and prod API/admin/LMS containers from marker `2c5ee68-session-level-exercises-20260706`.

## Evidence

- Local verifier PASS: db/api/admin/lms typecheck; 12 integration files; 55 tests.
- Dev DB: `curriculum_lesson=240`; dev health green for `deverp`, `devteacher`, `devlms`.
- Prod DB: `curriculum_lesson=240`; prod health green for `erp`, `teacher`, `hoc`.
- Edge smoke: root 200; teacher CORS 204; prod/devteacher SSO 302 with correct callback.

## Next Steps

1. Recreate `/root/cmcnew-devsrc` worktree before the next Jenkins/manual develop deploy.
2. Commit this story separately from earlier teacher bridge changes, or split into focused PRs if preserving review clarity.
3. Add a browser-authenticated check for director per-lesson upload UI when an operator can complete Microsoft/MFA login.
4. Consider an E2E spec for 12-unit/48-lesson upload visibility once stable test credentials are available.

## Warnings

- Full API integration on the long-lived local DB is noisy because fixture IDs drifted; use the focused verifier for this story.
- No interactive SSO login was performed; only SSO start/callback URI smoke was verified.
