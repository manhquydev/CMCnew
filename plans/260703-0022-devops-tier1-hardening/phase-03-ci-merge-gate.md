# Phase 3 — Jenkins → GitHub required-check wiring

## Goal

Make a red Jenkins PR build actually block merge at the GitHub UI, not just fail internally in Jenkins.

## Context / verified facts

- `Jenkinsfile` — zero `publishChecks`, zero `GITHUB_TOKEN` binding. `post{}` (lines 82-85) only `cleanWs()` + a failure `echo`.
- PRs already run the gating stages: `Lint + Typecheck` (all branches) and `Integration tests` (`Jenkinsfile:37` `when { anyOf { branch 'main'; changeRequest() } }`). `Build + Deploy` and `Smoke` are `when { branch 'main' }` → a PR (changeRequest) build's outcome = lint+typecheck+integration. That is exactly the signal that should gate merge.
- Credential already exists: `docker/jenkins-casc.yaml:19-25` → `usernamePassword` id `github-token`, user `manhquydev`, desc "GitHub PAT (SCM + checks)". Reused for SCM today (`jenkins-casc.yaml:44`). No new credential needed.
- Plugin: `docker/jenkins-plugins.txt:13` lists `github-checks` (and `blueocean` line 12) for install — **not confirmed installed on the live controller** (needs a VPS `docker compose -f docker/docker-compose.jenkins.yml up -d --build`).
- `jenkins-casc.yaml:27-31` sets `unclassified.location.url = https://ci.cmcvn.edu.vn/` → check `target_url` will resolve for humans. No separate GitHub-server CASC block exists (none needed for PAT-based checks-api).
- Repo: `manhquydev/CMCnew`. PRs target `main` (per AGENTS.md).
- **Finding 9 (High, accepted):** `.github/workflows/ci.yml` already exists and runs on every PR +
  push to `main` (its own job installs/migrates/seeds/typechecks/tests/builds — the same coverage
  Jenkins now provides), but per `AGENTS.md` it always fails within ~3 seconds due to a GitHub
  Actions billing block on this private repo. This plan never touches it. After this phase lands,
  every PR shows TWO checks: the new, real, required `CMCnew CI` (Jenkins) and the pre-existing,
  cosmetic, always-red `CI / build` (GitHub Actions) — confusing for a solo maintainer and silently
  burning Actions minutes on a job whose result is never used. **Decision: keep
  `.github/workflows/ci.yml` as-is (do not delete or disable it) but document explicitly why** — it's
  a ready-to-use fallback if Actions billing ever gets unblocked, and deleting it would lose that
  reference implementation for no real benefit (the file costs nothing while merely failing). State
  this in the decision doc (§6) so a future reader doesn't mistake the double-check UI for a bug.

## Design

### 1. Jenkinsfile — publish one check named `CMCnew CI`

Add a fault-tolerant publish so the check reflects the build outcome on every branch/PR:

- **Start:** publish `status: 'IN_PROGRESS'` once at the top of `stages` (a first `stage('Report start')` step, or per the checks-api pattern). `name: 'CMCnew CI'`, `credentialsId: 'github-token'`.
- **End:** in `post{ success { ... } }` publish `status:'COMPLETED', conclusion:'SUCCESS'`; in `post{ failure { ... } }` publish `conclusion:'FAILURE'`; optionally `post{ unstable { conclusion:'NEUTRAL' } }`.
- **Fault-tolerance:** wrap every `publishChecks` in `catchError(buildResult: null, stageResult: 'UNSTABLE')` (or `try/catch`) so a checks-API hiccup never fails the pipeline — the check is a reporter, not a gate inside Jenkins.

> The check name string is the contract with GitHub branch protection (step 3). Pick `CMCnew CI` and reuse it verbatim in the ruleset. Confirm the exact GitHub-visible context on the first PR build (Phase 4) — the checks-api plugin may surface it as-is or namespaced.

> **Jenkinsfile joint-ownership:** Phase 1 also edits `Jenkinsfile` (deploy cert step). Author both on one branch or land Phase 1 → Phase 3 to avoid a merge conflict.

### 2. Operator pre-flight (NOT code — cannot be automated)

Document in the decision/runbook, to be done on the VPS before the Jenkinsfile change merges:

