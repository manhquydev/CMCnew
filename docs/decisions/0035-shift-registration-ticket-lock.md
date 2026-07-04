# 0035 Shift Registration Ticket Lock

Date: 2026-07-04

## Status

Accepted

## Context

The shift-registration workflow (Draft → Submitted → Approved → Superseded) was designed in the 2026-06-30 brainstorm (`plans/260630-1919-work-shift-registration/reports/agent-01-business-logic.md`), but the rule "a staff member may only have one open (draft or submitted) registration at a time" was never written down as a decision — it existed only as unwritten intent. The original API design (`agent-03-api-design.md`) shipped a `create` mutation with no existence-check at all, and the first real implementation added only a partial guard (`status:'submitted'`, missing `draft`) — verified via `git log -p` on `apps/api/src/routers/shift-registration.ts`, this incomplete guard was present from the very first commit, not a later regression.

Because there was no written spec, the gap went undetected through the code's entire lifetime until manually re-reported and root-caused today (see `plans/reports/brainstorm-260704-2259-decision-defense-layer-and-lost-logic-audit-report.md`). This decision retrofits the missing spec and records the fix shipped in `plans/260704-2130-cong-ca-workflow-ux-fixes/` (commit `54b5613`).

## Decision

1. `create` blocks with `CONFLICT` when the caller already has ANY registration with `status ∈ {draft, submitted}` for that user. Only `approved`/`cancelled` registrations do not block a new `create`.
2. `create`, `updateDates`, and `submit` all reject `fromDate <= today` (Asia/Ho_Chi_Minh, string-compared as `YYYY-MM-DD`) via a shared `assertFutureFrom()` helper — registrations may only start from tomorrow onward.
3. A new `updateDates` mutation allows the ticket owner to edit `fromDate`/`toDate` while the registration is still `draft`. It prunes `shiftRegistrationEntry` rows that fall outside the new range in the same transaction, and writes an audit log entry.

## Alternatives Considered

1. Keep blocking only on `submitted` (status quo, rejected — allows unbounded draft accumulation, which is the exact incident this decision closes).
2. Block on any non-terminal status including hypothetical future statuses (rejected — YAGNI; no such status exists in the current `ShiftRegStatus` enum).

## Consequences

Positive:

- A single written source of truth now exists for this rule — closes the gap that let it ship incomplete undetected.
- Users can no longer accumulate multiple open tickets, matching the original (unwritten) intent.
- Draft tickets can now have their date range corrected instead of requiring a fresh create.

Tradeoffs:

- Legacy `draft` registrations whose `fromDate` has already passed can no longer be submitted until the owner edits the dates via `updateDates` — a known, accepted behavior change from Plan A's rollout.

## Follow-Up

- None — this decision documents already-shipped behavior (commit `54b5613`). Future changes to this rule must supersede this decision, not silently diverge from it (see `docs/DECISION_INDEX.md`).
