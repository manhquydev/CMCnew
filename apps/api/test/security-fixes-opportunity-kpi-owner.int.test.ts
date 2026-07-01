import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';
import type { ApiContext } from '../src/context.js';
import { appRouter } from '../src/routers/index.js';

/**
 * Integration tests for three security fixes:
 *
 * 1. receiptApprove: opportunity studentName must match receipt's student.
 *    An unrelated opportunityId must be rejected (BAD_REQUEST) to prevent
 *    mis-attributing commission to the wrong CVTV.
 *
 * 2. kpiAutoPrefill doanh_so: counts {approved,sent,reconciled} receipts —
 *    the same set used by commissionForSale. Before the fix, only 'approved'
 *    was counted → doanh_so was understated for sent/reconciled receipts.
 *
 * 3. opportunityCreate ownerId: a non-manager (sale/cskh/ctv_mkt) may only
 *    credit ownerId = self. Managers (giam_doc_kinh_doanh) may assign to any user.
 */

// ─── Shared fixtures ────────────────────────────────────────────────────────
const FACILITY = 1;

describe('Fix #1 — receiptApprove: opportunity studentName guard', () => {
  let courseId: string;
  let aliceId: string;
  let matchedOppId: string;
  let mismatchedOppId: string;
  const cleanup = { receiptIds: [] as string[], oppIds: [] as string[], contactIds: [] as string[] };

  beforeAll(async () => {
    // Create a course with a price
    const course = await withRls(SUPER, async (tx) => {
      const c = await tx.course.create({
        data: { code: uniq('CRS-OPP'), name: 'Opp Guard Test Course', program: 'UCREA' },
      });
      await tx.coursePrice.create({
        data: { facilityId: FACILITY, courseId: c.id, amount: 10_000_000, effectiveFrom: new Date('2020-01-01') },
      });
      return c;
    });
    courseId = course.id;

    // Create student "Alice"
    const alice = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('S-ALICE'), fullName: 'Alice Nguyen', program: 'UCREA' },
      }),
    );
    aliceId = alice.id;

    // Contact for the opportunities
    const contact = await withRls(SUPER, (tx) =>
      tx.contact.create({ data: { facilityId: FACILITY, fullName: 'Alice Parent', phone: uniq('+849') } }),
    );
    cleanup.contactIds.push(contact.id);

    // Fetch a valid ownerId for the opportunities (any active staff user)
    const anyUser = await withRls(SUPER, (tx) =>
      tx.appUser.findFirst({ where: { isActive: true }, select: { id: true } }),
    );
    const anyOwnerId = anyUser!.id;

    // Matched opportunity: studentName exactly matches student fullName (case-insensitive)
    const matchedOpp = await withRls(SUPER, (tx) =>
      tx.opportunity.create({
        data: {
          facilityId: FACILITY,
          contactId: contact.id,
          studentName: 'Alice Nguyen', // matches student.fullName
          stage: 'O5_ENROLLED',
          ownerId: anyOwnerId,
        },
      }),
    );
    matchedOppId = matchedOpp.id;
    cleanup.oppIds.push(matchedOpp.id);

    // Mismatched opportunity: studentName is a different student
    const mismatchedOpp = await withRls(SUPER, (tx) =>
      tx.opportunity.create({
        data: {
          facilityId: FACILITY,
          contactId: contact.id,
          studentName: 'Bob Tran', // does NOT match "Alice Nguyen"
          stage: 'O5_ENROLLED',
          ownerId: anyOwnerId,
        },
      }),
    );
    mismatchedOppId = mismatchedOpp.id;
    cleanup.oppIds.push(mismatchedOpp.id);
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      if (cleanup.receiptIds.length > 0) {
        await tx.receipt.deleteMany({ where: { id: { in: cleanup.receiptIds } } });
      }
      await tx.opportunity.deleteMany({ where: { id: { in: cleanup.oppIds } } });
      await tx.contact.deleteMany({ where: { id: { in: cleanup.contactIds } } });
      await tx.coursePrice.deleteMany({ where: { courseId } });
      await tx.course.deleteMany({ where: { id: courseId } });
      await tx.student.deleteMany({ where: { id: aliceId } });
    });
  });

  it('drops commission credit (no soldById) but still approves when opportunity studentName mismatches', async () => {
    const caller = await staffCaller();

    // Create receipt linking Alice to Bob's opportunity (mismatched studentName)
    const receipt = await caller.finance.receiptCreate({
      facilityId: FACILITY,
      studentId: aliceId,
      courseId,
      yearsPrepaid: 1,
      opportunityId: mismatchedOppId,
    });
    cleanup.receiptIds.push(receipt.id);

    // A name typo must NOT block revenue collection — approval succeeds, but the unrelated
    // opportunity is not credited: soldById stays null (commission dropped + audited).
    const approved = await caller.finance.receiptApprove({ id: receipt.id });
    expect(approved.status).toBe('approved');
    expect(approved.soldById).toBeNull();
  });

  it('approves when opportunity studentName matches the receipt student (case-insensitive)', async () => {
    const caller = await staffCaller();

    // Create receipt linking Alice to Alice's opportunity
    const receipt = await caller.finance.receiptCreate({
      facilityId: FACILITY,
      studentId: aliceId,
      courseId,
      yearsPrepaid: 1,
      opportunityId: matchedOppId,
    });
    cleanup.receiptIds.push(receipt.id);

    const approved = await caller.finance.receiptApprove({ id: receipt.id });
    expect(approved.status).toBe('approved');
    // Commission attribution: soldById stamped from matched opportunity owner
    expect(approved.soldById).not.toBeNull();
  });
});

