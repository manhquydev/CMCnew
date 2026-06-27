# 10 Harness, Ops, Tests

Status: DONE

## Scope Reviewed

- `README.md`, `CLAUDE.md`, `AGENTS.md`
- Harness docs: `docs/HARNESS.md`, `FEATURE_INTAKE.md`, `CK_WORKFLOW.md`, `TRACE_SPEC.md`, `TEST_MATRIX.md`
- `package.json`, workspace scripts, `turbo.json`, `eslint.config.js`
- `.github/workflows/ci.yml`
- Docker compose/nginx/Dockerfiles
- `apps/e2e/**`
- active plans/reports
- `git status`, `git remote`, `harness-cli query matrix`

## Findings

### Resolved In This Report: index referenced missing report files

Evidence at review time:

- `plans/reports/20260627-103314-10-agent-code-review/README.md` referenced `10-harness-ops-tests.md` and `summary.md` before they existed.

Status: resolved by this task after agent returned.

### High: App topology docs are stale after retiring `apps/teaching`

Evidence:

- `README.md:35`
- `docs/project-charter.md:15`
- current ops guide says one staff app + LMS: `docs/operate-and-test-guide.md:10`
- prod compose only has admin + lms frontends: `docker/docker-compose.prod.yml:138`

Impact: operators and reviewers get conflicting source-of-truth.

### High: Test matrix marks implemented where proof is planned/missing

Evidence:

- implemented definition: `docs/TEST_MATRIX.md:9`
- UI rows: `docs/TEST_MATRIX.md:45`
- roadmap E2E gate: `docs/roadmap.md:68`

Impact: governance overstates proof and still references retired app paths.

### High: CI does not run lint or Playwright E2E

Evidence:

- root scripts: `package.json:12`
- CI steps: `.github/workflows/ci.yml:63`
- roadmap browser proof gate: `docs/roadmap.md:71`

Impact: lint and browser-level gates are not enforced by CI.

### Medium: Root `pnpm test` is incomplete local verification

Evidence:

- root test: `package.json:14`
- API integration behind separate script: `apps/api/package.json:15`
- CI compensates separately: `.github/workflows/ci.yml:69`

Impact: local “test” success can omit high-value router invariant suite.

### Medium: Production auth/email docs not reflected in env template/compose

Evidence:

- ops guide SSO/OTP vars: `docs/operate-and-test-guide.md:305`
- env template lacks these: `.env.production.example:26`
- compose passes only basic vars: `docker/docker-compose.prod.yml:75`

Impact: production auth/email setup cannot be followed from provided deployment files.

### Medium: Roadmap records retired teaching/E2E evidence

Evidence:

- `docs/roadmap.md:50`
- E2E mapping still mentions teaching smoke: `docs/roadmap.md:81`

Impact: release/readiness claims drift from actual app topology.

### Medium: Screenshot artifacts are easy to accidentally add

Evidence:

- `.gitignore:27`
- untracked screenshots from `git status`: `admin-dashboard.png`, `teaching-full.png`, `lms-app.png`

Impact: review artifacts can enter source history accidentally.

## Verification Gaps

- Tests/builds not run due read-only review.
- GitNexus did not index `D:\project\CMCnew`.
- Ignored env files not inspected.
- GitHub Actions run history not verified.

## Positive Controls

- CI covers install, Prisma generate, migrations, seed, RLS verification, typecheck, unit tests, API integration, and build.
- ESLint config exists.
- API Dockerfile drops root privileges.
- Nginx has basic security headers and SSE buffering disabled.
- Secrets/env files broadly ignored.

## Unresolved Questions

- Is canonical topology permanently `admin + lms + api`?
- Should CI enforce Playwright E2E now?
- Should `pnpm test` include `@cmc/api test:int`, or should docs define a full local verification command separately?