- **Install the plugin on the live controller:** `docker compose -f docker/docker-compose.jenkins.yml up -d --build` (installs `github-checks` per `jenkins-plugins.txt`). Without this, the `publishChecks` DSL call errors with "no such method" and fails the whole pipeline. **This MUST happen before the Jenkinsfile change lands.**
- **Verify PAT scope:** the `github-token` PAT must have `repo` / `checks:write`. Its CASC description says "SCM + checks" but scope is unverifiable from the repo. Operator: check the token at github.com/settings/tokens, or use the corrected pre-flight (Finding 6, accepted — the original command hit an invalid endpoint that would 404 and be misread as a scope failure): `gh api -H "Authorization: token $PAT" repos/manhquydev/CMCnew/commits/main/check-runs` (a valid read-scoped check — a 200 doesn't prove `checks:write`, but a 403/404 here is a clear signal something's wrong before attempting the real thing). To positively confirm write access, the only reliable check is attempting an actual `POST .../check-runs` against a disposable ref during Phase 4 §Step 1's throwaway-PR test — that's the real proof, this pre-flight is just an early smoke check. If missing, regenerate the PAT with `repo`+`checks:write` scope and update `/root/jenkins.env` `GITHUB_TOKEN`, then re-run CASC (`up -d --build`). Regenerating a PAT is a manual GitHub-UI step — not scriptable.
- **Trust-boundary note (Finding 6's other half, accepted as documented risk, not fixed in this
  phase):** `jenkins-casc.yaml:48` enables `gitHubPullRequestDiscovery`, meaning every PR build runs a
  pipeline defined by the Jenkinsfile inside that PR itself, with the `github-token` credential bound
  in. This phase widens that token's required scope (`checks:write`, in addition to its existing SCM
  use) and its call frequency (every PR now triggers a `publishChecks` call). This is a real
  trust-boundary expansion on an already-PR-triggerable pipeline — not newly introduced by this plan,
  but not previously assessed either. Full mitigation (restricting PR discovery to same-repo only, or
  isolating PAT scope per stage) is a larger Jenkins security-model change than this Tier-1 hardening
  pass scopes for; record as an accepted risk in the cross-cutting risk table (plan.md) rather than
  silently ignoring it.
- **Prod-secrets exposure (Finding 7, accepted as documented risk):** `docker-compose.jenkins.yml:35`
  mounts `/root/cmcnew/.env.production` (full prod secrets: DB password, `JWT_SECRET`,
  `GRAPH_CLIENT_SECRET`, etc.) into the Jenkins container, readable from ANY pipeline stage —
  including `Lint + Typecheck` and `Integration tests`, which run unconditionally on every PR
  (`Jenkinsfile:23,37`), not just `main`. This plan is what converts "green CI" into a required merge
  gate (§3), which raises the stakes of trusting this pipeline's integrity, but scoping the secrets
  mount away from PR-triggered stages is a Jenkinsfile/compose restructuring exercise that overlaps
  with `plans/260703-0052-dev-prod-cicd-environments`'s Phase 4 (Jenkins branch pipeline split) —
  better addressed there, where the branch-conditional pipeline structure is already being rebuilt,
  than as a bolt-on to this smaller plan. Record as an accepted risk here; cross-reference the other
  plan as the natural place to fix it.

### 3. GitHub branch protection — scripted required check

**Critical fix (Finding 2, accepted):** the original design did a blind `PUT` with a hardcoded JSON
body setting `required_pull_request_reviews: null` and `restrictions: null` — the GitHub branch-
protection PUT endpoint **replaces the entire protection object**, it does not merge/patch. Run
verbatim against a `main` branch that already has ANY existing protection (a required-review rule,
an org-level default policy, admin restrictions — none of this is discoverable from the repo, and
`main` auto-deploys to prod on green per `Jenkinsfile:44`), this would silently delete it, converting
"PR review + green CI required to touch prod" into "green CI alone is sufficient" — a real
authorization-boundary weakening introduced by a one-shot script with no current-state check.

New helper `scripts/setup-github-required-check.sh` (run once by operator, needs `gh auth` with admin on the repo) — now GET-first, merge-only:

```bash
# 1. Read current protection (if any) — do not assume main has no existing rules.
current=$(gh api repos/manhquydev/CMCnew/branches/main/protection 2>/dev/null || echo '{}')

# 2. Print it and require explicit operator confirmation before proceeding — this script is run
#    once, interactively, by a human, not from CI, so a confirm prompt is cheap and appropriate.
echo "Current branch protection for main:"
echo "$current" | jq .
read -p "Proceed and ADD 'CMCnew CI' as a required check, preserving the above? [y/N] " ok
[ "$ok" = "y" ] || exit 1

# 3. Merge: keep whatever required_pull_request_reviews/restrictions/enforce_admins already exist,
#    only add/replace required_status_checks. Build the new body from the CURRENT state, not from
#    a hardcoded null-everything template.
new_body=$(echo "$current" | jq '{
  required_status_checks: { strict: true, contexts: (["CMCnew CI"] + ((.required_status_checks.contexts // []) - ["CMCnew CI"])) },
  enforce_admins: (.enforce_admins.enabled // false),
  required_pull_request_reviews: .required_pull_request_reviews,
  restrictions: .restrictions
}')

gh api --method PUT repos/manhquydev/CMCnew/branches/main/protection --input - <<< "$new_body"
```

