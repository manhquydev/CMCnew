# 0032 Extend record-detail.tsx primitive with data/onStateChange/onFieldChange

Date: 2026-07-03

## Status

Accepted

## Context

P2's `record-detail.tsx` primitive was built and committed (`731f03b`) as a generic detail-page
component, with `staff-profile.tsx` as its reference implementation. When P5 (migrating
`staff-profile.tsx` onto the primitive) was red-teamed, 2 real architectural gaps surfaced:

1. `RecordDetailHandle` (the imperative ref exposed to a caller-owned header for triggering Save)
   exposes `busy`/`isDirty`/`validationError` as plain values read via `ref.current.X` — but ref
   mutation does not trigger a re-render in the ref holder. A caller-owned header button
   (`loading={busy}` etc.) would show stale state.
2. `staff-profile.tsx`'s current behavior auto-clears `primaryRole` when it's removed from the
   selected `roles` set — a cross-field side effect the primitive's `RecordDetailField` interface
   has no hook for (`validate` returns a string, can't mutate other fields).

## Decision

Extend the primitive with 3 backward-compatible, all-optional additions:
- `RecordDetailHandle.data` — exposes live form data to the caller.
- `RecordDetailPanelProps.onStateChange` — reactive callback firing on internal state change, so
  a caller-owned header can re-render correctly.
- `RecordDetailField.onFieldChange` — per-field side-effect hook for cross-field auto-corrections.

Chosen over: (a) not migrating staff-profile.tsx this round (user's non-chosen option — would
leave P2 unproven by its own reference case), (b) working around the gaps with local state
duplication in `staff-profile.tsx` (rejected — fights the primitive instead of fixing it, and the
auto-clear side effect has no clean local workaround).

## Alternatives Considered

1. Defer P5 entirely, keep P2 as originally shipped.
2. Duplicate reactive state locally in the P5 consumer instead of extending P2.
3. (Chosen) Extend P2's interface with the 3 additions above.

## Consequences

Positive:

- P2 becomes genuinely reusable for entities with cross-field side effects and caller-driven
  header actions (not just staff — any future entity with similar needs benefits).
- All 3 additions are optional — zero breaking change to any hypothetical future consumer that
  doesn't need them.

Tradeoffs:

- P2's surface area grows before a second real consumer exists to validate the extension's
  shape — some risk the interface needs another iteration once P4/P6/P7's simpler consumers (if
  any end up using record-detail.tsx) reveal different needs.
- P5 (Authorization-adjacent, real HR/payroll data) now depends on a same-day extension of P2 —
  both must be verified together, not independently.

## Follow-Up

- If a third consumer of `record-detail.tsx` needs yet another primitive extension, reconsider
  whether the config-driven approach is still the right shape or whether specific entities should
  compose lower-level pieces directly instead.
