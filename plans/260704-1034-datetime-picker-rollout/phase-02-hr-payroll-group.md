# Phase 2 — HR / Payroll group (DateInput + MonthPickerInput)

**Depends:** P0. **Owns:** `staff-profile.tsx`, `payroll-panel.tsx`, `kpi-evaluation-panel.tsx`,
`attendance-monthly-report-panel.tsx` (all `apps/admin/src/`).

## Fields (verified file:line)

| Site | Field | Picker | Pattern |
|---|---|---|---|
| staff-profile.tsx:161 | `startedAt` Ngày vào làm | DateInput | plain `setForm({...form})` object, string; no @mantine/dates import yet |
| payroll-panel.tsx:105-112 | `periodKey` Kỳ (Tóm tắt kỳ lương) | MonthPickerInput | local `useState` string (state ~:76) + regex guard |
| payroll-panel.tsx:240-245 | `periodKey` Kỳ (Tính lương mới) | MonthPickerInput | local `useState` string (state ~:186) |
| kpi-evaluation-panel.tsx:435-441 | `periodKey` Kỳ lương | MonthPickerInput | local `useState` string |
| attendance-monthly-report-panel.tsx:59-66 | `periodKey` Kỳ | MonthPickerInput | local `useState` string + regex + disabled-button guard |

## Implement

**staff-profile `startedAt`** — import `{ DateInput }` + `{ toApiDate, parseApiDate }`:
```tsx
<DateInput
  label="Ngày vào làm" valueFormat="DD/MM/YYYY" clearable
  value={parseApiDate(form.startedAt)}
  onChange={(d) => setForm({ ...form, startedAt: toApiDate(d) ?? '' })}
/>
```
(plain object state — same manual value/onChange approach; submit reads `form.startedAt` string,
unchanged.)

**Month pickers** — import `{ MonthPickerInput }` + `{ toApiMonth, parseApiMonth }`:
```tsx
<MonthPickerInput
  label="Kỳ (YYYY-MM)" valueFormat="YYYY-MM" clearable={false}
  value={parseApiMonth(periodKey)}
  onChange={(d) => setPeriodKey(toApiMonth(d) ?? '')}
  w={150}
/>
```
Keep `periodKey` state as string → all downstream load/query code UNCHANGED.

**attendance-monthly**: MonthPickerInput guarantees `YYYY-MM` format, so the regex `error` prop
and `disabled={!periodKey.match(...)}` on the button become redundant. **Keep them** (defense in
depth; harmless — MonthPickerInput can't produce an invalid string, so the guard just never
fires). Optionally drop the `error` prop since it can never show; leave the disabled-button guard
so an empty period still blocks the load call.

## Validation

- Live staff-profile: edit a staff member, set Ngày vào làm, save, reopen — date persists, no
  day-shift.
- Live payroll: pick a Kỳ, run payroll calc/load — confirm it targets the right month
  (`YYYY-MM`), results non-empty for a month with data.
- Live kpi + attendance-monthly: pick Kỳ, load report — data for the correct month.
- `pnpm -w typecheck`; `pnpm --filter @cmc/admin test`.
- `gitnexus_detect_changes` — only these 4 files.
- code-reviewer: emitted `YYYY-MM`/`YYYY-MM-DD` identical to before; load/query handlers untouched.

## Risks / rollback

- MonthPickerInput default `valueFormat` differs across versions — set `valueFormat="YYYY-MM"`
  explicitly so the displayed text matches the domain label; the *emitted* string comes from
  `toApiMonth` (dayjs), independent of display format, so submit is safe regardless.
- Rollback: per-file revert; independent.