// ─── Fix #2: kpiAutoPrefill doanh_so counts sent + reconciled ──────────────

describe('Fix #2 — kpiAutoPrefill: doanh_so counts sent/reconciled receipts', () => {
  const PERIOD = '2097-06'; // isolated future period
  let saleUserId: string;
  let courseId: string;

  beforeAll(async () => {
    const su = await staffCaller();

    const saleUser = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('fix2-sale@cmc.test'),
          displayName: 'Fix2 Sale',
          passwordHash: 'dummy',
          primaryRole: 'sale',
          roles: ['sale'],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      }),
    );
    saleUserId = saleUser.id;

    await su.payroll.rateCreate({
      userId: saleUserId,
      facilityId: FACILITY,
      baseSalary: 5_000_000,
      monthlyQuota: 100_000_000,
      effectiveFrom: '2020-01-01',
    });

    const course = await withRls(SUPER, async (tx) => {
      const c = await tx.course.create({
        data: { code: uniq('CRS-FIX2'), name: 'Fix2 Course', program: 'UCREA' },
      });
      await tx.coursePrice.create({
        data: { facilityId: FACILITY, courseId: c.id, amount: 10_000_000, effectiveFrom: new Date('2020-01-01') },
      });
      return c;
    });
    courseId = course.id;

    const student = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('S-FIX2'), fullName: 'Fix2 Student', program: 'UCREA' },
      }),
    );

    const [y, m] = PERIOD.split('-').map(Number);
    const approvedTs = new Date(Date.UTC(y!, m! - 1, 15));

    // Seed a 'sent' receipt (not 'approved') — only counts if filter includes 'sent'
    await withRls(SUPER, (tx) =>
      tx.receipt.create({
        data: {
          facilityId: FACILITY,
          studentId: student.id,
          courseId,
          yearsPrepaid: 1,
          annualPrice: 40_000_000,
          grossAmount: 40_000_000,
          tierPercent: 0,
          effectiveDiscountPercent: 0,
          netAmount: 40_000_000,
          status: 'sent',
          soldById: saleUserId,
          kind: 'new',
          approvedAt: approvedTs,
        },
      }),
    );

    // Seed a 'reconciled' receipt
    await withRls(SUPER, (tx) =>
      tx.receipt.create({
        data: {
          facilityId: FACILITY,
          studentId: student.id,
          courseId,
          yearsPrepaid: 1,
          annualPrice: 20_000_000,
          grossAmount: 20_000_000,
          tierPercent: 0,
          effectiveDiscountPercent: 0,
          netAmount: 20_000_000,
          status: 'reconciled',
          soldById: saleUserId,
          kind: 'renewal',
          approvedAt: approvedTs,
        },
      }),
    );

    // Start KPI sheet
    await su.payroll.kpiEvalStart({ userId: saleUserId, facilityId: FACILITY, periodKey: PERIOD, block: 'sales' });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.kpiScore.deleteMany({ where: { userId: saleUserId } });
      await tx.receipt.deleteMany({ where: { soldById: saleUserId } });
      await tx.salaryRate.deleteMany({ where: { userId: saleUserId } });
      await tx.employmentProfile.deleteMany({ where: { userId: saleUserId } });
      await tx.appUser.deleteMany({ where: { id: saleUserId } });
      await tx.coursePrice.deleteMany({ where: { courseId } });
      await tx.course.deleteMany({ where: { id: courseId } });
    });
  });

  it('doanh_so includes sent + reconciled receipts (total 60M / 100M quota → score 60)', async () => {
    const su = await staffCaller();
    const result = await su.payroll.kpiAutoPrefill({ userId: saleUserId, facilityId: FACILITY, periodKey: PERIOD });

    const ds = result.computed.find((c) => c.key === 'doanh_so');
    expect(ds).toBeDefined();
    // 60M total (40M sent + 20M reconciled) / 100M quota = 0.6 → ratioToScore(0.6) = 60
    expect(ds!.score).toBe(60);
    expect(result.context.approvedRevenue).toBe(60_000_000);
  });
});

