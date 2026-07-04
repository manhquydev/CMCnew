# Phase 0 — Shared date helpers + contract lock

**Blocks:** P1, P2, P4. **Owns:** `packages/ui/src/date-format.ts` (new),
`packages/ui/src/index.tsx`, `packages/ui/src/date-format.test.ts` (new),
`packages/ui/vitest.config.ts` (add TZ pin). Optional:
`apps/admin/src/class-workspace.tsx` (migrate local helper — see step 4).

## Goal

One dayjs-based, local-time, tested conversion module so no call site reinvents Date↔string
(DRY) and the #1 risk (wrong emitted format) is locked by unit tests.

## Context

- Reference impl to extract: `apps/admin/src/class-workspace.tsx:81-82`.
- dayjs is a `packages/ui` dep (`packages/ui/package.json:24`) and locale `vi` is set app-side.
- ESM import convention in this package uses `.js` extensions (see `index.tsx`).

## Implement

Create `packages/ui/src/date-format.ts`:
```ts
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
dayjs.extend(customParseFormat); // needed for dayjs(str, 'YYYY-MM-DD') strict-ish parse

/** Date -> 'YYYY-MM-DD' in LOCAL time (no UTC off-by-one). null -> undefined. */
export const toApiDate = (d: Date | null): string | undefined =>
  d ? dayjs(d).format('YYYY-MM-DD') : undefined;

/** Date -> 'YYYY-MM' in LOCAL time. null -> undefined. */
export const toApiMonth = (d: Date | null): string | undefined =>
  d ? dayjs(d).format('YYYY-MM') : undefined;

/** 'YYYY-MM-DD' -> Date at LOCAL midnight. empty -> null. */
export const parseApiDate = (s: string | null | undefined): Date | null =>
  s ? dayjs(s, 'YYYY-MM-DD').toDate() : null;

/** 'YYYY-MM' -> Date at LOCAL first-of-month. empty -> null. */
export const parseApiMonth = (s: string | null | undefined): Date | null =>
  s ? dayjs(s, 'YYYY-MM').toDate() : null;

/** Date|string -> 'DD/MM/YYYY' for display. */
export const fmtDate = (d: string | Date): string => dayjs(d).format('DD/MM/YYYY');
```
Export all five from `packages/ui/src/index.tsx` (new block, `.js` extension):
`export { toApiDate, toApiMonth, parseApiDate, parseApiMonth, fmtDate } from './date-format.js';`

## Pin test timezone (REQUIRED part of the contract lock)

The round-trip test (`toApiDate(parseApiDate('YYYY-MM-DD'))`) PASSES even with a broken UTC-based
helper when the test process runs in UTC (the common CI default) — so without a fixed non-UTC TZ the
test locks NOTHING on the timezone dimension. The P0 vitest config MUST pin the process TZ to a
non-UTC zone so the off-by-one path is actually exercised: in GMT+7 a `toISOString`-based helper
yields the PREVIOUS day and the round-trip test correctly FAILS.

Set `TZ` in `packages/ui/vitest.config.ts` (currently no TZ pin):
```ts
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: { TZ: 'Asia/Ho_Chi_Minh' }, // pin non-UTC so date round-trip tests exercise off-by-one
  },
});
```
(Equivalently, set `process.env.TZ` in a setup file — but the config `env` is the smallest change.)
Treat this as a required deliverable of P0's contract lock, not optional.

## Tests — `packages/ui/src/date-format.test.ts`

Lock the exact contract (this is the safety net for all later phases; TZ pinned per section above):
- `toApiDate(new Date(2026, 5, 15))` === `'2026-06-15'` (June = month index 5).
- `toApiDate(null)` === `undefined`.
- Round-trip: `toApiDate(parseApiDate('2026-06-15'))` === `'2026-06-15'` (no day shift).
- `toApiMonth(new Date(2026, 5, 1))` === `'2026-06'`; round-trip
  `toApiMonth(parseApiMonth('2026-06'))` === `'2026-06'`.
- `parseApiDate('')` / `undefined` / `null` === `null`.
- Off-by-one guard: `parseApiDate('2026-06-15')` — assert `.getFullYear()/.getMonth()/.getDate()`
  are 2026/5/15 (local components), proving no UTC rollback.

## Step 4 (optional but recommended — DRY + regression proof)

Migrate `apps/admin/src/class-workspace.tsx:81-82` local `toApiDate`/`fmtDate` to import from
`@cmc/ui`. Run `gitnexus_impact` on `toApiDate` first (it's referenced 6× in that file). This
proves the extracted helper is behavior-identical against 8 already-correct DateInput sites. If
any typecheck/test friction, keep the local helper and ship only the shared module (still DRY for
new sites) — do not risk the working class-workspace flow.

## Validation

- `pnpm --filter @cmc/ui test` — new date-format tests green.
- `pnpm -w typecheck` clean.
- If step 4 done: live-open class-workspace, create a batch with start/end dates, submit, confirm
  dates persist unchanged (regression check on the migration).
- `gitnexus_detect_changes` — only date-format.ts, index.tsx, test, (+ class-workspace if migrated).

## Risks / rollback

- Wrong `customParseFormat` import path → typecheck catches. If dayjs strict-parse behaves oddly,
  `dayjs(s)` (ISO) also parses `'YYYY-MM-DD'` correctly as local — fallback is `dayjs(s).toDate()`
  for date, but keep customParseFormat for the `'YYYY-MM'` case (bare `dayjs('2026-06')` is
  invalid without the plugin). Tests will surface it.
- Rollback: revert the 3 (or 4) files; nothing else depends on P0 until P1 starts.
