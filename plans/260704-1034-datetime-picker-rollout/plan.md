---
title: "Date/time picker system rollout"
description: "Replace manual-typing date/time/period TextInputs with real Mantine pickers (DateInput/MonthPickerInput/TimeInput) system-wide, preserving exact backend string formats."
status: implemented
priority: P3
effort: 1-2d (5 phases, ~16 fields across 12 files)
branch: feat/phase-d-facility-picker-and-stitch-wireframes
tags: [ux, forms, mantine-dates]
created: 2026-07-04
sourceReports:
  - plans/reports/brainstorm-260704-1034-four-plan-decomposition-ux-auth-nav-report.md
  - plans/reports/planner-260704-1037-datetime-picker-rollout-scout-report.md
---

## Overview

Users currently type dates/times/periods into plain `TextInput`s (with `placeholder="YYYY-MM-DD"`
etc.) in ~16 spots (incl. both `Kỳ` inputs in `payroll-panel.tsx` — summary card :105-112 and
new-payroll :240-245), while the app already uses `DateInput` correctly in 12 other spots — a
half-done, inconsistent state. This plan finishes the job: every manual date/time/period field
becomes a real Mantine picker. **Presentation + input-ergonomics only — no business logic, no
API/schema change.** The one hard invariant: each picker must emit the *identical* string the
backend already receives today (`YYYY-MM-DD` dates, `HH:mm` times, `YYYY-MM` periods).

This is Plan B of the 4-plan decomposition (brainstorm report above). Split into phases by
screen-group, mirroring the re-skin plan's batch-by-screen shape.

## Critical design contract (read before any phase)

`@mantine/dates` is **7.17.8 (installed via pnpm-lock; `^7.15.2` declared in
`apps/admin/package.json:20`)** — i.e. `@mantine/dates` 7.x. In v7 (the `Date|null` API holds across
all 7.x; the string-return change lands only in v8.0):
- `DateInput` / `MonthPickerInput` `onChange` → **`Date | null`** (v8 changed to string; we are
  NOT on v8). Must convert Date↔string at every call site.
- `TimeInput` = native `<input type="time">` wrapper → value is already a **`HH:mm` string** via
  a DOM event. **No conversion.** Time swaps are near-drop-in.

**Safe conversion (local-time, avoids UTC off-by-one) — already proven at
`apps/admin/src/class-workspace.tsx:82`:** `dayjs(d).format('YYYY-MM-DD')`. Never use
`toISOString().slice(0,10)` (UTC → previous-day bug west of UTC). Parse-back uses
`dayjs(str, 'YYYY-MM-DD').toDate()` (local midnight), never `new Date(str)` (UTC midnight).

P0 extracts this into a shared helper so no call site reinvents it (DRY).

## Phases (P0 blocks all; P1–P4 independent of each other, distinct file ownership)

| # | Phase | Owns (files) | Pickers | Status | File |
|---|---|---|---|---|---|
| 0 | Shared date helpers + contract lock (incl. TZ-pinned tests) | `packages/ui/src/date-format.ts` (new), `index.tsx`, `date-format.test.ts` (new), `vitest.config.ts` (TZ pin); optional migrate `class-workspace.tsx` local helpers | — | pending | [phase-00-shared-date-helpers.md](phase-00-shared-date-helpers.md) |
| 1 | Finance group | `finance-panel.tsx` (4 fields), `compensation-panel.tsx`, `revenue-report.tsx`, `reconcile-worklist.tsx` | DateInput | pending | [phase-01-finance-group.md](phase-01-finance-group.md) |
| 2 | HR / Payroll group | `staff-profile.tsx`, `payroll-panel.tsx`, `kpi-evaluation-panel.tsx`, `attendance-monthly-report-panel.tsx` | DateInput + MonthPickerInput | pending | [phase-02-hr-payroll-group.md](phase-02-hr-payroll-group.md) |
| 3 | Class / Schedule time group | `class-workspace.tsx` (session times), `meetings-panel.tsx`, `shift-config-panel.tsx` | TimeInput | pending | [phase-03-class-schedule-time-group.md](phase-03-class-schedule-time-group.md) |
| 4 | Students DOB (closes 3-way DOB) | `students-panel.tsx` | DateInput | pending | [phase-04-students-dob.md](phase-04-students-dob.md) |

## Dependencies

- **P0 → blocks P1, P2, P4** (they import `toApiDate`/`toApiMonth`/`parseApiDate`/`parseApiMonth`).
- **P3 depends on P0 only trivially** (TimeInput needs no helper; P3 can run right after P0 or
  even standalone — it imports nothing new from date-format).
- P1, P2, P3, P4 have **zero file overlap** → could run parallel after P0, but recommend
  sequential (one code-review pass each) per the re-skin cadence.
- No dependency on Plans A/C/D. `shift-reg-detail-panel.tsx` is **Plan A's** (excluded here).

## Per-phase harness loop (every phase)

1. Implement the swaps (helper import + picker + conversion wiring).
2. `code-reviewer` subagent pass — must confirm: (a) no business-logic/handler change beyond
   the input swap; (b) emitted string format byte-identical to prior TextInput; (c) useForm
   fields keep string value via option (a) wiring unless justified.
