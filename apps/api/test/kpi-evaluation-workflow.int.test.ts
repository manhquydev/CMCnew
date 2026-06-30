import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

// Invariant (decision 0011, P05): KPI phiếu đánh giá workflow draft→submitted→confirmed→approved.
// Điểm cuối = weightedKpi(criterionScores × policy weights). Mỗi bước phải có record_event.
// authz: chỉ chính chủ tự nộp; manager xác nhận; BGD phê duyệt (≠ confirmer); quản_ly không approve.
describe('KPI evaluation workflow (P05 — phiếu đánh giá)', () => {
  const FACILITY = 1;
  const PERIOD = '2099-07'; // Kỳ test cô lập, không đụng kỳ test khác

  let saleId: string;     // nhân sự bị đánh giá
  let managerId: string;  // quản_ly (N+1 — confirm)
  let bgdId: string;      // bgd (N+2 — approve)

  beforeAll(async () => {
    // Dùng superAdmin làm BGD actor
    bgdId = await superAdminUserId();

    // Tạo user quản_ly để làm confirmer
    const mgr = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('kpi-eval-mgr@cmc.test'),
          displayName: 'KPI Eval Manager',
          passwordHash: 'dummy',
          primaryRole: 'quan_ly',
          roles: ['quan_ly'],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      }),
    );
    managerId = mgr.id;

    // Tạo nhân viên sale
    const sale = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('kpi-eval-sale@cmc.test'),
          displayName: 'KPI Eval Sale',
          passwordHash: 'dummy',
          primaryRole: 'sale',
          roles: ['sale'],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      }),
    );
    saleId = sale.id;

    const su = await staffCaller();
    await su.payroll.profileUpsert({
      userId: saleId,
      facilityId: FACILITY,
      position: 'sales',
      dependents: 0,
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.recordEvent.deleteMany({ where: { entityType: 'kpi_score' } });
      await tx.kpiScore.deleteMany({ where: { userId: saleId } });
      await tx.employmentProfile.deleteMany({ where: { userId: saleId } });
      await tx.appUser.deleteMany({ where: { id: { in: [saleId, managerId] } } });
    });
  });

  /** Helpers để tạo caller theo role */
  const hrCaller = () => staffCaller(); // super_admin = passes all role checks
  const managerCaller = () =>
    staffCaller({
      userId: managerId,
      roles: [Role.quan_ly],
      primaryRole: Role.quan_ly,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });
  const bgdCaller = () =>
    staffCaller({
      userId: bgdId,
      roles: [Role.bgd],
      primaryRole: Role.bgd,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });
  const saleCaller = () =>
    staffCaller({
      userId: saleId,
      roles: [Role.sale],
      primaryRole: Role.sale,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

  // ─── Happy path ───────────────────────────────────────────────────────────────

  it('HR khởi tạo phiếu KPI → status=draft với criterion scores = 0', async () => {
    const hr = await hrCaller();
    const row = await hr.payroll.kpiEvalStart({
      userId: saleId,
      facilityId: FACILITY,
      periodKey: PERIOD,
      block: 'sales',
    });
    expect(row.status).toBe('draft');
    expect(row.autoScore).toBe(0);
    // criterionScores khởi tạo = mỗi key score 0 (theo DEFAULT_PARAMS.kpiCriteria.sales)
    const cs = row.criterionScores as { key: string; score: number }[];
    expect(cs).toBeDefined();
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.every((c) => c.score === 0)).toBe(true);
    expect(cs.map((c) => c.key)).toContain('doanh_so');
  });

  it('HR khởi tạo lại phiếu đã có status=draft → OK (upsert)', async () => {
    const hr = await hrCaller();
    const row = await hr.payroll.kpiEvalStart({
      userId: saleId,
      facilityId: FACILITY,
      periodKey: PERIOD,
      block: 'sales',
    });
    expect(row.status).toBe('draft');
  });

  it('Nhân sự tự nộp phiếu → status=submitted', async () => {
    const sale = await saleCaller();
    // Scores theo spec: doanh_so=80, tuan_thu=70, khac=60 → autoScore = 0.7*80+0.2*70+0.1*60 = 76
    const row = await sale.payroll.kpiEvalSubmit({
      periodKey: PERIOD,
      scores: [
        { key: 'doanh_so', score: 80 },
        { key: 'tuan_thu', score: 70 },
        { key: 'khac', score: 60 },
      ],
    });
    expect(row.status).toBe('submitted');
    expect(row.submittedById).toBe(saleId);
    expect(row.submittedAt).not.toBeNull();
  });

  it('Quản lý xác nhận phiếu → status=confirmed', async () => {
    const mgr = await managerCaller();
    const row = await mgr.payroll.kpiEvalConfirm({
      userId: saleId,
      periodKey: PERIOD,
    });
    expect(row.status).toBe('confirmed');
    expect(row.confirmedById).toBe(managerId);
    expect(row.confirmedAt).not.toBeNull();
  });

  it('BGD phê duyệt phiếu → status=approved, autoScore=76 (per spec formula)', async () => {
    // BGD khác với managerId → thoả điều kiện tách trách nhiệm
    // Dùng superAdmin (bgdId) — nhưng ta cần gọi với role bgd.
    // Super admin passes requireRole(bgd) check vì isSuperAdmin=true.
    const su = await hrCaller(); // super passes bgd gate
    const row = await su.payroll.kpiEvalApprove({
      userId: saleId,
      periodKey: PERIOD,
    });
    expect(row.status).toBe('approved');
    expect(row.approvedAt).not.toBeNull();
    // autoScore = 0.7*80 + 0.2*70 + 0.1*60 = 56 + 14 + 6 = 76
    expect(row.autoScore).toBe(76);
  });

  it('kpiEvalGet trả về phiếu đầy đủ + criteriaConfig', async () => {
    const hr = await hrCaller();
    const { row, criteriaConfig } = await hr.payroll.kpiEvalGet({
      userId: saleId,
      periodKey: PERIOD,
    });
    expect(row.status).toBe('approved');
    expect(row.autoScore).toBe(76);
    expect(criteriaConfig).toBeDefined();
    expect(criteriaConfig.length).toBeGreaterThan(0);
    expect(criteriaConfig.some((c) => c.key === 'doanh_so')).toBe(true);
  });

  it('Mỗi bước có record_event cho kpi_score', async () => {
    const events = await withRls(SUPER, (tx) =>
      tx.recordEvent.findMany({
        where: { entityType: 'kpi_score' },
        orderBy: { createdAt: 'asc' },
      }),
    );
    // Ít nhất 4 events: start, submit, confirm, approve
    expect(events.length).toBeGreaterThanOrEqual(4);
  });

  // ─── Authz negatives ──────────────────────────────────────────────────────────

  it('Người khác không thể submit thay (FORBIDDEN — chỉ chính chủ submit)', async () => {
    // Tạo một user khác thử submit thay cho saleId
    const other = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('kpi-other@cmc.test'),
          displayName: 'Other',
          passwordHash: 'dummy',
          primaryRole: 'sale',
          roles: ['sale'],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      }),
    );
    const PERIOD2 = '2099-08';
    try {
      const su = await hrCaller();
      // HR tạo phiếu cho "other" user
      await su.payroll.kpiEvalStart({
        userId: other.id,
        facilityId: FACILITY,
        periodKey: PERIOD2,
        block: 'sales',
      });
      // saleId cố submit phiếu của other → chỉ ctx.session.userId được submit (other.id ≠ saleId)
      const saleActor = await saleCaller();
      // kpiEvalSubmit lấy userId từ session, nên nó sẽ tìm phiếu của saleId, không phải other
      // → NOT_FOUND vì phiếu PERIOD2 của saleId không tồn tại
      await expect(
        saleActor.payroll.kpiEvalSubmit({
          periodKey: PERIOD2,
          scores: [{ key: 'doanh_so', score: 80 }, { key: 'tuan_thu', score: 70 }, { key: 'khac', score: 60 }],
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await withRls(SUPER, async (tx) => {
        await tx.kpiScore.deleteMany({ where: { userId: other.id } });
        await tx.employmentProfile.deleteMany({ where: { userId: other.id } });
        await tx.appUser.delete({ where: { id: other.id } });
      });
    }
  });

  it('Giao viên không thể confirm phiếu (FORBIDDEN — cần quan_ly+)', async () => {
    const teacherCaller = await staffCaller({
      userId: saleId, // bất kỳ user, quan trọng là role
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });
    await expect(
      teacherCaller.payroll.kpiEvalConfirm({ userId: saleId, periodKey: PERIOD }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('Quản lý không thể approve (FORBIDDEN — cần bgd)', async () => {
    const mgr = await managerCaller();
    await expect(
      mgr.payroll.kpiEvalApprove({ userId: saleId, periodKey: PERIOD }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('Tự xác nhận phiếu của chính mình → FORBIDDEN (tách trách nhiệm)', async () => {
    // managerId là quan_ly, có quyền kpiEvalConfirm. Tạo phiếu cho chính managerId, manager tự nộp,
    // rồi cố tự xác nhận phiếu của mình → phải bị chặn dù role có quyền.
    const PERIOD_SELF = '2099-11';
    const su = await hrCaller();
    await su.payroll.kpiEvalStart({ userId: managerId, facilityId: FACILITY, periodKey: PERIOD_SELF, block: 'sales' });
    const mgr = await managerCaller();
    await mgr.payroll.kpiEvalSubmit({
      periodKey: PERIOD_SELF,
      scores: [{ key: 'doanh_so', score: 80 }, { key: 'tuan_thu', score: 70 }, { key: 'khac', score: 60 }],
    });
    await expect(
      mgr.payroll.kpiEvalConfirm({ userId: managerId, periodKey: PERIOD_SELF }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await withRls(SUPER, (tx) => tx.kpiScore.deleteMany({ where: { userId: managerId, periodKey: PERIOD_SELF } }));
  });

  it('Tự duyệt phiếu của chính mình → FORBIDDEN (tách trách nhiệm)', async () => {
    // bgd có quyền kpiEvalApprove. Tạo phiếu cho chính bgdId, bgd tự nộp, quản lý xác nhận (≠ subject),
    // rồi bgd cố tự duyệt phiếu của mình → bị chặn bởi self-guard (trước cả check confirmer≠approver).
    const PERIOD_SELF = '2099-12';
    const su = await hrCaller();
    await su.payroll.kpiEvalStart({ userId: bgdId, facilityId: FACILITY, periodKey: PERIOD_SELF, block: 'sales' });
    const bgd = await bgdCaller();
    await bgd.payroll.kpiEvalSubmit({
      periodKey: PERIOD_SELF,
      scores: [{ key: 'doanh_so', score: 80 }, { key: 'tuan_thu', score: 70 }, { key: 'khac', score: 60 }],
    });
    const mgr = await managerCaller();
    await mgr.payroll.kpiEvalConfirm({ userId: bgdId, periodKey: PERIOD_SELF });
    await expect(
      bgd.payroll.kpiEvalApprove({ userId: bgdId, periodKey: PERIOD_SELF }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await withRls(SUPER, (tx) => tx.kpiScore.deleteMany({ where: { userId: bgdId, periodKey: PERIOD_SELF } }));
  });

  // ─── Gating ───────────────────────────────────────────────────────────────────

  it('Approve khi status=submitted (chưa confirmed) → CONFLICT', async () => {
    // Tạo phiếu mới ở PERIOD3 và submit nhưng không confirm
    const PERIOD3 = '2099-09';
    const su = await hrCaller();
    await su.payroll.kpiEvalStart({
      userId: saleId,
      facilityId: FACILITY,
      periodKey: PERIOD3,
      block: 'sales',
    });
    const sale = await saleCaller();
    await sale.payroll.kpiEvalSubmit({
      periodKey: PERIOD3,
      scores: [{ key: 'doanh_so', score: 80 }, { key: 'tuan_thu', score: 70 }, { key: 'khac', score: 60 }],
    });
    // Cố approve khi chỉ mới submitted → CONFLICT
    await expect(
      su.payroll.kpiEvalApprove({ userId: saleId, periodKey: PERIOD3 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    // Cleanup
    await withRls(SUPER, (tx) => tx.kpiScore.deleteMany({ where: { userId: saleId, periodKey: PERIOD3 } }));
  });

  it('Submit khi đã submitted → CONFLICT', async () => {
    // Phiếu PERIOD hiện tại đã approved → cũng không thể submit lại
    const sale = await saleCaller();
    await expect(
      sale.payroll.kpiEvalSubmit({
        periodKey: PERIOD,
        scores: [{ key: 'doanh_so', score: 90 }, { key: 'tuan_thu', score: 80 }, { key: 'khac', score: 70 }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('HR khởi tạo phiếu đã submitted+ → CONFLICT', async () => {
    const hr = await hrCaller();
    await expect(
      hr.payroll.kpiEvalStart({
        userId: saleId,
        facilityId: FACILITY,
        periodKey: PERIOD,
        block: 'sales',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('Approver == confirmer → FORBIDDEN (tách trách nhiệm)', async () => {
    // Tạo phiếu PERIOD4 với managerId là confirmer, rồi managerId cố approve → phải FORBIDDEN
    const PERIOD4 = '2099-10';
    const su = await hrCaller();
    await su.payroll.kpiEvalStart({
      userId: saleId,
      facilityId: FACILITY,
      periodKey: PERIOD4,
      block: 'sales',
    });
    const sale = await saleCaller();
    await sale.payroll.kpiEvalSubmit({
      periodKey: PERIOD4,
      scores: [{ key: 'doanh_so', score: 80 }, { key: 'tuan_thu', score: 70 }, { key: 'khac', score: 60 }],
    });
    const mgr = await managerCaller();
    await mgr.payroll.kpiEvalConfirm({ userId: saleId, periodKey: PERIOD4 });
    // manager (confirmedById=managerId) cố approve → FORBIDDEN
    await expect(
      mgr.payroll.kpiEvalApprove({ userId: saleId, periodKey: PERIOD4 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Cleanup
    await withRls(SUPER, (tx) => tx.kpiScore.deleteMany({ where: { userId: saleId, periodKey: PERIOD4 } }));
  });
});
