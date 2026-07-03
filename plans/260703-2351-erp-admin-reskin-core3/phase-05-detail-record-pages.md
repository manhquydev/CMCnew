# Phase 5 — Detail / record pages

## Context
- Wireframe ref: `template_chi_t_iet_..._vietnamese_core` (#9, canonical per plan Decision #3) —
  2-column `[1fr_340px]` grid: left form sections (160px right-aligned labels, section heading with
  `w-1 h-5 bg-primary` accent bar, `rounded-xl` cards ≤8px), right sticky 340px chatter/activity rail
  with ring-dot timeline. Also `b_n_m_u_chi_ti_t_b_n_ghi_erp_b_c_c_2_c_t` (#1) and `h_s_nh_n_vi_n`
  (#4, staff profile: 12-col grid, 128px avatar + green status dot, role pill chips, SSO card, toggles).
- Existing primitives cover this: `record-detail.tsx` (composes Fieldset/Tabs/ActivityLog),
  `chatter.tsx`, `activity-log.tsx`, `record-detail.test.ts`. Tune the primitive, don't rebuild.
- Audit (report) confirmed `record-detail.tsx` owns no elevation surface and its field-row layout
  matches staff-profile's original `Field` helper — safe to restyle labels/spacing.

## Requirements
- `record-detail.tsx`: label column 160px right-aligned (`--cmc-form-label-*` tokens exist), section
  heading accent bar, card radius ≤8px, right chatter rail 340px (`--cmc-chatter-w` exists).
- `staff-profile.tsx`: 128px `InitialsAvatar` + green status dot (uses corrected #06C167), role pill
  chips via `StatusBadge pill`, generous section padding.
- `student-detail`, `opportunity-detail`, `schedule-detail`, `profile-settings-panel`: align to the
  same 2-col record shell + label/heading conventions.

## Files
- Modify: `packages/ui/src/record-detail.tsx`, `apps/admin/src/staff-profile.tsx`,
  `student-detail.tsx`, `opportunity-detail.tsx`, `schedule-detail.tsx`, `profile-settings-panel.tsx`.

## Steps
1. `gitnexus_impact` on `RecordDetail` (upstream — several panels consume it); warn if HIGH.
2. Restyle the primitive first, re-run `record-detail.test.ts`, screenshot a consumer.
3. Apply per-panel avatar/status/heading polish; keep all field data, edit handlers, tabs logic intact.

## Tests / validation
- `pnpm --filter @cmc/ui test` (`record-detail.test.ts` green); `pnpm -w typecheck`.
- Playwright: staff-profile + one opportunity/student detail vs #9/#4.
- `gitnexus_detect_changes`; reviewer confirms no data/handler change.

## Status (2026-07-04)
DONE. `record-detail.tsx` restyled (160px right-aligned labels via `--cmc-form-label-*`,
accent-bar section headings, flex-based 340px sticky `--cmc-chatter-w` right rail, `Grid`
import dropped) — `record-detail.test.ts` (pure-function tests only, no render assertions)
stayed green untouched. `staff-profile.tsx` (the primitive's only real consumer) gained a
128px `InitialsAvatar` + green `--cmc-status-active` dot header card and `StatusBadge pill`
role chips. `student-detail.tsx`, `schedule-detail.tsx`, `opportunity-detail.tsx` (hand-rolled,
not RecordDetailPanel consumers) got the same label/heading/radius conventions applied
directly; `profile-settings-panel.tsx` got heading accent bars, the label convention, a header
avatar, and `StatusBadge pill` role chips. `opportunity-detail.tsx`'s receipt-create Modal
(`receiptClassBatchId`/`classBatches`) was left untouched per this session's other in-flight
work — confirmed via `git diff` grep. `pnpm -w typecheck`, `@cmc/ui`/`@cmc/admin` test, and
ESLint all clean. See `reports/fullstack-developer-260704-0217-phase5-detail-record-pages-report.md`.

## Risks / rollback
- Risk: primitive restyle shifts every consuming detail page unexpectedly. Mitigation: change is
  visual; test locks structure; screenshot 2 consumers before batch-applying panel tweaks.
- Risk: staff-profile SSO/toggle logic touched. Mitigation: styling-only; reviewer diffs handlers.
- Rollback: primitive revert restores all consumers; per-panel reverts independent.
