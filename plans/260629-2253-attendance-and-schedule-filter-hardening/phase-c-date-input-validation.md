# Phase C — Date Input Parse + Range Validation (normal)

## Context Links

- `apps/admin/src/schedule-panel.tsx` — two `DateInput` (Mantine) for "Từ ngày" / "Đến ngày" with
  `valueFormat="DD/MM/YYYY"`. QC-C: typed entry swaps day/month (01/09→09/01) and `from > to` is accepted silently.
- Evidence: `../reports/qc-c-260629-2119-edge-ux-report.md` Major-3. Backlog #9.

## Problem

Typed dates are misparsed (day/month swap) and an inverted range (`from > to`) produces a confusing/empty result
with no feedback. The calendar picker works; only typing is bitten.

## Requirements

- Ensure typed input parses as DD/MM/YYYY (Mantine `DateInput` `dateParser` or equivalent) so typing matches the picker.
- Guard `from <= to`: when inverted, show inline feedback and do not fire the query (or auto-correct with a notice).
- Keep "Tuần này" reset behavior intact.

## Implementation Steps (later build phase)

1. Add a `dateParser` (or input props) enforcing DD/MM/YYYY on both DateInputs.
2. Add a `from <= to` check before calling `schedule.mySessions`; surface a small inline message when violated.
3. Confirm picker-driven selection still works unchanged.

## Validation

- Manual: typing 01/09/2026 yields 1 Sep (not 9 Jan); `from > to` is blocked with feedback; picker unaffected.
- Admin typecheck green.

## Risks / Rollback

- Low risk (UI input handling). Rollback: remove parser + guard.
