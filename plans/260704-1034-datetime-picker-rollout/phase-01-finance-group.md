# Phase 1 — Finance group (DateInput)

**Depends:** P0. **Owns:** `finance-panel.tsx`, `compensation-panel.tsx`, `revenue-report.tsx`,
`reconcile-worklist.tsx` (all `apps/admin/src/`). No overlap with other phases.

## Fields (verified file:line, current state)

| Site | Field | Pattern | Empty semantics today |
|---|---|---|---|
| finance-panel.tsx:162-167 | pricing `effectiveFrom` | `useForm` (priceForm) string, `withAsterisk` | required |
| finance-panel.tsx:354-363 | voucher `validFrom` / `validTo` | `useForm` (form) string, optional | optional, empty string |
| finance-panel.tsx:1386-1391 | payment-flow `studentDob` | local `useState` string, optional | optional, empty string |
| compensation-panel.tsx:137 | policy `effectiveFrom` | `useForm` string | required |
| revenue-report.tsx:86,87 | report `from` / `to` | local `useState` string | filter, may be empty |
| reconcile-worklist.tsx:87,88 | reconcile `from` / `to` | local `useState` string | filter, may be empty |

## Implement

Import `{ DateInput } from '@mantine/dates'` and `{ toApiDate, parseApiDate } from '@cmc/ui'`
per file (finance-panel, compensation-panel already may need the @mantine/dates import added;
revenue-report/reconcile-worklist need both).

**Local-useState sites** (finance-panel studentDob, revenue-report from/to, reconcile from/to):
```tsx
<DateInput
  label="..." valueFormat="DD/MM/YYYY" clearable
  value={parseApiDate(studentDob)}
  onChange={(d) => setStudentDob(toApiDate(d) ?? '')}
/>
```
Keep state as string — submit/query code that reads `studentDob`/`from`/`to` is UNCHANGED.

**useForm sites** (finance effectiveFrom/validFrom/validTo, compensation effectiveFrom) — use
option (a) from plan (form value stays string, submit handler untouched):
```tsx
<DateInput
  label="Hiệu lực từ" withAsterisk valueFormat="DD/MM/YYYY"
  value={parseApiDate(priceForm.values.effectiveFrom)}
  onChange={(d) => priceForm.setFieldValue('effectiveFrom', toApiDate(d) ?? '')}
  error={priceForm.errors.effectiveFrom}
/>
```
Do NOT spread `{...priceForm.getInputProps('effectiveFrom')}` onto DateInput — its onChange would
store a Date into a string field. Wire value/onChange/error manually as above. Keep any existing
validation rule (it validates the string, still a string).

## Match empty semantics

`toApiDate(null)` returns `undefined`; coerce to `''` (`?? ''`) at sites whose state/field is a
string and whose submit currently sends `''` for empty (all the optional ones). Required fields
(effectiveFrom) will fail existing validation if empty — unchanged behavior.

## Validation

- Live: create a pricing version (effectiveFrom) → submit → confirm it persists with the picked
  date; create a voucher with validFrom/validTo → confirm dates stored; run revenue-report with a
  Từ/Đến range → confirm the report queries the picked range (not shifted a day).
- DOB in payment flow: pick a DOB, complete the receipt/payment, confirm student DOB persists.
- `pnpm -w typecheck`; `pnpm --filter @cmc/admin test`.
- `gitnexus_detect_changes` — only these 4 files; no router/handler symbol changed.
- code-reviewer: confirm submit handlers untouched, emitted strings identical, empty-path parity.

## Risks / rollback

- Reviewer must catch any accidental `getInputProps` spread onto DateInput (Date-into-string bug).
- Rollback: revert per-file; each file independent.
