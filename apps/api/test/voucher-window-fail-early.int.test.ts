import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq, assertSuccess } from './helpers.js';

// Invariant (backlog T4 / F11): a voucher outside its validity window is rejected at receiptCreate
// (fail-early), not deferred to approve. receiptApprove still re-checks the window atomically, but a
// cashier must learn at draft time that the voucher is expired / not-yet-active — not after building
// the whole receipt. These assertions kill the OLD behavior: create only filtered active+archived,
// so an expired voucher silently produced a draft and only blew up at approve.
describe('receiptCreate — voucher validity window enforced early (T4)', () => {
  const FAC = 1;
  let studentId: string;
  let courseId: string;
  const voucherIds: string[] = [];

  // Date helpers on UTC-midnight basis (matches @db.Date storage + the router's comparison).
  const dayOffset = (days: number) => new Date(new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10));

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({ data: { code: uniq('CRS'), name: 'Voucher Course', program: 'UCREA' } });
      courseId = course.id;
      await tx.coursePrice.create({ data: { facilityId: FAC, courseId, effectiveFrom: dayOffset(-30), amount: 10_000_000 } });
      studentId = (await tx.student.create({ data: { facilityId: FAC, studentCode: uniq('HS'), fullName: 'Voucher kid', program: 'UCREA' } })).id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      const receipts = await tx.receipt.findMany({ where: { studentId }, select: { id: true } });
      await tx.recordEvent.deleteMany({ where: { entityType: 'receipt', entityId: { in: receipts.map((r) => r.id) } } });
      await tx.receipt.deleteMany({ where: { studentId } });
      await tx.voucher.deleteMany({ where: { id: { in: voucherIds } } });
      await tx.coursePrice.deleteMany({ where: { courseId } });
      await tx.student.deleteMany({ where: { id: studentId } });
      await tx.course.deleteMany({ where: { id: courseId } });
    });
  });

  async function seedVoucher(validFrom: Date | null, validTo: Date | null): Promise<string> {
    return withRls(SUPER, async (tx) => {
      const v = await tx.voucher.create({
        data: { facilityId: FAC, code: uniq('V'), percent: 10, active: true, maxUses: 5, validFrom, validTo },
      });
      voucherIds.push(v.id);
      return v.code!;
    });
  }

  const create = async (voucherCode: string) =>
    (await staffCaller()).finance.receiptCreate({ facilityId: FAC, studentId, courseId, yearsPrepaid: 1, voucherCode });

  it('rejects an EXPIRED voucher at create (validTo in the past) — not deferred to approve', async () => {
    const code = await seedVoucher(null, dayOffset(-1));
    await expect(create(code)).rejects.toThrow(/hết hạn/i);
    // Mutation-proof: old code would have created a draft; assert none landed for this student.
    const drafts = await withRls(SUPER, (tx) => tx.receipt.findMany({ where: { studentId } }));
    expect(drafts).toHaveLength(0);
  });

  it('rejects a NOT-YET-ACTIVE voucher at create (validFrom in the future)', async () => {
    const code = await seedVoucher(dayOffset(1), null);
    await expect(create(code)).rejects.toThrow(/chưa đến ngày hiệu lực/i);
  });

  it('accepts an in-window voucher and stores the discount on the draft', async () => {
    const code = await seedVoucher(dayOffset(-1), dayOffset(30));
    const receipt = assertSuccess(await create(code));
    expect(receipt.voucherId).not.toBeNull();
    expect(receipt.voucherPercent).toBe(10);
  });
});
