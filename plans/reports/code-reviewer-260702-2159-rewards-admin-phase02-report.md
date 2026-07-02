# Code Review — Phase 02 gift/star/redeem admin

## Scope
- `packages/db/prisma/schema.prisma` (RewardStatus enum)
- `packages/db/prisma/migrations/20260702144852_reward_status_delivered/migration.sql`
- `packages/auth/src/permissions.ts` (rewards.* block)
- `apps/api/test/fixtures/permission-snapshot.json` (rewards.* entries)
- `apps/api/src/routers/rewards.ts` (giftUpdate/giftArchive/stockAdjust/starAdjust/markDelivered/giftListAdmin)
- `apps/admin/src/rewards-panel.tsx`
- `apps/api/test/rewards-gift-star-redeem-admin.int.test.ts`

## Verification run
- `npx vitest run --config vitest.integration.config.ts test/rewards-gift-star-redeem-admin.int.test.ts test/reward-review-refund.int.test.ts test/star-redeem.int.test.ts` → 3 files, 9 tests, all pass.
- `npx vitest run test/permission-parity.test.ts` → 26/26 pass.
- `pnpm --filter @cmc/api typecheck` → clean.
- `pnpm --filter @cmc/admin typecheck` → clean.
- `prisma migrate diff --from-schema-datasource ... --to-schema-datamodel ...` → "No difference detected" (0 drift, dev DB port 5433).

## Critical-check results (a–f)

