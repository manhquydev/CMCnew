# Phase 1 — Migrate staff-profile.tsx onto record-detail.tsx primitive

**Lane**: TDD (this refactors existing shipped production behavior — staff-profile.tsx is a real, working page; lock current behavior before migrating)

## Context links

- `plans/260703-1549-p2-record-detail-primitive/` — the primitive this migrates onto, now built and committed (`731f03b`)
- `apps/admin/src/staff-profile.tsx` — the file being migrated, and the reference implementation P2's interface was extracted from
- `plans/260703-1549-p1-token-remap-zero-elevation/` — tokens dependency, committed

## Known interface facts from P2's build (do not re-derive, use directly)

- `RecordDetailPanel` covers ONLY sheet(Fieldsets)+Tabs+ActivityLog-rail — the page header (back button, title, inactive badge, edit-toggle button, reset-password button+modal) stays in `staff-profile.tsx` itself, wrapping `RecordDetailPanel`.
- Save/Hủy is caller-owned (header), triggered via a forwarded ref: `RecordDetailHandle = { save, isDirty, validationError, busy }`. `staff-profile.tsx`'s existing header Save button calls `ref.current.save()` instead of its own inline `save()` closure.
- `RecordDetailConfig.data` must be memoized by the caller (`useMemo`) — the primitive resets form state on `entityId` change, not on `data` object identity, but passing a fresh object every render is still wasteful and risks the primitive's internal `isDirty`/`validate` derivations recomputing unnecessarily.
- Field types: `text | email | select | multiselect | switch | date | number`. Staff's `dependents` field (currently `TextInput type="number"`) maps to the new `number` type.
- Cross-field validation (`roleEditInvalid`: `rolesChanged && (roles.length===0 || !primaryRole)`) maps to `RecordDetailConfig.validate`.
- Dynamic select options (`primaryRole`'s options depend on live `roles`): use the function form of `field.options`.

## Implementation steps (TDD)

1. **Lock current behavior**: before touching `staff-profile.tsx`, identify what's testable about its current save/validation logic (likely already covered by existing tests — check for a `staff-profile.test.ts` or similar; if none exists, this is a gap to flag, not necessarily block on, since the file has no jsdom/RTL infra either — same constraint as P2/P3). At minimum, manually verify the current running behavior (role-edit validation, tab visibility gating, activity log refresh) before refactoring, and re-verify identically after.
2. Build the `RecordDetailConfig` for the staff entity: `sections` (Định danh, Phân quyền field groups), `tabs` (EmploymentTab, PayrollTab gated by `canPayroll`), `activityLog` (wired to `trpc.audit.staffTimeline`, presence-gated by `canActivity` — omit the key entirely when the session shouldn't see it, per P2's FIX #6 pattern).
3. Replace the hand-rolled Fieldset/Tabs/ActivityLog JSX in `staff-profile.tsx` with `<RecordDetailPanel config={...} ref={recordDetailRef} editing={editMode} onEditingChange={setEditMode} refreshKey={activityKey} />`.
4. Header's existing Save button: change its `onClick` from the old inline `save()` to `recordDetailRef.current?.save()`. Keep the header's own pre-save checks (`displayName.trim().length === 0`) as an additional guard alongside the primitive's `validate`.
5. Keep the reset-password button + its Modal exactly as-is in the header region (out of primitive scope per FIX #4).
6. Verify visually: open staff-profile in the running admin app, confirm identical behavior to pre-migration (tabs, role editing, activity log, save/cancel, reset-password) — this is the actual proof the primitive generalizes correctly, not just a type-level check.

## Todo list

- [ ] Confirm P1+P2 committed (both are)
- [ ] Build staff RecordDetailConfig
- [ ] Replace hand-rolled JSX with RecordDetailPanel
- [ ] Wire header Save button to the ref handle
- [ ] Manual behavior verification (tabs, validation, activity log, reset-password) — before/after comparison
- [ ] `pnpm --filter @cmc/admin exec tsc --noEmit` clean
- [ ] `pnpm -w typecheck` clean

## Success criteria

- Zero behavior change from the user's perspective — this is a re-implementation, not a redesign.
- `staff-profile.tsx`'s line count should shrink substantially (the Fieldset/Tabs/ActivityLog JSX moves into config, not duplicated).
- Proves P2's primitive is genuinely reusable — if staff-profile (the reference implementation P2 was extracted FROM) doesn't migrate cleanly, that's a P2 defect to fix, not a P5 problem to work around.

## Risk assessment

- Moderate — this touches real, currently-working production code (staff records, role editing, payroll visibility). Regression here is directly user-visible.
- Main risk: the `data` memoization requirement (see "known interface facts") — if `config` is constructed inline without `useMemo`, no functional bug occurs (entityId-keyed reset handles it) but wasted re-renders could occur. Use `useMemo` anyway for cleanliness.
- Reset-password modal and header chrome must NOT get pulled into the primitive by accident — re-verify against P2's explicit scope boundary during implementation.

## Next steps

None — P5 is a leaf in the dependency graph other than depending on P1+P2.