- `contexts: ["CMCnew CI"]` MUST byte-match the publishChecks `name`; the jq expression above adds it
  without dropping any other required context that may already exist.
- `strict: true` = branch must be up-to-date before merge (require re-run after main moves). Operator may set `false` if that is too strict for a solo repo.
- `enforce_admins`, `required_pull_request_reviews`, `restrictions` are now PRESERVED from the current
  state (read in step 1), not blindly nulled — if `main` currently has no protection at all (`current`
  = `{}`), these safely resolve to `false`/`null`/`null`, matching the original intended defaults for
  a fresh repo.
- Rulesets (`gh api repos/.../rulesets`) are the modern alternative — classic protection chosen here for simplicity and because the required-check semantics are identical and well-understood. Note the choice.

**Ordering (critical):** GitHub blocks merge if a required context never reports. Do NOT run this script until Phase 4 confirms `CMCnew CI` actually posts on a real PR — otherwise every PR is permanently unmergeable.

**Also fixed (Finding 6's minor half):** the operator pre-flight PAT-scope check in §2 below used an
invalid GitHub REST endpoint (`/repos/{owner}/{repo}/check-runs` with no ref — not a real path;
check-runs are scoped under a commit SHA). Corrected below.

## Files

- MODIFY `Jenkinsfile` (publishChecks start + post blocks)
- CREATE `scripts/setup-github-required-check.sh`
- (doc) capture operator pre-flight in the Phase-1 decision doc or a short runbook note

## Data flow

PR opened → Jenkins multibranch builds the PR → publishChecks IN_PROGRESS → lint/typecheck/integration run → post → publishChecks COMPLETED(SUCCESS|FAILURE) → GitHub check-run on the PR → branch protection sees required context `CMCnew CI` → merge button gated on conclusion.

## Tests / validation

- `Jenkinsfile` is Groovy — validate via a real PR build in Phase 4 (no offline linter in-repo). Confirm: check appears on the PR, red build → FAILURE conclusion → merge blocked; green build → SUCCESS → merge allowed.
- Confirm the exact context string GitHub shows, then confirm it matches the ruleset `contexts[]`.

## Risks / rollback

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Required check enabled before it ever posts → all PRs blocked | High-if-misordered × High | Phase 4 ordering: prove posting on a PR BEFORE running `setup-github-required-check.sh` |
| `publishChecks` DSL missing (plugin not installed) → pipeline fails | Med × High | Operator installs plugin (VPS rebuild) BEFORE Jenkinsfile lands; wrap in catchError |
| PAT lacks `checks:write` → checks silently 403 | Unknown × Med | Pre-flight verify; catchError keeps pipeline green so a scope gap doesn't block deploys |
| Self-lockout (admin can't merge a fix when CI wedges) | Low × Med | `enforce_admins: false` |
| **(Finding 5, accepted)** `catchError`-wrapped `publishChecks` fails on the `COMPLETED` call specifically (start succeeded, end didn't — GitHub 5xx, PAT expiry, controller restart mid-build) → check stuck `IN_PROGRESS` on GitHub forever while Jenkins itself shows green, blocking ALL future PR merges with no Jenkins-side signal | Low × High | No automated fix within this phase's scope (would need a scheduled canary job or reconciliation check — larger scope). Documented mitigation: add a runbook troubleshooting line — "PR stuck un-mergeable with a green-looking Jenkins build → check `gh api repos/manhquydev/CMCnew/commits/<sha>/check-runs` before assuming it's a code problem" (added to phase-04's rollout docs) |

Rollback: (a) Jenkinsfile — revert the publishChecks edits (check stops posting; harmless). (b) Branch protection — `gh api --method DELETE repos/manhquydev/CMCnew/branches/main/protection` (or drop the context) removes the gate instantly. Both independently reversible.

## Done =

A red PR build shows a failing `CMCnew CI` check and GitHub blocks merge; a green build unblocks it; operator pre-flight (plugin + PAT scope) documented and confirmed.