**(a) starAdjust non-null reference** — `rewards.ts:277-285`: `tx.starTransaction.create({ ..., type: 'manual', reference: randomUUID() })`. Confirmed unconditional, every call. `schema.prisma:685-703` shows the partial index is `@@index([type, reference])` described in the doc comment as backed by a raw-SQL partial unique index (not visible as a Prisma `@@unique` because Postgres can't express the partial predicate there). Since every manual row gets a fresh random UUID, the index can never actually be hit for manual entries — it's structurally impossible to violate uniqueness with this code, which also means the partial index provides zero dedup protection for `starAdjust` (by design: manual corrections are meant to be distinct, non-idempotent). Test at `rewards-gift-star-redeem-admin.int.test.ts:117-135` asserts distinct references via `Set` size — genuine, not just a smoke test. **Verified correct.**

**(b) markDelivered race guard** — `rewards.ts:304-308` re-reads `before = tx.reward.findUniqueOrThrow(...)` inside the transaction, checks `before.status !== 'approved'`, then updates. This exactly mirrors `review`'s pattern at `rewards.ts:151-154`. **Caveat (see Medium finding below): this is not actually race-safe** — same weakness class as the pre-existing `review` procedure it mirrors. The update statement has no `status` guard in its `WHERE` clause (Prisma `update({ where: { id } })` only), so a concurrent second call that read the row before the first committed will still execute its `UPDATE` (blocking on the Postgres row lock, then proceeding unconditionally once unblocked) rather than hitting the `BAD_REQUEST` path. For `markDelivered` the observable end-state is idempotent (`approved→delivered` twice ends at `delivered`), so no data corruption, but the terminal-state error guarantee the plan describes does not actually hold under concurrency, and each racing call writes a duplicate audit row. This is inherited from `review`'s existing pattern, not a new regression, but it means "mirrors the existing guard" is true and *also* true of the underlying weakness.

**(c) stockAdjust absolute set** — `rewards.ts:246-262`: `tx.gift.update({ where: { id }, data: { stock: input.stock } })` — a plain absolute set, not `increment`/`decrement`. Matches the plan's "set/increment absolute stock; -1 stays unlimited" language and the code comment "Absolute stock set." **Verified correct**, distinct from `redeem`'s atomic `decrement`.

**(d) delivered enum additive migration** — `migration.sql`: `ALTER TYPE "RewardStatus" ADD VALUE 'delivered';` — a genuine append via `ADD VALUE`, not a drop/recreate or reorder. Postgres enum `ADD VALUE` is safe and non-blocking for reads. `prisma migrate diff` confirms 0 drift. **Verified correct.**

**(e) Director-gating enforcement** — All 6 procedures (`giftUpdate`, `giftArchive`, `stockAdjust`, `starAdjust`, `markDelivered`, `giftListAdmin`) are built on `requirePermission('rewards', <action>)` (`trpc.ts:69-77`), which throws `FORBIDDEN` unless `can(...)` returns true or `ctx.session.isSuperAdmin`. Registry entries in `permissions.ts` and the procedure-level `requirePermission` calls match 1:1 for the 5 assigned procedures. **Verified via actual enforcement code, not just registry presence** — confirmed by the `non-director gets FORBIDDEN on all 5 new procedures` test, which genuinely exercises the FORBIDDEN path for each (`rewards-gift-star-redeem-admin.int.test.ts:183-199`) and passed.
- **Gap:** `giftListAdmin` is gated on the `giftUpdate` permission key rather than a new `rewards.giftListAdmin` registry entry — a deliberate reuse documented in a code comment (`rewards.ts:18-20`). Enforcement is real (same `requirePermission` mechanism), but **no test exercises `giftListAdmin`'s FORBIDDEN path or its data at all** — it is not called anywhere in the new integration test file. The "non-director FORBIDDEN on all 5" test title and coverage literally excludes the 6th (extra, approved) procedure. Low-risk given it reuses an already-gated permission key, but it is untested and should get a one-line coverage addition.

**(f) giftListAdmin data exposure** — `rewards.ts:21-23`: `tx.gift.findMany({ orderBy: { createdAt: 'desc' } })`, no `where`, no `select`. This deliberately includes archived gifts (`isActive:false`), which is correct per the plan's "Add gift/list surfaces to include archived for admin" requirement. Fields returned (`schema.prisma:666-679`: id, facilityId, name, description, imageUrl, starsRequired, stock, program, minLevel, isActive, archivedAt, createdAt) contain no PII, secrets, or cross-tenant identifiers — facility scoping is enforced by RLS via `withRls(rlsContextOf(ctx.session))`, same as every other staff query in this file. **No leak found.**

## Fact-check on task framing
The task description states the extra `giftListAdmin` procedure was added "after flagging the gap to the orchestrator and getting explicit approval (documented in the report)." The report itself (`reports/from-fullstack-developer-to-orchestrator-phase-02-completion-260702-2145.md:11,47`) says the opposite: *"flagged to team-lead mid-task, no reply received within the stated wait window, proceeded with the documented default."* This is a self-selected default under an unanswered escalation, not an approval. Functionally the change is small, well-scoped, and RLS/permission-safe (see (e)/(f) above), so I am not blocking on it, but the "explicit approval" framing does not match the primary source document — treat the orchestrator sign-off as still outstanding per the implementer's own "Unresolved questions" section.

## Findings

### High Priority
None.

### Medium Priority
1. **`markDelivered`/`review` status-transition race is not actually race-safe** (`apps/api/src/routers/rewards.ts:304-308`, inherited pattern from `:151-154`) — the pre-update status check happens before any row lock is taken; Postgres only serializes at the `UPDATE` statement itself, which has no `status` condition in its `WHERE`. A genuine concurrent double-call bypasses the intended `BAD_REQUEST` terminal-state guard and both calls succeed, writing two audit rows. For `markDelivered` specifically the impact is limited to a duplicate audit entry (end state is idempotent), so this is not a correctness blocker for this diff, but it does not deliver the race-safety the plan's risk table promised ("re-read status inside tx" was intended as the mitigation and does not fully achieve it without `SELECT ... FOR UPDATE` or a conditional `updateMany({ where: { id, status: 'approved' } })`). Recommend a follow-up: change the update to `updateMany({ where: { id, status: 'approved' }, data: {...} })` and check `count === 0` to reject, mirroring `redeem`'s atomic stock guard pattern already in this same file (`rewards.ts:87-93`).

### Low Priority
2. **`giftListAdmin` has zero test coverage** — no test calls `trpc.rewards.giftListAdmin`, so neither its FORBIDDEN path for non-directors nor its archived-gift inclusion is verified by the new suite. Given it's a new read surface added outside the original 5-procedure scope, it deserves at least the same FORBIDDEN assertion the other 5 procedures get.
3. **`giftListAdmin` reuses the `giftUpdate` permission key** instead of a dedicated registry entry — works today (single role has both), but couples a read surface's authorization to a write action's key; if `giftUpdate`'s role set ever changes without considering read-only admins, `giftListAdmin` silently changes exposure too. Documented in a code comment, low risk, worth a real registry entry in a later pass.

## Positive observations
- `starAdjust`'s deliberate omission of the advisory lock is explicitly documented as an accepted trade-off in both the plan's risk table and the router comment (`rewards.ts:264-265`) — consistent, not a silent gap.
- Integration tests hit the real dev DB with no mocks, assert on both API return values and raw ledger rows (e.g., checking `Set` size for distinct references), and cover the actual FORBIDDEN path per procedure rather than a single generic check — these are not phantom tests.
- Migration is a clean single-statement additive `ALTER TYPE ... ADD VALUE`.

## Recommended Actions
1. (Medium) Convert `markDelivered`'s status check to a conditional `updateMany` (or `SELECT ... FOR UPDATE`) so the terminal-state guarantee actually holds under concurrency; consider filing a companion fix for `review`'s same-shaped race (out of scope for this diff, but same file, same bug class, and `review`'s reject path additionally risks a double stock-restore increment under a race, which is a real financial/inventory bug — not reviewed in depth here since `review` is out of scope, but worth a follow-up ticket).
2. (Low) Add a FORBIDDEN test and a basic archived-inclusion test for `giftListAdmin`.
3. (Low) Give `giftListAdmin` its own `permissions.ts` registry entry instead of reusing `giftUpdate`'s.
4. Get the orchestrator's actual sign-off on `giftListAdmin` recorded, since the implementer's own report flags it as unresolved (their wait-window default, not a received approval).

## Unresolved Questions
- Was orchestrator approval for `giftListAdmin` obtained after the report was filed? The report itself documents only a timed-out default, not a reply.
- Is the `review` reject-path double stock-restore race (same bug class as finding #1, but in code outside this diff's scope) already tracked, or should it be raised now given it was found as a byproduct of this review?
