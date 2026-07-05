---
title: Decision defense layer - index + hard rule enforcement
description: >-
  Grep-able index of accepted business decisions + mandatory pre-edit lookup
  rule in AGENTS.md/CLAUDE.md, closing the gap that let the shift-registration
  ticket-lock rule ship incomplete with no written source of truth.
status: completed
priority: P1
branch: develop
tags:
  - harness
  - decisions
  - governance
  - docs
blockedBy: []
blocks: []
created: '2026-07-04T16:13:37.319Z'
createdBy: 'ck:plan'
source: skill
---

# Decision defense layer - index + hard rule enforcement

## Overview

Root cause (verified via git history + old plan docs, see brainstorm report): the "1 phiếu xuyên suốt" shift-registration rule was never written as a decision — it shipped incomplete from the first commit and had no durable text to compare against. The harness already has a decision mechanism (`docs/decisions/` + `harness-cli decision add`) but nothing forces an agent to consult it before touching a governed file, and it's advisory-only (flagged by the harness itself in a 2026-06-25 audit intervention).

This plan closes that gap WITHOUT building a parallel system:
1. Seed `docs/DECISION_INDEX.md` — a flat, grep-able table mapping code areas to their governing decision doc (pointer only, no content duplication).
2. Add a hard, non-optional rule to `AGENTS.md`/`CLAUDE.md` (always-loaded) forcing lookup + restatement before editing a governed file.
3. Retrofit `docs/decisions/0035-shift-registration-ticket-lock.md` for the rule that was missing, making it the first properly-governed entry.

Source: `plans/reports/brainstorm-260704-2259-decision-defense-layer-and-lost-logic-audit-report.md`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Decision index seed](./phase-01-decision-index-seed.md) | Completed |
| 2 | [AGENTS/CLAUDE hard rule](./phase-02-agents-claude-hard-rule.md) | Completed |
| 3 | [Retrofit ticket-lock decision](./phase-03-retrofit-ticket-lock-decision.md) | Completed |

**Real execution order (dependencies, not phase numbers): 3 → 1 → 2.** Phase 3 creates decision 0035 first so Phase 1's index seed can include it as day-one entry #1; Phase 2's hard rule references the index file Phase 1 produces.

## Acceptance Criteria (toàn plan)

- [ ] `docs/DECISION_INDEX.md` exists, lists every `Accepted` decision with a clear code mapping (infra/process-only decisions explicitly marked "N/A — infra", not silently dropped).
- [ ] `AGENTS.md` and `CLAUDE.md` both carry the hard-rule addition; existing `@AGENTS.md` / `@docs/FEATURE_INTAKE.md` imports in CLAUDE.md remain intact and unbroken.
- [ ] `docs/decisions/0035-shift-registration-ticket-lock.md` exists, `Accepted`, registered via `harness-cli decision add`, referenced in the index.
- [ ] No content duplicated between index and decision docs (index = pointer only).
- [ ] Index update rule stated explicitly in a header comment: only add/change rows when a new decision doc is created or an existing one is superseded — never speculatively.

## Dependencies

- No blocking cross-plan relationship (scanned `plans/*/plan.md` for AGENTS.md/CLAUDE.md/decisions touches — all pre-existing plans reference `docs/decisions/` only in the generic "record a decision" convention, none restructure the index/hard-rule mechanism itself).
- **Hard gate: this plan edits always-loaded context files (`AGENTS.md`, `CLAUDE.md`).** Red-team is MANDATORY, not optional, before implementation — a broken `@import` line or malformed frontmatter breaks every future session.

## Incidental finding (flag, do not silently fix)

Two decision files both claim number **0032**: `0032-dev-prod-cicd-environment-split.md` and `0032-record-detail-primitive-reactive-extension.md`. This is itself evidence of the same underlying problem (no enforced registry checked before assigning a number). Phase 1 must surface this in the index (both rows, footnote explaining the collision) and file a `harness-cli backlog add` — do NOT renumber existing files (renumbering is a destructive rewrite of history/links, out of scope here, needs separate human-approved cleanup).
