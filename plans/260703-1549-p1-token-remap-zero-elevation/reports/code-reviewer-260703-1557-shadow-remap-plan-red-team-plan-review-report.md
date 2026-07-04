---
title: "Red-team review — P1 Zero Elevation shadow token remap plan"
status: done
---

## Scope
Reviewed `plan.md` + `phase-01-shadow-token-remap.md` against the source research report and re-derived every quantitative claim from actual code (`packages/ui/src/theme.ts`, `packages/ui/src/tokens.css`, `packages/ui/src/components.tsx`, `packages/ui/vitest.config.ts`, `apps/lms/src/showcase-view.tsx`, `apps/lms/src/student-shell.tsx`, `apps/admin/src/design-showcase.tsx`, `docs/design-system.md`).

## 1. "7 components, ~12 edit locations, LOW blast radius" — WRONG (undercounted)

The 7-component/theme.ts line numbers are individually **CONFIRMED accurate** (Card:137, Paper:148, Select dropdown boxShadow:198, Modal boxShadow:284, Drawer boxShadow:312, Notification boxShadow:361, Menu boxShadow:382 — all match current `packages/ui/src/theme.ts` exactly).

But the research's "no component explicitly passes `shadow=`" claim and the "1 file / 1 stray shadow" instance count are both **WRONG**:

- `apps/admin/src/design-showcase.tsx:558` — `<Menu shadow="lg" radius="md">` is an explicit prop override, directly contradicting "Component code does NOT explicitly pass `shadow=` prop." This uses Mantine's native `shadow` prop → `theme.shadows.lg` (the `shadows: {xs..xl}` object at `theme.ts:109-115`), a **third, separate duplicated source of shadow values** the plan never mentions touching. If Phase 1 only edits the 7 named `defaultProps`/`styles` overrides and leaves `shadows:{...}` untouched, this Menu instance (and any other future `shadow="..."` prop usage) keeps rendering the OLD heavy shadow — Zero Elevation doctrine applied inconsistently.
- `apps/admin/src/design-showcase.tsx:733-748` — a live "Shadow Scale" demo grid that binds directly to `var(--cmc-shadow-xs..xl)` CSS custom properties from `tokens.css`. Plan.md's title/description promises to edit "docs/design-system.md + tokens.css," but the phase file's Implementation steps (1-6) **never edit `tokens.css`** — only `theme.ts` and `design-system.md`. This is a real inconsistency between plan.md scope and phase-01's actual steps; if `tokens.css` isn't touched, `design-showcase.tsx`'s own live demo will silently disagree with the new theme.ts values.
- `apps/lms/src/showcase-view.tsx` has **9 inline `boxShadow`/`drop-shadow` instances** (lines 39, 159, 531, 554, 606, 632, 659, 685, 743, 872), not "1 stray inline shadow." Only line 554 (cloud step circle) matches what research/plan describe. The other 8 are neumorphic/skeuomorphic effects for a gamification "climb" feature (crowns, badges, leaderboard rows) — plausibly decorative but stylistically distinct from ERP-core "Zero Elevation," and the plan gives no instruction on them. Following step 5 literally ("fix the 1 stray inline shadow... likely decorative") would flatten one shadow and leave 8 visually similar neighbors untouched in the same file — an inconsistent partial fix with no stated rationale.
- `apps/lms/src/student-shell.tsx:148` — another explicit inline `boxShadow` the research report missed entirely (file not listed at all in its file-count of 79 scanned files' shadow usage).

**Suggested plan edits**:
- Correct the blast-radius count in `plan.md`/`phase-01` from "~12" to reflect the real total (7 theme.ts + 1 shadows-scale object + 1 explicit Menu prop + 9 showcase-view.tsx instances + 1 student-shell.tsx instance ≈ 19+, of which the gamification-styling ones may be explicitly scoped OUT).
- Add `theme.ts`'s `shadows: {xs..xl}` object (lines 109-115) as an explicit 8th edit location, or explicitly state it's staying as-is and justify why that doesn't create doctrine drift.
- Add `packages/ui/src/tokens.css` as an explicit edit target in phase-01's Implementation steps (currently promised in plan.md but absent from the phase file's actual steps).
- Explicitly scope showcase-view.tsx's climb/gamification shadows (8 of 9) as **out of scope** with a one-line rationale (different sub-brand/skeuomorphic language), or bring them in scope deliberately — don't leave it implicit.