3. `gitnexus_impact` on any shared symbol before edit; `gitnexus_detect_changes` before commit —
   only expected files/symbols.
4. **Live-verify a representative screen**: actually open the form, pick a value, submit, and
   confirm the record persists with the correct value (DB or list reflects it). Typecheck alone
   is NOT sufficient proof (the Date↔string contract can pass types but ship wrong strings).
5. `pnpm -w typecheck` + `pnpm --filter @cmc/admin test` clean. Commit (conventional, no AI refs,
   no plan/phase IDs in message).

## Acceptance criteria (whole plan)

- Every field in the P1–P4 inventory renders a real Mantine picker (no `placeholder="YYYY-MM-DD"`
  / `"HH:mm"` / `"YYYY-MM"` TextInputs remain in the listed sites).
- Each swapped field, when submitted **live**, persists the identical backend string it did
  before (verified by actual submit + read-back, not typecheck): `YYYY-MM-DD`, `HH:mm`, `YYYY-MM`.
- The picker↔string CONVERSION introduces no off-by-one: pick a date via a swapped picker, submit,
  reload, it shows the same date (tz-safe conversion). NB: this scopes the *conversion*, not the
  pre-existing UTC-slice seed helpers listed in Non-goals — those are independent and out of scope.
- Student DOB unified: class-workspace / finance-panel / students-panel all use `DateInput`.
- `pnpm -w typecheck` clean; `@cmc/admin` (+ `@cmc/ui` for P0) tests green; new
  `date-format.test.ts` green.
- `code-reviewer` pass per phase; `gitnexus_detect_changes` scope-clean per phase.

## Cross-cutting risks

| Risk | L×I | Mitigation |
|---|---|---|
| Picker emits wrong string format → silent submit breakage (#1 risk) | Med×High | Single shared helper (P0) with unit tests locking exact output; per-phase live submit+read-back; reviewer diffs emitted string vs prior. |
| UTC off-by-one on date-only conversion | Med×High | Helper uses dayjs local-time only; `parseApiDate` uses `dayjs(s,'YYYY-MM-DD')` not `new Date`; live test picks a date and confirms no shift after reload. |
| useForm field type mismatch (Date vs string) breaks submit/validation | Med×Med | Prefer option (a): keep form value string, wire picker via `parseApiDate`/`setFieldValue(toApiDate)`; submit handler untouched. Reviewer verifies handler unchanged. |
| Empty/clearable value → helper returns `undefined`/`''` inconsistently vs what API expects | Med×Med | Match each site's *current* empty semantics (some send `undefined`, some `''`); helper returns `undefined` for null, call site coerces to `''` where the current code does. Reviewer checks empty-path parity. |
| TimeInput produces `HH:mm:ss` instead of `HH:mm` | Low×High | Native time input default = `HH:mm` (no `step`); do not set `withSeconds`. Live-verify a saved time reads back `HH:mm`. |
| Touching working `class-workspace` helpers (P0 optional migrate) regresses 8 correct sites | Low×High | Extracted helper must be byte-behavior-identical; unit test parity; if any doubt, leave class-workspace local helper and only add shared one (still DRY-enough for new sites). |

## Decisions (confirm before / during P0)

1. **terms-panel** (`terms-panel.tsx:114,121,192,198`, `<TextInput type="date">` native picker):
   already has a working picker and already emits `YYYY-MM-DD`. Converting to Mantine adds
   Date↔string risk for pure visual uniformity. **Default: DEFER (out of scope).** Flip to
   in-scope (own mini-phase) only if user wants pixel-uniform pickers. — TOP OPEN DECISION.
2. **Helper home**: `packages/ui/src/date-format.ts` (dayjs already a ui dep; lms may reuse) vs a
   per-app `apps/admin` util. **Default: packages/ui.**
3. **attendance-monthly** regex + disabled-button guard becomes redundant with MonthPickerInput.
   **Default: keep guard (defense-in-depth), don't rip out.**

## Non-goals

- No backend/API/schema change; no new endpoints.
- No `shift-reg-detail-panel.tsx` (Plan A).
- No terms-panel conversion (unless decision #1 flips).
- No change to the 12 already-correct DateInput sites (except optional P0 helper migration).
- **Pre-existing UTC-slice seed helpers are OUT of scope** — this plan swaps input pickers, not seed
  logic. Three sites still build a `YYYY-MM-DD` string via `toISOString`, independent of the new
  picker/helper: `compensation-panel.tsx:9` (`todayISO = new Date().toISOString().slice(0,10)`),
  `staff-profile.tsx:103` and `students-panel.tsx:107` (`new Date(...).toISOString().split('T')[0]`
  / `.slice(0,10)`). In GMT+7 `todayISO()` returns YESTERDAY between local 00:00–07:00. OPTIONAL
  (out of core scope): migrating these three to dayjs-local (`toApiDate(new Date())` etc.) would give
  end-to-end tz consistency — cheap, but not required by this plan; leave unless separately requested.
- **`assessment-panel.tsx:126`** (`placeholder="2026-06 hoặc L1"`) stays a free-text `TextInput`:
  it accepts a round label ("L1") OR a month, so it deliberately CANNOT become a `MonthPickerInput`.
  Excluded so a future "complete the set" pass doesn't break the L1 case.
