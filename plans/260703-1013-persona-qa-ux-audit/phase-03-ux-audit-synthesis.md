---
phase: 3
title: "UX Audit Synthesis"
status: pending
effort: ""
---

# Phase 3: UX Audit Synthesis

## Overview

Spawn a `ui-ux-designer` subagent to synthesize all 6 persona reports from Phase 2 into one
prioritized master findings report, cross-referenced against `docs/design-system.md` for
consistency violations (per user's explicit example: raw IP shown in `/checkin` UI — already
fixed this session, use as a calibration example of the finding quality expected).

## Implementation Steps

1. Pass all 6 Phase-2 reports + `docs/design-system.md` to the `ui-ux-designer` subagent.
2. Ask it to: dedupe overlapping findings across personas, rank by severity (blocker/major/minor)
   and by how many personas hit the same issue, tag each finding technical vs UI vs UX, and flag
   any design-system violations found independently of what personas reported.
3. Output: one report at `plans/reports/ui-ux-designer-260703-*-persona-qa-master-findings-report.md`
   — this becomes the input for the deferred Phase D (UI rebuild via `/stitch`), not consumed here.

## Success Criteria

- [ ] Master report written, findings deduped and severity-ranked.
- [ ] Every finding traceable to which persona(s) hit it.
- [ ] Report explicitly separates "needs a code fix" vs "needs a design-system/UX redesign
      decision" — the former can go straight into a follow-up action-plan phase like this session's
      Phase A, the latter feeds the deferred Phase D.
