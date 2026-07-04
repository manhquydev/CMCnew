# Phase 3 — Class / Schedule time group (TimeInput)

**Depends:** P0 (trivially — imports no date-format helper). **Owns:** `class-workspace.tsx`
(session time fields only), `meetings-panel.tsx`, `shift-config-panel.tsx` (all `apps/admin/src/`).

Lowest-risk phase: `TimeInput` value is already an `HH:mm` string, no Date conversion.

## Fields (verified file:line)

| Site | Field | Pattern |
|---|---|---|
| class-workspace.tsx:700,701 | session Giờ bắt đầu/kết thúc (`startTime`/`endTime`) | local `useState` string, event onChange |
| meetings-panel.tsx:81 | meeting Giờ (`time`) | local `useState` string, event onChange |
| shift-config-panel.tsx:190,191 | shift template Bắt đầu/Kết thúc (`start`/`end`) | Mantine `useForm` string field |

## Implement

Import `{ TimeInput } from '@mantine/dates'` per file.

**Local-useState sites** (class-workspace, meetings-panel) — event onChange is unchanged, just
swap the component:
```tsx
<TimeInput label="Giờ bắt đầu" value={startTime}
  onChange={(e) => setStartTime(e.currentTarget.value)} />
```
Remove the `placeholder="08:00"` / `(HH:mm)` label hint (the picker makes format obvious); keep
label text otherwise.

**useForm site** (shift-config) — TimeInput keeps value as string, so `getInputProps` is a
genuine drop-in:
```tsx
<TimeInput label="Bắt đầu" withAsterisk {...tmplForm.getInputProps('start')} />
<TimeInput label="Kết thúc" withAsterisk {...tmplForm.getInputProps('end')} />
```
(Unlike DateInput, this spread is SAFE — form value stays string, matching the field type and the
submit handler. No conversion, no validation change.)

## Do NOT

- Do not set `withSeconds` — native default is `HH:mm`, matching the backend. Seconds would emit
  `HH:mm:ss` and break the format contract.
- class-workspace has many other date fields already correct — touch ONLY lines 700-701
  (session times). Run `gitnexus_impact` if editing anything shared; here it's local JSX only.

## Validation

- Live class-workspace: create a make-up session (buổi học bù), set start/end time, submit —
  confirm session persists with `HH:mm` times (read back exactly, no `:ss`).
- Live meetings-panel: chốt giờ họp with a time, confirm stored.
- Live shift-config: create a shift template with start/end, confirm stored `HH:mm`.
- `pnpm -w typecheck`; `pnpm --filter @cmc/admin test`.
- `gitnexus_detect_changes` — only these 3 files; no handler change.
- code-reviewer: confirm no `withSeconds`, emitted times are `HH:mm`, event wiring intact.

## Risks / rollback

- Empty time: native time input empty value is `''` — same as prior empty TextInput. Match
  existing required/optional behavior (shift start/end are `withAsterisk` required — unchanged).
- Rollback: per-file revert; independent.
