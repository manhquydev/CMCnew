---
title: "Plan A — UX correctness quick-fixes"
description: "Three small, independent, real-behavior UX-correctness fixes: class-status dropdown state, shift-reg dead-click affordance, raw date input normalization."
status: implemented
priority: P3
lane: normal
effort: 2h
branch: feat/phase-d-facility-picker-and-stitch-wireframes
tags: [ux, correctness, admin, quick-fix, mantine]
created: 2026-07-04
sourceReports:
  - plans/reports/brainstorm-260704-1034-four-plan-decomposition-ux-auth-nav-report.md
  - plans/260704-1034-ux-correctness-quickfixes/reports/planner-260704-1040-plan-a-scout-verification-report.md
---

## Overview

Corrective UX-correctness pass fixing three confirmed, independent defects surfaced by the
4-plan decomposition brainstorm (`brainstorm-260704-1034-...`). All three are presentation /
interaction-correctness bugs — **no business logic, no API, no schema change**. Each fix is
verified live (not just typecheck-clean) before commit.

This is the first of four plans (A→B→C→D, ascending risk). Plan A is independent of B/C/D.

**Scope boundary vs Plan B (date/time picker rollout):** Fix 3 normalizes the raw HTML
`<input type="date">` in `shift-reg-detail-panel.tsx` to Mantine `DateInput`. Because this is a
raw-HTML correctness defect (not merely a manual-typing picker upgrade), **this file is owned by
Plan A and MUST be excluded from Plan B's scope** to prevent double-ownership / merge conflict.

## Phase

| # | Phase | Owns (files) | Status | File |
|---|---|---|---|---|
| 1 | UX correctness fixes (all 3) | `apps/admin/src/class-workspace.tsx`, `apps/admin/src/shift-reg-list-panel.tsx`, `apps/admin/src/shift-reg-detail-panel.tsx` | pending | [phase-01-ux-correctness-fixes.md](phase-01-ux-correctness-fixes.md) |

Single phase (YAGNI): three tiny edits in three non-overlapping files. Commit atomically per fix
inside the phase (3 `fix(ui): …` commits) so each is independently revertible.

## Dependencies

- No external blockers. Independent of Plans B/C/D.
- **Decision D1 (Fix 1) MUST be resolved before implementing Fix 1** — see phase file. Fixes 2 & 3
  have no open decision and can proceed regardless.

## Acceptance criteria (whole plan)

- **Fix 1:** the status control shows its placeholder (action-picker) for all states incl.
  `planned`; picking a transition fires `classBatch.setStatus` and the control resets to placeholder;
  the `StatusBadge` remains the single source of truth for current status. No regression in the
  terminal-state meeting-cancel behavior (`class-close-cancels-future-meetings.int.test.ts` stays green).
- **Fix 2:** the "Thao tác" cell no longer shows a `cursor:pointer` on dead whitespace; action
  buttons still work; clicking a data cell still selects the row.
- **Fix 3:** "Từ ngày"/"Đến ngày" render a Mantine `DateInput` (`valueFormat="DD/MM/YYYY"`,
  consistent with the rest of the app); creating a phiếu still works; the `from > to` disabled guard
  still holds.
- `pnpm -w typecheck` clean; `@cmc/admin` test suite green; ESLint clean.
- `code-reviewer` subagent pass; diffs are correctness-only (no business-logic / API / schema symbol
  touched — verify with `gitnexus_detect_changes`).
- `gitnexus_detect_changes` before each commit shows only the expected file(s).

## Risks (whole plan)

| Risk | L×I | Mitigation |
|---|---|---|
| Fix 1 naive `value={batch.status}` renders blank for `planned` batches | High×Med | Resolve Decision D1 first; both recommended options avoid the blank state. |
| Fix 1 accidentally widens allowed transitions (offers `planned`/bypasses reopen reason) | Med×Med | Keep `data` to operational forward states; do NOT add `planned` to the picker (reopen owns cancelled→planned). |
| Fix 3 breaks the string `from > to` disabled guard by switching state to `Date` | Med×Med | Keep state as `YYYY-MM-DD` string; convert only at the `DateInput` boundary. |
| Any fix silently alters a handler / mutation | Low×High | code-reviewer + `gitnexus_detect_changes` correctness-only diff check per commit. |

## Harness loop (per fix, matching the re-skin plan convention)

implement → `code-reviewer` → `gitnexus_detect_changes` (scope check) → live-verify via Playwright
on the running stack → commit. Record intake row (normal lane) before implementation.

## Non-goals

- No date/time picker rollout beyond the single raw-HTML file (that is Plan B).
- No status-transition state-machine / validation change on the backend.
- No change to `classBatch.setStatus` / `reopen` / `cancel` semantics.
