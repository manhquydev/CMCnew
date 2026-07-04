# Phase 1 — Token Foundation: Code Review

## Scope
- Files: `packages/ui/src/tokens.css`, `packages/ui/src/theme.ts`, `packages/ui/src/theme.test.ts`, `packages/ui/package.json`, `apps/admin/package.json`, `apps/admin/src/main.tsx`, `apps/admin/src/design-showcase.tsx`, `docs/design-system.md`, `pnpm-lock.yaml`
- LOC: ~150 net changed (token-value diffs only, no logic)
- Focus: value-correction diff verified against `DESIGN.md` spec + self-reported concerns verified independently

## Value Verification (against `DESIGN.md`)

All five corrected values checked against `DESIGN.md` prose (the authoritative section — the YAML frontmatter's Material-Design `colors:` block is a generic MD3 token dump unrelated to this project's actual palette, e.g. `tertiary: '#006a36'` ≠ `#06C167`; the prose "Colors"/"Shapes"/"Elevation" sections are the real spec source and match what was implemented):

| Value | DESIGN.md spec | Implemented | Match |
|---|---|---|---|
| Font | "Inter exclusively" | `'Inter', -apple-system, ...` in both `tokens.css` and `theme.ts` | ✅ |
| Border | `#E5E7EB` | `--cmc-border: #E5E7EB` | ✅ |
| Success green | `#06C167` | `--cmc-ok`, `--cmc-status-active`, `cmcGreen[5]` all `#06C167` | ✅ |
| Card radius | "No rounded corners should exceed 8px" | `Card`/`Paper` `defaultProps.radius: 'sm'` = 8px per local `radius` scale (`theme.ts:92-98`) | ✅ |
| Button radius | "Buttons/Inputs: Use `rounded` (0.25rem)" = 4px | `Button.defaultProps.radius: 'xs'` = 4px per local scale | ✅ |

Radius SCALE itself (`xs:4/sm:8/md:10/lg:14/xl:18`) is untouched — confirmed only the named-step assignment on Card/Paper/Button changed, per plan constraint.

## Self-Reported Concerns — Verified

**1. LMS visual shift (functional tokens, not branding) — confirmed, but count is off.**
- `--cmc-status-active` usage: exactly 3 sites (`parent-view.tsx` ×2, `student-view.tsx` ×1) — matches claim.
- `--cmc-border` usage: **28 sites** across 8 files, not "~15" as reported (verified via `grep -rno "var(--cmc-border[a-z-]*)" apps/lms/src`, excluding `--cmc-border-faint` which has a separate 6 hits). The undercount doesn't change the substance of the finding — it's still a real, non-branding structural token — but the report's own audit number was materially wrong (~2x). Minor: correct the number if this report is referenced later.
- LMS own typography confirmed untouched: `.lms-app-root { font-family: var(--cmc-font-friendly) !important; }` (`tokens.css:236-238`) is a separate CSS variable from `--cmc-font`, and headings use `--cmc-font-bubble` — neither was touched by this diff. The Inter change genuinely does not leak into LMS. `apps/lms/src/main.tsx` has no `@fontsource/inter` import (confirmed: only `@fontsource-variable/fredoka` / `quicksand`).
- Verdict: **acceptable, as predicted by the plan's own risk table.** Non-blocking.

**2. Overwritten P0 baseline screenshots — confirmed gitignored, low severity.**
- `apps/e2e/.gitignore` line 6: `reskin-baseline/`. `git check-ignore -v` confirms the directory is untracked/local-only. This is a workflow annoyance (Phase 2 owner needs a note to re-baseline), not a repo-hygiene or data-loss issue. Non-blocking, but the report's "Next Steps" note to the Phase 2 owner should be preserved/acted on.

**3. cockpit-crm capture failure — confirmed pre-existing/unrelated.**
- `apps/e2e/tests/reskin-visual-capture.spec.ts` line 23 comment and the `giam_doc_kinh_doanh`-only test explicitly document the `STAFF_PASSWORD_LOGIN=true` precondition, predating this phase (test file committed in `742c20c`, Phase 0). Confirmed unrelated to the token diff.

## Independent Checks

**Contrast ratio — verified, claim accurate.** Computed WCAG relative-luminance contrast for `--cmc-ok-text (#1A6B34)` on `--cmc-ok-bg (#E6F9F0)`: **5.998:1** (rounds to the claimed "~6.0:1"). Passes AA (≥4.5:1) with comfortable margin.

**`theme.test.ts` assertions — correct.** `cmcGreen[5] === '#06C167'` matches the actual array index (`theme.ts:23-27`, index 5 is the 6th element, confirmed `#06C167` sits there, not a typo'd hex or off-by-one). Card/Paper `radius === 'sm'`, Button `radius === 'xs'`, and the Inter-prefix assertions all match the corresponding `theme.ts` values line-for-line.

**Font import isolation — confirmed.** `apps/admin/src/main.tsx` imports `@fontsource/inter/{400,500,600,700}.css`; `apps/lms/src/main.tsx` has zero `@fontsource/inter` references (only Fredoka/Quicksand). No leak.

**Business-logic scope — clean.** `git status --short` shows only the 13 files enumerated in the task (plus 2 unrelated pre-existing untracked plan dirs from a different session, not part of this diff). Zero finance/CRM/attendance files touched.

**`pnpm-lock.yaml` diff — clean.** Diff is exactly 4 additive hunks: `@fontsource/inter@5.2.8` added as a dependency + resolution entry for both `packages/ui` and `apps/admin` importers, nothing else changed (no unrelated version bumps).

## Additional Finding (not self-reported)

**`cmcGreen[6]` value (`#05A358`) is an invented interpolation with no DESIGN.md source — minor, flagged correctly by the implementer.** The plan.md prose said "leave far stops" while the phase file said "swap 5/6"; the implementer followed the more specific phase-file instruction and picked a value with no spec backing (chose to keep visual coherence with untouched index 7 `#1A7A34`). Grepped usage: `cmcGreen[6]` isn't directly referenced anywhere in the diff scope, but Mantine's `filled` variant uses shade 6 for default background under certain theme configs — worth a visual spot-check in Phase 2 when Badge/Button `color="cmcGreen"` combinations are reviewed, but not a Phase 1 blocker since no DESIGN.md target exists to fail against.

## Severity Summary

| Finding | Severity |
|---|---|
| All 5 token values verified correct against DESIGN.md prose | — (pass) |
| LMS `--cmc-border` count reported as ~15, actually 28 | Minor (informational — doesn't change verdict) |
| `cmcGreen[6]` invented value, no spec source | Minor (flag for Phase 2 visual check) |
| P0 baseline screenshots overwritten | Minor (gitignored, workflow-only, action item for Phase 2 owner) |
| cockpit-crm capture failure | Non-issue (pre-existing, documented, unrelated) |
| Contrast ratio claim | Verified accurate |
| theme.test.ts assertions | Verified correct |
| Scope/business-logic isolation | Verified clean |

**No blocking issues found.** Phase 1 is safe to consider complete; recommend Phase 2 owner re-baseline `apps/e2e/reskin-baseline/` before starting and spot-check `cmcGreen[6]` usage in filled/hover states.

## Unresolved Questions
- None requiring user input — all self-reported concerns resolved to non-blocking, and the one factual inaccuracy found (LMS border count) doesn't change any decision.
