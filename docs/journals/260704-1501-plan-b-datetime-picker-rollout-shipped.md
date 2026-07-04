# Plan B — Date/Time Picker System Rollout Complete

**Date**: 2026-07-04 15:01
**Severity**: Medium
**Component**: @cmc/ui date-format layer, date/time inputs across finance/HR/payroll/schedule/student modules
**Status**: Resolved

## What Happened

Five implementation phases shipped sequentially on `feat/plan-b-datetime-pickers`, branched from `feat/phase-d-facility-picker-and-stitch-wireframes`:

- **P0 (8545f1a)**: Foundation layer `packages/ui/src/date-format.ts` — dayjs-based conversion set (toApiDate, parseApiDate, parseApiMonth, fmtDate). Pinned test timezone to Asia/Ho_Chi_Minh in vitest config.
- **P1 (e5b0556)**: Finance group (pricing effectiveFrom, voucher validFrom/validTo, student DOB in payment flow, compensation policy effectiveFrom, revenue/reconcile report filters) — replaced raw TextInputs with Mantine DateInput.
- **P2 (379bfce)**: HR/payroll group (staff startedAt, payroll periodKey ×2, KPI evaluation, attendance report) — DateInput + MonthPickerInput variants.
- **P3 (4e80405)**: Class/schedule group (makeup-session times, meeting times, shift-config times) — native TimeInput (no Date conversion needed).
- **P4 (f19ed6b)**: Student DOB final case — manual value/onChange wiring to preserve empty-string-as-clear semantic.

All phases live-verified against running dev stack: picker interactions, mutation/query round-trips, persistence checks passed.

## The Brutal Truth

Timezone handling is a trap that looks simple until you're 3 commits in. The temptation to use `new Date(str)` is always there — it's the JavaScript default — but it silently parses input as UTC, causing an off-by-one day error in any non-UTC timezone when the user's local midnight gets reinterpreted as UTC noon of the *previous* day. 

The code review forced us to confront this head-on: TZ-pinning `vitest.config.ts` only protected the Date→string direction. The string→Date parse direction was still vulnerable to a `new Date()` regression. We added a `getHours()===0` assertion as a trap: if someone later smuggled in a UTC-parsing call, the test would fail immediately, making the contract explicit and non-negotiable.

## Technical Details

**P0 design decision — dayjs over native Date**: All conversions go through dayjs in local time. No `toISOString()` (which forces UTC), no `new Date(str)` (which parses as UTC). Round-trip is `Date → dayjs(d).format('YYYY-MM-DD') → dayjs(str) → date.toDate()`. Guards added: `parseApiDate`/`parseApiMonth` return `null` on `.isValid()` fail, preventing Invalid Date leakage.

**Vitest TZ pin**: `TZ=Asia/Ho_Chi_Minh` in test env forces V8 to run in local timezone. This is the only way to exercise the off-by-one trap in tests without mocking the system clock.

**P1 pre-existing debt left intact**: Seed helpers (todayISO, monthAgoIso, etc.) still use UTC-slice logic in their implementations — out of scope per plan. These are caller-side, not contract-side; the new DateInput components tolerate them and round-trip correctly even though the seed pattern is fragile. Deliberate choice: fixing the seed layer is a separate, larger initiative.

**P4 DOB clear semantic**: Empty string must serialize to null in DB; Mantine DateInput's `getInputProps` spread was unsafe here. Switched to manual `value={dob ? fmtDate(dob) : ''}` + `onChange={(d) => setDob(d ? d : null)}`. Preserves the three-way state (unset → set → explicitly cleared → unset).

**Test coverage**: P0 added 10 date-format tests (dayjs round-trip, timezone trap, invalid-input fallback). P1–P4 exercised via @cmc/admin integration tests (27) and @cmc/ui (65), plus live Playwright verification on each phase before commit.

## What We Tried

- **P0 first pass**: dayjs without TZ pin in tests. Test passed locally in UTC+0 CI but failed in Asia/Ho_Chi_Minh on developer machine. Added the TZ pin.
- **P0 second pass**: TZ pin passed, but code review caught that `parseApiDate` could leak an Invalid Date if someone called it with malformed input downstream. Added `.isValid()` + null fallback.

## Root Cause Analysis

The timezone trap is architectural, not a bug: JavaScript's Date object *always* stores milliseconds-since-epoch (UTC). The user's local timezone is only applied during string formatting (`toLocaleString`), not during parsing (`new Date`). This is correct for epoch calculations but deadly for date-of-birth / effective-date semantics, where the user thinks in local calendar days, not UTC instants.

The fix is not to avoid Date — it's to never let a user-facing input string become a Date via UTC parsing. Always parse as local time (dayjs does this by default) and only convert to Date for storage when needed.

## Lessons Learned

1. **Timezone is not a testing detail.** It's a contract. Pin your test environment's TZ and write tests that would fail in a different timezone. The assertion `date.getHours() === 0` is not overkill — it's a guard against future regress by someone who doesn't know the trap exists.

2. **Pre-existing debt can be tolerated if the boundary is sealed.** We left the UTC-slice seed helpers alone (P1) because the DateInput components form a hard conversion boundary on the way out to the API. The old code doesn't infect the new layer.

3. **Playwright live verification caught edge cases that unit tests missed.** The P4 DOB clear button worked in unit tests but required real interaction to verify the state machine was truly three-way (unset / set / cleared).

## Next Steps

1. **Found but deferred**: `students-panel.tsx` DataTable row has a click-handler race (row onRowClick + "Sửa" button both fire, navigation wins). Same class of bug as Plan A Fix 2. Schedule separate intake — not Plan B scope.

2. **P1 debt**: The seed helpers (todayISO, monthAgoIso) should be audited and either migrated to dayjs or documented with a `// FIXME: UTC-slice` comment. This is a one-phase follow-up if other modules start using date-format.ts.

3. **Verify on prod**: Before shipping to prod, confirm the Asia/Ho_Chi_Minh timezone choice is correct for all user bases (check RBAC docs). If users span multiple timezones, this may need a per-user TZ setting in account-settings.

4. **Index refresh**: After commit, run `npx gitnexus analyze` to update the symbol index for date-format.ts exports and their new call sites across 5 modules.

## Commits

Sequential on `feat/plan-b-datetime-pickers`:
- `8545f1a` P0 date-format foundation
- `e5b0556` P1 finance group
- `379bfce` P2 HR/payroll group
- `4e80405` P3 class/schedule group
- `f19ed6b` P4 student DOB final case
