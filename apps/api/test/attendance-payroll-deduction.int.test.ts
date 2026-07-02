import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

const FACILITY_ID = 1;
const PERIOD = '2099-01';

describe('attendance penalty flows into payroll', () => {
  let directorId: string;
  let employeeId: string;
  let templateId: string;
  let registrationId: string;
  let salaryRateId: string;

  beforeAll(async () => {
    const setup = await withRls(SUPER, async (tx) => {
      const director = await tx.appUser.create({
        data: {
          email: uniq('p4-kd-director@cmc.test'),
          displayName: 'P4 KD Director',
          passwordHash: 'test',
          primaryRole: Role.giam_doc_kinh_doanh,
          roles: [Role.giam_doc_kinh_doanh],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY_ID }] },
        },
      });
      const employee = await tx.appUser.create({
        data: {
          email: uniq('p4-sale@cmc.test'),
          displayName: 'P4 Sale',
          passwordHash: 'test',
          primaryRole: Role.sale,
          roles: [Role.sale],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY_ID }] },
        },
      });
      await tx.employmentProfile.create({
        data: { facilityId: FACILITY_ID, userId: director.id, position: Role.giam_doc_kinh_doanh },
      });
      await tx.employmentProfile.create({
        data: { facilityId: FACILITY_ID, userId: employee.id, position: Role.sale, managerId: director.id },
      });
      const rate = await tx.salaryRate.create({
        data: {
          facilityId: FACILITY_ID,
          userId: employee.id,
          baseSalary: 30_000_000,
          mealAllowance: 0,
          otherAllowance: 0,
          kpiMax: 0,
          monthlyQuota: 0,
          effectiveFrom: new Date('2098-01-01'),
          createdById: director.id,
        },
      });
      const group = await tx.shiftGroup.upsert({
        where: { facilityId_code: { facilityId: FACILITY_ID, code: 'KINH_DOANH' } },
        update: { name: 'Kinh doanh', selectionMode: 'SINGLE' },
        create: { facilityId: FACILITY_ID, code: 'KINH_DOANH', name: 'Kinh doanh', selectionMode: 'SINGLE' },
      });
      const template = await tx.shiftTemplate.create({
        data: {
          facilityId: FACILITY_ID,
          shiftGroupId: group.id,
          code: uniq('P4_KD'),
          name: 'P4 KD shift',
          startTime: '22:00',
          endTime: '23:00',
          hours: 8,
        },
      });
      const reg = await tx.shiftRegistration.create({
        data: {
          facilityId: FACILITY_ID,
          userId: employee.id,
          fromDate: new Date('2099-01-05'),
          toDate: new Date('2099-01-05'),
          status: 'approved',
          shiftGroupId: group.id,
          managerId: director.id,
          approvedAt: new Date(),
          approvedById: director.id,
          entries: {
            create: [{
              date: new Date('2099-01-05'),
              shiftTemplateId: template.id,
              type: 'work',
              hours: 8,
            }],
          },
        },
      });
      await tx.timePunch.createMany({
        data: [
          {
            facilityId: FACILITY_ID,
            userId: employee.id,
            timestamp: new Date('2099-01-05T15:15:00Z'),
            ipAddress: '198.51.100.10',
            method: 'ip',
            shiftTemplateId: template.id,
          },
          {
            facilityId: FACILITY_ID,
            userId: employee.id,
            timestamp: new Date('2099-01-05T15:40:00Z'),
            ipAddress: '198.51.100.10',
            method: 'ip',
            shiftTemplateId: template.id,
          },
        ],
      });
      return { director, employee, template, reg, rate };
    });
    directorId = setup.director.id;
    employeeId = setup.employee.id;
    templateId = setup.template.id;
    registrationId = setup.reg.id;
    salaryRateId = setup.rate.id;
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.payslip.deleteMany({ where: { userId: employeeId, periodKey: PERIOD } }).catch(() => {});
      await tx.timePunch.deleteMany({ where: { userId: employeeId } }).catch(() => {});
      await tx.shiftRegistration.deleteMany({ where: { id: registrationId } }).catch(() => {});
      await tx.shiftTemplate.deleteMany({ where: { id: templateId } }).catch(() => {});
      await tx.salaryRate.deleteMany({ where: { id: salaryRateId } }).catch(() => {});
      await tx.employmentProfile.deleteMany({ where: { userId: { in: [directorId, employeeId] } } }).catch(() => {});
      await tx.appUser.deleteMany({ where: { id: { in: [directorId, employeeId] } } }).catch(() => {});
    });
  });

  function directorCaller() {
    return staffCaller({
      userId: directorId,
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [FACILITY_ID],
    });
  }

  it('computes live attendance penalty into draft payslip and monthly report', async () => {
    const caller = await directorCaller();
    const slip = await caller.payroll.payslipCompute({
      userId: employeeId,
      facilityId: FACILITY_ID,
      periodKey: PERIOD,
      standardDays: 22,
      workdays: 22,
      kpiScore: 0,
      variablePay: 0,
      insuranceDeduction: 0,
    });
    expect(slip.attendanceDeduction).toBe(27_500);
    expect(slip.netIncome).toBe(slip.grossIncome - slip.insuranceDeduction - slip.pitAmount - 27_500);

    const report = await caller.checkInOut.monthlyReport({ facilityId: FACILITY_ID, periodKey: PERIOD });
    const row = report.rows.find((r) => r.userId === employeeId);
    expect(row?.workdays).toBe(1);
    expect(row?.lateMinutes).toBe(15);
    expect(row?.earlyMinutes).toBe(20);
    expect(row?.penaltyAmount).toBe(27_500);
  });

  it('lets payroll manager override attendance deduction on draft and locks after finalize', async () => {
    const caller = await directorCaller();
    const draft = await caller.payroll.payslipCompute({
      userId: employeeId,
      facilityId: FACILITY_ID,
      periodKey: PERIOD,
      standardDays: 22,
      workdays: 22,
      kpiScore: 0,
      variablePay: 0,
      insuranceDeduction: 0,
    });
    const overridden = await caller.payroll.payslipOverrideAttendanceDeduction({
      id: draft.id,
      amount: 1_000,
      reason: 'Manager accepted valid one-off exception',
    });
    expect(overridden.attendanceDeduction).toBe(27_500);
    expect(overridden.attendanceDeductionOverride).toBe(1_000);
    expect(overridden.attendanceDeductionOverrideById).toBe(directorId);
    expect(overridden.netIncome).toBe(overridden.grossIncome - overridden.insuranceDeduction - overridden.pitAmount - 1_000);

    const recomputed = await caller.payroll.payslipCompute({
      userId: employeeId,
      facilityId: FACILITY_ID,
      periodKey: PERIOD,
      standardDays: 22,
      workdays: 22,
      kpiScore: 0,
      variablePay: 0,
      insuranceDeduction: 0,
    });
    expect(recomputed.attendanceDeductionOverride).toBe(1_000);
    expect(recomputed.netIncome).toBe(recomputed.grossIncome - recomputed.insuranceDeduction - recomputed.pitAmount - 1_000);

    await caller.payroll.payslipFinalize({ id: recomputed.id });
    await expect(caller.payroll.payslipOverrideAttendanceDeduction({
      id: recomputed.id,
      amount: 0,
      reason: 'Too late',
    })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
