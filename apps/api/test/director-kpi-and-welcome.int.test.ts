/**
 * Integration tests for the 3-heads executive authority added this round:
 *   1. Both directors can confirm AND approve KPI (replacing legacy bgd, which prod bootstrap
 *      never seeds). Confirm is domain-scoped but approve is cross-domain (decision 0023), so the
 *      real one-KD/one-DT org reaches `approved` without a second same-domain director. SoD intact
 *      (approver ≠ confirmer).
 *   2. Directors can load the KPI panel (kpiList + kpiEvalGet).
 *   3. user.create enqueues an SSO welcome email that carries NO password.
 *
 * Uses freshly-created users so KPI period keys never collide with other suites.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { prisma, staffCaller, withRls, SUPER, uniq } from './helpers.js';

const FACILITY_1 = 1;

let bizDirId: string;
let eduDirId: string;
let teacherId: string;

const eduDirCaller = () =>
  staffCaller({
    userId: eduDirId,
    roles: [Role.giam_doc_dao_tao],
    primaryRole: Role.giam_doc_dao_tao,
    isSuperAdmin: false,
    facilityIds: [FACILITY_1],
  });

// The OTHER director (business domain). Cross-domain approve (decision 0023) lets this director
// approve an education-domain KPI even though confirm would be domain-scoped to the DT director.
const bizDirCaller = () =>
  staffCaller({
    userId: bizDirId,
    roles: [Role.giam_doc_kinh_doanh],
    primaryRole: Role.giam_doc_kinh_doanh,
    isSuperAdmin: false,
    facilityIds: [FACILITY_1],
  });

const teacherCaller = () =>
  staffCaller({
    userId: teacherId,
    roles: [Role.giao_vien],
    primaryRole: Role.giao_vien,
    isSuperAdmin: false,
    facilityIds: [FACILITY_1],
  });

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`; // fail fast if DB not available

  const mk = (role: Role, name: string) =>
    withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq(`${name}@cmc.test`),
          displayName: name,
          passwordHash: 'dummy',
          roles: [role],
          primaryRole: role,
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY_1 }] },
        },
        select: { id: true },
      }),
    );

  bizDirId = (await mk(Role.giam_doc_kinh_doanh, 'dir-kd')).id;
  eduDirId = (await mk(Role.giam_doc_dao_tao, 'dir-dt')).id;
  teacherId = (await mk(Role.giao_vien, 'dir-teacher')).id;
});

afterAll(async () => {
  await withRls(SUPER, async (tx) => {
    await tx.recordEvent.deleteMany({ where: { entityType: 'kpi_score', facilityId: FACILITY_1 } });
    await tx.kpiScore.deleteMany({ where: { userId: teacherId } });
    await tx.appUser.deleteMany({ where: { id: { in: [bizDirId, eduDirId, teacherId] } } });
  });
});

describe('director KPI authority', () => {
  it('DT director confirms, KD director approves cross-domain (SoD satisfied)', async () => {
    const su = await staffCaller();
    const period = '2099-41';
    await su.payroll.kpiEvalStart({ userId: teacherId, facilityId: FACILITY_1, periodKey: period, block: 'training' });

    const teacher = await teacherCaller();
    await teacher.payroll.kpiEvalSubmit({
      periodKey: period,
      scores: [{ key: 'chuyen_mon', score: 85 }, { key: 'tuan_thu', score: 80 }],
    });

    // Education Director confirms (domain-scoped: DT director manages the teacher's education domain).
    const edu = await eduDirCaller();
    const confirmed = await edu.payroll.kpiEvalConfirm({ userId: teacherId, periodKey: period });
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.confirmedById).toBe(eduDirId);

    // The OTHER director (KD, business domain) approves — cross-domain approve (decision 0023):
    // different person → SoD ok; domain no longer gates approve, so the real one-DT org still closes.
    const biz = await bizDirCaller();
    const approved = await biz.payroll.kpiEvalApprove({ userId: teacherId, periodKey: period });
    expect(approved.status).toBe('approved');
    expect(approved.approvedById).toBe(bizDirId);
  });

  it('same director cannot confirm AND approve the same sheet (FORBIDDEN)', async () => {
    const su = await staffCaller();
    const period = '2099-42';
    await su.payroll.kpiEvalStart({ userId: teacherId, facilityId: FACILITY_1, periodKey: period, block: 'training' });

    const teacher = await teacherCaller();
    await teacher.payroll.kpiEvalSubmit({
      periodKey: period,
      scores: [{ key: 'chuyen_mon', score: 70 }, { key: 'tuan_thu', score: 75 }],
    });

    const edu = await eduDirCaller();
    await edu.payroll.kpiEvalConfirm({ userId: teacherId, periodKey: period });
    await expect(
      edu.payroll.kpiEvalApprove({ userId: teacherId, periodKey: period }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('director can load the KPI panel (kpiList + kpiEvalGet)', async () => {
    const su = await staffCaller();
    const period = '2099-43';
    await su.payroll.kpiEvalStart({ userId: teacherId, facilityId: FACILITY_1, periodKey: period, block: 'training' });

    const edu = await eduDirCaller();
    const rows = await edu.payroll.kpiList({ facilityId: FACILITY_1, periodKey: period });
    expect(rows.some((r) => r.userId === teacherId)).toBe(true);

    const got = await edu.payroll.kpiEvalGet({ userId: teacherId, periodKey: period });
    expect(got.row.userId).toBe(teacherId);
    expect(got.criteriaConfig.length).toBeGreaterThan(0);
  });
});

describe('user.create welcome email (SSO onboarding, no password)', () => {
  it('enqueues an account_welcome email that does not contain the password', async () => {
    const su = await staffCaller();
    const personalEmail = `personal-${uniq('welcome')}@example.com`;
    const created = await su.user.create({
      email: `${uniq('welcome-staff')}@cmc.test`,
      displayName: 'Welcome Staff',
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      facilityIds: [FACILITY_1],
      nationalId: '0010000000001',
      startedAt: '2026-01-01',
      position: 'Nhân viên',
      phone: '0901000001',
      personalEmail,
    });

    // Welcome email goes to the PERSONAL email, not the CMC EDU/SSO address — the new hire may
    // not be able to check their company inbox yet (see apps/api/src/routers/user.ts emailWelcome).
    const row = await withRls(SUPER, (tx) =>
      tx.emailOutbox.findUnique({ where: { dedupKey: `account_welcome:${personalEmail}` } }),
    );
    expect(row, 'welcome email should be enqueued').not.toBeNull();
    expect(row!.templateKind).toBe('account_welcome');
    expect(row!.toAddress).toBe(personalEmail);
    expect(row!.bodyHtml).toContain('CMC EDU'); // SSO instruction
    expect(row!.bodyHtml).not.toContain('Mật khẩu'); // SSO onboarding: no password is ever emailed

    // cleanup
    await withRls(SUPER, async (tx) => {
      await tx.emailOutbox.deleteMany({ where: { dedupKey: `account_welcome:${personalEmail}` } });
      await tx.recordEvent.deleteMany({ where: { entityType: 'user', entityId: created.id } });
      await tx.appUser.delete({ where: { id: created.id } });
    });
  });
});
