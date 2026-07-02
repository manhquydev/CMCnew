# Phase 03 — Badge admin UI

## Context

- Badge API is COMPLETE, zero admin UI: `badge.list` (incl archived, `apps/api/src/routers/badge.ts:35`), `create` (criteria form `:56`), `archive` (`:92`), `grant` (teacher/director, idempotent no-op re-grant `:106`, `:125`), `myBadges` (LMS `:17`). No changes needed to the API.
- Criteria discriminated union: `stars_total {gte}` | `homework_count {gte}` (`badge.ts:10`).
- Permissions: `badge.list`+`grant` = `['giao_vien','giam_doc_dao_tao']`; `create`+`archive` = `['giam_doc_dao_tao']` (`packages/auth/src/permissions.ts:46`).
- Admin nav: `SectionKey` union (`apps/admin/src/shell.tsx:38`), nav item list (`:434-441` group; add near `rewards` `:439`), `visible(key)` gate (`:369`), `SECTION_TITLES` (`:487`). Render switch in `apps/admin/src/App.tsx` (rewards case `:705`); panel import block (`:41-50`). Nav key ordering array `App.tsx:490`.
- **This phase is fully independent** — no shared files with P1/P2/P4 (new panel + additive nav wiring only). API complete → no schema/router/permission change.

## Requirements

- New `apps/admin/src/badge-panel.tsx`: facility picker (reuse rewards-panel facility source pattern) → `badge.list` table (name, code, criteria summary, active/archived badge). Create form (name/code/description/iconUrl + criteria kind select + gte NumberInput → `badge.create`). Archive action per active row (`badge.archive`). Grant card: student picker + badge select → `badge.grant`; surface `{awarded}` result (toast "đã cấp" vs "đã có sẵn").
- Wire nav: add `'badges'` to `SectionKey`, nav item (`IconAward`/`IconMedal`), `SECTION_TITLES`, ordering array, and a `case 'badges'` in App.tsx render switch. Visibility follows `badge.list` roles (GV + GĐ đào tạo); create/archive controls hidden unless director (client gate mirrors server, server is source of truth).

## Data flow

director/teacher opens Huy hiệu → `badge.list({facilityId})` → table. Create (director only) → `badge.create` → refetch. Grant → `badge.grant({studentId,badgeId})` → toast; re-grant owned → `awarded:false` no-op (guaranteed server-side `:125`).

## Files

- CREATE `apps/admin/src/badge-panel.tsx` — mirror `rewards-panel.tsx` structure (Card/Table/Modal/useForm from `@cmc/ui` + Mantine; `notifyError`/`notifySuccess`).
- MODIFY `apps/admin/src/shell.tsx` — `SectionKey` (:38), nav item (:439 area), `SECTION_TITLES` (:487).
- MODIFY `apps/admin/src/App.tsx` — import `BadgePanel` (:41-50), ordering array (:490), render `case 'badges'` (near :705).

## Tests / validation

- Manual: GĐ đào tạo sees create+archive+grant; GV sees list+grant only, no create/archive control; other roles: nav item hidden (`visible('badges')` false).
- Manual: create badge → appears in list; archive → shows archived badge; grant to a student twice → first "đã cấp", second "đã có sẵn" (no duplicate).
- No new integration tests (API pre-covered); typecheck + admin build must pass.

## Risks & rollback

| Risk | L×I | Mitigation |
|------|-----|------------|
| Nav union/title/ordering desync → runtime "unknown section" | M×M | Edit all four spots (SectionKey, item, titles, ordering) in one pass; typecheck catches union gaps |
| Client shows create to GV (no server enforcement) | L×M | Server `requirePermission` is source of truth; client hide is UX only — GV click still FORBIDDEN |
| facilityId source differs from rewards-panel | L×L | Reuse the same facilities query rewards-panel uses |

- Rollback: delete `badge-panel.tsx`, revert the four additive nav edits. No API/schema change → nothing else to undo.