## 2. showcase-view.tsx stray shadow "genuinely decorative" — INCOMPLETE

Line 554 (`boxShadow: '0 4px 8px rgba(0,0,0,0.05)'`) is on a "cloud step circle" per the plan's own description and is indeed decorative (no interactive/functional signal). CONFIRMED for that single instance. But this check is incomplete in context: the plan frames it as "the" stray shadow in that file when 8 more exist in the same component (see #1). The plan's claim is technically true for line 554 alone, misleading as a description of the file.

## 3. TDD feasibility — INCOMPLETE / plan gap

`packages/ui/vitest.config.ts`:
```
test: { include: ['src/**/*.test.ts'], environment: 'node' }
```
No `jsdom`/`happy-dom`, no `@testing-library/react` in `packages/ui/package.json` devDependencies (only `vitest`). The only existing test file is `packages/ui/src/data-table-utils.test.ts` — a pure-logic test, not a component-render test. Test include glob is `*.test.ts` only, **not `.tsx`** — a literal render-test file wouldn't even be picked up without also editing `vitest.config.ts`.

The phase file's step 1 ("write a test... Vitest + Testing Library or a Storybook/snapshot if that pattern exists") gestures at component-render testing infra that **does not exist** in this package. Setting it up (jsdom + Testing Library + config changes) would be meaningful scope creep beyond a 3-hour P1 token-remap task and violates this repo's YAGNI/KISS rule.

There is a cheap, genuinely feasible alternative the phase file doesn't mention: `theme.components.Card.defaultProps.shadow` etc. are plain object values on an exported JS object (`theme` from `theme.ts`) — a plain `.test.ts` assertion (`expect(theme.components?.Card?.defaultProps?.shadow).toBe('sm')`, and string equality checks on the hardcoded `boxShadow` strings in `styles.*`) is trivially testable with **zero new infra**, fits the existing `src/**/*.test.ts` + `node` environment, and matches the existing `data-table-utils.test.ts` pattern.

**Suggested plan edit**: Rewrite phase-01 step 1 to specify a plain object/string-assertion test against the exported `theme` config (not component rendering), removing the "Testing Library or Storybook" language entirely — it's not available and not needed for this change.

## 4. Interaction with already-shipped Modal-ization (commit 2bb1ad5, "fix(ux): resolve 18 persona-QA findings + modal-ize 7 create-forms")

Spot-checked `apps/admin/src/crm-panel.tsx` — its `<Modal opened={opened} onClose={close} title="Tạo cơ hội" radius="xl" centered>` (line 312) uses the standard Mantine `Modal` with no explicit `shadow`/`boxShadow` override, meaning it inherits `theme.ts`'s `Modal.styles.content.boxShadow` (line 284) automatically. **CONFIRMED — no regression risk.** The newly Modal-ized panels are exactly the kind of centralized-theme leverage the plan intends; they'll pick up the new doctrine for free once theme.ts changes. No conflict to report, but worth noting as a positive: this shipped work is why the theme-only approach's leverage claim is directionally correct even though the total edit count was undercounted.

## 5. Unresolved Question #1 blocking — CONFIRMED

Phase-01 step 2 reads literally: *"Get explicit user confirmation on Unresolved Question #1 from `plan.md`... before editing — do not guess."* This is placed before step 3 (the actual theme.ts edit) in the Implementation steps sequence, and the Todo list also lists "Confirm functional-vs-decorative split with user" as a separate checkbox before "Edit theme.ts (7 components)." Correctly gated, not merely noted-and-proceeded.

