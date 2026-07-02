# Phase 02 — Gift / star / redeem admin

## Context

- Rewards API today: only `giftCreate` (`apps/api/src/routers/rewards.ts:17`), `gifts` list active-only (:11), `balance` (:52), `redeem` (:64), `pendingList` (:111), `review` approve/reject+refund+stock-restore (:133). No update/archive/stock-adjust; no manual star endpoint; redeem terminal at `approved`.
- Permissions registry: `rewards.giftCreate` + `rewards.review` both `['giam_doc_kinh_doanh']` (`packages/auth/src/permissions.ts:200`). Director gate = registry role (KD director), matching existing rewards actions.
- Star ledger: balance = SUM(amount) (`packages/domain-rewards/src/stars.ts:18`); `StarTxnType` includes `manual` (:9); partial unique `(type, reference) WHERE reference NOT NULL` (schema `:684-703`) — **manual rows MUST carry a non-null reference** or dedupe index is void.
- Enum `RewardStatus { pending approved rejected }` (`schema.prisma:537`). Admin UI: `apps/admin/src/rewards-panel.tsx` (create card + pending review table). Nav key `rewards` (`shell.tsx:439`, `App.tsx:705`).

## Requirements

- `giftUpdate` (name/starsRequired/stock/imageUrl/program), `giftArchive` (`isActive=false, archivedAt=now`), `stockAdjust` (set/increment absolute stock; `-1` stays unlimited) — all `requirePermission('rewards','giftUpdate'|'giftArchive'|'stockAdjust')`, audited via `logEvent` with `changes` diff.
- `starAdjust` (director-gated): `{ studentId, amount (+/- int, non-zero), reason (required) }` → writes ONE `StarTransaction {type:'manual', reference: randomUUID()}` (non-null ref satisfies partial index), audited (`entityType:'star_transaction'`, body includes reason). Balance recomputes from ledger — no cached column.
- Redeem lifecycle: extend `RewardStatus` with `delivered`; `markDelivered` (staff, `requirePermission('rewards','markDelivered')`) transitions `approved → delivered` only; `delivered` terminal (reject any other source status). Add gift/list surfaces to include archived for admin.

## Data flow

director edits gift → `giftUpdate` withRls(session) → update + logEvent → panel refetch. Manual adjust → `starAdjust` → insert manual ledger row → `balance` query reflects sum. Approved reward → staff `markDelivered` → status flips; second call on delivered row → BAD_REQUEST.

## Files

- MODIFY `packages/db/prisma/schema.prisma:537` — add `delivered` to `RewardStatus` (additive enum value). Generate migration `pnpm --filter @cmc/db prisma migrate dev`.
- MODIFY `packages/auth/src/permissions.ts:200` — add `giftUpdate`, `giftArchive`, `stockAdjust`, `starAdjust`, `markDelivered` → `['giam_doc_kinh_doanh']`.
- MODIFY `apps/api/src/routers/rewards.ts` — add the five procedures; reuse `withRls(rlsContextOf(ctx.session))` + `logEvent` pattern from `giftCreate`/`review`. Import `randomUUID` from `node:crypto` for manual ref.
- MODIFY `apps/admin/src/rewards-panel.tsx` — gift row actions (edit modal, archive, stock adjust); manual star-adjust card (student picker + amount + reason); "mark delivered" action in the approved/redemption table.

## Tests / validation

- Integration: `giftUpdate` changes fields + audit row; `giftArchive` drops gift from `gifts` active list. `stockAdjust` to 0 → `redeem` returns `out_of_stock`.
- Integration: `starAdjust +50 / -20` → `balance` moves by net 30; two calls each write a distinct manual row (distinct ref, both persist). `starAdjust` with amount 0 → rejected.
- Integration: `markDelivered` on approved → `delivered`; on pending or already-delivered → BAD_REQUEST (terminal).
- Manual: KD director sees new actions; non-director gets FORBIDDEN.

## Risks & rollback

| Risk | L×I | Mitigation |
|------|-----|------------|
| Manual row with null reference breaks partial-unique semantics / allows silent dup | M×M | Always set `reference = randomUUID()`; unit-assert non-null in router; distinct-ref test |
| Enum add reorders / migration drift | L×H | Additive value only (append); run `prisma migrate dev` + verify 0-drift before commit |
| Negative `starAdjust` drives balance below 0 | M×M | Allow (correction use-case) but audit; redeem still guards insufficient_stars at spend time |
| `markDelivered` race double-transition | L×M | Re-read status inside tx, reject if `!= 'approved'` (mirror `review` guard `:144`) |

- Rollback: revert router + panel + permissions edits. Enum value `delivered` is additive — leave in place (no data written unless markDelivered used); if must revert, no rows reference it so value drop is safe only if unused.
