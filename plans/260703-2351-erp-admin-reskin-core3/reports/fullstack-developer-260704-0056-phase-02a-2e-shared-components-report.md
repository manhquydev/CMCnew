# Phase 2a-2e — Shared component layer implementation report

Plan: `plans/260703-2351-erp-admin-reskin-core3/plan.md`
Phase spec: `plans/260703-2351-erp-admin-reskin-core3/phase-02-shared-components.md`
Scope: sub-phases 2a-2e only. 2f (global search backend, `apps/api/`) explicitly out of scope
for this pass per task instructions — not touched.

## Status: DONE

## Files changed

Modified:
- `packages/ui/src/stat-card.tsx` — circular semantic-accent icon chip, built-in trend arrow,
  `radius="lg"` → `radius="sm"`.
- `packages/ui/src/status-badge.tsx` — added backward-compatible `pill?: boolean` (default false).
- `packages/ui/src/index.tsx` — export `InitialsAvatar`, `initialsOf`, `colorOf`, `PipelineFunnel`
  + their types.
- `apps/admin/src/shell.tsx` — top-bar search/help/app-grid, avatar swapped to `InitialsAvatar`.
- `apps/admin/src/design-showcase.tsx` — added 4 new demo sections (StatCard accents, StatusBadge
  pill, InitialsAvatar, PipelineFunnel).
- `apps/admin/src/crm-director-dashboard.tsx` — `TrendDelta` helper trimmed to text-only (11-line
  diff, exactly this one fix, no other change).

Created:
- `packages/ui/src/avatar-initials.tsx` (InitialsAvatar + pure helpers `initialsOf`/`colorOf`).
- `packages/ui/src/avatar-initials.test.ts` (9 unit tests on the pure helpers).
- `packages/ui/src/pipeline-funnel.tsx` (PipelineFunnel).