// ─── Fix #3: opportunityCreate ownerId guard ──────────────────────────────

describe('Fix #3 — opportunityCreate: non-manager cannot assign to another user', () => {
  let saleUserId: string;
  let otherUserId: string;
  let managerUserId: string;
  let contactId: string;
  const cleanup = { oppIds: [] as string[], contactIds: [] as string[] };

  beforeAll(async () => {
    // Create a sale user, another user, and a manager user
    const [saleUser, otherUser, managerUser] = await Promise.all([
      withRls(SUPER, (tx) =>
        tx.appUser.create({
          data: {
            email: uniq('fix3-sale@cmc.test'),
            displayName: 'Fix3 Sale',
            passwordHash: 'dummy',
            primaryRole: 'sale',
            roles: ['sale'],
            isActive: true,
            facilities: { create: [{ facilityId: FACILITY }] },
          },
        }),
      ),
      withRls(SUPER, (tx) =>
        tx.appUser.create({
          data: {
            email: uniq('fix3-other@cmc.test'),
            displayName: 'Fix3 Other',
            passwordHash: 'dummy',
            primaryRole: 'sale',
            roles: ['sale'],
            isActive: true,
            facilities: { create: [{ facilityId: FACILITY }] },
          },
        }),
      ),
      withRls(SUPER, (tx) =>
        tx.appUser.create({
          data: {
            email: uniq('fix3-mgr@cmc.test'),
            displayName: 'Fix3 Manager',
            passwordHash: 'dummy',
            primaryRole: 'giam_doc_kinh_doanh',
            roles: ['giam_doc_kinh_doanh'],
            isActive: true,
            facilities: { create: [{ facilityId: FACILITY }] },
          },
        }),
      ),
    ]);
    saleUserId = saleUser.id;
    otherUserId = otherUser.id;
    managerUserId = managerUser.id;

    // Contact for all opportunity create calls
    const contact = await withRls(SUPER, (tx) =>
      tx.contact.create({ data: { facilityId: FACILITY, fullName: 'Fix3 Lead', phone: uniq('+847') } }),
    );
    contactId = contact.id;
    cleanup.contactIds.push(contactId);
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.opportunity.deleteMany({ where: { id: { in: cleanup.oppIds } } });
      await tx.contact.deleteMany({ where: { id: { in: cleanup.contactIds } } });
      await tx.appUser.deleteMany({ where: { id: { in: [saleUserId, otherUserId, managerUserId] } } });
    });
  });

  function callerAs(userId: string, roles: string[], isSuperAdmin = false) {
    const session = {
      userId,
      displayName: 'test',
      roles,
      primaryRole: roles[0] ?? 'sale',
      isSuperAdmin,
      facilityIds: [FACILITY],
    };
    const ctx: ApiContext = { c: {} as never, session: session as never, lms: null, ip: 'test' };
    return appRouter.createCaller(ctx);
  }

  it('non-manager gets FORBIDDEN when setting ownerId to another user', async () => {
    const saleCaller = callerAs(saleUserId, ['sale']);

    await expect(
      saleCaller.crm.opportunityCreate({ contactId, studentName: 'Fix3 Child', ownerId: otherUserId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('non-manager succeeds when ownerId is omitted (defaults to self)', async () => {
    const saleCaller = callerAs(saleUserId, ['sale']);

    const opp = await saleCaller.crm.opportunityCreate({ contactId, studentName: 'Fix3 Child Self' });
    cleanup.oppIds.push(opp.id);
    expect(opp.ownerId).toBe(saleUserId);
  });

  it('non-manager succeeds when ownerId is explicitly set to self', async () => {
    const saleCaller = callerAs(saleUserId, ['sale']);

    const opp = await saleCaller.crm.opportunityCreate({ contactId, studentName: 'Fix3 Child Explicit', ownerId: saleUserId });
    cleanup.oppIds.push(opp.id);
    expect(opp.ownerId).toBe(saleUserId);
  });

  it('manager (giam_doc_kinh_doanh) can assign ownerId to another user', async () => {
    const mgrCaller = callerAs(managerUserId, ['giam_doc_kinh_doanh']);

    const opp = await mgrCaller.crm.opportunityCreate({ contactId, studentName: 'Fix3 Child Mgr', ownerId: saleUserId });
    cleanup.oppIds.push(opp.id);
    expect(opp.ownerId).toBe(saleUserId);
  });
});
