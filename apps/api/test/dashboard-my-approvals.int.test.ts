import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

/**
 * dashboard.myApprovals — role-aware "pending my approval" aggregate for the two director roles
 * (Phase 1, plans/260701-2344-nav-restructuring-operator-executive/phase-01-approval-inbox-backend.md).
 *
 * Coverage:
 * - Each domain returns the pending item for the right director role and omits it for the wrong one.
 * - Each domain's item disappears once the underlying record leaves the pending state.
 * - Separation of duties: a director who confirmed a KPI sheet does not see that sheet in their
 *   own "chờ duyệt" queue (mirrors the kpiEvalApprove mutation guard at payroll.ts:888-890).
 * - Non-director roles are rejected (FORBIDDEN) by the permission gate.
 */
describe('dashboard.myApprovals — approval-inbox aggregate', () => {
  const FACILITY = 1;
  // KpiScore is unique per (userId, periodKey); saleId is a fresh user each run, so a fixed
  // period key here can't collide with other suites.
  const PERIOD = '2097-07';

  let bizDirId: string;
  let otherBizDirId: string;
  let eduDirId: string;
  let saleId: string; // reports to bizDirId — KPI subject, manual-punch subject
  let teacherId: string; // reports to eduDirId — GIAO_VIEN shift-reg subject
  let studentId: string;
  let courseId: string;
  let kdGroupId: string;
  let gvGroupId: string;
  const createdUserIds: string[] = [];

  async function staff(role: Role, managerId?: string) {
    const user = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq(`${role}-inbox@cmc.test`),
          displayName: `${role} inbox test`,
          passwordHash: 'test',
          primaryRole: role,
          roles: [role],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      }),
    );
    await withRls(SUPER, (tx) =>
      tx.employmentProfile.create({
        data: { facilityId: FACILITY, userId: user.id, position: role, managerId },
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  const bizDirCaller = () =>
    staffCaller({ userId: bizDirId, roles: [Role.giam_doc_kinh_doanh], primaryRole: Role.giam_doc_kinh_doanh, isSuperAdmin: false, facilityIds: [FACILITY] });
  const otherBizDirCaller = () =>
    staffCaller({ userId: otherBizDirId, roles: [Role.giam_doc_kinh_doanh], primaryRole: Role.giam_doc_kinh_doanh, isSuperAdmin: false, facilityIds: [FACILITY] });
  const eduDirCaller = () =>
    staffCaller({ userId: eduDirId, roles: [Role.giam_doc_dao_tao], primaryRole: Role.giam_doc_dao_tao, isSuperAdmin: false, facilityIds: [FACILITY] });
  const saleCaller = () =>
    staffCaller({ userId: saleId, roles: [Role.sale], primaryRole: Role.sale, isSuperAdmin: false, facilityIds: [FACILITY] });

  beforeAll(async () => {
    const biz = await staff(Role.giam_doc_kinh_doanh);
    const otherBiz = await staff(Role.giam_doc_kinh_doanh);
    const edu = await staff(Role.giam_doc_dao_tao);
    bizDirId = biz.id;
    otherBizDirId = otherBiz.id;
    eduDirId = edu.id;

    const sale = await staff(Role.sale, bizDirId);
    const teacher = await staff(Role.giao_vien, eduDirId);
    saleId = sale.id;
    teacherId = teacher.id;

    const student = await withRls(SUPER, (tx) =>
      tx.student.create({ data: { facilityId: FACILITY, studentCode: uniq('S-INBOX'), fullName: 'Inbox Student', program: 'UCREA' } }),
    );
    studentId = student.id;

    const course = await withRls(SUPER, (tx) => tx.course.findFirst({ where: { archivedAt: null }, select: { id: true } }));
    if (!course) throw new Error('No course seeded — run pnpm db:seed first');
    courseId = course.id;

    const groups = await withRls(SUPER, async (tx) => {
      const kd = await tx.shiftGroup.upsert({
        where: { facilityId_code: { facilityId: FACILITY, code: 'KINH_DOANH' } },
        update: {},
        create: { facilityId: FACILITY, code: 'KINH_DOANH', name: 'Kinh doanh', selectionMode: 'SINGLE' },
      });
      const gv = await tx.shiftGroup.upsert({
        where: { facilityId_code: { facilityId: FACILITY, code: 'GIAO_VIEN' } },
        update: {},
        create: { facilityId: FACILITY, code: 'GIAO_VIEN', name: 'Giáo viên', selectionMode: 'MULTIPLE' },
      });
      return { kd, gv };
    });
    kdGroupId = groups.kd.id;
    gvGroupId = groups.gv.id;
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.recordEvent.deleteMany({ where: { entityType: 'kpi_score' } }).catch(() => {});
      await tx.kpiScore.deleteMany({ where: { userId: { in: [saleId, teacherId] } } }).catch(() => {});
      await tx.timePunch.deleteMany({ where: { userId: { in: [saleId, teacherId] } } }).catch(() => {});
      await tx.shiftRegistration.deleteMany({ where: { userId: { in: [saleId, teacherId] } } }).catch(() => {});
      await tx.reward.deleteMany({ where: { studentId } }).catch(() => {});
      await tx.gift.deleteMany({ where: { facilityId: FACILITY, name: { startsWith: 'GIFT_INBOX' } } }).catch(() => {});
      await tx.levelProgress.deleteMany({ where: { studentId } }).catch(() => {});
      await tx.receipt.deleteMany({ where: { studentId } }).catch(() => {});
      await tx.student.deleteMany({ where: { id: studentId } }).catch(() => {});
      await tx.employmentProfile.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await tx.appUser.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
    });
  });

  describe('gate', () => {
    it('non-director role (sale) is rejected with FORBIDDEN', async () => {
      await expect((await saleCaller()).dashboard.myApprovals({ facilityId: FACILITY })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('receipt-pending (giam_doc_kinh_doanh only)', () => {
    let receiptId: string;

    it('draft receipt appears for giam_doc_kinh_doanh, not for giam_doc_dao_tao', async () => {
      const receipt = await withRls(SUPER, (tx) =>
        tx.receipt.create({
          data: {
            facilityId: FACILITY, studentId, courseId,
            yearsPrepaid: 1, annualPrice: 10_000_000, grossAmount: 10_000_000,
            tierPercent: 0, effectiveDiscountPercent: 0, netAmount: 10_000_000,
            status: 'draft',
          },
        }),
      );
      receiptId = receipt.id;

      const bizItems = await (await bizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(bizItems.some((i) => i.domain === 'receipt' && i.id === receiptId)).toBe(true);

      const eduItems = await (await eduDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(eduItems.some((i) => i.domain === 'receipt' && i.id === receiptId)).toBe(false);
    });

    it('approved receipt no longer appears', async () => {
      await withRls(SUPER, (tx) => tx.receipt.update({ where: { id: receiptId }, data: { status: 'approved' } }));
      const bizItems = await (await bizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(bizItems.some((i) => i.domain === 'receipt' && i.id === receiptId)).toBe(false);
    });
  });

  describe('rewards-pending (giam_doc_kinh_doanh only)', () => {
    let rewardId: string;
    let giftId: string;

    it('pending reward appears for giam_doc_kinh_doanh, not for giam_doc_dao_tao', async () => {
      const gift = await withRls(SUPER, (tx) =>
        tx.gift.create({ data: { facilityId: FACILITY, name: uniq('GIFT_INBOX'), starsRequired: 10 } }),
      );
      giftId = gift.id;
      const reward = await withRls(SUPER, (tx) =>
        tx.reward.create({ data: { facilityId: FACILITY, studentId, giftId, starsSpent: 10, status: 'pending' } }),
      );
      rewardId = reward.id;

      const bizItems = await (await bizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(bizItems.some((i) => i.domain === 'rewards' && i.id === rewardId)).toBe(true);

      const eduItems = await (await eduDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(eduItems.some((i) => i.domain === 'rewards' && i.id === rewardId)).toBe(false);
    });

    it('approved reward no longer appears', async () => {
      await withRls(SUPER, (tx) => tx.reward.update({ where: { id: rewardId }, data: { status: 'approved' } }));
      const bizItems = await (await bizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(bizItems.some((i) => i.domain === 'rewards' && i.id === rewardId)).toBe(false);
    });
  });

  describe('shift-registration-pending (group-filtered: KINH_DOANH → GĐKD, GIAO_VIEN → GĐĐT)', () => {
    let kdRegId: string;
    let gvRegId: string;

    it('KINH_DOANH group registration appears only for giam_doc_kinh_doanh (its assigned manager)', async () => {
      const reg = await withRls(SUPER, (tx) =>
        tx.shiftRegistration.create({
          data: {
            facilityId: FACILITY, userId: saleId,
            fromDate: new Date('2099-02-01'), toDate: new Date('2099-02-01'),
            status: 'submitted', shiftGroupId: kdGroupId, managerId: bizDirId,
          },
        }),
      );
      kdRegId = reg.id;

      const bizItems = await (await bizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(bizItems.some((i) => i.domain === 'shiftRegistration' && i.id === kdRegId)).toBe(true);

      const eduItems = await (await eduDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(eduItems.some((i) => i.domain === 'shiftRegistration' && i.id === kdRegId)).toBe(false);

      // Another giam_doc_kinh_doanh who is NOT the assigned manager DOES still see it — decision
      // 0027's director-role bypass (dashboard.ts shiftRegistrationPendingItems) lets BOTH
      // directors approve all registrations in their domain, not just their own assigned ones.
      const otherBizItems = await (await otherBizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(otherBizItems.some((i) => i.domain === 'shiftRegistration' && i.id === kdRegId)).toBe(true);
    });

    it('GIAO_VIEN group registration appears only for giam_doc_dao_tao', async () => {
      const reg = await withRls(SUPER, (tx) =>
        tx.shiftRegistration.create({
          data: {
            facilityId: FACILITY, userId: teacherId,
            fromDate: new Date('2099-02-01'), toDate: new Date('2099-02-01'),
            status: 'submitted', shiftGroupId: gvGroupId, managerId: eduDirId,
          },
        }),
      );
      gvRegId = reg.id;

      const eduItems = await (await eduDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(eduItems.some((i) => i.domain === 'shiftRegistration' && i.id === gvRegId)).toBe(true);

      const bizItems = await (await bizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(bizItems.some((i) => i.domain === 'shiftRegistration' && i.id === gvRegId)).toBe(false);
    });

    it('approved registration no longer appears', async () => {
      await withRls(SUPER, (tx) => tx.shiftRegistration.update({ where: { id: kdRegId }, data: { status: 'approved' } }));
      const bizItems = await (await bizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(bizItems.some((i) => i.domain === 'shiftRegistration' && i.id === kdRegId)).toBe(false);
    });
  });

  describe('manual-punch-pending (both directors, scoped to the direct manager)', () => {
    let punchId: string;

    it('manual punch appears only for its subject\'s manager (bizDir), not the other director', async () => {
      const punch = await withRls(SUPER, (tx) =>
        tx.timePunch.create({
          data: { facilityId: FACILITY, userId: saleId, ipAddress: '203.0.113.9', method: 'manual' },
        }),
      );
      punchId = punch.id;

      const bizItems = await (await bizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(bizItems.some((i) => i.domain === 'manualPunch' && i.id === punchId)).toBe(true);

      const eduItems = await (await eduDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(eduItems.some((i) => i.domain === 'manualPunch' && i.id === punchId)).toBe(false);
    });

    it('approved punch no longer appears', async () => {
      await withRls(SUPER, (tx) => tx.timePunch.update({ where: { id: punchId }, data: { approvedAt: new Date(), approvedById: bizDirId } }));
      const bizItems = await (await bizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(bizItems.some((i) => i.domain === 'manualPunch' && i.id === punchId)).toBe(false);
    });
  });

  describe('level-progress-pending (giam_doc_dao_tao only)', () => {
    let lpId: string;

    it('pending level-up appears for giam_doc_dao_tao, not for giam_doc_kinh_doanh', async () => {
      const lp = await withRls(SUPER, (tx) =>
        tx.levelProgress.create({ data: { facilityId: FACILITY, studentId, fromLevel: 'L1', toLevel: 'L2', status: 'pending' } }),
      );
      lpId = lp.id;

      const eduItems = await (await eduDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(eduItems.some((i) => i.domain === 'levelProgress' && i.id === lpId)).toBe(true);

      const bizItems = await (await bizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(bizItems.some((i) => i.domain === 'levelProgress' && i.id === lpId)).toBe(false);
    });

    it('decided proposal no longer appears', async () => {
      await (await eduDirCaller()).levelProgress.decide({ id: lpId, decision: 'reject', reason: 'test cleanup' });
      const eduItems = await (await eduDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(eduItems.some((i) => i.domain === 'levelProgress' && i.id === lpId)).toBe(false);
    });
  });

  describe('kpi-pending (both directors) + separation of duties', () => {
    // Ensure clean state: delete any existing KPI sheet for this employee/period before the SoD tests
    let kpiId: string;
    beforeAll(async () => {
      await withRls(SUPER, (tx) =>
        tx.kpiScore.deleteMany({ where: { userId: saleId, periodKey: PERIOD } }),
      );
    });

    it('submitted KPI sheet appears for both directors with actionKey kpiEvalConfirm', async () => {
      const created = await withRls(SUPER, (tx) =>
        tx.kpiScore.create({
          data: {
            facilityId: FACILITY, userId: saleId, periodKey: PERIOD, block: 'sales',
            autoScore: 0, status: 'submitted', submittedById: saleId, submittedAt: new Date(),
          },
        }),
      );
      kpiId = created.id;

      const bizItems = await (await bizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      const bizItem = bizItems.find((i) => i.domain === 'kpi' && i.id === kpiId && i.actionKey === 'payroll.kpiEvalConfirm');
      expect(bizItem).toBeDefined();

      // Domain-scoped: only giam_doc_kinh_doanh can manage BUSINESS domain targets (saleId).
      // otherBizDir (second giam_doc_kinh_doanh) should also see it.
      const otherBizItems = await (await otherBizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(otherBizItems.some((i) => i.domain === 'kpi' && i.id === kpiId && i.actionKey === 'payroll.kpiEvalConfirm')).toBe(true);
    });

    it('separation of duties: confirming director does NOT see the sheet in their own approve-queue; a different director does', async () => {
      await (await bizDirCaller()).payroll.kpiEvalConfirm({ userId: saleId, periodKey: PERIOD });

      // No longer "chờ xác nhận" for anyone.
      const bizAfterConfirm = await (await bizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(bizAfterConfirm.some((i) => i.domain === 'kpi' && i.id === kpiId && i.actionKey === 'payroll.kpiEvalConfirm')).toBe(false);
      // And NOT "chờ duyệt" for the confirmer either (separation of duties).
      expect(bizAfterConfirm.some((i) => i.domain === 'kpi' && i.id === kpiId && i.actionKey === 'payroll.kpiEvalApprove')).toBe(false);

      // A different director (second giam_doc_kinh_doanh) sees it as "chờ duyệt".
      const otherBizAfterConfirm = await (await otherBizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(otherBizAfterConfirm.some((i) => i.domain === 'kpi' && i.id === kpiId && i.actionKey === 'payroll.kpiEvalApprove')).toBe(true);
    });

    it('approved KPI sheet no longer appears for either director', async () => {
      await (await otherBizDirCaller()).payroll.kpiEvalApprove({ userId: saleId, periodKey: PERIOD });
      const bizItems = await (await bizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      const otherBizItems = await (await otherBizDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(bizItems.some((i) => i.domain === 'kpi' && i.id === kpiId)).toBe(false);
      expect(otherBizItems.some((i) => i.domain === 'kpi' && i.id === kpiId)).toBe(false);
    });
  });

  describe('item shape', () => {
    it('every item has domain, id, title, submittedAt, actionKey', async () => {
      await withRls(SUPER, (tx) =>
        tx.levelProgress.create({ data: { facilityId: FACILITY, studentId, fromLevel: 'L1', toLevel: 'L2', status: 'pending' } }),
      );
      const items = await (await eduDirCaller()).dashboard.myApprovals({ facilityId: FACILITY });
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(typeof item.domain).toBe('string');
        expect(typeof item.id).toBe('string');
        expect(typeof item.title).toBe('string');
        expect(item.submittedAt).toBeTruthy();
        expect(typeof item.actionKey).toBe('string');
      }
    });
  });
});