Not touched: `apps/api/*` (2f, out of scope). `apps/lms/*` (verified no imports of
`StatCard`/`StatusBadge`/admin's `shell.tsx` — LMS has its own `StudentShell`/`ParentShell`).

## 2a — StatCard polish

- Icon chip: `borderRadius: 8` (square) → `borderRadius: '50%'` (circular).
- New `accent?: 'brand'|'ok'|'warn'|'danger'` prop (default `'brand'`), drives chip bg/fg from
  the matching `--cmc-*`/`--cmc-*-bg` token pairs via a new `ACCENT_CHIP` map.
- Trend arrow: `IconArrowUpRight`/`IconArrowDownRight` prepended to `delta` based on `deltaDir`;
  `flat` renders no arrow. Existing `DELTA_COLOR` mapping kept, arrow inherits the same color.
- Card `radius="lg"` → `radius="sm"` (matches Phase 1's new Card default of 8px).
- **Double-icon fix (per spec option b, explicitly preferred by the task)**: grepped all 5
  `StatCard` callers (`attendance-report-panel.tsx`, `crm-director-dashboard.tsx`,
  `overview-panel.tsx`). Only `crm-director-dashboard.tsx`'s `TrendDelta` helper built its own
  icon (`IconTrendingUp`/`IconTrendingDown`) inside the `delta` prop — the other 2 callers pass
  plain text or nothing. Trimmed `TrendDelta` to return text only; removed the now-unused
  `IconTrendingDown` import (`IconTrendingUp` stays — still used directly as a `StatCard` `icon`
  prop elsewhere in the same file). Diff: 11 lines, this one change only — verified via
  `git diff --stat` before finishing.

## 2b — StatusBadge pill variant

- Added `pill?: boolean` (default `false`). When true: renders a bare Mantine `Badge` (no dot
  wrapper), `variant="light"` (already tints per `TONE` color), `styles={{ label: {
  textTransform: 'uppercase' } }}` to satisfy the wireframe's "VƯỢT KPI"/"CẢNH BÁO" look. Default
  path (dot + light badge) is byte-for-byte unchanged — verified by re-reading the non-pill
  branch, no existing caller passes `pill`.

## 2c — InitialsAvatar (new)

- `packages/ui/src/avatar-initials.tsx`. Props: `name: string`, `size?: MantineSize | number`
  (default 32), `src?: string`.
- `initialsOf(name)`: splits on whitespace, first-word-initial + last-word-initial uppercased for
  multi-word names (e.g. "Nguyễn Thành Trung" → "NT"); single-word names take the first 2 chars;
  empty/whitespace-only names fall back to `'?'`.
- `colorOf(name)`: sums `charCodeAt` across the string, mods into a 5-entry palette
  (`cmc`/`cmcGreen`/`cmcAmber`/`cmcRed`/`cmcGray` — the exact Mantine color tuples already in
  `theme.ts`) — deterministic, same name always resolves to the same family.
- Both helpers exported (not just the component) so they're independently unit-testable without
  a DOM/jsdom environment (the package has none — see Testing section below).
- Reused in `shell.tsx`'s account menu, replacing `me.displayName.slice(0, 2).toUpperCase()` +
  a hardcoded `color="blue"` `Avatar`.

## 2d — PipelineFunnel (new)

- `packages/ui/src/pipeline-funnel.tsx`. Props: `stages: { label, count, value?, onClick? }[]`.
- Chevron shape via CSS `clip-path: polygon(...)` per segment — first stage flat-left, last
  stage flat-right, middle stages notched both sides, mirroring the wireframe's `.pipeline-step`
  CSS exactly (`D:\Downloads\stitch_cmcnew\stitch_cmcnew\cockpit_i_u_h_nh_crm\code.html:111-118`).
- Gradient: `color-mix(in srgb, var(--cmc-brand) <pct>%, white)`, pct ramping 15%→100% across
  stage index — ties the gradient to the live `--cmc-brand` token (no hardcoded hex ramp to
  drift out of sync with `theme.ts`).
- Last-stage text renders white (solid brand bg); earlier stages use `var(--cmc-text)`.
- Pure presentation: `onClick` per stage renders an `UnstyledButton` instead of a `Box`, no
  internal state or data-fetching.
- **Drop-in shape check for Phase 3**: `crm-director-dashboard.tsx`'s existing flat `SimpleGrid`
  funnel (read, not modified) uses `{ stage: { value, label }, count, pct }`. Mapping to
  `PipelineFunnel`'s `{ label, count, value }` is a one-line `.map()` (`label: f.stage.label,
  count: f.count, value: `${f.pct}% tổng pipeline`}`) — no further `PipelineFunnel` prop changes
  needed when Phase 3 swaps it in.

## 2e — Top-bar additions (`shell.tsx`)

- Added to the header's right `Group`, before the bell `ActionIcon`: a search `TextInput`
  (`IconSearch` leftSection, placeholder "Tìm kiếm…", local `searchQuery` state only — no tRPC
  call, per instructions 2f wires the real endpoint separately), a help `ActionIcon`
  (`IconHelpCircle`, no-op), an app-grid `ActionIcon` (`IconLayoutGrid`, no-op).
- Avatar swap: `<Avatar size={32} radius="xl" color="blue">{slice(0,2)}</Avatar>` →
  `<InitialsAvatar name={me.displayName} size={32} />`. Removed the now-unused `Avatar` import
  from `@mantine/core` (grepped file — no other `Avatar` usage remained).
- `AppShell.Header` height (56px, `header={{ height: 56 }}` on `AppShell`) untouched. Bell
  popover + account `Menu` (profile nav, logout) logic byte-for-byte unchanged — only the avatar
  render swapped.
- Responsive: search input uses `visibleFrom="sm"` (visible at `sm` breakpoint and up, hidden on
  narrow/mobile) — verified this is the correct direction against the existing hamburger
  `ActionIcon` two lines above, which uses `hiddenFrom="sm"` (opposite: visible on mobile only).

## Testing

- `pnpm --filter @cmc/ui test`: **5 files / 55 tests pass** (46 pre-existing + 9 new
  `avatar-initials.test.ts` tests covering `initialsOf` multi-word/single-word/whitespace/empty
  cases and `colorOf` determinism + full-palette spread using hand-picked single-char inputs
  whose char-code sums land on all 5 mod-5 buckets, avoiding a flaky "just check >1 unique"
  assertion).
- No render/DOM tests added for `InitialsAvatar`/`PipelineFunnel` themselves: confirmed
  `packages/ui/vitest.config.ts` uses `environment: 'node'` (no jsdom) and the package has no
  `@testing-library/react` dependency — the existing sibling pattern (`record-detail.test.ts`,
  `theme.test.ts`, `calendar-view.test.ts`) is pure-function/logic testing only, not component
  rendering. Adding a jsdom+testing-library render harness would be a tooling change beyond this
  phase's scope (YAGNI) — flagging as a gap rather than silently deviating from "mirror the
  sibling pattern." Instead extracted and tested the pure logic (`initialsOf`/`colorOf`); visual
  correctness of both new components is verified via the Playwright capture below and
  `design-showcase.tsx`.
- `pnpm -w typecheck`: **12/12 packages pass** (turbo run across the whole workspace, including
  `@cmc/admin`, `@cmc/lms`, `@cmc/ui`). One `noUncheckedIndexedAccess` fix needed in
  `avatar-initials.tsx` (array-index-into-possibly-undefined on `words[...]`/`PALETTE[...]`) —
  resolved with explicit `?? fallback` guards, not `!` assertions.
- `pnpm --filter @cmc/ui lint` / `pnpm --filter @cmc/admin lint`: clean on all touched files (one
  pre-existing unrelated warning in `course-exercise-manager.tsx`, not touched this phase).
- `pnpm --filter @cmc/admin test`: **4 files / 27 tests pass**, including the 3
  `nav-*-consolidation.test.ts` suites that import `shell.tsx`'s `buildNavGroups`/`SECTION_TITLES`
  — confirms the top-bar edit didn't regress nav-gate logic (expected, since only the header
  Group's JSX changed, not `buildNavGroups`).

## Visual verification

Dev stack was running (`admin` on :5173, `lms` on :5175 — confirmed via `curl`). Re-ran
`pnpm --filter e2e reskin:capture`: 3/4 admin captures pass (`login`, the 5-section
`super_admin` batch incl. `attendance-report`/`students-list` which consume `StatCard`, and the
LMS regression guard). The 4th (`cockpit-crm`, `giam_doc_kinh_doanh`-only account) fails on login
— pre-existing, unrelated to this change: the spec's own comment states it needs
`STAFF_PASSWORD_LOGIN=true` set on the dev `api` process, which wasn't set for this run.

**Baseline path handling** (Phase 1's known gap, avoided this time): the harness writes to a
fixed `apps/e2e/reskin-baseline/` path. Before re-running, copied the existing (Phase 1) baseline
to `reskin-baseline-phase1-backup/`; after the capture, copied the fresh Phase-2 shots to
`apps/e2e/reskin-baseline-phase2/` and restored the Phase-1 backup as the canonical
`reskin-baseline/` (git-ignored, local-only, matches the existing convention). Phase 1's
baseline is therefore preserved; Phase 2's is at `reskin-baseline-phase2/`.

Compared file sizes (rough diff signal) and eyeballed `attendance-report.png` side-by-side:
- `login.png`: byte-identical (0 diff) — expected, `login-gate.tsx` doesn't render inside `Shell`.
- All other admin screens: consistent +~2.7-2.9KB diff, matching the expected additive changes
  (top-bar search/help/app-grid + `InitialsAvatar` apply globally via `Shell`; `StatCard`'s
  icon-chip going circular applies to every screen using it, e.g. `attendance-report`, as flagged
  in the task as an expected, non-gated visual change).
- Direct visual check of `attendance-report.png` before/after: top-bar renders search box + help
  + app-grid icons cleanly, no squeeze on the "Báo cáo điểm danh" section title; account avatar
  correctly shows deterministic-colored initials ("SA" green vs old plain blue "SU"); StatCard
  KPI row layout intact, delta text color/positioning correct. No layout regression found.

## gitnexus tooling note

No `gitnexus_*` MCP tools were available in this agent's tool set (not present in the provided
tool list), so `gitnexus_impact`/`gitnexus_detect_changes` per `CLAUDE.md`/`AGENTS.md` could not
be run directly. Substituted with: `Grep` for all `StatCard`/`StatusBadge`/`Shell` callers before
editing (5 `StatCard` callers, 5 `StatusBadge` callers, `shell.tsx` imported only by
`apps/admin/src/App.tsx`), and `git status`/`git diff --stat` at the end to confirm the changed-file
set exactly matches the phase spec's "Files" section (minus 2f) plus `design-showcase.tsx` and the
new test file. Flagging this as a process gap for the orchestrator — if `gitnexus` MCP is expected
to be available to phase-executing subagents, it should be added to this agent type's tool grant.

## Deviations from the phase spec

- None in scope/behavior. The only cross-file touch beyond the phase's explicit file list was
  `crm-director-dashboard.tsx`, which the task itself pre-authorized ("if you touch that file,
  keep the diff minimal and exactly scoped to that one fix") — done, 11-line diff, `TrendDelta`
  only.

## Unresolved questions / follow-ups for Phase 3+

1. `PipelineFunnel`'s gradient uses CSS `color-mix()` — broadly supported in evergreen Chromium/
   Firefox/Safari (2023+), consistent with this app's existing browser-support bar (no legacy IE
   concern seen elsewhere in the codebase), but flagging in case the team has an undocumented
   minimum-browser constraint.
2. `cockpit-crm` capture still needs `STAFF_PASSWORD_LOGIN=true` set on the dev `api` process to
   verify Phase 2's top-bar/avatar changes on that specific screen — pre-existing harness
   limitation, not new to this phase, but worth a reminder before Phase 3 touches that cockpit.
3. `gitnexus` MCP tools were unavailable to this agent — see note above.

Status: DONE
Summary: Phase 2a-2e shipped — StatCard circular accent chip + built-in trend arrow, StatusBadge
pill variant, new InitialsAvatar + PipelineFunnel (exported, tested, in design-showcase), shell.tsx
top-bar search/help/app-grid + InitialsAvatar swap. Typecheck/lint/tests all green; visual capture
confirms no layout regression; crm-director-dashboard.tsx got the one pre-authorized 11-line
TrendDelta fix.
Concerns/Blockers: gitnexus MCP tools unavailable to this agent (worked around via grep + git diff);
cockpit-crm capture still blocked on STAFF_PASSWORD_LOGIN env var (pre-existing, not this phase's
regression).
