---
title: "Scout notes — date/time picker system rollout (Plan B)"
date: 2026-07-04
type: planner-scout-report
plan: plans/260704-1034-datetime-picker-rollout/
---

## Purpose

Verified ground truth for Plan B (pickerize manual date/time/period TextInputs).
Every file:line below was re-read in this session, not copied from the prior scout.

## Library / API facts (verified)

- `@mantine/dates` = **7.17.8 (installed; pnpm-lock) — `^7.15.2` declared** (`apps/admin/package.json:20`),
  i.e. 7.x. **v7 API** — critical:
  `DateInput` / `MonthPickerInput` `onChange` returns **`Date | null`** (v8 changed
  it to string; we are NOT on v8). Confirmed by existing working code:
  `class-workspace.tsx:126` `useState<Date|null>` + `onChange={setStartDate}`.
- `TimeInput` (from `@mantine/dates`) is a thin wrapper over native
  `<input type="time">`: value is a **string `HH:mm`**, `onChange` is a DOM change
  event (`e.currentTarget.value`). No Date conversion. **Time swaps are near-drop-in.**
- `DatesProvider settings={{ locale: 'vi' }}` + `dayjs.locale('vi')` already set at
  `apps/admin/src/main.tsx:18,23`. Pickers render Vietnamese automatically.
- `dayjs` is a dependency of both `packages/ui` (`package.json:24`) and `apps/admin`
  (`package.json:25`). Shared helper in `packages/ui` is viable.

## The safe conversion pattern (already in the codebase — extract this)

`apps/admin/src/class-workspace.tsx:81-82`:
```
const fmtDate  = (d: string | Date) => dayjs(d).format('DD/MM/YYYY');
const toApiDate = (d: Date | null)  => (d ? dayjs(d).format('YYYY-MM-DD') : undefined);
```
`dayjs(d).format('YYYY-MM-DD')` uses **local** time → NO UTC off-by-one.
(`d.toISOString().slice(0,10)` would be the buggy way — do not use it.)
For parse-back, use `dayjs(str, 'YYYY-MM-DD').toDate()` (local midnight), NOT
`new Date(str)` (UTC midnight → can render previous day west of UTC).

12 existing `DateInput` sites all use this or an equivalent dayjs path
(class-workspace.tsx:249,250,559,560,698,774,1099,1100; schedule-panel.tsx:109,116;
meetings-panel.tsx:80; opportunity-detail uses DateTimePicker).

## Backend format contract (confirmed by existing working submits)

The current manual TextInputs already ship these exact strings and work:
- dates → `YYYY-MM-DD` (e.g. `toApiDate` at class-workspace.tsx:189,190,752)
- times → `HH:mm`
- periods → `YYYY-MM` (`periodKey` state, regex-guarded at
  attendance-monthly-report-panel.tsx:64)

Invariant for every swap: the picker must emit the **identical** string the current
TextInput emits. No router reads needed — the format is proven by the live submit code.

## Verified target inventory (file:line, current state, integration pattern)

### TimeInput (HH:mm) — manual TextInput today, string state → near-drop-in
| File:line | Field | State pattern |
|---|---|---|
| class-workspace.tsx:700,701 | session Giờ bắt đầu/kết thúc | local `useState` string; onChange `e.currentTarget.value` |
| meetings-panel.tsx:81 | meeting Giờ | local `useState` string |
| shift-config-panel.tsx:190,191 | shift template Bắt đầu/Kết thúc | Mantine `useForm` string field (`getInputProps('start'/'end')`) |

TimeInput keeps value as string in all three → `getInputProps` and event-onChange both
work with no type change. Lowest-risk group.

