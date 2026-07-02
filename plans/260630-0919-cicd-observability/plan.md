# CI/CD Observability (recommendations + remaining work)

Status: completed (2026-07-02) · Lane: high-risk · Intake #36

**Closure note (2026-07-02):** P3's deferred items are done — GitHub token
credential + `github-branch-source` PR discovery wired in `docker/jenkins-casc.yaml`
(commits `72b1d3f`, `e2a1657`), `ci.cmcvn.edu.vn` is live. Verified live via
`gh pr list --json statusCheckRollup` on PR #11-#15: Jenkins posts real
`continuous-integration/jenkins/branch` status to GitHub PRs. `.github/workflows/ci.yml`
(GitHub Actions) remains billing-blocked and always FAILURE — now slated for
deletion in `plans/260702-*-google-jules-async-agent-integration/` since it
provides zero signal and only adds noise.
Goal: make Jenkins deploys externally verifiable + visually observable, and close
the session's harness backlog.

## Phases

- **P1 — Health version marker (VERIFIABLE):** `/api/health` returns
  `{ok, commit, builtAt}` from env (`APP_COMMIT`/`APP_BUILT_AT`, default `unknown`).
  Additive (smoke `wget` still 200). Verify: api typecheck.
- **P2 — Wire commit through deploy (infra, unverifiable here):** compose `api`
  env passes `APP_COMMIT`/`APP_BUILT_AT` (`:-unknown` default = safe no-op);
  Jenkinsfile exports them from `$GIT_COMMIT` + build time before `$COMPOSE up`.
- **P3 — Visual CI (infra):** add `blueocean` + `github-checks` to
  `jenkins-plugins.txt` (additive). DEFER the casc GitHub-server + Jenkinsfile
  `publishChecks` + `ci.` nginx block — they need a VPS-side GitHub token and
  cross-compose networking I cannot verify here; documented in decision 0019.
- **P4 — Harness housekeeping (VERIFIABLE):** SESSION_LOOP trace-tier reminder
  (backlog #10); decision 0019; close backlog #10/#11 with outcomes.

## Acceptance
- api typecheck green; `/health` shape additive (ok still present).
- Config edits additive + reversible; unset env → `unknown`, no behavior change.
- Decision 0019 records the deferred VPS steps.

## Out of scope (this round)
- Applying anything on the VPS (user rebuilds Jenkins/app stack).
- GitHub token credential creation in Jenkins; `ci.cmcvn.edu.vn` DNS/cert.

## Risks
- Infra edits (P2/P3) unverifiable from this env → high-risk gate: STOP before
  commit for human approval (--auto rule).
