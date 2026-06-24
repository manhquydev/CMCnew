import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { Role } from '@cmc/auth';
import { starBalance } from '@cmc/domain-rewards';
import type { LmsSession } from '@cmc/auth';
import { lmsCaller, staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant (spec Phase 2 §2.8): a staff reviewer (quan_ly) deciding a PENDING reward redemption
// must reconcile both ledgers. decision 'rejected' → REFUND the student's stars (one
// gift_rejected_refund row restoring balance) AND restore gift stock +1. decision 'approved'
// keeps the spend (stock stays down). Re-reviewing an already-decided reward → BAD_REQUEST
// (the status guard makes review non-replayable, so refund/restock can't be applied twice).
describe('reward review refund (rewards invariant)', () => {
  const FACILITY = 1;
  const COST = 10;
  let studentId: string;
  let giftId: string;
  let rewardId: string;

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
      const s = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('HSRR'), fullName: 'HS review-refund', program: 'UCREA' },
      });
      studentId = s.id;
      const g = await tx.gift.create({
        data: { facilityId: FACILITY, name: uniq('GIFTRR'), starsRequired: COST, stock: 1 },
      });
      giftId = g.id;
      // 100 stars so the redeem succeeds and we can prove the refund restores it exactly.
      await tx.starTransaction.create({
        data: { facilityId: FACILITY, studentId: s.id, amount: 100, type: 'manual', reference: uniq('seed') },
      });
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

  it('rejected review refunds stars + restores stock; re-review rejects as BAD_REQUEST', async () => {
    // 1. Student redeems → PENDING reward, stock 0, balance 90.
    const reward = await lmsCaller(studentLms()).rewards.redeem({ giftId });
    rewardId = reward.id;
    expect(reward.status).toBe('pending');

    const afterRedeem = await withRls(SUPER, async (tx) => {
      const gift = await tx.gift.findUniqueOrThrow({ where: { id: giftId } });
      const txns = await tx.starTransaction.findMany({ where: { studentId } });
      return { stock: gift.stock, balance: starBalance(txns) };
    });
    expect(afterRedeem.stock).toBe(0);
    expect(afterRedeem.balance).toBe(100 - COST);

    // 2. Staff (quan_ly, facility-scoped, not super) rejects the pending redemption.
    const staff = await staffCaller({
      isSuperAdmin: false,
      facilityIds: [FACILITY],
      roles: [Role.quan_ly],
      primaryRole: Role.quan_ly,
    });
    const reviewed = await staff.rewards.review({ id: rewardId, decision: 'rejected', reason: uniq('whoops') });
    expect(reviewed.status).toBe('rejected');

    // 3. Reject reconciles both ledgers: balance back to 100, exactly one +COST refund row,
    //    gift stock restored to 1, reward marked rejected.
    const afterReject = await withRls(SUPER, async (tx) => {
      const gift = await tx.gift.findUniqueOrThrow({ where: { id: giftId } });
      const txns = await tx.starTransaction.findMany({ where: { studentId } });
      const rw = await tx.reward.findUniqueOrThrow({ where: { id: rewardId } });
      return { stock: gift.stock, txns, status: rw.status };
    });
    const refunds = afterReject.txns.filter((t) => t.type === 'gift_rejected_refund');
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBe(COST);
    expect(starBalance(afterReject.txns)).toBe(100);
    expect(afterReject.stock).toBe(1);
    expect(afterReject.status).toBe('rejected');

    // 4. Re-reviewing an already-decided reward is rejected (no double refund / restock).
    await expect(staff.rewards.review({ id: rewardId, decision: 'approved' })).rejects.toSatisfy(
      (e: unknown) => e instanceof TRPCError && e.code === 'BAD_REQUEST',
    );

    // The failed re-review left state untouched: still one refund, balance 100, stock 1.
    const afterReReview = await withRls(SUPER, async (tx) => {
      const gift = await tx.gift.findUniqueOrThrow({ where: { id: giftId } });
      const txns = await tx.starTransaction.findMany({ where: { studentId } });
      return { stock: gift.stock, txns };
    });
    expect(afterReReview.txns.filter((t) => t.type === 'gift_rejected_refund')).toHaveLength(1);
    expect(starBalance(afterReReview.txns)).toBe(100);
    expect(afterReReview.stock).toBe(1);
  });
});