### DateInput (YYYY-MM-DD) — manual TextInput today → needs Date↔string conversion
| File:line | Field | State pattern | Conversion note |
|---|---|---|---|
| staff-profile.tsx:161 | Ngày vào làm (`startedAt`) | plain `setForm({...form})` object, string | no @mantine/dates import yet |
| students-panel.tsx:259-263 | student DOB (`dateOfBirth`) | Mantine `useForm` string field | form value must move string↔Date at boundaries |
| finance-panel.tsx:162-167 | pricing Hiệu lực từ (`effectiveFrom`) | Mantine `useForm` (priceForm) string |
| finance-panel.tsx:354-363 | voucher validFrom/validTo | Mantine `useForm` (form) string |
| finance-panel.tsx:1386-1391 | payment-flow student DOB (`studentDob`) | local `useState` string |
| compensation-panel.tsx:137 | policy Hiệu lực từ (`effectiveFrom`) | Mantine `useForm` string |
| revenue-report.tsx:86,87 | report Từ/Đến ngày (`from`/`to`) | local `useState` string |
| reconcile-worklist.tsx:87,88 | reconcile Từ/Đến ngày (`from`/`to`) | local `useState` string |

### MonthPickerInput (YYYY-MM) — manual TextInput today → Date↔string conversion
| File:line | Field | State pattern |
|---|---|---|
| payroll-panel.tsx:105-112 | Kỳ (`periodKey`, Tóm tắt kỳ lương, state ~:76) | local `useState` string + regex guard |
| payroll-panel.tsx:240-245 | Kỳ (`periodKey`, Tính lương mới, state ~:186) | local `useState` string |
| attendance-monthly-report-panel.tsx:59-66 | Kỳ (`periodKey`) | local `useState` string + regex guard + disabled-button guard |
| kpi-evaluation-panel.tsx:435-441 | Kỳ lương (`periodKey`) | local `useState` string |

## useForm integration caveat (design-relevant)

Mantine `useForm` fields (shift-config time, students-panel DOB, finance
effectiveFrom/validFrom/validTo, compensation effectiveFrom) store a value type.
- For **TimeInput** the value stays string → `getInputProps` drop-in, no other change.
- For **DateInput/MonthPickerInput** the picker wants `Date|null` but the form field
  and its submit handler use a string. Two options per field:
  (a) keep form value as string, wire DateInput manually:
      `value={parseApiDate(form.values.x)} onChange={(d)=>form.setFieldValue('x', toApiDate(d) ?? '')}`
      — submit handler unchanged (still reads a string). **Recommended: least blast radius.**
  (b) change form field to `Date|null`, convert only in `onSubmit`. Touches initialValues +
      submit + any validation. More surface. Avoid unless (a) is awkward.

## DOB 3-way inconsistency — resolution path

Same field, three treatments today:
- class-workspace.tsx:774 — already `DateInput` (correct, reference).
- finance-panel.tsx:1386 — manual TextInput (fixed in Finance phase).
- students-panel.tsx:259 — manual TextInput (fixed in Students phase).
After both phases: all three = `DateInput` + shared `parseApiDate`/`toApiDate`. Unified.

## terms-panel — the deferral decision

`terms-panel.tsx:114,121,192,198` use `<TextInput type="date">` = **native browser date
picker**, value already `YYYY-MM-DD` (native format matches backend), local `useState`.
It already HAS a working picker and already emits the correct string. Converting to
Mantine `DateInput` buys visual consistency but ADDS the Date↔string conversion risk to
4 fields that currently cannot get the format wrong.
Recommendation: **defer** (out of Plan B scope) unless the user wants pixel-uniform
pickers. Listed as the top open decision.

## Excluded (owned elsewhere)

- `shift-reg-detail-panel.tsx:360,365` raw `<input type=date>` → **Plan A** (raw-HTML
  correctness fix, not a picker-consistency rollout). Not in Plan B.

## Shared-helper home

Proposed `packages/ui/src/date-format.ts` exporting `toApiDate`, `toApiMonth`,
`parseApiDate`, `parseApiMonth`, `fmtDate` (all dayjs-based, local-time). Re-export from
`packages/ui/src/index.tsx` (note `.js` import extension convention). Migrating
class-workspace's local `toApiDate`/`fmtDate` to the shared version doubles as the
regression check that the extracted helper matches proven behavior.

## Open questions

1. terms-panel: convert native→Mantine for uniformity, or defer? (recommend defer)
2. Shared helper in `packages/ui` (cross-app, DRY) vs a per-app `apps/admin/src/lib`
   util? packages/ui chosen — dayjs already there, lms may reuse. Confirm no objection.
3. attendance-monthly regex/disabled-button guard becomes redundant with MonthPickerInput
   (format always valid) — keep guard as defense-in-depth, or simplify? (recommend keep.)
