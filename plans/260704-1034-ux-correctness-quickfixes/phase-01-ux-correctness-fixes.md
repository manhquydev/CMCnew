# Phase 1 — UX correctness fixes (3 independent edits)

## Context

- Source: `plans/reports/brainstorm-260704-1034-four-plan-decomposition-ux-auth-nav-report.md`
- Verified scout notes: `reports/planner-260704-1040-plan-a-scout-verification-report.md` (all file:line re-grepped)
- Lane: normal. Presentation / interaction-correctness only. No API/schema/business-logic change.

Three non-overlapping files. Implement + verify + commit each fix atomically.

---

## Fix 1 — class-status Select never reflects real status (`class-workspace.tsx`)

### Current state (verified)

- `apps/admin/src/class-workspace.tsx:1260-1264`: `<Select ... placeholder="Đổi trạng thái"
  data={['open','running','closed']} onChange={(v)=>v&&setStatus(v)} />` — **no `value`** → uncontrolled.
- Adjacent `StatusBadge status={batch.status} map={BATCH_STATUS_MAP} pill` (`:1251`) shows the real status.
- Rendered only when `batch.status !== 'cancelled'` (`:1258`); `cancelled` → separate "Mở lại" reopen button (`:1268`).
- `ClassStatus` = planned|open|running|closed|cancelled (`schema.prisma:51-57`); new batches default `planned`
  (`schema.prisma:243`, `class-batch.ts:128`).
- Local `setStatus` (`:1236-1243`) narrows param to `'open'|'running'|'closed'` and calls
  `trpc.classBatch.setStatus.mutate({id, status})` then `onChanged()`. Backend accepts full
  `nativeEnum(ClassStatus)` (`class-batch.ts:224`); terminal states cancel future meetings (`:239-245`).

### Decision D1 (RESOLVE BEFORE CODING — top red-team target)

The brainstorm proposed "bind `value={batch.status}`". **That naive bind is unsafe**: for a `planned`
batch (the default for every newly created class) `planned` is not in `data`, so Mantine renders the
Select **blank** — replacing one wrong state with another. Two coherent resolutions:

**Option A — Controlled status field (full operational enum).**
Bind `value={batch.status}`; expand `data` to labelled options for the four non-cancelled states
(`planned/open/running/closed`, labels from `BATCH_STATUS_MAP`); widen local `setStatus` param type;
guard `onChange={(v) => v && v !== batch.status && setStatus(v)}`.
- Pro: Select mirrors the badge exactly (literal reading of the brainstorm).
- Con: offers `planned` as a manual target → a running/closed→planned "soft rewind" that bypasses the
  dedicated `reopen` flow (which captures a reason + audit). Redundant with the adjacent badge. More churn.

**Option B — Explicit action picker (RECOMMENDED, KISS/DRY).**
Keep `data=['open','running','closed']` (forward operational transitions). Make the Select explicitly
controlled to ALWAYS show its placeholder: add `value={null}`. The adjacent `StatusBadge` stays the single
source of truth for current status; the Select is a "change status to →" action, consistent with the
sibling "Hủy lớp"/"Mở lại" action buttons.
- Pro: fixes the actual latent defect (after picking "closed" the uncontrolled Select keeps displaying
  "closed" instead of resetting); avoids the `planned`-renders-blank trap entirely; zero new transition
  surface; smallest diff.
- Con: diverges from the brainstorm's off-hand wording (Select does not display current status — but the
  badge already does, so this is intentional, non-redundant IA).

**Recommendation: Option B.** It is the DRY/correct information architecture (badge = state, Select =
action) and sidesteps the `planned` edge case. Flag for red-team / user confirmation; if the user insists
the dropdown must *display* current status, fall back to Option A (with `planned` included so it never
blanks).

### Steps (Option B)

1. Add `value={null}` to the `<Select>` at `:1260-1264` (keep `data`, `placeholder`, `onChange`).
2. Optionally keep the `onChange` no-op-safe (it already guards `v &&`). Leave `setStatus` type as-is.
3. Do NOT touch `setStatus`, `reopen`, `cancel`, or backend.

> Scope note: the pre-existing `closed → open` transition offered by this Select (which bypasses the
> `reopen` reason/audit that only fires for the `cancelled` → "Mở lại" path) is PRE-EXISTING behavior,
> deliberately left untouched by Option B. Option B keeps `data` unchanged and does not widen it, so it
> neither introduces nor removes that transition — a reviewer should not attribute it to this fix.

### Validation (live, not just typecheck)

- Log into admin on the running stack; open a class in each state:
  - **new/`planned` batch** → Select shows placeholder "Đổi trạng thái" (NOT blank), badge shows "Đã lên kế hoạch".
  - `open`/`running`/`closed` batch → Select shows placeholder; badge shows the true state.
- Pick "closed" from the Select → mutation fires, badge updates to "Đã đóng", Select snaps back to placeholder.
- Confirm terminal-state meeting cancel still works (integration test green; no backend diff).

---

## Fix 2 — dead-click + misleading cursor on action cell (`shift-reg-list-panel.tsx`)

### Current state (verified)

