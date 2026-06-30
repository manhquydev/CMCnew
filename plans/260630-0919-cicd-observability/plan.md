# CI/CD Observability (recommendations + remaining work)

Status: in-progress · Lane: high-risk · Intake #36
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
