---
phase: 2
title: "Guardrails and Governance Docs"
status: pending
priority: P1
dependencies: [1]
---

# Phase 2: Guardrails and Governance Docs

## Overview

Write down the guardrails agreed in the brainstorm (Approach B) as durable
project documentation, and create the GitHub label that scopes which issues
Jules is allowed to touch. This phase is documentation + 1 GitHub API call —
no application code changes.

**[Red-team revision, Critical findings #1 and #2]** The original version of this
phase claimed 3 independent, enforced guardrails. Live verification during
red-team review disproved that:
- `gh api repos/manhquydev/CMCnew/branches/develop/protection` and the `main`
  equivalent both return `403 "Upgrade to GitHub Pro or make this repository
  public to enable this feature"` — **branch protection is unavailable on this
  repo's current GitHub plan.** There is no `CODEOWNERS` file either. "No merge
  rights" is therefore **not a GitHub-enforced control** — it is trust in
  Jules's own product behavior (opening a PR for review, not auto-merging),
  which cannot be verified from this repo.
- The `jules-ok` label has no GitHub-native trigger wired to it. Jules's actual
  trigger surfaces (per brainstorm research) are: web UI, the
  `google-labs-code/jules-invoke` GitHub Action, CLI, or the alpha API — none of
  which is "auto-scan issues for a label." And since this repo's GitHub Actions
  is billing-blocked, the Action-based trigger path is dead anyway. So
  `jules-ok` is a **manual scoping convention**: a human sees the label and
  starts the Jules task themselves (web UI or CLI) — it does not automatically
  hand work to Jules.

This phase now documents both facts honestly instead of presenting them as
enforced technical guardrails. The real safety mechanisms, in order of actual
strength, are: (1) the human is the sole GitHub collaborator on this repo
(confirmed via API) and remains the only one who can authorize/merge anything
in practice today, (2) Jules's own product design opens a PR rather than
auto-merging, (3) the `jules-ok` label + `develop`-only convention bound what a
human will *manually* hand to Jules. None of these is a hard technical wall —
that is the accepted residual risk, written down rather than hidden.

## Requirements

- Functional: `jules-ok` label exists on the GitHub repo; guardrail rules (including the honest branch-protection/label-trigger caveats above) are written into `AGENTS.md` so any future agent/human reads them automatically.
- Non-functional: guardrail text must not overstate enforcement — say "convention, not a GitHub-enforced control" explicitly wherever "no merge rights" or "develop-only" is mentioned, per red-team findings #1/#2.

## Architecture

Pure documentation + GitHub label metadata. No runtime component.

## Related Code Files

- Create: `docs/decisions/00NN-google-jules-guardrailed-integration.md` (NN = next number confirmed at execution time, continuing from Phase 1's 00NN — use `docs/templates/decision.md`)
- Modify: `AGENTS.md` — (a) add a short "Async agents (Jules)" subsection near the existing "Branch workflow (bắt buộc)" section, cross-referencing the decision doc; (b) **[Red-team finding #4]** fix the stale sentence "GitHub Actions billing is blocked → runs fail at ~3s; Jenkins not yet built" — Jenkins has been live and posting real PR status since 2026-06-30 (see decision 0019, memory `cmcnew-cicd-jenkins-decision`). Correct the fact; do NOT unilaterally lift the Tier-3 gate on `ship`/`review-pr`/`vibe --ship`/`team` — that's a separate decision, flag it as a follow-up instead.
- Create: `docs/jules-integration-runbook.md` — the manual account-connection steps for Phase 3 (also carries the operational-habit note from finding #5, written in Phase 3).

## Implementation Steps

1. Confirm current repo owner/slug: `gh repo view --json nameWithOwner` (expect `manhquydev/CMCnew`).
2. Create the label (idempotent check first, matching the pattern already used by `ck-plan`'s `--github` mode for `ready to review`):
   ```
   gh label list --json name --jq '.[].name' | grep -Fx "jules-ok" >/dev/null \
     || gh label create "jules-ok" --color "1D76DB" --description "Human-triggered scope marker for Google Jules (not an automatic trigger)"
   ```
   **[Red-team finding #8]** Repo currently has exactly 1 collaborator (confirmed via API during red-team), so label-application ACL is not an active risk. Note in the decision doc: if a second collaborator is ever added, revisit whether label-application should be restricted (e.g. via a lightweight process note, since GitHub's free plan has no granular label-permission control).
3. Re-check `docs/decisions/` for the actual next number at execution time (continuing from Phase 1 — do not reuse; do not trust this plan's number references as ground truth, per finding #3).
4. Write `docs/decisions/00NN-google-jules-guardrailed-integration.md`:
   - Context: user wants an async agent for unattended small-bug fixes; Jules is GitHub-only, personal-Google-account-only (no org controls published as of research date), reads PR check status. Link brainstorm report `plans/reports/brainstorm-260702-0024-google-jules-async-agent-integration-report.md`.
   - Decision: adopt Approach B — Jules scoped to issues **manually** labeled `jules-ok` (human starts the task via Jules's own UI/CLI, the label is bookkeeping, not an automatic trigger); Jules PRs target `develop` only, never `main` (by convention — repo currently has no branch protection to enforce this technically); Jules gets no collaborator/merge grant beyond what its OAuth PR-creation flow requires, human review/merge remains the practice; start on Jules Free tier, escalate to Pro only after demonstrated value; actual account connection is a separate, explicitly human-approved step (Phase 3 runbook, not automated here).
   - Alternatives considered: Approach A (sandbox-only repo) — rejected, too slow to validate (5 tasks/month, doesn't exercise the real monorepo/Postgres shape); Approach C (wait for enterprise controls) — rejected, no Google timeline, blocks the stated need indefinitely.
   - Consequences — Positive: bounded scope via a manual, human-initiated workflow (nothing runs unattended-from-GitHub); a paper trail via decision doc + label. Tradeoffs (be explicit, per red-team): (a) branch protection is unavailable on this repo's current GitHub plan (403, upgrade-required) — "no merge rights" is a **convention**, enforced only by the human being the sole collaborator today, not by GitHub; (b) `develop`-target PRs only get lint+typecheck from Jenkins (`Jenkinsfile:36-41` gates integration tests to `main`-only) — reviewers must not assume integration coverage exists pre-merge; (c) all 15 prior PRs in this repo's history targeted `main`, none targeted `develop` — reviewing PRs into `develop` is a **new habit**, not an existing one, call this out in the runbook; (d) personal Google account still gets OAuth read/write to the repo, no org-level revocation control exists on Google's side (only GitHub-side: revoke the OAuth grant / GitHub App install).
   - Follow-up: (i) if Jules proves valuable, revisit whether GitHub Pro/Team (to enable real branch protection) is worth paying for before removing the "human is sole collaborator" informal guardrail; (ii) revisit whether the deferred Jenkinsfile PR-level integration-test stage should be added; (iii) **[finding #10]** confirm whether Jules's GitHub App/OAuth identity shows as a distinct author on commits/PRs (likely yes, standard GitHub App behavior) — if not, add a commit trailer convention for auditability.
5. Add the "Async agents (Jules)" subsection to `AGENTS.md`, near "Branch workflow (bắt buộc)": state the guardrails honestly (label = manual convention, develop-only = convention not enforced, no branch protection available on this plan), link to the decision doc. In the same edit, fix the stale "Jenkins not yet built" sentence.
6. `.\scripts\bin\harness-cli.exe decision add` for this decision (check `decision add --help` for flags first).
7. `mcp__gitnexus__detect_changes({scope: "staged"})` to confirm scope (expect: 1 new decision doc, 1 new runbook doc stub, 1 AGENTS.md edit, no code files).

## Success Criteria

- [ ] GitHub label `jules-ok` exists on the repo (verify: `gh label list --json name --jq '.[].name' | grep -Fx jules-ok`).
- [ ] `docs/decisions/00NN-google-jules-guardrailed-integration.md` exists, status `Accepted`, and explicitly states the branch-protection-unavailable and label-is-manual caveats (not silently omitted).
- [ ] `AGENTS.md` documents the guardrails honestly (no overstated "enforced" language) and the stale Jenkins sentence is fixed.
- [ ] Harness decision row recorded.

## Risk Assessment

Low risk for the documentation work itself — additive, reversible by deleting
the label or editing the docs. The **residual product risk is now written down
instead of hidden**: without branch protection, nothing on GitHub's side stops
a write-scoped OAuth grant from merging its own PR; the actual safety today is
"this repo has exactly one collaborator and Jules's own product doesn't
auto-merge by design." If either of those two facts changes (a second
collaborator is added, or Jules ships an auto-merge-on-green feature), this
decision doc's assumptions need to be revisited before continuing to rely on
it.
