---
title: "Google Jules Async-Agent Integration (Guardrailed)"
description: "Prep the repo for Google Jules (async coding agent) under Approach B: guardrailed develop-branch, label-gated, no merge rights. Delete dead GitHub Actions signal, document governance, hand off the manual account-connection step."
status: pending
priority: P2
branch: "develop"
tags: ["ci-cd", "external-systems", "high-risk"]
blockedBy: []
blocks: []
created: "2026-07-02T00:31:11.708Z"
createdBy: "ck:plan"
source: skill
---

# Google Jules Async-Agent Integration (Guardrailed)

Lane: **high-risk** (docs/FEATURE_INTAKE.md hard gate — "External systems": granting
a new external cloud service read/write access to the repo).
Brainstorm source: `plans/reports/brainstorm-260702-0024-google-jules-async-agent-integration-report.md`.

## Overview

CMCnew wants an async coding agent (Google Jules) to auto-fix small/repetitive
bugs while the operator is away. Jules is cloud-only, GitHub-OAuth-only, tied to
a personal Google account (no org controls published), and reads PR check
status to decide whether its own fix worked. This repo currently shows **two**
CI signals on every PR: a real one (Jenkins, `continuous-integration/jenkins/branch`,
verified live via `gh pr list --json statusCheckRollup` on PR #11-#15) and a
permanently-broken one (GitHub Actions `CI / build`, billing-blocked, dies at
~3s, always FAILURE). This plan does the **prep work only** — it does not
connect a live Jules account (that step needs a human OAuth login and is left
as a documented runbook step). Goal: when the operator does connect Jules, it
lands in a repo that (a) has no false-red noise to loop on, (b) only sees
work the human manually hands it via an opt-in label (not an automatic
trigger — see Red Team Review), (c) is documented to target `develop` only,
never `main`, by convention (this repo's GitHub plan has no branch protection
to enforce that technically — see Red Team Review), and (d) has a written
decision record, including the honest limits of (b) and (c), for whoever
reviews this later.

## Non-Goals (this round)

- Registering/connecting an actual Jules account or Google OAuth grant (manual, human-only step — documented in Phase 3 runbook, not executed here).
- Adding a PR-level integration-test stage to `Jenkinsfile` for `develop` branch (deferred per Scope Challenge — HOLD SCOPE selected. Compensating control is manual reviewer diligence + this repo having exactly one collaborator today, **not** a strict merge-rights technical wall — see Red Team Review, finding #1).
- Upgrading the GitHub plan to enable branch protection (a cost decision left to the user, noted as a follow-up in the Phase 2 decision doc, not executed here).
- Any change to `main`-branch deploy behavior (`Jenkinsfile` `when { branch 'main' }` stages are untouched).

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Cleanup Dead CI Signal](./phase-01-cleanup-dead-ci-signal.md) | Pending |
| 2 | [Guardrails and Governance Docs](./phase-02-guardrails-and-governance-docs.md) | Pending |
| 3 | [Validation and Handoff](./phase-03-validation-and-handoff.md) | Pending |

## Acceptance Criteria

- `.github/workflows/ci.yml` removed; no PR shows the permanently-broken `CI / build` check anymore.
- A decision doc explains why Actions was removed and that Jenkins is the sole authoritative CI signal.
- `AGENTS.md` documents the Jules guardrails **honestly**: `jules-ok` is a manual/human-triggered scoping label (not an automatic trigger); `develop`-only PRs and "no merge rights" are documented as conventions, not GitHub-enforced controls (branch protection is unavailable on this repo's plan — confirmed via live `gh api` 403); personal-account governance caveat stated.
- A decision doc records the Jules governance choice (Approach B) **and** the two Critical red-team findings (branch protection unavailable, label is manual not automatic) so future agents/humans don't reopen this debate without new evidence, and don't mistake conventions for enforced controls.
- `gitnexus_detect_changes` and harness `intake`/`decision` records exist for this work (durable proof per project harness convention).
- Nothing in this plan enables Jules to actually run yet — that is an explicit, separately-approved manual step, gated on the human reading and accepting the residual-risk note in the runbook.

## Dependencies

- Builds on `plans/260630-0919-cicd-observability/` (status: completed 2026-07-02) — that plan made Jenkins the real, externally-verifiable CI signal this plan relies on.
- No other open plan touches `.github/workflows/`, `AGENTS.md`, or `docs/decisions/` at time of writing (checked via directory scan of `plans/*/plan.md`); decision doc numbers must still be re-confirmed at execution time per finding #3 (numbering is racy — `0021` was uncommitted when checked).

## Red Team Review

### Session — 2026-07-02
**Findings:** 10 consolidated (after dedup across 3 reviewers) — 2 Critical, 3 High, 5 Medium.
**Reviewers:** Security Adversary (Fact Checker role), Assumption Destroyer (Contract Verifier role), Failure Mode Analyst (Fact Checker role). All findings evidence-backed (live `gh api`/`gh pr list` calls or file:line grep citations); all passed the evidence filter.

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | "No merge rights" is not GitHub-enforced — branch protection returns 403 (upgrade-required) on this repo's plan; no CODEOWNERS | Critical | Accept | Phase 2 (rewritten), plan Overview/Non-Goals/Acceptance Criteria |
| 2 | `jules-ok` label has no confirmed automatic trigger — Jules's real triggers don't include label-watching, and GH Actions (the one path that could wire it) is billing-blocked | Critical | Accept | Phase 2 (rewritten — label reframed as manual convention), Phase 3 runbook |
| 3 | Decision-doc numbering (0022/0023) is racy — `0021` confirmed uncommitted via `git status` at planning time | High | Accept | Phase 1 step 1b, Phase 2 step 3, all doc filenames changed to `00NN` placeholders |
| 4 | `AGENTS.md` has a stale "Jenkins not yet built" sentence contradicting this plan's own premise | High | Accept | Phase 2 Related Code Files + Implementation Steps |
| 5 | All 15 historical PRs target `main`; none target `develop` — "develop-only" has no review-habit precedent | High | Accept | Phase 3 (runbook + PR-opening step both flag this as a new habit) |
| 6 | Phase 1 risk assessment falsely cited `docs/TOOL_REGISTRY.md` as referencing Jenkins (zero matches on grep) | Medium | Accept | Phase 1 Risk Assessment corrected |
| 7 | No compensating reviewer guidance for `develop`-target PRs lacking integration-test coverage | Medium | Accept | Phase 3 runbook step (review as if no safety net exists) |
| 8 | No ACL on who can apply `jules-ok` label (low real risk — repo has exactly 1 collaborator, confirmed via API) | Medium | Accept (light) | Phase 2 step 2 + decision doc follow-up note |
| 9 | Runbook had no abort criterion if OAuth doesn't offer per-repo scoping | Medium | Accept | Phase 3 runbook step (explicit abort instruction added) |
| 10 | No requirement to keep Jules-authored commits/PRs identifiable for audit | Medium | Accept (light) | Phase 2 decision doc follow-up + Phase 3 runbook check |

**Not treated as a plan defect:** the "unassign if it loops" human-vigilance dependency (Failure Mode Analyst, Critical framing) is documented as an accepted tradeoff rather than "fixed" — mitigated by starting on Jules Free tier, where the worst case (a runaway loop burning the monthly quota) is bounded at 5 tasks, not a runaway cost or access incident. See Phase 3 Risk Assessment.

**Operational note (not a plan finding):** a red-team reviewer's live testing of `harness-cli.exe intake --help` syntax created a stray `Intake #52` ("test dry run") row in the local harness DB. No undo/delete subcommand exists; harmless, safe to ignore, does not affect git state or this plan.

### Whole-Plan Consistency Sweep
- Files reread: `plan.md`, `phase-01-cleanup-dead-ci-signal.md`, `phase-02-guardrails-and-governance-docs.md`, `phase-03-validation-and-handoff.md`.
- Decision deltas checked: 10 (all findings above).
- Reconciled stale references: decision-doc filenames `0022`/`0023` → `00NN` across all 3 phase files and plan.md Dependencies section; "3 independent guardrails" language removed from plan.md Overview and Phase 2; Phase 1's false `TOOL_REGISTRY.md` claim corrected; Phase 3's harness-intake `--docs` list updated to `00NN` placeholders.
- Unresolved contradictions: 0.
