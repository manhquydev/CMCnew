# Watzup: Teacher Lite Direct LMS MVP

Date: 2026-07-07

## Current State

- Branch: `develop`.
- Story: `TEACHER-LITE-DIRECT-LMS-MVP`.
- Intake: `#76`, high-risk.
- Decision: `0039-teacher-lite-direct-lms-mvp`, accepted.
- Plan: `plans/260707-teacher-lite-direct-lms-mvp/plan.md`.

## Recent Work

- Brainstorm report created.
- Decision index updated.
- High-risk story docs created.
- Red-team/scenario report created.
- Plan normalized with gates and phase workflow.
- Phase 1 complete: decisions read, GitNexus impact checked for shared permission gates, risk scoped.
- Phase 2 API implemented: `teacherLite.createFamilyStudentAndEnroll`, direct student-code counter, transaction facade, permission parity, integration spec.
- Phase 3 shell implemented: Teacher Lite copy, direct LMS setup panel, `teacherLite` nav gate, Jenkins smoke marker updates.

## Proof

- Harness story verify: pass.
- Harness trace: `#164`, detailed tier.
- `pnpm --filter @cmc/db generate`: pass.
- `pnpm --filter @cmc/api typecheck`: pass.
- `pnpm --filter @cmc/db typecheck`: pass.
- `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts`: pass.
- `pnpm --filter @cmc/api lint`: pass with unrelated existing warnings.
- `teacher-lite-direct-provisioning.int.test.ts`: compiles/runs, DB assertions skipped because local Postgres not reachable.
- `pnpm --filter @cmc/admin typecheck`: pass.
- Admin nav tests for teacher/director surfaces: pass.
- `pnpm --filter @cmc/admin build`: pass with Vite chunk-size warning.

## Next Steps

- Bring dev Postgres up, run migrations/seed if needed, rerun `teacher-lite-direct-provisioning.int.test.ts` with no skip.
- Finish Phase 2 hardening: duplicate email, cross-facility, concurrent same-phone tests.
- Start live browser proof for Phase 3 after DB/app dev server is available.
- Continue Phase 4/5: director class/material workflows and teacher class-day workflow.

## Warnings

- Dirty worktree includes unrelated deploy files: `Jenkinsfile`, `docs/prod-deploy-security-runbook.md`, `scripts/prod-server-deploy.sh`, `scripts/ensure-blob-store-dirs.sh`.
- Do not deploy/prod-test until local integration + E2E are green.
- GitNexus `detect_changes` did not include untracked new Teacher Lite files; rely on `git status`, typecheck, and targeted tests until index is refreshed.

## Unresolved Questions

- None.
