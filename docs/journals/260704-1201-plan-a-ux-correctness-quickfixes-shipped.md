# Plan A — UX Correctness Quick-Fixes Shipped

**Date**: 2026-07-04 12:01
**Severity**: Low (three independent, non-overlapping presentation fixes)
**Component**: apps/admin — class-workspace, shift-reg-list-panel, shift-reg-detail-panel
**Status**: Shipped (committed on `feat/plan-a-ux-quickfixes`, 3 atomic commits, ready for PR)

## What Happened

Completed all three fixes from `plans/260704-1034-ux-correctness-quickfixes/phase-01-ux-correctness-fixes.md`:

1. **Class-status Select uncontrolled state** (`class-workspace.tsx:1260`) — the control showed stale picks and rendered blank for `planned`-status batches (since `planned` isn't a valid picker option). Fixed by setting `value={null}` to make it an explicit action-picker that always returns to placeholder; the adjacent `StatusBadge` remains the single source of truth for actual batch status. This was Option B from the plan's Decision D1 (rejected Option A — binding to `batch.status` — because it would render blank for `planned` and would incorrectly offer `planned` as a manual rewind, bypassing the dedicated `reopen` flow's audit trail).

2. **Shift-reg list row cursor inheritance** (`shift-reg-list-panel.tsx`) — the entire `<Table.Tr>` had `cursor:pointer`, but only 5 of 6 cells (action cell is the 6th) had `onClick` handlers. Fixed by dropping the row-level cursor and adding a `CLICK_CELL` const applied only to the 5 clickable data cells, eliminating the misleading pointer over dead whitespace in the action column.

3. **Shift-reg date inputs (raw HTML → Mantine DateInput)** (`shift-reg-detail-panel.tsx`) — two bare `<input type="date">` elements replaced with Mantine `DateInput` (format `DD/MM/YYYY`, matching app-wide convention). Conversion at the boundary: `dayjs(x).toDate()` and `dayjs(d).format('YYYY-MM-DD')` instead of `new Date(str)`, which parses as UTC midnight and introduces off-by-one in negative-timezone contexts. State remains as `YYYY-MM-DD` strings, so existing `fromDate > toDate` disabled guard was untouched.

## Verification

- **Typecheck**: `pnpm --filter @cmc/admin exec tsc --noEmit` — clean.
- **Lint**: ESLint on all 3 changed files — clean.
- **Test regression**: `@cmc/admin` vitest suite (27 tests, including nav-consistency) — all green.
- **Business logic regression**: `apps/api/test/class-close-cancels-future-meetings.int.test.ts` (the plan's explicit gate for Fix 1, run against fresh `docker/docker-compose.dev.yml` postgres/redis) — 2/2 green, confirming backend terminal-state cancel logic untouched.
- **Code review** (code-reviewer subagent): zero blocking findings; confirmed dayjs-vs-`new Date` UTC claim empirically; confirmed `DateInput`'s `onChange` type accepts `null` and fallback handles it; confirmed no scope leakage into `setStatus`/`reopen`/`cancel`/backend.
- **Live verification** (Playwright MCP against running dev stack at :5173 admin, :4000 api): a `planned`-status class batch shows badge "ĐÃ LÊN KẾ HOẠCH" while Select shows placeholder (not blank); picking "open" from Select fires mutation, badge updates, Select snaps back to placeholder; shift-reg list action cell has `cursor:auto` while 5 data cells have `cursor:pointer`; shift-reg create form renders Mantine DateInput in DD/MM/YYYY and successfully created a phiếu with exact entered date range.

## Commits (3 atomic, per fix)

- `8c4bfee` fix(ui): keep class-status control on placeholder; badge is source of truth
- `dc564cb` fix(ui): drop misleading pointer cursor on shift-reg action cell
- `a77f30a` fix(ui): use Mantine DateInput for shift-reg create date range

## Notable

Zero business logic, API, or schema changes — pure presentation and interaction correctness. `gitnexus_detect_changes()` confirmed scope: only the 3 targeted files, no unexpected symbols. This is Plan A of a 4-plan autonomous sequence (A→B→C→D, ascending risk); B/C/D are separate branches/plans, not yet implemented.

## Harness

Intake #N/A (spec slice, normal lane), story `PLA-UX-CORRX-001` (lightweight, self-contained), no decision artifact (all choices deferred to existing design/pattern: Option B decided pre-session, dayjs-conversion is app-wide convention). Trace: `plans/260704-1034-ux-correctness-quickfixes/`.
