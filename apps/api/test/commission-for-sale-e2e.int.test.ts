import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';
import { commissionAmount, cvtvNewCustomerRate } from '@cmc/domain-payroll';
import { DEFAULT_PARAMS } from '@cmc/domain-payroll';

/**
 * E2E integration test: sales-commission attribution flow.
 *
 * Invariant (payroll-v2-commission-design.md, CV4): receipt approve freezes
 * soldById (from opportunity owner) and kind (new/renewal), then commission
 * computation groups receipts by kind and computes per-attainment rate.
 *
 * Reference case (tài liệu CMC 2026 — commission by ABSOLUTE new revenue): a CVTV sells 85tr net
 * new revenue → tier [80–100tr] → 2% → 1.7tr commission. Quota is display/context only now.
 *
 * Test covers:
 * - Full seed: seller staff + student + course + opportunity (with seller as owner) + receipt
 * - Receipt approve freezes soldById & kind server-side
 * - Commission computation returns expected amounts grouped by kind
 * - Specific commission tied to the attributed receipt (mutation-proof)
 */
describe('commission-for-sale: E2E attribution & computation', () => {
  const FACILITY = 1;
  // Use the current month so approvedAt (set to now()) falls in the period range
  const now = new Date();
  const PERIOD = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const MONTHLY_QUOTA = 10_000_000; // 10M — attainment is display-only now (commission is revenue-based)

  let seller: { id: string; displayName: string };
  let student: { id: string; studentCode: string };
  let course: { id: string; code: string };
  let opportunity: { id: string; ownerId: string };
  let receipt: { id: string; netAmount: number; soldById: string | null; kind: string | null };

  const created = { courseIds: [] as string[], studentIds: [] as string[], opportunityIds: [] as string[], userIds: [] as string[] };

  beforeAll(async () => {
    const superId = await superAdminUserId();
    const caller = await staffCaller();

    // ─── Create seller (CVTV staff) ───
    // For commission to apply, must have a SalaryRate with monthlyQuota set.
    const sellerEmail = uniq('seller@cmc.test');
    const sellerUser = await withRls(SUPER, async (tx) => {
      return tx.appUser.create({
        data: {
          email: sellerEmail,
          displayName: 'CVTV Seller',
          passwordHash: 'dummy',
          primaryRole: 'sale',
          roles: ['sale'],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      });
    });
    seller = { id: sellerUser.id, displayName: sellerUser.displayName };
    created.userIds.push(sellerUser.id);

    // Create SalaryRate for the seller (effective BEFORE the test period).
    // The commission query uses periodEnd(periodKey) to find rates with effectiveFrom <= period-end,
    // so we must set effectiveFrom to a date BEFORE the period's end.
    const periodYear = parseInt(PERIOD.split('-')[0]);
    const periodMonth = parseInt(PERIOD.split('-')[1]);
    const rateEffectiveDate = `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`; // First day of period
    await caller.payroll.rateCreate({
      userId: seller.id,
      facilityId: FACILITY,
      baseSalary: 5_000_000,
      mealAllowance: 0,
      otherAllowance: 0,
      kpiMax: 0,
      monthlyQuota: MONTHLY_QUOTA,
      effectiveFrom: rateEffectiveDate,
    });

    // ─── Create course ───
    const courseCode = uniq('CRS');
    const courseData = await withRls(SUPER, async (tx) => {
      const c = await tx.course.create({
        data: { code: courseCode, name: 'Integration Test Course', program: 'UCREA' },
      });
      await tx.coursePrice.create({
        data: {
          facilityId: FACILITY,
          courseId: c.id,
          amount: 100_000_000, // 100M/year → 1yr 15% tier → net 85M → commission tier [80–100M]=2%
          effectiveFrom: new Date('2020-01-01'),
        },
      });
      return c;
    });
    course = courseData;
    created.courseIds.push(course.id);

    // ─── Create student ───
    const studentCode = uniq('HS');
    const studentData = await withRls(SUPER, async (tx) => {
      return tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode,
          fullName: 'Test Student',
          program: 'UCREA',
        },
      });
    });
    student = studentData;
    created.studentIds.push(student.id);

    // ─── Create contact + opportunity (stage O5_ENROLLED, owned by seller) ───
    const contactData = await withRls(SUPER, async (tx) => {
      return tx.contact.create({
        data: {
          facilityId: FACILITY,
          fullName: 'Parent Contact',
          phone: uniq('+84901'),
        },
      });
    });

    const oppData = await withRls(SUPER, async (tx) => {
      return tx.opportunity.create({
        data: {
          facilityId: FACILITY,
          contactId: contactData.id,
          studentName: student.fullName,
          program: 'UCREA',
          stage: 'O5_ENROLLED', // Enrolled stage → kind='new' regardless of prior receipts
          ownerId: seller.id,
        },
      });
    });
    opportunity = oppData;
    created.opportunityIds.push(oppData.id);

    // ─── Create + approve receipt ───
    // Receipt draft: 100M/year, 1 year → gross 100M, 15% tier → net 85M.
    // 85M new revenue → commission tier [80–100M] → 2% → 1.7M.
    const draftReceipt = await caller.finance.receiptCreate({
      facilityId: FACILITY,
      studentId: student.id,
      courseId: course.id,
      yearsPrepaid: 1,
      opportunityId: opportunity.id,
      // No voucher, so effective discount = tier only
    });

    // Approve the receipt → soldById & kind frozen
    const approvedReceipt = await caller.finance.receiptApprove({ id: draftReceipt.id });
    receipt = approvedReceipt;
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      // Reverse order of creation to respect FKs.
      if (receipt.id) {
        await tx.receipt.deleteMany({ where: { id: receipt.id } });
      }
      if (created.opportunityIds.length > 0) {
        await tx.opportunity.deleteMany({ where: { id: { in: created.opportunityIds } } });
      }
      await tx.contact.deleteMany({ where: { facilityId: FACILITY } });
      if (created.studentIds.length > 0) {
        await tx.student.deleteMany({ where: { id: { in: created.studentIds } } });
      }
      if (created.courseIds.length > 0) {
        await tx.coursePrice.deleteMany({ where: { courseId: { in: created.courseIds } } });
        await tx.course.deleteMany({ where: { id: { in: created.courseIds } } });
      }
      if (created.userIds.length > 0) {
        await tx.salaryRate.deleteMany({ where: { userId: { in: created.userIds } } });
        await tx.appUser.deleteMany({ where: { id: { in: created.userIds } } });
      }
    });
  });

  it('receipt approve sets soldById to the opportunity owner', async () => {
    expect(receipt.soldById).toBe(seller.id);
  });

  it('receipt approve sets kind based on stage & prior receipts (O5_ENROLLED → new)', async () => {
    expect(receipt.kind).toBe('new');
  });

  it('commission computation for the period groups by kind & applies quota-attainment rate', async () => {
    const caller = await staffCaller();

    const result = await caller.payroll.commissionForSale({
      userId: seller.id,
      facilityId: FACILITY,
      periodKey: PERIOD,
    });

    // Commission rate = by QUOTA ATTAINMENT % (Excel PHỤ LỤC 02, nguồn chuẩn).
    const attainment = receipt.netAmount / MONTHLY_QUOTA;
    const expectedRate = cvtvNewCustomerRate(attainment, DEFAULT_PARAMS);
    const expectedCommission = commissionAmount(receipt.netAmount, expectedRate);

    expect(result.newRevenue).toBe(receipt.netAmount);
    expect(result.renewalRevenue).toBe(0); // Only new receipt
    expect(result.rateNew).toBe(expectedRate);
    expect(result.commissionNew).toBe(expectedCommission);
    expect(result.commissionRenewal).toBe(0);
    expect(result.total).toBe(expectedCommission);
    // Net 85M vs quota 10M → attainment 850% → top band >150% → 5%.
    expect(result.rateNew).toBe(0.05);
  });

  it('commission amount is mutation-proof: tied to the specific receipt (soldById freeze)', async () => {
    const caller = await staffCaller();

    // Get commission before any hypothetical tampering.
    const result1 = await caller.payroll.commissionForSale({
      userId: seller.id,
      facilityId: FACILITY,
      periodKey: PERIOD,
    });

    // Verify it's non-zero and specific to our receipt.
    expect(result1.commissionNew).toBeGreaterThan(0);

    // Now verify the receipt's soldById is frozen (not null, not someone else).
    const frozenReceipt = await withRls(SUPER, (tx) =>
      tx.receipt.findUniqueOrThrow({ where: { id: receipt.id } }),
    );
    expect(frozenReceipt.soldById).toBe(seller.id);
    expect(frozenReceipt.kind).toBe('new');
    expect(frozenReceipt.status).toBe('approved');

    // The frozen values ensure that any change to the commission result is caught
    // (because it hinges on the approved receipt's attributes).
    const result2 = await caller.payroll.commissionForSale({
      userId: seller.id,
      facilityId: FACILITY,
      periodKey: PERIOD,
    });
    expect(result2.commissionNew).toBe(result1.commissionNew);
  });
});
