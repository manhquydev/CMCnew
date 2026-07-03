---
phase: 3
title: "CI Check Investigation"
status: pending
effort: ""
---

# Phase 3: CI Check Investigation

## Overview

`Jenkinsfile`'s `publishChecks` (added in `plans/260703-0022-devops-tier1-hardening/`) never posts
a `CMCnew CI` check-run to GitHub despite the pipeline reporting SUCCESS. Partially diagnosed:
`docker/jenkins-casc.yaml`'s `gitHubPullRequestDiscovery` was `strategyId(1)` (checks out an
ephemeral PR-merge SHA never pushed to GitHub, so a check posted against it 404s silently inside
`catchError`) — fixed to `strategyId(2)` (real PR head SHA). Even against the correct head SHA, no
check-run appeared. Separately, this session found Jenkins' own GitHub plugin already posts a
WORKING check under a different context — `continuous-integration/jenkins/pr-head` — visible via
`gh pr checks <N>` on every PR built this session. Investigate whether that pre-existing mechanism
should simply be adopted as the required check instead of continuing to debug the custom
`publishChecks` step.

## Implementation Steps

1. Confirm on a live PR: `gh api repos/manhquydev/CMCnew/commits/<sha>/check-runs` — list every
   check-run context posted (not just `CMCnew CI`). Compare `continuous-integration/jenkins/pr-head`
   vs `CMCnew CI` behavior across several builds.
2. If `continuous-integration/jenkins/pr-head` reliably reflects the real build result (success on
   green, failure on red) — the simplest fix is to point
   `scripts/setup-github-required-check.sh` at THAT context instead of `CMCnew CI`, and drop the
   custom `publishChecks` Jenkinsfile stages entirely (less code, one less thing that can silently
   break). Verify this is genuinely equivalent before committing to it — confirm it fails on a
   red build, not just passes on green (a check that never posts a failure would be worse than the
   current report-only setup).
3. If `continuous-integration/jenkins/pr-head` is NOT reliable (e.g. only tracks the SCM checkout
   step, not the actual pipeline result), keep investigating `publishChecks`: check Jenkins
   `docker logs cmcnew-jenkins` around a build's Checkout/post stages for swallowed exceptions
   (the `catchError(stageResult: 'UNSTABLE')` wrapper hides them from the pipeline result but they
   should still appear in the Jenkins system log).
4. Once a working mechanism is confirmed (either fixed `publishChecks` or the adopted
   `continuous-integration/jenkins/pr-head` context), run `scripts/setup-github-required-check.sh`
   for real (it has never been run this session — dry-run against the live `main` protection state
   first per its own safety design, per its Unresolved Question in the devops Tier-1 plan).

## Success Criteria

- [ ] A real check-run context reliably posts SUCCESS on a green build and FAILURE on a red build — verified with an actual forced-red test build, not just observed on passing builds.
- [ ] `scripts/setup-github-required-check.sh` run for real against `main`, confirmed via the script's own GET-first safety check that it didn't clobber any existing branch protection.
- [ ] A PR with a failing build is confirmed blocked from merging in the GitHub UI.
