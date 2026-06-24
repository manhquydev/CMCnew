import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import type { LmsSession } from '@cmc/auth';
import { lmsCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant (spec Phase 2 §2.8, fixes legacy M2): gift redeem is atomic — an advisory lock per
// student + a stock>0 guard mean two concurrent redeems of the last unit → 1 ok, 1 CONFLICT,
// and the star balance (SUM of ledger) never goes negative / double-spends.
describe('star redeem atomic (rewards invariant)', () => {
  const FACILITY = 1;
  let studentId: string;
  let giftId: string;

  function studentLms(): LmsSession {
    return {
      kind: 'student',
      accountId: randomUUID(),
      displayName: 'HS',
      students: [{ id: studentId, fullName: 'HS' }],
      studentIds: [studentId],
      facilityIds: [FACILITY],
    };
  }

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      const s = await tx.student.create({ data: { facilityId: FACILITY, studentCode: uniq('HSR'), fullName: 'HS redeem', program: 'UCREA' } });
      studentId = s.id;
      const g = await tx.gift.create({ data: { facilityId: FACILITY, name: uniq('GIFT'), starsRequired: 10, stock: 1 } });
      giftId = g.id;
      // Plenty of stars (100) so the limiter under test is STOCK, not balance.
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

  it('two concurrent redeems of a stock=1 gift → 1 ok, 1 CONFLICT, stock not oversold', async () => {
    const caller = lmsCaller(studentLms());
    const results = await Promise.allSettled([
      caller.rewards.redeem({ giftId }),
      caller.rewards.redeem({ giftId }),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    // The per-student advisory lock serialises the two attempts, so the loser is blocked at
    // the stock check (BAD_REQUEST); the atomic stock>0 guard (CONFLICT) is the backstop if
    // two ever pass the check together. Either way the unit is never oversold.
    const reason = (failed[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(TRPCError);
    expect(['CONFLICT', 'BAD_REQUEST']).toContain(reason.code);

    const gift = await withRls(SUPER, (tx) => tx.gift.findUniqueOrThrow({ where: { id: giftId } }));
    expect(gift.stock).toBe(0); // exactly one unit consumed, never negative

    const rewards = await withRls(SUPER, (tx) => tx.reward.findMany({ where: { studentId } }));
    expect(rewards).toHaveLength(1);
  });
});
