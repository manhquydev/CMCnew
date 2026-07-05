---
title: "Plan A scout verification — 3 UX-correctness quick-fixes (re-verified against live code)"
date: 2026-07-04
type: planner-scout-report
plan: plans/260704-1034-ux-correctness-quickfixes
---

## Purpose

Re-grepped every file:line and symbol from the brainstorm report before authoring Plan A.
Scout summaries go stale; below is the re-verified ground truth (cited).

## Fix 1 — class-status Select uncontrolled (class-workspace.tsx)

- `apps/admin/src/class-workspace.tsx:1260-1264` — `<Select size="xs" w={130} placeholder="Đổi trạng thái" data={['open','running','closed']} onChange={(v)=>v&&setStatus(v)} />` — **no `value` prop** (uncontrolled). CONFIRMED.
- Adjacent `StatusBadge status={batch.status} map={BATCH_STATUS_MAP} pill` at `:1251`. CONFIRMED — shows true current status.
- `ClassStatus` enum = `planned | open | running | closed | cancelled` (`packages/db/prisma/schema.prisma:51-57`). 5 values.
- Schema default: `status ClassStatus @default(planned)` (`schema.prisma:243`). Backend `create` explicitly sets `status: 'planned'` (`apps/api/src/routers/class-batch.ts:128`). **New batches are `planned`.**
- The Select renders only inside `batch.status !== 'cancelled'` branch (`class-workspace.tsx:1258`). When `cancelled`, a separate "Mở lại" (reopen) button shows instead (`:1268`, calls `trpc.classBatch.reopen` with `toStatus:'planned'` + reason, `:1227-1229`).
- So statuses the Select can face: **`planned` (default/new), `open`, `running`, `closed`** — but `data` lists only 3, MISSING `planned`.
- Backend `classBatch.setStatus` input = `z.nativeEnum(ClassStatus)` (`class-batch.ts:224`) — accepts ALL 5, no transition guard. Front-end local `setStatus` narrows param type to `'open'|'running'|'closed'` (`class-workspace.tsx:1238`).
- `setStatus` into a terminal state (`closed`/`cancelled`) soft-cancels future parent meetings (`class-batch.ts:239-245`). `TERMINAL_STATUSES=['closed','cancelled']` (`:14`).
- Existing test touches this path: `class-close-cancels-future-meetings.int.test.ts` (per GitNexus + `plans/reports/fullstack-260624-1936-...`). Backend behavior — not affected by a front-end `value` bind, but must not regress.

**CRUX (the trap):** the brainstorm's off-hand fix "bind `value={batch.status}`" is UNSAFE as-is — for a `planned` batch (the most common initial state) `planned` is not in `data`, so Mantine renders the Select **blank**. See Decision D1 in the phase file.

## Fix 2 — shift-reg-list dead-click (shift-reg-list-panel.tsx)

- `apps/admin/src/shift-reg-list-panel.tsx:89` — `<Table.Tr key={r.id} style={{ cursor:'pointer' }}>`. CONFIRMED.
- Cells 1-5 (`:90,93,96,99,102`) each carry `onClick={() => onSelect(r.id)}`. The "Thao tác" cell (`:105`) has **NO `onClick`** and contains action `<Button>`s (`:107-118`). CONFIRMED.
- Row-select is wired per-`Td`, NOT on the `Tr` → buttons already fire independently; there is **no event-propagation conflict** today. The only defect: whitespace in the action cell shows a `cursor:pointer` (inherited from the `Tr` style) but does nothing = misleading affordance + dead click.
- Codebase doctrine (brainstorm): `data-table.tsx` sets `cursor:pointer` only when clickable. This instance violates that on the action cell.

## Fix 3 — raw date input (shift-reg-detail-panel.tsx)

- `apps/admin/src/shift-reg-detail-panel.tsx:360-361, 365-366` — raw `<input type="date" ... style={{...}}>` for "Từ ngày"/"Đến ngày". CONFIRMED (not Mantine).
- State: `fromDate`/`toDate` are `YYYY-MM-DD` **strings** (`:334-337`, seeded via `dayjs().format('YYYY-MM-DD')`).
- Contract to preserve: `onCreate(from: string, to: string)` (`:333,343`); disabled guard uses **string** comparison `fromDate > toDate` (`:370`) — valid for ISO `YYYY-MM-DD`.
- `dayjs` already imported (`:2`). `@mantine/dates@^7.15.2` (`apps/admin/package.json:20`); in this version `DateInput.value` = `Date | null`, `onChange` = `(d: Date|null)=>void` (confirmed by existing usage `class-workspace.tsx:126-127,249` — `useState<Date|null>` bound to `DateInput`).
- Rest-of-app convention: `DateInput ... valueFormat="DD/MM/YYYY"` (`class-workspace.tsx:249-250,559-560,698`).
- Local `toApiDate` helper exists but is NOT exported (`class-workspace.tsx:82`) — inline the dayjs conversion in this file (YAGNI; no shared helper).

## Plan B coordination (must-state)

`shift-reg-detail-panel.tsx` date inputs are claimed by **Plan A** (it is raw HTML, a correctness/consistency defect, not merely a picker upgrade). Plan B (date/time picker rollout) must **exclude** this file to avoid double-ownership.

## Unresolved

- D1 (Fix 1 design): controlled status-field vs action-picker. Recommendation + options in phase file. Top red-team target.
