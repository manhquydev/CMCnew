# Phase 03 — Badge admin UI — completion report

## Status: DONE

## Files modified

- CREATE `apps/admin/src/badge-panel.tsx` (~260 lines) — mirrors `rewards-panel.tsx` structure: facility `Select` → `BadgeListCard` (table: code/name/criteria summary/active-archived badge, director-only "Lưu trữ" action) → `BadgeCreateCard` (director-only, name/code/description/iconUrl + criteria-kind `Select` + `gte` `NumberInput`) → `GrantCard` (student `Select` + active-badge `Select`, both roles, toasts "Đã cấp huy hiệu" / "Học sinh đã có sẵn huy hiệu này" based on the server's `{awarded}` boolean).
- MODIFY `apps/admin/src/shell.tsx` — added `'badges'` to `SectionKey` union, `IconAward` import, nav item (`{ key: 'badges', label: 'Huy hiệu', icon: <IconAward/>, visible: visible('badges') }`) placed right after `rewards`, `SECTION_TITLES.badges = 'Huy hiệu'`.
- MODIFY `apps/admin/src/nav-permissions.ts` — added `badges: { kind: 'permission', module: 'badge', action: 'list' }` to `NAV_GATES`. Note: the codebase has moved past the plan's cited hardcoded-`visible()` pattern to a registry-driven `NAV_GATES` map (comment in shell.tsx: "No hardcoded role arrays here"); wired into that current pattern instead of the stale one the plan described.
- MODIFY `apps/admin/src/App.tsx` — added `BadgePanel` import, `'badges'` to `ALL_SECTION_KEYS` (the actual "ordering array" — it's a `Set<string>`, not an array, contra the plan's description; same additive-edit shape), `case 'badges'` render branch after `case 'rewards'`.
- MODIFY `apps/admin/src/shallow-trpc.ts` — added `BadgeRow` type + `badgeApi` shallow-typed proxy (`list`/`create`/`archive`/`grant`). Required because `Awaited<ReturnType<typeof trpc.badge.list.query>>` triggers `TS2589 (excessively deep type instantiation)` — the same pre-existing issue documented in `DEBT.md` for other routers returning Prisma `Json` columns (`badge.unlockCriteria` is `Json`). Followed the established `payrollApi`/`compensationApi` pattern already in this file rather than reinventing one.

## Tasks completed

- [x] Facility picker → badge list table (name/code/criteria summary — "Đạt N sao" / "Hoàn thành N bài tập" — /active-archived badge)
- [x] Create form (director-only) → `badge.create`, refetches list on success
- [x] Archive action on active rows (director-only) → `badge.archive`, refetches
- [x] Grant card (student + badge picker, both roles) → `badge.grant`, surfaces `{awarded}` as the two specified toasts, no client-side re-grant prevention (server-side no-op is authoritative)
- [x] Client-side hide of create/archive via `can(me.roles, me.isSuperAdmin, 'badge', 'create'|'archive')` from `@cmc/auth/permissions` (same pattern as `courses-panel.tsx`) — UX only, server `requirePermission` remains the real gate
- [x] Nav wiring: `SectionKey`, nav item, `SECTION_TITLES`, `NAV_GATES`, `ALL_SECTION_KEYS`, render switch — all edited in one pass

## Tests / validation

- Type check: **pass** — `pnpm --filter @cmc/admin typecheck` clean, zero errors.
- Nav consistency tests: ran all four `apps/admin/src/__tests__/nav-*.test.ts` files (27 tests). 26 pass. One pre-existing failure (`nav-consistency.test.ts` D3, `payroll.kpiList`/`hr` role) reproduces identically on a clean `git stash` of my changes — confirmed unrelated to this phase (looks like drift from concurrent Plan6 P1/P2 work touching `packages/auth/src/permissions.ts`).
- Manual logic verification (read-through, no browser):
  - Director session (`giam_doc_dao_tao`): `can(..., 'badge', 'list')` true → nav visible; `can(..., 'badge', 'create')` and `'archive'` true → `BadgeCreateCard` renders, archive buttons render on active rows.
  - Teacher session (`giao_vien`): `badge.list` true → nav visible, list+grant render; `badge.create`/`archive` false → create card and archive buttons do not render.
  - Any other role (e.g. `sale`, `ke_toan`): `badge.list` false → `NAV_GATES.badges` gate fails → nav item hidden entirely via `visible('badges')`.
  - Re-grant flow: `badgeApi.grant.mutate` always reflects the server's actual `{awarded}` result in the toast; no client dedupe/prevention logic added, per spec.
- No new integration tests written — API is pre-covered per phase spec (badge router unchanged).
- Build: not run (no `build` invoked per acceptance criteria — only typecheck was required); typecheck is the acceptance gate and it's green.

## Deviations from the plan doc

- Line numbers cited in the plan (`shell.tsx:38`, `:434-441`, `:369`, `:487`; `App.tsx:41-50`, `:490`, `:705`) had drifted from current state — re-grepped exact locations before editing, as the plan itself anticipated ("may have drifted").
- Nav gating uses the current `NAV_GATES` registry pattern (`nav-permissions.ts`), not the plan's described hardcoded `visible(key)` role-array pattern — the codebase migrated to the registry approach since the plan was written. Functionally equivalent (still driven by `can()` off `packages/auth/src/permissions.ts`), just wired through the current indirection layer.
- Added a `badgeApi` shallow-typed proxy in `shallow-trpc.ts` (not mentioned in the plan's file list) to work around a pre-existing TS2589 issue with Prisma `Json` fields in tRPC output inference — same fix pattern already used for `payroll`/`compensation` routers in this exact file. Did not touch any other panel's use of `trpc.badge.*` (none exist — this is the only consumer of the badge router in `apps/admin`).

## Concerns / Blockers

None. This phase is fully independent — no file overlap with P1/P2/P4 as the plan stated.

Status: DONE
Summary: Badge admin UI shipped as a new `badge-panel.tsx` mirroring `rewards-panel.tsx`, wired into nav via the current `NAV_GATES` registry pattern (not the plan's stale hardcoded-visible() description), with a `shallow-trpc.ts` type escape hatch for the pre-existing Json-field TS2589 issue. Admin typecheck clean; 26/27 nav tests pass with the 1 failure confirmed pre-existing/unrelated (reproduces on unmodified tree).
Concerns/Blockers: None.
