import { test, expect } from '@playwright/test';
import { Role, mintStaffSession } from '@cmc/auth';
import { withRls } from '@cmc/db';

// Phase 4 M5 regression guard: checkInOut.monthlyReport is a SERVER-SIDE facility-scoped aggregate
// that must NOT reuse canViewStaffPunch (which only allows hr/self/direct-manager). A director who is
// NOT the employee's manager must still be able to load the report and drill into a staff member's
// day-by-day breakdown without FORBIDDEN. Mirrors the punch math already proven in
// attendance-payroll-deduction.int.test.ts (same shift/punch fixture → lateMinutes=15,
// earlyMinutes=20, penaltyAmount=27_500) but drives it through the real admin UI.
const FACILITY_ID = 1;
const PERIOD = '2099-03';
const SUPER = { facilityIds: [] as number[], isSuperAdmin: true };

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 1000)}`;
}

test.use({ baseURL: 'http://localhost:5173' });

type Fixture = {
  directorEmail: string;
  otherManagerId: string;
  employeeId: string;
  employeeName: string;
  templateId: string;
  registrationId: string;
  directorId: string;
};

let fixture: Fixture;

test.beforeAll(async () => {
  const suffix = unique('MRD');
  const directorEmail = `${suffix}-director@cmc.test`;
  const employeeName = `E2E MonthlyReport ${suffix}`;

  const setup = await withRls(SUPER, async (tx) => {
    // The director is deliberately NOT the employee's manager — proves the server-side aggregate
    // bypasses canViewStaffPunch instead of merely happening to pass a manager check.
    const director = await tx.appUser.create({
      data: {
        email: directorEmail,
        displayName: `E2E Director ${suffix}`,
        passwordHash: 'unused',
        primaryRole: Role.giam_doc_kinh_doanh,
        roles: [Role.giam_doc_kinh_doanh],
        isActive: true,
        facilities: { create: [{ facilityId: FACILITY_ID }] },
      },
    });
    const otherManager = await tx.appUser.create({
      data: {
        email: `${suffix}-manager@cmc.test`,
        displayName: `E2E Manager ${suffix}`,
        passwordHash: 'unused',
        primaryRole: Role.giam_doc_kinh_doanh,
        roles: [Role.giam_doc_kinh_doanh],
        isActive: true,
        facilities: { create: [{ facilityId: FACILITY_ID }] },
      },
    });
    const employee = await tx.appUser.create({
      data: {
        email: `${suffix}-employee@cmc.test`,
        displayName: employeeName,
        passwordHash: 'unused',
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
      data: { facilityId: FACILITY_ID, userId: otherManager.id, position: Role.giam_doc_kinh_doanh },
    });
    await tx.employmentProfile.create({
      data: { facilityId: FACILITY_ID, userId: employee.id, position: Role.sale, managerId: otherManager.id },
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
        code: unique('MRD_SHIFT'),
        name: 'MRD shift',
        startTime: '22:00',
        endTime: '23:00',
        hours: 8,
      },
    });
    const reg = await tx.shiftRegistration.create({
      data: {
        facilityId: FACILITY_ID,
        userId: employee.id,
        fromDate: new Date(`${PERIOD}-05`),
        toDate: new Date(`${PERIOD}-05`),
        status: 'approved',
        shiftGroupId: group.id,
        managerId: otherManager.id,
        approvedAt: new Date(),
        approvedById: otherManager.id,
        entries: {
          create: [{ date: new Date(`${PERIOD}-05`), shiftTemplateId: template.id, type: 'work', hours: 8 }],
        },
      },
    });
    // 22:15/22:40 ICT (UTC+7) against a 22:00-23:00 shift → 15min late + 20min early, same fixture
    // as attendance-payroll-deduction.int.test.ts.
    await tx.timePunch.createMany({
      data: [
        {
          facilityId: FACILITY_ID,
          userId: employee.id,
          timestamp: new Date(`${PERIOD}-05T15:15:00Z`),
          ipAddress: '198.51.100.20',
          method: 'ip',
          shiftTemplateId: template.id,
        },
        {
          facilityId: FACILITY_ID,
          userId: employee.id,
          timestamp: new Date(`${PERIOD}-05T15:40:00Z`),
          ipAddress: '198.51.100.20',
          method: 'ip',
          shiftTemplateId: template.id,
        },
      ],
    });
    return { director, otherManager, employee, template, reg };
  });

  fixture = {
    directorEmail,
    directorId: setup.director.id,
    otherManagerId: setup.otherManager.id,
    employeeId: setup.employee.id,
    employeeName,
    templateId: setup.template.id,
    registrationId: setup.reg.id,
  };
});

test.afterAll(async () => {
  await withRls(SUPER, async (tx) => {
    await tx.timePunch.deleteMany({ where: { userId: fixture.employeeId } });
    await tx.shiftRegistration.deleteMany({ where: { id: fixture.registrationId } });
    await tx.shiftTemplate.deleteMany({ where: { id: fixture.templateId } });
    await tx.employmentProfile.deleteMany({
      where: { userId: { in: [fixture.directorId, fixture.otherManagerId, fixture.employeeId] } },
    });
    await tx.appUser.deleteMany({
      where: { id: { in: [fixture.directorId, fixture.otherManagerId, fixture.employeeId] } },
    });
  });
});

test('non-manager director loads monthlyReport and drills into a staff day-breakdown without FORBIDDEN', async ({ browser }) => {
  const auth = await mintStaffSession(fixture.directorEmail);
  expect(auth).toBeTruthy();

  const context = await browser.newContext();
  await context.addCookies([{
    name: 'cmc.session',
    value: auth!.token,
    domain: 'localhost',
    path: '/',
    sameSite: 'Lax',
    httpOnly: true,
    secure: false,
  }]);
  const page = await context.newPage();
  // The 'payroll-checkin' nav link is only shown for teacher-only accounts, but the section route
  // itself is open to any authenticated session — directors reach it by URL (App.tsx `/:section`).
  await page.goto('http://localhost:5173/payroll-checkin');

  await page.getByRole('tab', { name: 'Báo cáo công' }).click();
  await page.getByLabel('Kỳ').fill(PERIOD);
  await page.getByRole('button', { name: 'Tải báo cáo' }).click();

  // No FORBIDDEN: the row for a staff member this director does NOT manage still loads.
  await expect(page.getByText('Không tải được báo cáo công tháng')).not.toBeVisible();
  const row = page.getByRole('row').filter({ hasText: fixture.employeeName });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row.getByText('15p')).toBeVisible();
  await expect(row.getByText('20p')).toBeVisible();
  await expect(row.getByText('27.500đ')).toBeVisible();

  // Drill-down comes from the SAME server-side aggregate (no per-user history/canViewStaffPunch call).
  await row.getByRole('button', { name: 'Xem' }).click();
  await expect(page.getByText(`${fixture.employeeName} — chi tiết ${PERIOD}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('MRD shift')).toBeVisible();

  await context.close();
});
