---
phase: 1
title: "Cleanup Dead CI Signal"
status: pending
priority: P1
dependencies: []
---

# Phase 1: Cleanup Dead CI Signal

## Overview

Remove `.github/workflows/ci.yml` (GitHub Actions) because it is permanently
broken (billing-blocked, fails at ~3s) and provides zero real signal — it only
adds a false-red check alongside the real Jenkins one on every PR. This is
valuable independent of Jules (cleaner PR UI for humans too), and it removes
the specific risk that an async agent reading "all checks green" will loop
forever trying to fix an unfixable infra check.

## Requirements

- Functional: delete the dead workflow file; record why via a decision doc.
- Non-functional: the real Jenkins signal (`continuous-integration/jenkins/branch`) must be completely untouched by this change.

## Architecture

No code architecture change — this is CI configuration removal + documentation.
Verify via `gh pr list --json statusCheckRollup` on the next real PR (Phase 3)
that only Jenkins + third-party bot checks remain.

## Related Code Files

- Delete: `.github/workflows/ci.yml`
- Create: `docs/decisions/00NN-remove-dead-github-actions-ci.md` (NN confirmed at execution time — see step 1b; use `docs/templates/decision.md`)

## Implementation Steps

1. Read `.github/workflows/ci.yml` to confirm current content (reference-only pipeline per memory `cmcnew-cicd-jenkins-decision`; safe to delete since Jenkins already supersedes it).
1b. **[Red-team finding #3, Critical/High evidence]** Before writing the decision doc, re-scan `docs/decisions/` for the actual latest number **at execution time**, not from this plan's planning-time snapshot (0021 was the latest when this plan was written, but confirmed via `git status` to still be uncommitted at that time — numbering is racy in this repo; don't trust a stale count).
2. Write `docs/decisions/00NN-remove-dead-github-actions-ci.md` (NN = the number confirmed in step 1b):
   - Context: GitHub Actions billing blocked since 2026-06-24; Jenkins has posted real status since 2026-06-30 (see decision 0019, 0021 precedent format); Actions check is now pure noise on every PR, verified via `gh pr list --json statusCheckRollup`.
   - Decision: delete `.github/workflows/ci.yml`; Jenkins (`continuous-integration/jenkins/branch`) is the sole authoritative CI signal until GitHub Actions billing is resolved (if ever).
   - Alternatives considered: (a) leave it and ignore the red check — rejected, actively risks confusing any status-reading agent (Jules or otherwise) and humans; (b) fix Actions billing — rejected, out of scope/owner already decided against it (memory `cmcnew-cicd-jenkins-decision`, 2026-06-24).
   - Follow-up: if Actions billing is ever resolved, re-add a workflow file as a *second* real signal, not blindly restore this one (it was written before the Prisma/monorepo pipeline matured).
3. Delete `.github/workflows/ci.yml`.
4. `.\scripts\bin\harness-cli.exe decision add` to record the durable decision row (check `decision add --help` for exact flags before running; mirror the doc's title/date).
5. Run `mcp__gitnexus__detect_changes({scope: "staged"})` before commit to confirm only expected files changed (should be: 1 deletion, 1 new decision doc).

## Success Criteria

- [ ] `.github/workflows/ci.yml` no longer exists in the repo.
- [ ] `docs/decisions/00NN-remove-dead-github-actions-ci.md` exists, follows the template, status `Accepted`.
- [ ] Harness decision row recorded (`harness-cli decision add` succeeds).
- [ ] `gitnexus_detect_changes` shows only the expected 2-file diff for this phase.

## Risk Assessment

Near-zero risk: Actions was already non-functional and blocked no merges (Jenkins
and human review are the real gates). The only failure mode is if some external
tool/dashboard still depends on the Actions workflow existing.

**[Red-team finding #6, corrected]** `docs/CK_WORKFLOW.md` documents Jenkins as
the CI provider (Tier 3 gate reasoning references "a green CI"); `docs/TOOL_REGISTRY.md`
does **not** mention Jenkins or Actions at all (verified via grep — zero matches)
and is not relevant evidence here. No external doc/dashboard depends on the
Actions workflow file's existence.
