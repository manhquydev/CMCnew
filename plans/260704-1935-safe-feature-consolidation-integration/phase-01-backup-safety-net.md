---
phase: 1
title: "Backup safety net"
status: pending
priority: P1
dependencies: []
---

# Phase 1: Backup safety net

## Overview

Create immutable references for every branch involved BEFORE any merge, so nothing implemented can
be lost and any later step is revertible with one command.

## Requirements
- Functional: tag current tips of develop, main, and all 5 feature branches; record prod/dev health baselines.
- Non-functional: tags pushed to origin (survive local loss); zero mutation of any branch.

## Related Code Files
- Create: git tags only (no source files). Optionally a short evidence note under this plan dir.

## Implementation Steps
1. `git fetch origin --prune` to ensure local refs are current.
2. Create annotated backup tags at each tip:
   - `backup/develop-preintegration` → origin/develop
   - `backup/main-preintegration` → origin/main
   - `backup/phase-d-preintegration` → origin/feat/phase-d-facility-picker-and-stitch-wireframes
   - `backup/plan-a-preintegration`, `-b-`, `-c-`, `-d-` → the 4 plan branches
3. `git push origin --tags` (push all backup tags to origin).
4. Record baselines to an evidence file: prod `erp`/`hoc` `/api/health` commit (`84ff0d22`),
   dev `deverp`/`devlms` commit, `git rev-parse` of each tag.
5. Confirm each feature branch/PR (#27–31) is still OPEN and untouched.

## Success Criteria
- [ ] 7 `backup/*-preintegration` tags exist locally AND on origin.
- [ ] Each tag resolves to the expected current tip SHA.
- [ ] Baseline health (prod + dev) recorded with commit markers + timestamp.
- [ ] No branch was modified; all 5 PRs still OPEN.

## Risk Assessment
- Risk: tag name collision with an existing tag. Mitigation: list tags first; use the
  `-preintegration` suffix; fail loud if a tag exists rather than overwriting.
- Risk: forgetting to push tags (local-only backup lost on machine failure). Mitigation: verify
  `git ls-remote --tags origin | grep preintegration` shows all 7.
