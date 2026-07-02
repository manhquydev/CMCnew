# Code Review — devops/tier1-hardening (diff vs develop)

## Scope
- Files: `Jenkinsfile`, `docker/docker-compose.prod.tls.yml`, `scripts/prod-server-deploy.sh`,
  `scripts/prod-tls-bootstrap.sh` (modified); `scripts/ensure-origin-cert.sh`,
  `scripts/setup-github-required-check.sh` (new, untracked)
- LOC: 107 insertions / 17 deletions across 4 modified files + 2 new scripts (~95 lines)
- Focus: full diff against `develop`, cross-checked against `plans/260703-0022-devops-tier1-hardening/plan.md` + its 4 phase files
- Verification performed: `docker compose -f docker/docker-compose.prod.tls.yml --env-file .env.production.example config` (parses clean, all 9 services carry `deploy.resources`, byte-accurate to plan's sizing table); pulled and confirmed the pinned `alpine@sha256:d9e853e87e...` digest is real/pullable; empirically ran `ensure-origin-cert.sh` against a scratch Docker volume on this machine for all 3 claimed test cases (empty / pre-existing-valid / corrupted) — all 3 passed exactly as designed once a Git-Bash path-mangling artifact (`MSYS_NO_PATHCONV`) was worked around in my own test harness (not a script bug — confirmed by re-running with the env var set).

## Overall Assessment
The implementation matches the plan closely — sizing numbers, service list, script logic, and Jenkinsfile wiring all check out against the phase files. Two real gaps found: (1) the Phase-1-required decision doc `docs/decisions/0029-*.md` does not exist yet, even though two modified files already reference it by path; (2) the GitHub branch-protection merge script's field-preservation for `required_pull_request_reviews`/`restrictions` doesn't fully round-trip GitHub's GET→PUT schema asymmetry for nested config (dismissal/bypass/restriction objects use different shapes on read vs write) — low practical likelihood for this solo-maintainer repo, but the script will fail loudly rather than corrupt state if it ever does bite, which is the important improvement over the original blind-PUT design. No live-prod-breaking defects found in the code itself; the remaining acceptance criteria (OOM-free soak, red/green PR check, fresh-volume Jenkins run) are correctly deferred to Phase 4's live rollout and not fakeable from a code review.

## Critical Issues
None. No trust-boundary violation, no data exposure, no silent breaking change to a public contract found in this diff.

## High Priority

### 1. `docs/decisions/0029-canonical-origin-tls-self-signed-behind-cloudflare.md` does not exist
Phase 1 §6 states this decision doc is "**Required** because this is a high-risk (TLS/external/prod) change per `docs/FEATURE_INTAKE.md`," and lists it as a file this phase must CREATE. It's missing from the untracked-files list. Worse, three already-modified files reference this exact path as if it exists:
- `scripts/prod-server-deploy.sh` (new comment): `"...see docs/decisions/0029-canonical-origin-tls-self-signed-behind-cloudflare.md."`
- `scripts/prod-tls-bootstrap.sh` (new header): same reference.
- `docker/docker-compose.prod.tls.yml` (new header comment): same reference.

This is an incomplete Phase-1 deliverable, not a bug in the shipped code paths — per the task brief, flagging as an incomplete acceptance criterion rather than a code defect. Should be created before this branch is considered done, both to satisfy `FEATURE_INTAKE.md`'s high-risk gate and to avoid three dangling doc references pointing at a file that 404s.

### 2. `setup-github-required-check.sh` — GET→PUT schema asymmetry not fully closed for nested protection fields
Confirmed the jq merge logic (Finding 2's fix) correctly preserves `enforce_admins`, dedups/prepends the new required context, and defaults safely to `false`/`null` when `main` currently has no protection (`current = {}`). That closes the original "blind PUT nulls everything" critical bug for the common case.

However, `required_pull_request_reviews` and `restrictions` are passed straight through from the GET response object into the PUT body (`required_pull_request_reviews: .required_pull_request_reviews`, `restrictions: .restrictions`). GitHub's branch-protection API has a known GET/PUT shape mismatch for these two fields:
- GET returns `dismissal_restrictions.users`/`.teams` and `restrictions.users`/`.teams`/`.apps` as arrays of **full user/team/app objects** (with `login`, `id`, `url`, etc.)
- PUT expects those same keys as arrays of **login/slug strings** (`["octocat"]`, not `[{"login":"octocat",...}]`)

If `main` currently has any review-dismissal restrictions or push restrictions configured (unverified — this is literally the plan's own Unresolved Question #7), this script's PUT will likely 422 on the type mismatch rather than apply cleanly. This is a real residual gap in Finding 2's fix, but the failure mode is a **loud script error** (caught by `gh api`'s own error reporting, script exits nonzero), not the original "silently deletes existing protection" — so it's a correctness gap, not a re-opening of the critical finding. Given AGENTS.md confirms this is a solo-maintainer repo (`manhquydev/CMCnew`) where such team/app restrictions are unlikely to exist, practical risk is low. Recommend either documenting this caveat next to the script, or (better) checking whether `required_pull_request_reviews`/`restrictions` round-trip correctly the first time it's run against the real `main` (the interactive confirm step won't surface this — the printed `jq .` output looks identical whether or not it'll round-trip).

## Medium Priority

### 3. Jenkinsfile `publishChecks` calls omit `credentialsId: 'github-token'` specified by the plan
Phase 3 §1 explicitly designs the start-of-build check as `name: 'CMCnew CI', credentialsId: 'github-token'`. All four `publishChecks` call sites in the actual `Jenkinsfile` (Checkout, post/success, post/failure, post/unstable) omit `credentialsId` entirely:
```
publishChecks name: 'CMCnew CI', title: 'Build in progress', summary: 'Jenkins build running', status: 'IN_PROGRESS'
```
This is plausibly fine — the `github-checks` plugin commonly resolves credentials automatically from the multibranch job's configured GitHub SCM source (`jenkins-casc.yaml:44` already binds `github-token` there for checkout), so an explicit `credentialsId` may be redundant. But it's an unverified, undocumented deviation from the plan's stated design, and the plan's own Unresolved Question #3 already flags that the exact GitHub-visible behavior needs empirical confirmation on the first real PR build. Recommend explicitly confirming during Phase 4 Step 1 that the check posts correctly under the intended identity/token — if it works, note the simplification in the decision doc; if it doesn't, add `credentialsId: 'github-token'` back before enabling the required-check gate (Step 2).

### 4. `catchError`-wrapped `IN_PROGRESS` publish can degrade a clean build to UNSTABLE
Confirmed as implemented exactly per Phase 3 §1's spec: `catchError(buildResult: null, stageResult: 'UNSTABLE')` wraps every `publishChecks` call, including the very first one in the `Checkout` stage. Declarative Pipeline takes the worst stage result as the overall build result, so if that first `IN_PROGRESS` publish throws (network blip, plugin hiccup — anything, not just "plugin missing"), the entire build becomes `UNSTABLE` even if lint/typecheck/integration/deploy all subsequently succeed — which then fires `post{unstable}`, posting a `NEUTRAL` conclusion to GitHub. For a required check, GitHub does not treat `NEUTRAL` as passing, so a build that did all its real work correctly can still block merge purely because of a transient checks-API blip at the very start. This is not a deviation — it's built exactly as the plan specified — and is already the plan's own accepted Finding 5 risk (with a documented runbook mitigation in Phase 4 Step 2.3). No code action needed per this repo's review-audit rules (verified design decision, already red-teamed); flagging only because the task asked me to walk the Jenkinsfile post-block end to end and confirm what's actually wired.

## Low Priority
- `setup-github-required-check.sh` only preserves `required_status_checks.contexts` (legacy field); if `main`'s existing protection happens to use the newer `checks` array (app-ID-scoped required checks, populated automatically by some GitHub UI flows), those entries aren't explicitly carried forward in the new PUT body. GitHub does auto-populate `checks` from `contexts` on write, so this is very unlikely to matter for a repo with no other CI integrations — noting for completeness, not blocking.
- No `.gitattributes` in the repo; Git reported it would rewrite `docker-compose.prod.tls.yml`/`prod-server-deploy.sh`/`prod-tls-bootstrap.sh` to CRLF "next time git touches them" on this Windows checkout. Confirmed this is a local working-tree/`core.autocrlf` artifact only — the actual committed blobs and current working-tree bytes are LF (verified via `file` and `git diff` byte counts), so nothing will actually break on the Linux VPS. Pre-existing repo condition, not introduced by this diff — not actionable here.

## Edge Cases Found by Scout
- **Verified, not a bug**: `ensure-origin-cert.sh`'s idempotent skip-path (case b) initially appeared broken in my scratch-volume test — it was regenerating on every run. Root-caused to Git Bash/MSYS auto-converting `/le` and `/etc/letsencrypt` docker-run path arguments into Windows paths (`C:/Program Files/Git/le`), a Windows-only test-harness artifact. Re-ran with `MSYS_NO_PATHCONV=1` and all 3 cases (empty/valid/corrupt) passed cleanly, matching the claimed empirical test results. On the actual Linux Jenkins controller / VPS this class of bug cannot occur.
- Confirmed the compose-file service list is exactly the 9 services the plan expects (`postgres`, `redis`, `api`, `api-migrate`, `api-seed`, `admin`, `lms`, `nginx`, `certbot`), each carries a `deploy.resources` block, and `docker compose config` resolves the byte values correctly (e.g. `postgres`: 1073741824 bytes = 1 GiB limit / 536870912 = 512 MiB reservation — exact match to the plan's table).
- Confirmed `docker-compose.prod.yml` (the separate local-only file, explicitly out of scope) and `docker-compose.jenkins.yml`/`.github/workflows/ci.yml` (explicitly deferred/kept-as-is per the plan) are untouched by this diff — no scope creep.
- Confirmed Jenkinsfile branch/PR conditionals (`when { branch 'main' }`, `when { anyOf { branch 'main'; changeRequest() } }`) are unmodified and still gate `Build + Deploy`/`Smoke` to `main`-only while `Integration tests` still runs on PRs — no regression to the existing stage-gating logic.
- Note for the operator (not a code defect): this working branch bundles Phase 1's Jenkinsfile cert-step hunk together with Phase 3's `publishChecks` hunk in one diff. Phase 4 Step 1/Step 3 explicitly require these to land on `main` in two separate merges (`publishChecks` first, proven posting on a throwaway PR, THEN the cert-step hunk) — the plan already anticipates and permits authoring both on one branch as long as the *merge* is split (phase-01 "Jenkinsfile joint-ownership note", phase-04 Step 1.1 Finding 8). Nothing in the code forces or breaks this ordering; it's purely an operator sequencing step to remember when landing this branch.

## Positive Observations
- Resource-limit sizing arithmetic is exact: steady-state ceiling sum (postgres 1g + api 1g + redis 256m + nginx 128m + admin 128m + lms 128m) = 2.625 GiB, matching the plan's ~2.64 GiB claim and comfortably under the ~4 GiB app budget with Jenkins at full tilt.
- `ensure-origin-cert.sh` correctly implements verify-first (no `apk add` on the 99%-common hot path per Finding 12), never overwrites an existing cert (guard is presence-only), and fails loud with an actionable message on a corrupt cert — matches Phase 1 design exactly, empirically confirmed.
- `setup-github-required-check.sh`'s use of `jq --arg ctx` instead of string-interpolating the context name into the jq filter (which the plan's own pseudocode did) is a small, correct hardening beyond what was specified — avoids jq-filter injection from the context-name variable.
- certbot correctly moved behind `profiles: ['le']`, keeping the default deploy dormant on that service (one fewer idle container) with no risk to the `certbot_www` mount (empty volume is valid for nginx's ro mount).

## Recommended Actions
1. **Before merge**: create `docs/decisions/0029-canonical-origin-tls-self-signed-behind-cloudflare.md` per Phase 1 §6 (re-check `ls docs/decisions` for the actual next-free number first — plan.md itself warns `0029` may already be claimed by a parallel plan).
2. **Before running `setup-github-required-check.sh` against real `main`**: manually inspect the printed `current` JSON's `required_pull_request_reviews`/`restrictions` for non-null values with populated `dismissal_restrictions`/`bypass_pull_request_allowances`/team-or-app restrictions; if present, hand-verify the PUT body's shape before confirming (or just attempt it — a 422 fails safe, doesn't corrupt state).
3. **During Phase 4 Step 1** (throwaway PR): confirm the `CMCnew CI` check actually posts without an explicit `credentialsId` — if it fails silently under `catchError`, add `credentialsId: 'github-token'` to all four `publishChecks` call sites before proceeding to Step 2 (enabling the required-check gate).
4. Proceed with Phase 4's rollout order exactly as documented (Step 0 pre-flight → Step 1 report-only → Step 2 gate → Step 3 TLS → Step 4 limits soak) — nothing in this code review changes that sequencing.

## Metrics
- Type Coverage: N/A (shell/YAML/Groovy, no TS in this diff)
- Test Coverage: 3/3 claimed `ensure-origin-cert.sh` scratch-volume test cases re-verified empirically in this review; `docker compose config` parse-check re-verified; Jenkinsfile/branch-protection script have no offline test harness (Groovy/live-GitHub-API — matches plan's own acknowledgment that these require Phase 4's live PR)
- Linting Issues: 0 found (no shellcheck run — not in this repo's standard toolchain per scan; scripts use `set -euo pipefail` consistently, matching repo convention)

## Unresolved Questions
1. Does `main` currently have any existing branch protection with team/app-scoped review-dismissal or push restrictions configured? (Plan's own Unresolved Question #7 — determines whether Medium Finding #2 above is reachable in practice.)
2. Will `publishChecks` actually authenticate correctly without an explicit `credentialsId`, given the multibranch job's GitHub SCM source already binds `github-token`? Needs the Phase 4 Step 1 throwaway-PR test to confirm.
3. Confirmed not part of this review's scope but worth flagging to the operator: the plan's own Unresolved Questions 1, 2, 4, 5, 6 (PAT `checks:write` scope, `github-checks` plugin installed, live cert issuer, Cloudflare zone mode, `run --rm` resource-limit enforcement) are all still open and are exactly what Phase 4 Step 0 is designed to close before this branch's changes go live — none of them are answerable from a code-only review.
