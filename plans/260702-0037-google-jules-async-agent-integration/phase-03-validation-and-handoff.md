---
phase: 3
title: "Validation and Handoff"
status: pending
priority: P2
dependencies: [1, 2]
---

# Phase 3: Validation and Handoff

## Overview

Verify Phases 1-2 landed cleanly on a real PR, record the harness intake row
for this whole body of work (per `docs/FEATURE_INTAKE.md`, lane `high-risk`),
and write the manual runbook for the one step this plan deliberately does NOT
automate: actually connecting a Jules account. Ends with a journal entry.

## Requirements

- Functional: open a PR with Phases 1-2's changes, confirm on GitHub that only Jenkins + third-party bot checks appear (no more Actions `CI / build` false-red); confirm `jules-ok` label is visible and usable on a real issue.
- Non-functional: the runbook must be followable by a non-engineer (the user) without needing another planning session — concrete UI steps, not "figure it out". **[Red-team finding #5]** It must also explicitly flag that reviewing a PR targeting `develop` is a new habit for this repo (all 15 prior PRs targeted `main`), not something the existing workflow already does automatically.

## Architecture

No code. This phase is verification + 1 new runbook doc + harness recording.

## Related Code Files

- Create: `docs/jules-integration-runbook.md` (manual account-connection steps — NOT executed by this plan)
- Modify: none (verification only) beyond what Phases 1-2 already changed

## Implementation Steps

1. Open the PR containing Phase 1 + Phase 2 changes into `develop` (per repo convention, `AGENTS.md`). **[Finding #5]** Note this itself is the first real precedent for a PR targeting `develop` in this repo's history — treat it as a dry run for the review habit Jules PRs will require.
2. `gh pr checks <PR#>` (or `gh pr list --json statusCheckRollup` as used during brainstorm research) — confirm: Jenkins status present and real, GitHub Actions `CI / build` check is **gone** (not just green — gone, since the workflow file no longer exists).
3. `gh label list --json name --jq '.[].name' | grep -Fx jules-ok` — confirm label exists and is assignable on an issue.
4. Record harness intake for this body of work:
   ```
   .\scripts\bin\harness-cli.exe intake --type "maintenance" --summary "Google Jules guardrailed integration prep: remove dead GH Actions signal, add jules-ok label + governance decisions" --lane high-risk --docs "AGENTS.md,docs/decisions/00NN-remove-dead-github-actions-ci.md,docs/decisions/00NN-google-jules-guardrailed-integration.md"
   ```
   (verify exact flag names via `harness-cli.exe intake --help` before running; substitute the actual decision-doc filenames from Phases 1-2, and be aware a red-team reviewer's test run already created a stray `Intake #52` "test dry run" row in the local harness DB during this planning session — harmless, no undo command exists, safe to ignore.)
5. Write `docs/jules-integration-runbook.md` — the manual steps for the user (not automatable):
   - Go to jules.google, sign in with the Google account chosen for this integration (per the Phase 2 decision doc — confirm account ownership choice is written down before this step, do not proceed with an undecided account).
   - Authorize the `manhquydev/CMCnew` repo via OAuth; verify granted scope is limited to this repo (not org-wide) if the UI offers that choice. **[Red-team finding #9]** Abort criterion: if GitHub/Jules does NOT offer per-repo scoping and only offers all-repos/org-wide access, stop and escalate back to a planning conversation before authorizing — do not proceed with broader access than intended.
   - Confirm Free tier (5 tasks/month) as the starting quota.
   - Read and accept the residual-risk note from the Phase 2 decision doc before proceeding: branch protection is unavailable on this repo's GitHub plan, so "no merge rights" is enforced only by Jules's own product behavior + this repo having exactly one collaborator (you) — not by GitHub itself.
   - Label one small, real, low-risk issue `jules-ok`, then **manually start the Jules task yourself** via the Jules web UI or CLI (the label is a scoping convention for you to remember/track, not an automatic trigger — per red-team finding #2, Jules has no built-in "watch this label" mechanism, and this repo's GitHub Actions can't run one either since it's billing-blocked).
   - Watch the resulting PR: confirm it targets `develop`, confirm Jules did not attempt to merge it, confirm the only checks are Jenkins + bots (no Actions noise). Remember only lint+typecheck runs on `develop`-target PRs (`Jenkinsfile:36-41`) — review the diff yourself as if no integration-test safety net exists, because none does yet.
   - **[Finding #10]** Confirm whether the PR/commits show a distinct Jules author identity (expected, standard GitHub App/OAuth behavior). If not, adopt a commit-message trailer convention (e.g. `Co-authored-by: Jules <...>`) for future auditability.
   - If Jules loops or times out repeatedly on the same issue, unassign/unlabel and escalate manually — do not let it consume the whole monthly quota on one task. Worst case on Free tier is bounded: 5 tasks/month lost, not a runaway cost or access incident.

6. Run `/ck:journal` to record this planning+prep session (brief technical journal entry).

## Success Criteria

- [ ] PR opened, Jenkins-only real CI signal confirmed (Actions check absent, not just passing).
- [ ] `jules-ok` label confirmed usable.
- [ ] Harness intake row recorded for this work at `lane=high-risk`.
- [ ] `docs/jules-integration-runbook.md` exists, is followable without further engineering help, and includes the branch-protection-unavailable + manual-trigger + develop-review-is-new-habit caveats (not silently omitted).
- [ ] Journal entry written.

## Risk Assessment

Low risk for the automated parts (verification only). The actual residual risk
— granting a personal Google account OAuth access to a production repo with no
GitHub-enforced merge restriction — is explicitly written into the runbook as
an accept-or-abort decision point for the human, not silently automated past.
If the user decides not to proceed with real Jules connection after reading
the runbook, Phases 1-2 (dead-CI cleanup + honest guardrail docs) still stand
as independently valuable, reversible changes.
