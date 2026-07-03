# Phase 1 — Build generic record-detail.tsx primitive

**Lane**: normal (new component, no existing behavior to lock — `staff-profile.tsx` itself is NOT touched in this phase, only used as a reference; migrating it onto the primitive is P5)

## Context links

- `plans/260703-1543-erp-ui-rebuild-phase-ab-token-primitives/reports/researcher-260703-1549-record-detail-calendar-primitives-report.md` — full interface shape already extracted from `staff-profile.tsx`
- `plans/260703-1549-p1-token-remap-zero-elevation/` — P1 must be committed first (this component consumes the new Zero Elevation tokens from the start)
- `packages/ui/src/activity-log.tsx` — canonical `ActivityLog` component this primitive wraps
- `packages/ui/src/theme.ts`, `tokens.css` — post-P1 shadow doctrine (Card/Paper flat, this primitive's containers should NOT set an explicit shadow override)

## Resolved decisions (defaults applied, YAGNI-favoring — override if disagreed)

1. **Batch mutation**: caller-managed. `record-detail.tsx` exposes `onSave(changes)` and does NOT internally batch/diff — the calling module (P5's staff-profile refactor, future entity pages) computes its own changed-fields object. Keeps the primitive simple; entity-specific save-gating logic (like staff's `rolesChanged` check) stays in the caller.
2. **Field rendering**: allow custom `render()` per field (already in the sketched interface), in addition to the `type` enum. Covers complex fields (e.g. facility MultiSelect) without forcing every entity into a fixed type set.
3. **ActivityLog refresh**: manual `refreshKey: number` prop, matching the existing `staff-profile.tsx` pattern (`setActivityKey(k => k+1)` after mutation). No auto-poll/WebSocket — YAGNI, this matches how every other panel in the codebase already refreshes.

## Interface (red-team corrected 2026-07-03 — 6 fixes applied, see below; do not use the original research report's interface verbatim, it had a blocking gap)

```tsx
interface RecordDetailConfig {
  entityType: string;
  entityId: string | number;
  /** FIX #1 (blocking): current field values — the interface had NO way to render
   * a field's value without this. Keyed by field `key`. */
  data: Record<string, unknown>;
  sections: {
    name: string;
    fields: Array<{
      key: string; label: string;
      type: 'text' | 'email' | 'select' | 'multiselect' | 'switch' | 'date';
      /** FIX #3: static or dynamic options for select/multiselect. Dynamic form
       * receives the live `data` so one field's options can depend on another's
       * value (e.g. primaryRole options depend on the live `roles` selection). */
      options?: { value: string; label: string }[] | ((data: Record<string, unknown>) => { value: string; label: string }[]);
      readOnly?: boolean;
      render?: (value: unknown, data: Record<string, unknown>) => React.ReactNode;
      validate?: (value: unknown) => string | null;
    }>;
    permission?: (session: Session) => boolean;
  }[];
  tabs: Array<{
    value: string; label: string;
    permission?: (session: Session) => boolean;
    component: React.ComponentType<{ data: unknown }>;
  }>;
  activityLog?: {
    fetchEndpoint: (entityId: string) => Promise<ActivityEntry[]>;
    fieldLabels: Record<string, string>;
    formatValue?: (field: string, value: unknown) => string;
    title?: string;
  };
  /** FIX #2 (blocking): record-level cross-field validation, e.g. staff-profile's
   * roleEditInvalid (rolesChanged && (roles.length===0 || !primaryRole)) — cannot
   * be expressed as a per-field validate(). Drives Save-button disabled + an
   * inline error banner. Caller still owns which mutations actually fire (see
   * onSave note below) — this only gates whether Save is clickable at all. */
  validate?: (data: Record<string, unknown>) => string | null;
  /** Caller-managed: primitive hands back the full current `data` (post-edit
   * form state), caller does its own diffing and decides how many mutation
   * calls to fire (staff-profile fires up to 4 independently-gated mutations —
   * that branching stays in the caller, NOT in this primitive). */
  onSave?: (data: Record<string, unknown>) => Promise<void>;
  canRead?: (session: Session) => boolean;
  canEdit?: (session: Session) => boolean;
}

export function RecordDetailPanel({ config, refreshKey, editing, onEditingChange, onBack }: {
  config: RecordDetailConfig; refreshKey?: number;
  /** FIX #5: entity-wide edit-mode toggle is CALLER-owned (not internal to the
   * primitive) — staff-profile's single "Chỉnh sửa" button flips ALL fields'
   * effective readOnly at once; exposing it as a prop keeps that caller-owned
   * without duplicating toggle logic inside every consumer. */
  editing?: boolean; onEditingChange?: (editing: boolean) => void;
  onBack: () => void;
}) { … }
```

**FIX #4 (scope correction)**: this primitive covers the sheet+tabs+activity-rail region only — `staff-profile.tsx` lines ~415-525 (Fieldsets/Tabs/Grid+ActivityLog), NOT the full 300-528 range. The page header (back button, title, inactive badge, edit-toggle button, reset-password button+its own Modal) at lines ~486-516 stays caller-owned — P5 keeps that chrome in `staff-profile.tsx` itself and wraps `RecordDetailPanel` inside it.

**FIX #6**: `activityLog` visibility is config-presence-only inside the primitive — if a session shouldn't see the activity rail (staff-profile's `canActivity` check), the CALLER omits `activityLog` from the config for that session; the primitive does not re-check session permissions itself for this field.

Layout: `Grid` — left col (8/12 md breakpoint) = sections rendered as `Fieldset`s + `Tabs` below; right col (4/12) = sticky `ActivityLog`, matching `staff-profile.tsx`'s sheet+rail sub-range (~415-525), not the full component.

## Implementation steps

1. Create `packages/ui/src/record-detail.tsx` implementing the corrected interface above.
2. Sections render as Mantine `Fieldset` per section, fields per `type` (resolving `options` if `select`/`multiselect`, calling it as a function with live `data` if dynamic) or custom `render(value, data)`, gated by `permission`. Effective `readOnly` = field's own `readOnly` OR `!editing` (when `editing` prop is provided).
3. Tabs render as Mantine `Tabs` (matches P1's decision — tabs won over accordion), gated by `permission`, lazy-panel (Mantine default).
4. Right rail: `ActivityLog` from `packages/ui/src/activity-log.tsx`, wired via `activityLog.fetchEndpoint`/`fieldLabels`/`formatValue`, re-fetches on `refreshKey` change.
5. Save button: disabled when `config.validate?.(currentFormState)` returns non-null; on click calls `onSave(currentFormState)`.
6. Export from `packages/ui/src/index.tsx` using the repo's `.js`-extension convention: `export { RecordDetailPanel, type RecordDetailConfig } from './record-detail.js';` (NodeNext resolution — matches existing exports like `activity-log.js`).
7. Write a unit test (`record-detail.test.ts` if a pure-logic slice exists, e.g. field-validation or permission-gating logic) — no component-render test (confirmed still true post-P1: `packages/ui/vitest.config.ts` is `environment: 'node'`, `.test.ts` only, no jsdom/RTL in devDependencies).

## Todo list

- [ ] Confirm P1 committed and merged into this branch (token dependency)
- [ ] Build `record-detail.tsx` per interface
- [ ] Wire ActivityLog with refreshKey pattern
- [ ] Export from index.tsx
- [ ] Unit test for any pure-logic helper (permission-gating, field-validation)
- [ ] `pnpm --filter @cmc/ui exec tsc --noEmit` clean
- [ ] `pnpm -w typecheck` clean (no consumer yet, but confirm no export-surface break)

## Success criteria

- Component matches the interface shape exactly (no drift from what P5 will need to consume).
- No explicit shadow override on internal Card/Paper containers (inherits P1's flat default).
- `staff-profile.tsx`'s current Tabs+Chatter shape is achievable by config alone (validate mentally against sections above — full proof happens in P5).

## Risk assessment

- Low — new file, no existing consumer yet, no behavior to regress.
- Main risk: interface mismatch discovered only when P5 tries to consume it — mitigate by keeping the interface exactly as extracted from the real `staff-profile.tsx` shape (not inventing a "cleaner" abstraction that doesn't fit the actual reference implementation).

## Next steps

P5 (staff-profile re-skin) is the first real consumer — validates this primitive's generality.
