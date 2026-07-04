# Phase 4 — Students DOB (DateInput, closes 3-way DOB inconsistency)

**Depends:** P0. **Owns:** `apps/admin/src/students-panel.tsx`. Single file, but it is the
trickiest useForm-DOB case and closes the 3-way DOB story.

## Field (verified)

`students-panel.tsx:259-263` — student DOB edit modal, `label="Ngày sinh"`,
`{...editForm.getInputProps('dateOfBirth')}`. `editForm` is a Mantine `useForm`; `dateOfBirth`
is a **string** field (placeholder "YYYY-MM-DD hoặc để trống để xóa" — empty string is a
meaningful value meaning "clear DOB").

## Implement

Import `{ DateInput } from '@mantine/dates'` + `{ toApiDate, parseApiDate } from '@cmc/ui'`.
Replace the spread (Date-into-string hazard) with manual wiring, option (a):
```tsx
<DateInput
  label="Ngày sinh" valueFormat="DD/MM/YYYY" clearable
  placeholder="Để trống để xóa"
  value={parseApiDate(editForm.values.dateOfBirth)}
  onChange={(d) => editForm.setFieldValue('dateOfBirth', toApiDate(d) ?? '')}
  error={editForm.errors.dateOfBirth}
/>
```
- `clearable` + `onChange(null)` → `toApiDate(null) ?? ''` → `''` = the existing "để trống để
  xóa" semantic. Preserve it exactly (empty string clears DOB; do NOT send `undefined` if the
  current submit path distinguishes `''` from absent).
- Verify the `onEdit`/submit handler reads `editForm.values.dateOfBirth` as a string — it stays a
  string, handler unchanged.
- Check `editForm` initialValues: `dateOfBirth` must init from the student's stored DOB as a
  `YYYY-MM-DD` string (or `''`). If it currently inits from an ISO datetime, `parseApiDate` only
  accepts `YYYY-MM-DD`; slice/normalize at init (`dob?.slice(0,10)`) so the picker shows the
  right day. Confirm during implementation by reading the `editForm` setup + `startEdit`.

## 3-way DOB unification (acceptance)

After this phase, DOB is `DateInput` in all three treatments:
- class-workspace.tsx:774 (already DateInput — reference),
- finance-panel.tsx:1386 (Phase 1),
- students-panel.tsx:259 (this phase).
Document in the phase commit that the DOB inconsistency is resolved.

## Validation

- Live: edit a student, set a DOB via picker, save, reopen — DOB shows the same day (no shift).
- Live: edit a student, clear the DOB (clearable X), save — DOB is removed (empty-string clear
  path works as before).
- Cross-check: the DOB set here displays consistently with the same student's DOB shown elsewhere.
- `pnpm -w typecheck`; `pnpm --filter @cmc/admin test`.
- `gitnexus_detect_changes` — only students-panel.tsx.
- code-reviewer: no `getInputProps` spread on DateInput; clear-to-empty semantic preserved;
  initialValues parse correct; submit handler untouched.

## Risks / rollback

- Init-value format mismatch (ISO vs `YYYY-MM-DD`) is the one real trap → normalize at init and
  verify with live reopen.
- Rollback: single-file revert.
