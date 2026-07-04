---
phase: 2
title: "Integrate onto develop"
status: pending
priority: P1
dependencies: [1]
---

# Phase 2: Integrate onto develop

## Overview

Build one integration branch off `develop` that cleanly merges phase-d + Plan A/B/C/D, resolve the
single known docs conflict, and open a PR into `develop`. No prod impact — `develop` only.

## Requirements
- Functional: integration branch = develop + phase-d + A + B + C + D; all feature files present.
- Non-functional: merge (not squash) to preserve authorship/history; every step reversible via Phase 1 tags.

## Architecture
Merge order (validated clean by trial): `develop` (has CI/CD) → phase-d (UI-rebuild base) → A → B → C → D.
Only conflict: `plans/260703-0052-dev-prod-cicd-environments/plan.md` at the D step → resolve by
**union** (keep both the CI/CD plan body and plan-d's red-team-session-2 additions).

## Related Code Files
- Create: branch `integ/feature-consolidation` (from origin/develop).
- Modify (merge result): apps/**, packages/**, plans/** — via merges, not hand edits.
- Resolve: `plans/260703-0052-dev-prod-cicd-environments/plan.md` (union).

## Implementation Steps
1. `git checkout -b integ/feature-consolidation origin/develop`.
2. Merge in order with `--no-ff`: phase-d, plan-a, plan-b, plan-c, plan-d. Expect clean until D.
3. At the plan-d conflict on `plan.md`: resolve by union (both sections), `git add`, continue.
4. **No-loss verification (critical) — CORRECTED (red-team H1):** `git diff` is symmetric, so
   `diff <branch> HEAD` is NON-zero by design (HEAD holds the other siblings' work) — do NOT use it
   as a loss check. Correct proofs:
   - **Inclusion:** `git merge-base --is-ancestor origin/<branch> HEAD` returns 0 for ALL 5 branches
     → every commit of each branch is in HEAD (nothing dropped). This works because Phase 2 uses `--no-ff`.
   - **Deletions-only review:** `git diff <branch> HEAD -- apps packages docker scripts | grep '^-'`
     inspected for feature content missing from HEAD (ignore additions — those are sibling work).
   - **CI/CD-not-reverted (this plan's own work):** the feature branches carry OLD docker/nginx/
     Jenkinsfile (pre-split). Confirm the merge KEPT develop's newer CI/CD, not the branches' old copy:
     grep the integrated tree for dev vhosts in `nginx-prod.conf`, the `Build + Deploy (dev)` stage in
     `Jenkinsfile`, the dev SAN in `ensure-origin-cert.sh`, and `cmcnew-edge` in the prod compose.
   - **Signature features present:** nav rail, datetime pickers (dayjs), student phone login files.
5. Local sanity: `pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm -r lint` (or rely on CI
   in Phase 3 if local toolchain unavailable — state which).
6. Push `integ/feature-consolidation`; open **PR → develop** with summary + the no-loss evidence.
   Do NOT merge yet (merge happens at Phase 3 start under monitoring).

## Success Criteria
- [ ] Integration branch built with only the 1 expected docs conflict, resolved by union.
- [ ] `git merge-base --is-ancestor <branch> HEAD` = 0 for ALL 5 branches (nothing dropped) — recorded.
- [ ] Deletions-only diff review shows no feature content missing from HEAD.
- [ ] CI/CD intact (dev vhosts / dev Jenkins stage / dev SAN / cmcnew-edge all present in HEAD).
- [ ] Signature features present (nav rail / datetime pickers / phone login) by grep.
- [ ] PR to develop open; typecheck/lint pass (local or via the PR's Jenkins build).

## Risk Assessment
- Risk: a merge silently drops a change via mis-resolution. Mitigation: `--is-ancestor` inclusion
  proof + deletions-only review; merge (not squash) keeps commits; Phase 1 tags allow full reset.
- Risk: merge REVERTS this plan's CI/CD (branches carry old docker/nginx/Jenkinsfile). Mitigation:
  verified in a trial-merge that 3-way keeps develop's newer CI/CD; step 4 re-confirms on the real merge.
- Risk (LOW — red-team downgraded): lockfile drift. Only Plan C touches package.json (adds a vitest
  devDep + `test`, +3 lockfile lines); no sibling lockfile conflict → `--frozen-lockfile` should pass.
- Risk: the 1 docs conflict resolved wrong. Mitigation: union keeps both; plan doc, no runtime effect.
