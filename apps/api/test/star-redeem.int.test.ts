import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { starBalance } from '@cmc/domain-rewards';
import type { LmsSession } from '@cmc/auth';
import { lmsCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant (spec Phase 2 §2.8, fixes legacy M2): gift redeem is atomic. Two concurrent
// redeems of the last unit → exactly one succeeds; the loser is serialised by the per-student
// advisory lock and rejected at the stock check (BAD_REQUEST). Stock is never oversold and the
// star ledger (SUM) is debited exactly once — no double-spend.
describe('star redeem atomic (rewards invariant)', () => {
  const FACILITY = 1;
  const COST = 10;
  let studentId: string;
  let giftId: string;

  function studentLms(): LmsSession {
    return { kind: 'student', accountId: randomUUID(), displayName: 'HS', students: [{ id: studentId, fullName: 'HS' }], studentIds: [studentId], facilityIds: [FACILITY] };
  }

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      const s = await tx.student.create({ data: { facilityId: FACILITY, studentCode: uniq('HSR'), fullName: 'HS redeem', program: 'UCREA' } });
      studentId = s.id;
      const g = await tx.gift.create({ data: { facilityId: FACILITY, name: uniq('GIFT'), starsRequired: COST, stock: 1 } });
      giftId = g.id;
      // 100 stars → affordable twice over, so the limiter under test is STOCK, not balance.
      await tx.starTransaction.create({ data: { facilityId: FACILITY, studentId: s.id, amount: 100, type: 'manual', reference: uniq('seed') } });
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.reward.deleteMany({ where: { studentId } });
      await tx.starTransaction.deleteMany({ where: { studentId } });
      await tx.gift.deleteMany({ where: { id: giftId } });
      await tx.student.deleteMany({ where: { id: studentId } });
    });
  });

  it('two concurrent redeems of a stock=1 gift → 1 ok, 1 rejected, no oversell, ledger debited once', async () => {
    const caller = lmsCaller(studentLms());
    const results = await Promise.allSettled([
      caller.rewards.redeem({ giftId }),
      caller.rewards.redeem({ giftId }),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    // The advisory lock serialises the two, so the loser is deterministically blocked at the
    // stock check (BAD_REQUEST). If the lock were removed, the loser would instead hit the
    // atomic stock>0 backstop and surface CONFLICT — so asserting BAD_REQUEST specifically
    // guards that the lock (not just the backstop) is doing its job.
    const reason = (failed[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(TRPCError);
    expect(reason.code).toBe('BAD_REQUEST');

    const gift = await withRls(SUPER, (tx) => tx.gift.findUniqueOrThrow({ where: { id: giftId } }));
    expect(gift.stock).toBe(0); // exactly one unit consumed, never negative

    const rewards = await withRls(SUPER, (tx) => tx.reward.findMany({ where: { studentId } }));
    expect(rewards).toHaveLength(1);

    // Ledger invariant: exactly one spend row of -COST; balance = 100 - COST (no double-debit).
    const txns = await withRls(SUPER, (tx) => tx.starTransaction.findMany({ where: { studentId } }));
    const spend = txns.filter((t) => t.type === 'gift_redeemed');
    expect(spend).toHaveLength(1);
    expect(spend[0].amount).toBe(-COST);
    expect(starBalance(txns)).toBe(100 - COST);
  });
});