- `:89` `<Table.Tr key={r.id} style={{ cursor:'pointer' }}>`.
- Data cells `:90,93,96,99,102` each have `onClick={() => onSelect(r.id)}`.
- Action cell `:105` has NO `onClick`; contains `<Button>`s (`:107-118`) with their own handlers.
- Row-select is per-`Td`, not on the `Tr` → buttons already independent (no propagation conflict). Only
  defect: whitespace of the action cell inherits `cursor:pointer` from the `Tr` but does nothing.

### Steps (KISS — honest affordance)

1. Remove `style={{ cursor:'pointer' }}` from the `<Table.Tr>` (`:89`).
2. Add `style={{ cursor:'pointer' }}` to the five data cells that already carry `onClick`
   (`:90,93,96,99,102`). (Define a `const CLICK_CELL = { cursor:'pointer' } as React.CSSProperties;`
   near `TH_STYLE` to keep it DRY, or inline — implementer's call; one small const preferred.)
3. Leave the action `Td` (`:105`) with neither cursor nor onClick.

Rejected alt: add `onClick={()=>onSelect(r.id)}` to the action `Td` + `stopPropagation` on each button —
more churn, introduces a propagation concern that doesn't exist today.

### Validation

- Open the shift-registration list; hover the action cell whitespace → **no** pointer cursor, no select.
- Hover a data cell → pointer cursor; click → row opens/selects.
- Action buttons (Sửa/Xem, Duyệt, Từ chối) still fire their own handlers.

---

## Fix 3 — normalize raw `<input type="date">` to Mantine `DateInput` (`shift-reg-detail-panel.tsx`)

### Current state (verified)

- `:360-361`, `:365-366`: raw `<input type="date" value={fromDate|toDate}
  onChange={(e)=>setFromDate(e.target.value)} style={{...}} />`.
- `fromDate`/`toDate` are `YYYY-MM-DD` **strings** (`:334-337`). `onCreate(from:string,to:string)` (`:333`),
  disabled guard `fromDate > toDate` string-compares (`:370`). `dayjs` imported (`:2`).
- `@mantine/dates@^7.15.2`: `DateInput.value` = `Date|null`, `onChange` = `(d:Date|null)=>void` (matches
  `class-workspace.tsx:126-127,249`). App convention: `valueFormat="DD/MM/YYYY"`.

### Steps (KISS — keep string state, convert at boundary)

1. Add import: `import { DateInput } from '@mantine/dates';`.
2. Replace the two raw inputs with:
   ```tsx
   <DateInput
     value={fromDate ? dayjs(fromDate).toDate() : null}
     onChange={(d) => setFromDate(d ? dayjs(d).format('YYYY-MM-DD') : '')}
     valueFormat="DD/MM/YYYY"
   />
   ```
   and likewise for `toDate`/`setToDate`. Keep the surrounding `<div>` + label `<Text>` (`:358-359,363-364`).
   > Note: parse with `dayjs(fromDate).toDate()` (local midnight), NOT `new Date(fromDate)` —
   > `new Date('YYYY-MM-DD')` parses as UTC midnight (off-by-one in negative-TZ; benign in Vietnam
   > UTC+7 but the snippet may be copied elsewhere). `dayjs(...)` parses local, is tz-robust, and
   > matches the `dayjs` already used in this file.
3. Do NOT change state types, `onCreate`, `handle`, or the `fromDate > toDate` disabled guard — the string
   `YYYY-MM-DD` contract is preserved, so the guard and API call are untouched.
4. Inline the dayjs conversion (do NOT export/reuse `class-workspace.tsx`'s local `toApiDate` — YAGNI, no
   shared helper for one file).

### Validation

- Open "Tạo phiếu đăng ký ca"; both "Từ ngày"/"Đến ngày" render a Mantine `DateInput` (DD/MM/YYYY),
  visually consistent with class-workspace date fields.
- Defaults populate (today / +1 month). Pick dates; set from > to → "Tạo phiếu" disabled. Set valid range →
  create succeeds, phiếu appears in list with correct dates.

---

## Files

- Modify: `apps/admin/src/class-workspace.tsx` (Fix 1)
- Modify: `apps/admin/src/shift-reg-list-panel.tsx` (Fix 2)
- Modify: `apps/admin/src/shift-reg-detail-panel.tsx` (Fix 3)
- Create/Delete: none.

## Tests / gates

- `pnpm -w typecheck`; `@cmc/admin` unit tests; ESLint. (Run by orchestrator — Bash may be unavailable to the planner.)
- `gitnexus_impact` on `setStatus` (Fix 1) before edit — expect front-end display-only change, no backend blast.
- `gitnexus_detect_changes` before each commit — only the one expected file.
- `code-reviewer` per fix: correctness-only diff, no handler/mutation altered.
- Playwright live-verify per the per-fix Validation sections above.

## Risks / rollback

- Each fix is one file and independently revertible (3 atomic `fix(ui): …` commits). Rollback = revert the
  single commit; no data/schema/migration involvement, no cascading impact.
- Highest residual risk is Decision D1 (Fix 1). If unresolved at implementation time, ship Fixes 2 & 3 first
  (no open decision) and hold Fix 1 for confirmation.

## Commit messages (no plan IDs / phase numbers in commit text)

- `fix(ui): keep class-status control on placeholder; badge is source of truth`
- `fix(ui): drop misleading pointer cursor on shift-reg action cell`
- `fix(ui): use Mantine DateInput for shift-reg create date range`
