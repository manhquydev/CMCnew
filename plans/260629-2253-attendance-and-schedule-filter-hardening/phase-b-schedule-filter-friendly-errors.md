# Phase B — Schedule Filter Friendly Errors (normal)

## Context Links

- `apps/admin/src/schedule-panel.tsx` — the date-range filter loads `schedule.mySessions`; on failure it does
  `setError(e.message)` and renders "Lỗi tải lịch: {error}". A malformed date makes tRPC/Zod throw a JSON
  validation shape that is shown verbatim.
- Evidence: `../reports/qc-c-260629-2119-edge-ux-report.md` Major-2. Backlog #8.

## Problem

Raw Zod JSON ("[{code:invalid_string…path:["to"]}]") reaches the end user instead of a friendly message,
leaking internal error shape and confusing the user.

## Requirements

- Catch the load error and show a friendly Vietnamese message (e.g. "Khoảng ngày không hợp lệ, vui lòng chọn lại.")
  instead of the raw `e.message` when the failure is an input/validation error.
- Keep a generic fallback ("Không tải được lịch, thử lại.") for other errors.
- Do NOT render raw JSON/Zod structures to the user anywhere in this panel.
- Prefer the repo's existing `notifyError` / message-mapping convention if one exists (check `@cmc/ui`).

## Implementation Steps (later build phase)

1. Inspect the error path in `schedule-panel.tsx` and any shared error-message helper in `@cmc/ui`.
2. Map validation errors to a friendly string; keep raw detail only in console if useful.
3. Verify the date filter ideally never sends an invalid date (pairs with Phase C).

## Validation

- Manual: a bad/empty date shows the friendly message, no JSON.
- Admin typecheck green; no regression to normal schedule loads.

## Risks / Rollback

- Low risk (display-only). Rollback: restore `setError(e.message)`.
