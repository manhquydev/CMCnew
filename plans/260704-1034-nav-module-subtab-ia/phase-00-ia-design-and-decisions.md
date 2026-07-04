# Phase 0 — IA design + decisions gate

Status: pending
Owns (files): `design/ia-module-subtab-map.md` (authored), this plan folder. No source code.

## Purpose

The whole plan hinges on two architecture decisions. This phase produces the IA design doc
(done — `design/ia-module-subtab-map.md`) and drives it through user/red-team sign-off before
any code. No Phase 1 work starts until both decisions are locked.

## Deliverables

- [x] Module → sub-tab map for all 8 groups (design doc §2), verified against
  `shell.tsx:625-714`.
- [x] URL scheme options + backward-compat strategy (design doc §3).
- [x] Role-gating mapping per-leaf → per-subtab (design doc §4).
- [x] Default/empty/active-state rules (design doc §5).
- [x] Component architecture + Mantine controlled-Tabs gotcha (design doc §6).
- [x] Switch-vs-registry analysis (design doc §7).
- [x] **GATE:** user/red-team sign-off on open decision #1 (URL scheme) and #2 (switch vs
  registry). Record the chosen answers here before Phase 1.

## Requirements to resolve at the gate

1. **URL scheme** — confirm Option C (keep flat `/{sectionKey}`, derive module) or Option A
   (two-segment path + redirect layer). This changes Phase 1 scope materially.
2. **Switch vs registry** — confirm hybrid (nav-only registry) or full render registry.

## Validation

- Design doc self-consistent; every file:line citation re-verified against current code.
- Red-team review of the design doc (adversarial: does Option C actually leave every
  deep-link intact? enumerate all deep-link surfaces and confirm none encodes the module).

## Risks / rollback

- Risk: signing off Option A without budgeting the redirect layer → Phase 1 underscoped.
  Mitigation: the gate explicitly records the chosen scheme AND the resulting Phase 1 scope
  delta (design doc §8).
- Rollback: none — no code written this phase.

## Decision record (fill at gate)

- Decision #1 (URL scheme): **Option C** (keep flat `/{sectionKey}`, derive module) — locked in.
- Decision #2 (switch vs registry): **hybrid** (nav-only registry derived from `buildNavGroups`,
  keep the `renderContent` switch) — locked in.
- Signed off by: adversarial red-team pass (code-reviewer subagent, 2026-07-04) — verified all
  10 §1 code citations, all 8 §2 module-map rows, an independent deep-link-surface sweep beyond
  the doc's own citations (emails, nginx, other apps, `window.open`/`<a href>` calls — none
  encode a module segment), the §4 `hr`-role landing quirk, and the §7 switch-closures claim.
  Verdict: **Option C is safe to lock in as designed.** Two cosmetic doc-accuracy defects found
  (§1/§4 mischaracterized which of the 4 nav test files uses `keysOf()`; §7's `hr` facilityId
  parenthetical was wrong) — both fixed in the design doc; neither affected the recommendation.
  Date: 2026-07-04.