## 6. Acceptance criteria completeness — INCOMPLETE

- Phase-01's own **Success criteria** section (not plan.md's Acceptance criteria) does include "No visual regression on floating UI (dropdowns/modals still visually separate from page content)" — the plan's stated #1 risk is covered, but only at the phase-file level.
- `plan.md`'s top-level **Acceptance criteria** list is vaguer: "visual smoke-check on Card/Modal/Menu/Select in running admin app" doesn't explicitly restate the floating-UI-distinguishability requirement, so a reader of plan.md alone (without opening phase-01) could sign off without checking it explicitly.
- The source research report's Unresolved Question #2 ("Will removing Modal shadow hurt accessibility? … low-vision users who rely on contrast to see modal edge") is **dropped entirely** — it doesn't appear anywhere in plan.md's or phase-01's Unresolved Questions, Risk assessment, or Acceptance/Success criteria. Given the plan's own Risk assessment already flags border/backdrop compensation as the mitigation for Menu/Select/Drawer, the accessibility angle for Modal specifically should either be folded into that same mitigation note or explicitly declared out-of-scope with rationale — right now it's silently omitted.
- No acceptance criterion addresses the `tokens.css` edit promised in plan.md's description (see #1), nor the `theme.ts` `shadows:{...}` scale object / explicit `shadow="lg"` prop precedence question (see #1) — worth a fast manual check (does the hardcoded `styles.dropdown.boxShadow` win over the `shadow` prop's CSS var, or vice versa) before declaring Menu correctly remapped everywhere.

**Suggested plan edit**: Add to plan.md's Acceptance criteria: "Floating UI (Menu/Select dropdown/Modal/Drawer) remains visually distinguishable from page background after remap — verified manually, not just typechecked" and "Modal edge remains distinguishable under reduced-shadow doctrine (border/outline compensation), addressing low-vision contrast concern from source research Unresolved Q2."

## Status: DONE

**Verdict: NEEDS-EDITS** (not blocking on a fresh user decision beyond the one already gated in step 2 — the plan already correctly blocks on Unresolved Question #1). Required edits before implementation:

1. Correct blast-radius count (~12 → ~19+) and explicitly scope showcase-view.tsx's 8 non-cloud-circle shadows in or out.
2. Add `theme.ts`'s `shadows:{xs..xl}` scale object (lines 109-115) as an explicit edit location, or justify leaving it untouched despite `design-showcase.tsx`'s explicit `shadow="lg"` Menu prop depending on it.
3. Add `packages/ui/src/tokens.css` to phase-01's actual Implementation steps (currently only promised in plan.md, missing from the phase file).
4. Add `apps/lms/src/student-shell.tsx:148` as a 3rd file with an inline shadow (research missed it).
5. Rewrite phase-01 step 1's TDD approach to a plain `theme` object/string assertion test (no rendering, no Testing Library/jsdom) — current infra (`packages/ui/vitest.config.ts`: `node` env, `*.test.ts` only, no Testing Library dependency) cannot support the literal "assert current shadow prop value... Testing Library" language as written.
6. Add explicit floating-UI-distinguishability and Modal-accessibility-contrast items to plan.md's Acceptance criteria (currently only in phase-01's Success criteria / dropped from research entirely, respectively).

## Unresolved Questions
- Does Mantine's native `shadow` prop (used explicitly at `design-showcase.tsx:558`) get overridden by theme.ts's hardcoded `styles.dropdown.boxShadow`, or does it win due to CSS var precedence? Needs a quick manual render check — not determinable from static code alone.
- Is `apps/lms/src/showcase-view.tsx`'s gamification/climb feature intended to share the ERP-core "Zero Elevation" doctrine at all, or is it a deliberately distinct visual sub-language? Product/design call, not derivable from code.
