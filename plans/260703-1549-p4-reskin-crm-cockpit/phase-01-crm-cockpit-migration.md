# Phase 1 — Re-skin CRM cockpit + pipeline + opportunity-detail

**Lane**: normal (cosmetic re-skin verification, no business logic change)

## Context links

- `plans/260703-1549-p1-token-remap-zero-elevation/` — tokens dependency, committed
- `plans/260703-1549-p7-reskin-list-kanban-templates/` — soft-dependency (DataTable/ViewSwitcher interface), P7 confirms zero contract change so this is safe to proceed once P7 lands
- `apps/admin/src/biz-director-cockpit-panel.tsx`, `crm-panel.tsx`, `opportunity-detail.tsx` — target files

## Scope (per plan.md, red-team-corrected — includes opportunity-detail.tsx)

Re-skin to Zero Elevation tokens. Preserve the stage-stepper "current" color fix and Modal-ized create-lead/test-schedule forms shipped in commit `2bb1ad5` (this session's earlier action-plan work) — do not regress them.

## Implementation steps

1. Read all 3 target files' current `Card`/`Modal`/shadow usage — `biz-director-cockpit-panel.tsx` already uses `withBorder` with no explicit shadow (spot-checked, likely already compliant post-P1's theme.ts default change — verify, don't assume).
2. `crm-panel.tsx`/`opportunity-detail.tsx`: same verification — these already went through Modal-ization in `2bb1ad5`; confirm no explicit shadow override was introduced there that P1's theme default change wouldn't already cover.
3. If any explicit shadow override exists in these 3 files, remove it (inherits P1 flat/functional-minimum default). If none exists (likely, per spot-check), this phase is primarily a verification pass.
4. Manually verify in the running admin app: stage-stepper still highlights correctly (brand blue, not the old error-red), Modal-ized forms still open/submit correctly — this is the actual regression check, not just "no shadow override found."

## Todo list

- [ ] Confirm P1 committed (it is); confirm P7 committed before starting (soft-dependency)
- [ ] Verify/fix shadow usage in biz-director-cockpit-panel.tsx
- [ ] Verify/fix shadow usage in crm-panel.tsx
- [ ] Verify/fix shadow usage in opportunity-detail.tsx
- [ ] Manual regression check: stage-stepper color, Modal forms
- [ ] `pnpm -w typecheck` clean

## Success criteria

- All 3 files render flat per P1 doctrine.
- Zero regression to `2bb1ad5`'s stage-stepper fix or Modal-ized forms.
- No DataTable/ViewSwitcher prop-shape break (P7's interface unchanged, confirmed by P7's own success criteria).

## Risk assessment

- Low — likely a verification-only phase (no explicit shadow overrides found in initial spot-check), with the real risk being accidental regression of very recently shipped fixes, not the re-skin itself.

## Next steps

None — last CRM-touching plan in the sequence.
