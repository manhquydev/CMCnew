---
title: "Plan: Attendance Integrity + Schedule Filter Hardening (QC Majors)"
date: 2026-06-29
status: proposed
lane: high-risk
scope: plan-first-then-implement-after-approval
intake: 27
inputs:
  - ../reports/qc-c-260629-2119-edge-ux-report.md
  - ../260629-2102-connected-schedule-detail-navigation/plan.md
backlog: [7, 8, 9]
---

# Plan: Attendance Integrity + Schedule Filter Hardening

## Why

The 3-persona product-experience QC of the connected schedule feature surfaced three MAJOR issues
that live in PRE-EXISTING reused components (not regressions of the schedule-detail feature).
They were logged as harness backlog #7–9 and deferred from that feature's scope. This plan fixes them.

## Issues (from QC-C, real Chrome)

| # | Severity | Where | Problem | Backlog |
|---|---|---|---|---|
| A | MAJOR (data integrity) | `apps/admin/src/attendance-roster.tsx` (+ `attendance.mark` API) | A student can be marked Present **and** "Có phép" (excused) at once; toggling status does not reset excused. Excused-only-makes-sense-for-absent. Bad data flows toward attendance→payroll/KPI. | #7 |
| B | MAJOR (UX) | `apps/admin/src/schedule-panel.tsx` error display | A malformed date in the range filter renders raw Zod JSON: "Lỗi tải lịch: [{code:invalid_string…path:["to"]}]". | #8 |
| C | MAJOR (UX) | `apps/admin/src/schedule-panel.tsx` date inputs (Mantine `DateInput`) | Typed entry swaps day/month (01/09→09/01); no guard when `from > to`. | #9 |

## Phases

| Phase | File | Risk | Purpose |
|---|---|---|---|
| A | `phase-a-attendance-excused-integrity.md` | high-risk (data integrity, payroll-adjacent) | Make "Có phép" valid only with Absent; reset excused when status changes; enforce on both UI and `attendance.mark` server input so bad combinations cannot be persisted. Add a regression test. |
| B | `phase-b-schedule-filter-friendly-errors.md` | normal | Replace raw Zod/tRPC error text in the schedule date filter with a friendly Vietnamese message; do not leak internal error shapes. |
| C | `phase-c-date-input-validation.md` | normal | Fix DateInput parse format (DD/MM/YYYY) and add a `from <= to` guard with inline feedback; applies to the schedule range filter. |

## Core Decisions

1. **Server is the source of truth for A.** The UI fix alone is insufficient — `attendance.mark` must
   reject or normalize `excused=true` when `status !== 'absent'` so no client (or API caller) can persist
   the contradiction. Decide in Phase A: reject (TRPCError) vs normalize (force excused=false). Recommend
   **reject** for an explicit contract, with the UI preventing the state in the first place.
2. **No schema change expected.** Attendance already stores `status` + `excused`; this is a validation rule,
   not a new column. Confirm during Phase A.
3. **B and C are UI-only**, scoped to `schedule-panel.tsx`; keep changes minimal and pattern-faithful.
4. Preserve existing passing attendance tests; add one for the new excused rule.

## Dependencies

- Independent of the schedule-detail feature (already shipped). A is independent of B/C.
- Phase A touches the attendance domain/API → treat as high-risk; run `/ck:security` consideration only if
  the change widens any input contract (it narrows it).

## Success Criteria

- A: It is impossible (UI and API) to save Present/Late + excused; switching away from Absent clears excused;
  a test proves `attendance.mark` rejects/normalizes the bad combo. Existing attendance tests still pass.
- B: A bad date in the schedule filter shows a friendly Vietnamese message; no raw JSON/Zod shape reaches the user.
- C: Typed dates parse as DD/MM/YYYY; `from > to` is blocked with clear feedback.
- Admin (and API for A) typecheck green; code review no blocking issues.

## Out of Scope

- Localizing status enums app-wide (separate minor cleanup).
- Console "Unsupported style property" warnings and a11y form-field id/name (separate cleanup).
- Session-detail roster fetch dedupe.
- Anything in the connected schedule-detail feature (already shipped/verified).

## Stop Conditions

- Pause if fixing A requires a schema/migration (escalate; not expected).
- Pause if the attendance domain has an intentional reason to allow Present+excused (confirm business rule
  before narrowing the contract).

## Open Questions (confirm before Phase A)

1. Phase A contract: REJECT bad combo (TRPCError, recommended) or NORMALIZE (silently force excused=false)?
2. Is "Có phép" ever valid for "Muộn" (late), or strictly Absent-only?
3. Do these fixes ship together, or A (data integrity) first as its own PR ahead of B/C?
