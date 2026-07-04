# Design

## Domain Model

No schema/entity change. `Staff` (User with roles/facilities/isActive) stays as-is; this is a
UI-layer re-implementation only.

## Application Flow

Unchanged mutations: `profile.update`, `profile.setRoles`, `profile.setFacilities`,
`profile.setActive` (4 independently-gated calls, per the existing `save()` closure) — the
migration keeps this branching in `staff-profile.tsx` (caller-owned per P2's design), it does not
move into `record-detail.tsx`.

## Interface Contract — P2 extension (decision 0032)

`packages/ui/src/record-detail.tsx`'s `RecordDetailHandle`/`RecordDetailField` gain 2 new,
backward-compatible additions (both optional, no existing consumer breaks):

```tsx
export interface RecordDetailHandle {
  save: () => Promise<void>;
  isDirty: boolean;
  validationError: string | null;
  busy: boolean;
  /** Current live form data — lets a caller-owned header read values (e.g. for its
   * own additional guard checks) without duplicating form state. */
  data: Record<string, unknown>;
}

export interface RecordDetailPanelProps {
  // ...existing fields unchanged...
  /** Fires whenever the primitive's internal reactive state (busy/isDirty/
   * validationError/data) changes, so a caller-owned header can re-render its
   * own Save button (ref reads alone don't trigger re-renders — this callback
   * does). Optional; omitting it means the caller accepts non-live header state. */
  onStateChange?: (state: Pick<RecordDetailHandle, 'busy' | 'isDirty' | 'validationError' | 'data'>) => void;
}

export interface RecordDetailField {
  // ...existing fields unchanged...
  /** Side-effect hook fired after this field's value changes, given the new full
   * form data — lets a caller express cross-field auto-corrections (e.g.
   * clearing primaryRole when it's no longer in the selected roles) without the
   * primitive needing field-specific business logic. Optional. */
  onFieldChange?: (data: Record<string, unknown>) => Record<string, unknown> | void;
}
```

## Data Model

None.

## UI / Platform Impact

`apps/admin` only. Staff record page re-implementation, header Save button re-wired to the ref
handle + `onStateChange` for reactivity, `roles` field gets an `onFieldChange` clearing
`primaryRole`. Section-level note text and inline validation banner (currently inside the Phân
quyền Fieldset) move to `staff-profile.tsx`'s own header/wrapper region since `RecordDetailSection`
has no note slot — this is a caller-owned concern, matches P2's FIX #4 scope boundary (chrome
stays with the caller).

## Observability

No new logs/audit — existing `audit.staffTimeline` activity log wiring is unchanged (already
verified sound by red-team).

## Alternatives Considered

1. **Keep staff-profile.tsx as-is, don't migrate onto P2 this round** — user's non-chosen option;
   would leave P2 unproven by its own reference implementation, but zero risk to real HR data.
2. **Extend P2's interface (chosen)** — fixes the 2 architectural gaps at the primitive level so
   future entity migrations (not just staff) benefit, rather than working around them in P5 with
   bespoke local state duplication.
3. **Work around the gaps locally in staff-profile.tsx** (duplicate reactive state, poll the ref)
   — rejected: fights the primitive instead of fixing it, and the auto-clear side effect has no
   clean workaround without the `onFieldChange` hook.
