# 0019 CI/CD Observability (deploy marker + Jenkins visibility)

Date: 2026-06-30

## Status

Accepted

## Context

Jenkins runs single-node on the VPS (`127.0.0.1:8080`), posts no status to
GitHub, and `/api/health` exposed no version — so an agent (or human off the VPS)
could not confirm whether a merge to `main` actually deployed, nor watch the
pipeline like GitHub Actions. Surfaced as backlog #11 during the PR #10 merge.

## Decision

Implemented now (additive, reversible, verifiable locally):

- `GET /api/health` returns `{ ok, commit, builtAt }` from `APP_COMMIT` /
  `APP_BUILT_AT` (default `unknown`). A deploy is now externally verifiable by
  reading the live commit SHA.
- `docker-compose.prod.tls.yml` `api` passes those env (`:-unknown` default → safe
  no-op when unset). `Jenkinsfile` exports them from `$GIT_COMMIT` + build time
  before `compose up`.
- `jenkins-plugins.txt` adds `blueocean` (visual pipeline dashboard) and
  `github-checks`.

Deferred (need VPS access + manual setup, documented here):

- Jenkins → GitHub commit-status (`publishChecks`): requires a GitHub token
  credential in Jenkins + a GitHub server entry in `jenkins-casc.yaml`, then a
  `post{}` publishChecks step. This is what makes CI appear as a check on the PR
  like Actions.
- `ci.cmcvn.edu.vn` nginx reverse-proxy to `jenkins:8080`: the Jenkins controller
  is a separate compose project (`cmcnew-jenkins`), so the prod nginx cannot
  resolve it without a shared network — needs an infra decision.
- Immediate visual access today: SSH tunnel `ssh -L 8080:127.0.0.1:8080 <vps>`
  → `http://localhost:8080`.

## Alternatives Considered

1. Build-arg bake of the commit into the image — rejected; runtime env is simpler
   and needs no Dockerfile change.
2. Wire full github-checks now — cannot verify without the VPS token; deferred to
   avoid shipping unverifiable credential config.

## Consequences

Positive: deploys verifiable from anywhere via `/api/health`; Blue Ocean gives a
visual pipeline; path to PR-level CI status is documented.
Tradeoffs: the PR-level status + public `ci.` dashboard still need a VPS-side step.

## Follow-Up

- Apply on VPS: rebuild Jenkins (`docker compose -f docker/docker-compose.jenkins.yml up -d --build`) to load new plugins; redeploy app stack so `/health` carries the commit.
- Create the GitHub token credential + casc server, then add `publishChecks`.
