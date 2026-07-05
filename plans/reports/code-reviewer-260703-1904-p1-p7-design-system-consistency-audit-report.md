# Design-System Consistency Audit — P1-P7 ERP UI Rebuild

Scope: 9 files (apps/admin: crm-director-dashboard, attendance-report-panel, meetings-panel,
staff-profile, profile-settings-panel, biz-director-cockpit-panel; packages/ui: record-detail,
calendar-view; apps/lms: attendance-history-card). Read against theme.ts, tokens.css,
theme.test.ts, design-showcase.tsx, data-table.tsx, stat-card.tsx as ground truth, and
cross-checked patterns against pre-existing P1-P4 code before flagging.

## Findings

| # | Severity | File:Line | Issue | Fix |
|---|----------|-----------|-------|-----|
| 1 | **Blocking** | `apps/admin/src/attendance-report-panel.tsx:34` | `backgroundColor: 'var(--cmc-surface-muted)'` — this CSS custom property is **not defined** anywhere in `packages/ui/src/tokens.css` (checked full token list: `--cmc-surface`, `--cmc-surface-2`, `--cmc-surface-dark` exist; `--cmc-surface-muted` does not). The bar-chart track background will resolve to the CSS `unset`/inherited value, i.e. it silently renders with no visible track — the new `TrendBarChart` (P6) is the only place in the entire codebase referencing this token (grep-verified, 1 hit). | Use an existing token — `var(--cmc-surface-2)` (alternating-row/nested-section fill) or `var(--cmc-bg)` matches the visual intent of a "track" background. |

No other genuine P5/P6-introduced violations found. Detail on what was checked and ruled out below.

## Checked and ruled out (no violation — matches established precedent)

- **Shadow doctrine**: grepped all 9 files for `shadow=`/`boxShadow` — zero hits. No Card/Paper/Modal/Menu/Select override anywhere in P4-P7 scope. Doctrine (flat Card/Paper, `--cmc-shadow-sm` minimum on Modal/Menu/Select/Drawer) is untouched and matches `theme.test.ts`'s locked assertions.
- **`Card ... style={{ border: '1px solid var(--cmc-border)' }}` without `withBorder`** (staff-profile.tsx:148/217/240, profile-settings-panel.tsx:39, attendance-history-card.tsx:54): initially looked like a P5/P6 deviation from `crm-director-dashboard.tsx`/`biz-director-cockpit-panel.tsx`'s `withBorder style={{ borderColor: ... }}` pattern (both P4). Grepped the whole `apps/` tree — the manual-`border` form is actually the **dominant, pre-existing pattern** (40+ hits across App.tsx, checkin-panel.tsx, guardians-panel.tsx, parent-view.tsx, and — critically — `design-showcase.tsx` itself, the canonical reference, uses it 3×). Not a new inconsistency; the `withBorder`+`borderColor` form used by the two P4 dashboard cards is the minority variant. No action needed.
- **`var(--mantine-color-${x}-6)` dynamic status color** (meetings-panel.tsx:267 for `CalendarEvent.color`): matches existing precedent (`cskh-panel.tsx:327` uses the identical `-4` variant). Consistent, not a one-off.
- **Bare Mantine color names** (`color="red"`, `color="orange"`, `color="teal"` etc. throughout meetings-panel.tsx, attendance-history-card.tsx, biz-director-cockpit-panel.tsx): this is the dominant codebase-wide convention (80+ pre-existing hits for `color="red"` alone, including in finance-panel.tsx, payroll-panel.tsx, class-workspace.tsx). Not a P5/P6 regression.
- **Hardcoded pixel radius/fontSize** (`calendar-view.tsx`: `borderRadius: 10/6/4`, `fontSize: 11/10`; `biz-director-cockpit-panel.tsx`/`attendance-history-card.tsx`: `fontSize: 11` table-header style objects): all values match the token scale numerically (10px = `--cmc-radius`, 8px = `--cmc-radius-sm`, 11px = `--cmc-text-xs`) and this exact "hardcode the pixel value that equals the token" style is already established in `design-showcase.tsx` itself (`borderRadius: 10/14/8` at lines 87/271/751/856) and `stat-card.tsx` (icon chip `borderRadius: 8`). Stylistic nit at most, not a new pattern P5/P6 introduced.
- **record-detail.tsx**: renders no Card/Paper/shadow itself (composes `Fieldset`/`Tabs`/`ActivityLog`) — no elevation surface owned by this primitive, so no doctrine risk. Field row layout (`Group justify="space-between"` + `Text size="sm" c="dimmed"`) matches `staff-profile.tsx`'s pre-migration `Field` helper it was generalized from, 1:1.
- **calendar-view.tsx**: uses `var(--cmc-border)` / `var(--cmc-border-faint)` / `var(--cmc-brand)` / `var(--cmc-brand-muted)` consistently for all borders/fills — no raw hex, no bare Mantine color as a background. Visually consistent with data-table.tsx/stat-card.tsx's token usage (both draw borders from the same `--cmc-border` token).
- **Radius on Card family** (`radius="lg"` in staff-profile.tsx, profile-settings-panel.tsx, attendance-history-card.tsx): matches Card's theme default (`defaultRadius: 'lg'` per theme.ts) — redundant explicit prop but not a deviation.

## Unresolved Questions

None — the single finding above is unambiguous (grep-confirmed the token doesn't exist) and the fix is a one-line token swap.
