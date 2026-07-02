# Phase 3 — Jenkins PR gates (integration tests on PR)

## Context links
- Report §"PLAN 7" item 3: `plans/reports/brainstorm-260702-1109-fullproject-completeness-p4-p7-report.md:45`
- Pipeline: `Jenkinsfile` — `Lint + Typecheck` stage (`:23-34`, runs all branches); `Integration tests` gated `when { branch 'main' }` (`:36-41`); Build+Deploy `:43-65`; Smoke `:67-80`, both `main`-only
- Integration runner: `scripts/ci-integration-tests.sh` (ephemeral postgres:16-alpine, migrate, `test:integration`, self-cleanup)
- API test script: `apps/api/package.json:16` → `test:integration`

## Overview
PRs currently get only Lint+Typecheck; integration tests run **only on `main`** (`Jenkinsfile:37`), i.e. after merge —
so a red integration test cannot block a PR. Move the integration-test gate to run on PRs too, reusing the existing
self-contained `ci-integration-tests.sh`. Keep Build/Deploy/Smoke `main`-only (deploy must not fire from a PR).

## Key Insights
- The heavy lifting already exists — `ci-integration-tests.sh` spins its own Postgres and tears it down. The only change
  is the **`when` condition** on the Integration stage, not new infra.
- Jenkins multibranch: PR builds carry `CHANGE_ID`. Gate = run integration when building a PR **or** `main`
  (`when { anyOf { branch 'main'; changeRequest() } }`). Deploy stages stay `branch 'main'`.
- **What actually serializes builds is `numExecutors: 1` in `docker/jenkins-casc.yaml:4`** — one global build slot
  across the whole controller — NOT `disableConcurrentBuilds()` (`Jenkinsfile:9`), which only prevents two builds of
  the *same* branch/job. In a multibranch pipeline each PR/branch is a distinct job, so `disableConcurrentBuilds()`
  alone would let a PR build and a `main` build run concurrently. Because `numExecutors: 1`, they can't → the extra
  per-PR Postgres won't cause parallel resource spikes or port collisions; it only lengthens queue time. Acceptable.
- e2e smoke: currently the `Smoke` stage hits live domains post-deploy — NOT suitable for PRs (no deploy). Real e2e
  (`apps/e2e`) needs a running stack; running it per-PR is a bigger lift. **Assess only**: recommend deferring e2e-on-PR
  (YAGNI now; coverage is ~1 real e2e file). Integration-on-PR is the go-live-blocking gate.

## Requirements
- Integration tests execute on every PR build with an ephemeral DB and block merge on failure.
- Build/Deploy and post-deploy Smoke remain `main`-only (no deploy from PRs).
- No new secrets required (integration DB is ephemeral, password inline in the script).
- e2e-on-PR: documented decision (defer) with rationale; not implemented.

## Architecture
```
PR build:   Checkout → Lint+Typecheck → Integration tests(ephemeral PG)         → (no deploy)
main build: Checkout → Lint+Typecheck → Integration tests → Build+Deploy → Smoke
```

## Related code files
- MODIFY `Jenkinsfile` — change Integration stage `when` from `branch 'main'` to `anyOf { branch 'main'; changeRequest() }`; leave Build/Deploy/Smoke conditions unchanged
- POSSIBLY MODIFY `scripts/ci-integration-tests.sh` — only if a fixed host port (`55432`) collides under serialized PR+main runs; likely no change (serialized builds don't overlap)

## Implementation Steps
1. Edit the Integration stage `when` block to include `changeRequest()`.
2. Verify the stage's `sh 'bash scripts/ci-integration-tests.sh'` needs nothing PR-specific (it uses `$WORKSPACE`, self-contained).
3. Confirm the Jenkins job is a multibranch/PR-aware pipeline so `changeRequest()` resolves (operator-assisted: check job config).
4. Document the e2e-on-PR defer decision in the runbook or DEBT (coordinate with P5 for DEBT entry).
5. **[operator-assisted]** open a throwaway PR with a deliberately failing integration test → confirm the PR check goes red and blocks; then confirm a green PR passes.

## Todo list
- [ ] Jenkinsfile: integration gate on PR + main
- [ ] Confirm ci-integration-tests.sh port safe under serialized builds
- [ ] [operator] verify multibranch PR trigger + red-PR-blocks demonstration
- [ ] Record e2e-on-PR defer rationale (hand to P5 DEBT)

## Success Criteria
- A PR with a failing integration test shows a failed Jenkins check and cannot merge (branch protection permitting).
- A clean PR passes Lint+Typecheck+Integration without triggering any deploy.
- `main` pipeline behavior (deploy+smoke) is unchanged.

## Risk Assessment
- **`changeRequest()` on non-multibranch job (MED×MED):** if the Jenkins job isn't PR-aware, the condition never matches and PRs silently keep the old (weaker) gate. Mitigation: step 3 operator check + step 5 red-PR demonstration is the real proof.
- **CI minutes / queue time on 2 vCPU (MED×LOW):** more builds run the DB stage; serialized by the single global executor (`numExecutors: 1`). Acceptable; monitor.
- **Port collision (LOW, latent):** the hardcoded `55432` in `ci-integration-tests.sh` is safe ONLY because `numExecutors: 1` guarantees no two builds run at once — `disableConcurrentBuilds()` does NOT cover this (it serializes per-branch, but PR vs `main` are distinct multibranch jobs). If `numExecutors` is ever raised (plausible once PR gates add queue time — this phase itself flags queue cost), concurrent builds would collide on `55432` silently. Mitigation if that happens: randomize the port (e.g. derive from `$EXECUTOR_NUMBER` or `$BUILD_TAG`). Flag revisit whenever executor count changes.

## Security Considerations
- Integration DB is ephemeral with a throwaway password — no prod secret exposure. Ensure no `.env.production` is mounted into PR test containers (it isn't; script sets its own DSNs).
- Do not run Build/Deploy from PR context (would deploy unreviewed code) — guarded by keeping those stages `branch 'main'`.

## Next steps
- Feeds go-live criterion "PR không qua được nếu int-test đỏ". Coverage expansion (unit tests, more e2e) is out of scope — long-haul debt noted in report §item-3 note.
