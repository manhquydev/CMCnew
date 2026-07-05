import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { staffCaller, withRls, SUPER, uniq, assertSuccess } from './helpers.js';

// Invariant (plans/260702-1109-finance-ops/phase-01-refund-ledger.md, decision 0028): the refund
// ledger is append-only money-out. Sum of refund amounts for a receipt must never exceed
// receipt.netAmount, enforced ATOMICALLY (SELECT ... FOR UPDATE on the receipt row inside the
// same txn) — not read-then-check. Refund is only allowed on a receipt that was actually
// approved (took money in) before being cancelled; a draft cancelled before approval never had
// money in and must be rejected.
describe('refund ledger — atomic sum-cap + approved-before-cancel guard', () => {
  const FACILITY_A = 1; // HQ (seeded)
  const FACILITY_B = 2; // CS2 (seeded)
  let courseId: string;
  const created = {
    courseIds: [] as string[],
    studentIds: [] as string[],
    receiptIds: [] as string[],
  };

  async function createApprovedCancelledReceipt(facilityId: number, _netHint = 10_000_000) {
    const caller = await staffCaller();
    const student = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: { facilityId, studentCode: uniq('HS'), fullName: 'Refund test HS', program: 'UCREA' },
      }),
    );
    created.studentIds.push(student.id);
    const r = assertSuccess(await caller.finance.receiptCreate({
      facilityId,
      studentId: student.id,
      courseId,
      yearsPrepaid: 1,
    }));
    created.receiptIds.push(r.id);
    await caller.finance.receiptApprove({ id: r.id });
    await caller.finance.receiptCancel({ id: r.id, reason: 'refund test cancel' });
    const cancelled = await withRls(SUPER, (tx) =>
      tx.receipt.findUniqueOrThrow({ where: { id: r.id } }),
    );
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.approvedAt).not.toBeNull();
    return { receiptId: r.id, netAmount: cancelled.netAmount, facilityId };
  }

  beforeAll(async () => {
    const courseCode = uniq('CRS');
    await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({
        data: { code: courseCode, name: 'Refund test course', program: 'UCREA' },
      });
      courseId = course.id;
      created.courseIds.push(course.id);
      for (const facilityId of [FACILITY_A, FACILITY_B]) {
        await tx.coursePrice.create({
          data: {
            facilityId,
            courseId: course.id,
            amount: 10_000_000,
            effectiveFrom: new Date('2020-01-01'),
          },
        });
      }
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.refundRecord.deleteMany({ where: { receiptId: { in: created.receiptIds } } });
      await tx.receipt.deleteMany({ where: { id: { in: created.receiptIds } } });
      await tx.student.deleteMany({ where: { id: { in: created.studentIds } } });
      await tx.coursePrice.deleteMany({ where: { courseId: { in: created.courseIds } } });
      await tx.course.deleteMany({ where: { id: { in: created.courseIds } } });
    });
  });

  it('refund on an approved-then-cancelled receipt succeeds and writes an audit event', async () => {
    const caller = await staffCaller();
    const { receiptId, netAmount } = await createApprovedCancelledReceipt(FACILITY_A);

    const refund = await caller.finance.refundCreate({
      receiptId,
      amount: 1_000_000,
      reason: 'Hoàn một phần theo thỏa thuận',
    });
    expect(refund.amount).toBe(1_000_000);
    expect(refund.receiptId).toBe(receiptId);

    // netAmount on the receipt itself must stay untouched (audit-preserving, never mutated).
    const receipt = await withRls(SUPER, (tx) => tx.receipt.findUniqueOrThrow({ where: { id: receiptId } }));
    expect(receipt.netAmount).toBe(netAmount);

    const events = await withRls(SUPER, (tx) =>
      tx.recordEvent.findMany({ where: { entityType: 'receipt', entityId: receiptId, type: 'note' } }),
    );
    expect(events.some((e) => e.body?.includes('Hoàn tiền'))).toBe(true);
  });

  it('refund on a draft-cancelled (never-approved) receipt is rejected', async () => {
    const caller = await staffCaller();
    const student = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: { facilityId: FACILITY_A, studentCode: uniq('HS'), fullName: 'Draft cancel HS', program: 'UCREA' },
      }),
    );
    created.studentIds.push(student.id);
    const r = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY_A,
      studentId: student.id,
      courseId,
      yearsPrepaid: 1,
    }));
    created.receiptIds.push(r.id);
    // Cancel while still draft — never approved, so no money ever came in.
    await caller.finance.receiptCancel({ id: r.id, reason: 'never approved' });

    await expect(
      caller.finance.refundCreate({ receiptId: r.id, amount: 1, reason: 'should be rejected' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const refunds = await withRls(SUPER, (tx) => tx.refundRecord.findMany({ where: { receiptId: r.id } }));
    expect(refunds).toHaveLength(0);
  });

  it('refund on a non-cancelled (still approved) receipt is rejected', async () => {
    const caller = await staffCaller();
    const student = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: { facilityId: FACILITY_A, studentCode: uniq('HS'), fullName: 'Still approved HS', program: 'UCREA' },
      }),
    );
    created.studentIds.push(student.id);
    const r = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY_A,
      studentId: student.id,
      courseId,
      yearsPrepaid: 1,
    }));
    created.receiptIds.push(r.id);
    await caller.finance.receiptApprove({ id: r.id });

    await expect(
      caller.finance.refundCreate({ receiptId: r.id, amount: 1, reason: 'not cancelled yet' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('two concurrent refundCreate calls summing over netAmount → exactly one succeeds (atomic sum-cap)', async () => {
    const caller = await staffCaller();
    const { receiptId, netAmount } = await createApprovedCancelledReceipt(FACILITY_A);

    // Two refunds, each 70% of netAmount — together 140%, must NOT both succeed.
    const half = Math.floor(netAmount * 0.7);
    const results = await Promise.allSettled([
      caller.finance.refundCreate({ receiptId, amount: half, reason: 'concurrent A' }),
      caller.finance.refundCreate({ receiptId, amount: half, reason: 'concurrent B' }),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(TRPCError);
    expect((failed[0] as PromiseRejectedResult).reason.code).toBe('CONFLICT');

    const rows = await withRls(SUPER, (tx) => tx.refundRecord.findMany({ where: { receiptId } }));
    expect(rows).toHaveLength(1);
    const sum = rows.reduce((s, x) => s + x.amount, 0);
    expect(sum).toBeLessThanOrEqual(netAmount);
  });

  it('a second refund that would push the sum over the cap is rejected, one under the cap is accepted', async () => {
    const caller = await staffCaller();
    const { receiptId, netAmount } = await createApprovedCancelledReceipt(FACILITY_A);

    const first = Math.floor(netAmount * 0.6);
    await caller.finance.refundCreate({ receiptId, amount: first, reason: 'first chunk' });

    // Over cap: first(60%) + 60% > 100%.
    await expect(
      caller.finance.refundCreate({ receiptId, amount: first, reason: 'would overshoot' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // Exactly the remainder is accepted.
    const remainder = netAmount - first;
    const second = await caller.finance.refundCreate({
      receiptId,
      amount: remainder,
      reason: 'remainder',
    });
    expect(second.amount).toBe(remainder);

    const rows = await withRls(SUPER, (tx) => tx.refundRecord.findMany({ where: { receiptId } }));
    const total = rows.reduce((s, x) => s + x.amount, 0);
    expect(total).toBe(netAmount);
  });

  it('cross-facility user cannot read another facility’s refunds (RLS)', async () => {
    const { receiptId } = await createApprovedCancelledReceipt(FACILITY_A);
    await withRls(SUPER, async (tx) => {
      // Insert a refund row directly (super bypass) so we have something to try to leak.
      await tx.refundRecord.create({
        data: {
          receiptId,
          facilityId: FACILITY_A,
          amount: 500_000,
          reason: 'seed for RLS check',
          recordedById: (await tx.appUser.findFirstOrThrow({ select: { id: true } })).id,
        },
      });
    });

    const bScope = { facilityIds: [FACILITY_B], isSuperAdmin: false };
    const leaked = await withRls(bScope, (tx) =>
      tx.refundRecord.findMany({ where: { receiptId }, select: { id: true } }),
    );
    expect(leaked).toHaveLength(0);

    const aScope = { facilityIds: [FACILITY_A], isSuperAdmin: false };
    const seen = await withRls(aScope, (tx) =>
      tx.refundRecord.findMany({ where: { receiptId }, select: { id: true } }),
    );
    expect(seen.length).toBeGreaterThan(0);
  });
});
