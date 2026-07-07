# Phase 7: Deploy Smoke and Docs

## Goal

Validate deployment and update docs after implementation.

## Requirements

- `teacher.cmcvn.edu.vn` serves Teacher Lite.
- `erp.cmcvn.edu.vn` and `hoc.cmcvn.edu.vn` unaffected.
- Smoke covers login, root render, API health, CORS/cookies as needed.
- Update docs that changed product behavior.
- Record Harness trace and story proof.

## Commands

```text
pnpm --filter @cmc/api typecheck
pnpm --filter @cmc/admin typecheck
pnpm --filter @cmc/lms typecheck
pnpm --filter @cmc/api lint
pnpm --filter @cmc/api test -- teacher-lite
pnpm --filter @cmc/e2e exec playwright test teacher-lite
```

## Local Smoke Proof

- Dev servers started:
  - API: `http://localhost:4000`
  - Teacher/admin: `http://localhost:5173/?surface=teacher`
  - LMS: `http://localhost:5175`
- API health: `GET /health` returned `{"ok":true,"commit":"unknown","builtAt":"unknown"}`.
- Playwright smoke:
  - Teacher/admin local URL title: `CMC Teacher Lite Portal`.
  - Teacher/admin body includes `CMC Teacher Lite`.
  - LMS local URL title: `Học tập CMC EDU`.
  - LMS body is non-blank.
- Screenshot: `.playwright-mcp/teacher-lite-login-smoke.png`.

## Validation

- `harness-cli story verify TEACHER-LITE-DIRECT-LMS-MVP`: passed.
- `pnpm --filter @cmc/admin build`: passed with Vite chunk-size warning.
- `pnpm --filter @cmc/lms build`: passed with Vite chunk-size warning.

## Remaining Before Production

- Run DB-backed integration tests with Postgres available.
- Run domain E2E after a seeded DB is available.
- Deploy smoke against real `teacher.cmcvn.edu.vn`, `erp.cmcvn.edu.vn`, and `hoc.cmcvn.edu.vn`.
