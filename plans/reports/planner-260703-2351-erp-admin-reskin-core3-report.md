# Scouting notes — ERP admin re-skin to Core 3 wireframe fidelity

Support notes for `plans/260703-2351-erp-admin-reskin-core3/plan.md`.

## Key finding: spec vs wireframe HTML diverge

`DESIGN.md` prose/frontmatter (authoritative per task) states: Inter · borders #E5E7EB ·
primary #0071E3 · green #06C167 · card `rounded-lg`=8px · 36px table rows. But the 15 wireframe
`code.html` files do NOT all implement these literally:
- **#06C167 green appears in NO wireframe** — greens are Tailwind `green-100/600/700` or Material
  `tertiary` (#006a36). The #06C167 value is DESIGN.md's own; it is what the user's screenshot
  comparison validated. → Use DESIGN.md value.
- **#E5E7EB as the border token appears in only ONE file** (#8 `template_chi_tiet_erp`). Most use
  Material `outline-variant #c1c6d6` or hardcode `#D2D2D7`. → DESIGN.md value #E5E7EB wins.
- Radius: the `*_vietnamese_core` variants use `rounded-lg`=8px; the `apple_minimal_hybrid` and #8
  variants use 4px.

**Resolution baked into the plan**: token VALUES come from DESIGN.md; component COMPOSITION comes
from the `*_vietnamese_core` wireframe variant of each template.

## Canonical wireframe variant per template (Explore-verified)

| Template | Variants | Canonical | Why |
|---|---|---|---|
| Record detail | #1, #8 (non-core), #9 (core) | **#9 vietnamese_core** | 8px radius + 340px chatter rail + section accent bar; #8 has exact #E5E7EB/#0071E3 but 4px radius |
| List/table | #10 apple_minimal, #11 core | **#11 vietnamese_core** | 8px radius + Odoo `8px 12px`/36px density + #0071E3 buttons |
| Calendar | #13 apple, #14 core, #15 month | **#14 core** (+ #15 as month mode) | enterprise density tokens + #0071e3 |
| Kanban | #12 core (only) | **#12** | 4-col, rounded-lg cards, left-accent active column |
| Cockpit | #3 (only) | **#3** | 4 KPI cards + gradient chevron funnel + 36px table + tinted pills + initials avatars |
| Attendance report | #2 (only) | **#2** | 3 KPI cards + bar chart + breakdown table |
| Staff profile | #4 (only) | **#4** | 12-col grid, 128px avatar + green dot, role pills, SSO card |
| Login | #6/#7 | (reference only) | **kid/LMS flavor** (Plus Jakarta Sans + orange glass) — admin `login-gate.tsx` stays enterprise hero |
| Parent meeting | #5 | (reference only) | mobile PARENT portal (Plus Jakarta Sans) — not admin styling |

## Codebase ground truth (re-verified this session)

- Tokens single source: `packages/ui/src/tokens.css` (`--cmc-*`) + `packages/ui/src/theme.ts`
  (Mantine). Both must change together (audit found a one-sided token bug before).
- `theme.test.ts` locks ONLY shadows — color/radius/font changes won't break it; add explicit locks.
- Existing shared primitives to REUSE (do not duplicate): `stat-card.tsx` StatCard,
  `status-badge.tsx` StatusBadge, `page-header.tsx`, `data-table.tsx` (+ `--cmc-dt-*` density tokens
  already exist), `record-detail.tsx`, `calendar-view.tsx`, `filter-bar.tsx`, `view-switcher.tsx`,
  `chatter.tsx`, `activity-log.tsx`. Barrel: `index.tsx`.
- NEW components needed: `avatar-initials.tsx` (InitialsAvatar), `pipeline-funnel.tsx` (gradient
  chevron funnel).
- `shell.tsx` top bar currently = bell + avatar only (lines ~270-339); wireframe wants + search +
  help + app-grid. High fan-out file.
- `login-gate.tsx` already a bespoke enterprise split-hero with MS SSO — minimal alignment only.
- Open audit bug to fold into P3: `attendance-report-panel.tsx:~34` uses undefined token
  `--cmc-surface-muted` → swap to `--cmc-surface-2`.
- Playwright exists in `apps/e2e` → reuse for the per-phase visual-verification harness (P0).
- No `@fontsource`/Inter in repo yet → P1 adds `@fontsource/inter`, imported in admin `main.tsx`
  only (keeps tokens.css network-free for LMS, which self-scopes fonts via `.lms-app-root`).

## Unresolved questions (also in plan.md Decisions)

1. Button radius: keep pill (default) or literal 4px per DESIGN.md? (task didn't flag buttons broken)
2. Green tuple: swap `cmcGreen[5/6]` only (default) or full re-ramp of the 10-stop scale?
3. Top-bar search: no-op visual affordance (default) or wire to real/client-side search?
4. LMS token reliance: must grep `apps/lms` for `--cmc-ok`/`--cmc-status-active`/`--cmc-border`
   before P1 to confirm no kid-branding depends on the values being changed.
