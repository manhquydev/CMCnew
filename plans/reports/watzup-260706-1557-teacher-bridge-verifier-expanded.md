# Teacher Bridge Verifier Expanded Handoff

## Current State

- Branch: `develop` at `2c5ee68`.
- Worktree: dirty; broad teacher/devteacher/runtime/docs changes already in progress plus latest
  verifier expansion.
- Live prod smoke from verifier: `https://teacher.cmcvn.edu.vn/` renders `CMC Teacher Portal` and
  live SSO redirect pre-login has no Entra redirect mismatch.

## Recent Work

- Added direct staff-setup proof for the original requirement that ERP directors create teacher
  staff normally:
  - GĐĐT creates `giao_vien` in own facility.
  - Created teacher has role/facility and can call staff teaching API.
  - GĐKD cannot create `giao_vien`.
- Expanded the story verifier to include staff setup, class code/slots, exercise upload RBAC,
  intake/provisioning, teacher grading, parent/student LMS visibility, and live smoke.
- Updated validation evidence under `docs/stories/TEACHER-CMCVN-LMS-BRIDGE/validation.md`.

## Verification

- `pnpm --dir apps/api exec vitest run --config vitest.integration.config.ts test/teacher-bridge-staff-setup.int.test.ts --reporter=verbose`
  passed: 1 file, 2 tests.
- `pnpm --dir apps/api exec vitest run --config vitest.integration.config.ts test/lms-full-lifecycle-e2e.int.test.ts test/student-provisioning-approve.int.test.ts --reporter=verbose`
  passed: 2 files, 8 tests.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-teacher-cmcvn-lms-bridge.ps1`
  passed after final update in 80.4s.
- `.\scripts\bin\harness-cli.exe story verify TEACHER-CMCVN-LMS-BRIDGE` passed.
- Harness trace #155 recorded the verifier coverage expansion.
- Harness trace #156 recorded the final staff-setup proof, verifier rerun, journal, and handoff.

## Next Steps

1. Run `git status --short` and review the dirty worktree grouping before any commit.
2. Commit/stash teacher-bridge changes before context switch; avoid mixing unrelated older dirty
   work into a broad commit accidentally.
3. Optional manual proof remains: real Microsoft login/MFA callback using a real staff account.
   Non-interactive SSO redirect/cert smoke is already green.

## Warnings

- The `ck:watzup` default scanner path `.Codex/skills/watzup/scripts/watzup-scan.cjs` is absent in
  this repo; the working scanner path is `C:\Users\manhquy\.agents\skills\watzup\scripts\watzup-scan.cjs`.
- Scanner reported remote refs from local cache only; no `--fetch` was requested.
