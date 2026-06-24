import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant (spec Phase 3 §2.5, fixes legacy M2): voucher consume at receipt.approve is
// ATOMIC — two approvals racing for the last use → exactly one wins, the other CONFLICTs,
// and used_count never exceeds max_uses. Cancel after approve refunds one use.
describe('voucher atomic consume (money invariant)', () => {
  const FACILITY = 1; // HQ (seeded)
  let courseId: string;
  let studentId: string;
  const created = { courseIds: [] as string[], studentIds: [] as string[], voucherCodes: [] as string[] };

  beforeAll(async () => {
    const courseCode = uniq('CRS');
    await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({
        data: { code: courseCode, name: 'Test course', program: 'UCREA' },
      });
      courseId = course.id;
      created.courseIds.push(course.id);
      await tx.coursePrice.create({
        data: { facilityId: FACILITY, courseId: course.id, amount: 10_000_000, effectiveFrom: new Date('2020-01-01') },
      });
      const student = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('HS'), fullName: 'Test HS', program: 'UCREA' },
      });
      studentId = student.id;
      created.studentIds.push(student.id);
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.receipt.deleteMany({ where: { studentId: { in: created.studentIds } } });
      await tx.voucher.deleteMany({ where: { code: { in: created.voucherCodes } } });
      await tx.coursePrice.deleteMany({ where: { courseId: { in: created.courseIds } } });
      await tx.student.deleteMany({ where: { id: { in: created.studentIds } } });
      await tx.course.deleteMany({ where: { id: { in: created.courseIds } } });
    });
  });

  it('two concurrent approvals on a maxUses=1 voucher → 1 ok, 1 CONFLICT, used_count=1', async () => {
    const caller = await staffCaller();
    const code = uniq('V');
    created.voucherCodes.push(code);
    await caller.finance.voucherCreate({ facilityId: FACILITY, code, percent: 10, maxUses: 1 });

    // Two separate draft receipts, both pointing at the same single-use voucher.
    const r1 = await caller.finance.receiptCreate({ facilityId: FACILITY, studentId, courseId, yearsPrepaid: 1, voucherCode: code });
    const r2 = await caller.finance.receiptCreate({ facilityId: FACILITY, studentId, courseId, yearsPrepaid: 1, voucherCode: code });

    const results = await Promise.allSettled([
      caller.finance.receiptApprove({ id: r1.id }),
      caller.finance.receiptApprove({ id: r2.id }),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(TRPCError);
    expect((failed[0] as PromiseRejectedResult).reason.code).toBe('CONFLICT');

    const v = await withRls(SUPER, (tx) => tx.voucher.findFirstOrThrow({ where: { code } }));
    expect(v.usedCount).toBe(1);
    expect(v.usedCount).toBeLessThanOrEqual(v.maxUses);

    // Bind the count to the right winner: exactly one receipt is approved (with a code),
    // the other stayed draft. Catches a guard that under-consumes yet still approves both.
    const rows = await withRls(SUPER, (tx) =>
      tx.receipt.findMany({ where: { id: { in: [r1.id, r2.id] } }, select: { status: true, code: true } }),
    );
    const approved = rows.filter((r) => r.status === 'approved');
    const drafts = rows.filter((r) => r.status === 'draft');
    expect(approved).toHaveLength(1);
    expect(approved[0].code).toBeTruthy();
    expect(drafts).toHaveLength(1);
  });

  it('cancel after approve refunds one use (used_count back to 0)', async () => {
    const caller = await staffCaller();
    const code = uniq('V');
    created.voucherCodes.push(code);
    await caller.finance.voucherCreate({ facilityId: FACILITY, code, percent: 10, maxUses: 1 });
    const r = await caller.finance.receiptCreate({ facilityId: FACILITY, studentId, courseId, yearsPrepaid: 1, voucherCode: code });
    await caller.finance.receiptApprove({ id: r.id });

    let v = await withRls(SUPER, (tx) => tx.voucher.findFirstOrThrow({ where: { code } }));
    expect(v.usedCount).toBe(1);

    await caller.finance.receiptCancel({ id: r.id, reason: 'test refund' });
    v = await withRls(SUPER, (tx) => tx.voucher.findFirstOrThrow({ where: { code } }));
    expect(v.usedCount).toBe(0);
  });

  it('discount stacks tier + voucher but caps at 35%', async () => {
    const caller = await staffCaller();
    const code = uniq('V');
    created.voucherCodes.push(code);
    // tier for 3 years = 30%, voucher = 20% → 50% raw, must cap to 35%.
    await caller.finance.voucherCreate({ facilityId: FACILITY, code, percent: 20, maxUses: 5 });
    const r = await caller.finance.receiptCreate({ facilityId: FACILITY, studentId, courseId, yearsPrepaid: 3, voucherCode: code });
    // Prove BOTH components actually stacked (not a single 35-yielding source), then capped.
    expect(r.tierPercent).toBe(30);
    expect(r.voucherPercent).toBe(20);
    expect(r.effectiveDiscountPercent).toBe(35);
  });
});
