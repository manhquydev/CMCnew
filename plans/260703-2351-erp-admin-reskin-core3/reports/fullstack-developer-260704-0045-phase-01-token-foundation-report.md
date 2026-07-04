# Phase 1 — Token foundation implementation report

## Executed Phase
- Phase: phase-01-token-foundation
- Plan: `plans/260703-2351-erp-admin-reskin-core3`
- Status: completed

## Files Modified
- `packages/ui/src/tokens.css` — `--cmc-font` (Inter-first), `--cmc-border` (#E5E7EB), `--cmc-ok`/`--cmc-status-active` (#06C167), `--cmc-ok-bg` (#E6F9F0)
- `packages/ui/src/theme.ts` — `fontFamily`/`headings.fontFamily` (Inter-first), `cmcGreen[5]`→`#06C167`, `cmcGreen[6]`→`#05A358` (see note below), `Card`/`Paper` `defaultProps.radius`→`'sm'`, `Button` `defaultProps.radius`→`'xs'`
- `packages/ui/src/theme.test.ts` — +20 lines: new `describe('theme tokens — Core 3 re-skin corrections')` block locking Card/Paper radius `'sm'`, Button radius `'xs'`, `cmcGreen[5]==='#06C167'`, fontFamily/headings starting with `'Inter'`
- `packages/ui/package.json` — added `@fontsource/inter: ^5.1.0` (resolved 5.2.8)
- `apps/admin/package.json` — added `@fontsource/inter: ^5.1.0` (see note below — required for the import to resolve under pnpm's strict deps, not just declaring it in `packages/ui`)
- `apps/admin/src/main.tsx` — imports `@fontsource/inter/{400,500,600,700}.css`
- `apps/admin/src/design-showcase.tsx` — corrected Border/Success swatch hex labels; removed the hardcoded `radius="xl"`/`radius={9999}` overrides from every `Button` demo (13 call sites) so the showcase now demonstrates the real new default instead of silently masking it
- `docs/design-system.md` — font stack, border/green hex, Border-Radius "Rule" line, Button/Card code examples updated to match new defaults (not in the phase's explicit file-ownership list; updated per repo convention since it documents exactly these values and would otherwise go stale)
- `pnpm-lock.yaml` — updated by `pnpm install` for the new dependency

## Tasks Completed
- [x] Grepped `apps/lms/src` for reliance on changed tokens before editing (see Concerns)
- [x] Added `@fontsource/inter`, imported 4 weights in `apps/admin/src/main.tsx` only
- [x] Edited `tokens.css` (font, border, green ok/status-active/ok-bg)
- [x] Edited `theme.ts` (fontFamily, headings, cmcGreen[5/6], Card/Paper/Button radius)
- [x] Updated `design-showcase.tsx` demos bound to old literal values
- [x] Added TDD locks to `theme.test.ts`
- [x] `docs/design-system.md` synced

## Tests Status
- Type check: pass (`@cmc/ui`, `@cmc/admin`, `@cmc/lms` — all three, since theme.ts fans out to all apps)
- Unit tests: pass — `packages/ui` vitest, 4 files / 46 tests (theme.test.ts now 14, was 3)
- Lint: pass — `@cmc/ui` 0 problems; `@cmc/admin` 0 errors (1 pre-existing unrelated warning in `course-exercise-manager.tsx`, not touched by this phase)
- Visual: re-ran `pnpm --filter e2e reskin:capture` against live dev servers (admin :5173, LMS :5175). 3/4 admin captures + LMS capture passed; the `cockpit-crm` capture failed on login (`giam_doc_kinh_doanh` seed account needs `STAFF_PASSWORD_LOGIN=true` on the currently-running api server — this is a pre-existing environment precondition documented in the spec's own comment, not a regression from this change). Visually confirmed in the captured PNGs: Inter renders, filled buttons render square (~4px, e.g. "Tạo cơ hội"/"Làm mới" in `crm-kanban.png`), lighter borders, LMS login screen (`lms-regression-guard.png`) unaffected.

## Contrast verification (not silently accepted)
`--cmc-ok-text` (`#1A6B34`) against the new `--cmc-ok-bg` (`#E6F9F0`) computed contrast ratio ≈ 6.0:1 (WCAG relative-luminance formula) — passes ≥4.5:1 with margin, no adjustment needed.

## Ambiguity resolved: cmcGreen[6]
Plan.md's Decision #2 prose says "leave far stops (index 0-4, 6-9)" (implying only index 5 moves), but both my task brief and `phase-01-token-foundation.md` itself say "swap 5/6 + keep far stops" (index 6 also moves). I followed the more specific phase-file/task-brief instruction and swapped index 6 to `#05A358` (a darker green interpolated for hover/pressed use, chosen to keep the ramp visually coherent with the untouched index 7 `#1A7A34`) since no exact target hex exists for it in DESIGN.md. This is a minor internal hover-shade value with no direct DESIGN.md target — flagging the plan.md/phase-01.md inconsistency for the record, not blocking.

## Concerns/Blockers

1. **LMS token reliance — expected, not blocking.** `apps/lms/src` uses `--cmc-border` in ~15 call sites (Card borders in `student-view.tsx`, `parent-view.tsx`, `curriculum-sessions-tab.tsx`, `attendance-history-card.tsx`, shell borders) and `--cmc-status-active` in 3 call sites (small graded-checkmark icon color). Both are functional/structural tokens, not part of LMS's kid-branding font system (`--cmc-font-bubble`/`--cmc-font-friendly`, untouched). The border shift (#D2D2D7→#E5E7EB) and green shift (#34C759→#06C167) will produce a small but real visual change in LMS (lighter card borders, slightly different green checkmark) — this is the exact risk the plan's own cross-cutting risk table anticipated, with "screenshot before/after" as the stated mitigation rather than a `.lms-app-root` override. `--cmc-font` does NOT leak into LMS: `.lms-app-root` sets `font-family` on the wrapping div, which cascades to all children unless a component sets `--cmc-font-bubble`/`friendly` explicitly (which most LMS text does) — so the Inter change is effectively a non-issue for LMS.

2. **P0 baseline screenshots overwritten (my mistake).** `apps/e2e/reskin-baseline/*.png` is gitignored/local-only. I ran `reskin:capture` to verify the P1 change without first backing up the Phase-0 "before" images — the harness writes both runs to the same path, so the original pre-reskin screenshots are gone and cannot be recovered from git. The current PNGs now only represent the "after" state. I visually confirmed the expected changes render correctly (Inter font, square buttons, lighter borders, shifted green) by inspecting the after-images directly, but there is no pixel-diff proof against the true P0 baseline for this phase. If a strict before/after diff is required, it would need to be re-derived from Phase-0's own captured artifacts if they exist elsewhere (e.g. a prior report), or accepted as a gap.

3. **`cockpit-crm` capture not re-verified** — pre-existing env precondition (`STAFF_PASSWORD_LOGIN=true` + seed account), unrelated to this phase's changes, documented in the spec itself.

4. **`@fontsource/inter` added to both `packages/ui/package.json` (per phase spec) and `apps/admin/package.json`** — the spec only listed `packages/ui`, but the import lives in `apps/admin/src/main.tsx`; under pnpm's strict dependency resolution a package can only import what it directly declares, so `apps/admin` needed its own entry too. Functionally necessary, not a scope deviation in spirit.

## Next Steps
Phase 1 unblocks Phase 2 (shared component layer). Recommend Phase 2 owner re-capture a fresh P0-equivalent baseline (or accept the current post-P1 screenshots as the new "before" reference for P2) before starting, since the true P0 baseline no longer exists on disk.

Status: DONE_WITH_CONCERNS
Summary: All 5 token-value corrections landed in tokens.css+theme.ts together, locked by 6 new theme.test.ts assertions (46/46 tests, typecheck/lint clean across ui+admin+lms), design-showcase.tsx and docs/design-system.md de-staled, gitnexus tool unavailable so scope verified via git status instead (clean — only expected files + pnpm-lock.yaml + docs).
Concerns/Blockers: (1) LMS visually shifts slightly on border/green tokens — expected per plan's own risk table, not a kid-branding violation, but real; (2) I accidentally overwrote the Phase-0 "before" screenshots while re-running the visual-capture harness (gitignored, unrecoverable) — only post-change visuals exist now; (3) cockpit-crm capture blocked by a pre-existing env flag, unrelated to this change.
