import { test, expect, type Page } from '@playwright/test';
import { mintParentSession } from '@cmc/auth';
import { hashPassword, withRls } from '@cmc/db';

// P6 UI wiring: parentMeeting.setSchedule confirms a TBD meeting time. Verifies staff can set it
// from the admin Meetings panel and that the parent LMS myMeetings view reflects the confirmed time.
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';
const LMS_PASSWORD = process.env.TEST_LMS_PARENT_PASSWORD ?? 'ChangeMe!123';
const FACILITY = 1;
const SUPER = { facilityIds: [] as number[], isSuperAdmin: true };

test.use({ baseURL: 'http://localhost:5173' });

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`;
}

type Fixture = {
  courseId: string;
  batchId: string;
  studentId: string;
  parentAccountId: string;
  meetingId: string;
  meetingTitle: string;
};

let fixture: Fixture;

test.beforeAll(async () => {
  const suffix = unique('E2EMS');
  const meetingTitle = `E2E Meeting ${suffix}`;

  fixture = await withRls(SUPER, async (tx) => {
    const course = await tx.course.create({
      data: { code: `${suffix}-C`, name: `Meeting SetSchedule E2E ${suffix}`, program: 'UCREA' },
    });
    const batch = await tx.classBatch.create({
      data: { facilityId: FACILITY, courseId: course.id, code: `${suffix}-B`, name: `Meeting SetSchedule E2E ${suffix}`, status: 'running' },
    });
    const student = await tx.student.create({
      data: { facilityId: FACILITY, studentCode: `${suffix}-HS`, fullName: `E2E Student ${suffix}`, program: 'UCREA', level: 'L1' },
    });
    const parent = await tx.parentAccount.create({
      data: {
        email: `${suffix.toLowerCase()}@cmc.local`,
        displayName: `Parent ${suffix}`,
        passwordHash: await hashPassword(LMS_PASSWORD),
        isActive: true,
      },
    });
    await tx.guardian.create({
      data: { facilityId: FACILITY, parentAccountId: parent.id, studentId: student.id, relation: 'guardian' },
    });
    await tx.enrollment.create({
      data: { facilityId: FACILITY, classBatchId: batch.id, studentId: student.id, status: 'active' },
    });
    const meeting = await tx.parentMeeting.create({
      data: {
        facilityId: FACILITY,
        classBatchId: batch.id,
        title: meetingTitle,
        scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: 'scheduled',
        timeConfirmed: false,
      },
    });
    return {
      courseId: course.id,
      batchId: batch.id,
      studentId: student.id,
      parentAccountId: parent.id,
      meetingId: meeting.id,
      meetingTitle,
    };
  });
});

test.afterAll(async () => {
  if (!fixture) return;
  await withRls(SUPER, async (tx) => {
    await tx.parentMeeting.deleteMany({ where: { id: fixture.meetingId } });
    await tx.enrollment.deleteMany({ where: { classBatchId: fixture.batchId } });
    await tx.guardian.deleteMany({ where: { parentAccountId: fixture.parentAccountId } });
    await tx.parentAccount.deleteMany({ where: { id: fixture.parentAccountId } });
    await tx.student.deleteMany({ where: { id: fixture.studentId } });
    await tx.classBatch.deleteMany({ where: { id: fixture.batchId } });
    await tx.course.deleteMany({ where: { id: fixture.courseId } });
  });
});

async function loginAdmin(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Mật khẩu').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  // super_admin's default landing module is "Quản trị" (Plan D: module rail, not leaf nav).
  await expect(page.locator('nav a').filter({ hasText: 'Quản trị' })).toBeVisible({ timeout: 10_000 });
}

test('staff confirms meeting time via setSchedule → parent LMS myMeetings shows confirmed time', async ({ page, browser }) => {
  await loginAdmin(page);
  await page.locator('nav a').filter({ hasText: 'Lớp học' }).click();
  await page.getByRole('tab', { name: 'Họp PH' }).click();

  const meetingRow = page.getByRole('row', { name: new RegExp(fixture.meetingTitle) });
  await expect(meetingRow).toBeVisible({ timeout: 10_000 });
  await expect(meetingRow.getByText('Chưa chốt')).toBeVisible();

  await meetingRow.getByRole('button', { name: 'Chốt giờ' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(new RegExp(`Chốt giờ họp — ${fixture.meetingTitle}`))).toBeVisible({ timeout: 8_000 });
  await dialog.getByLabel('Giờ (HH:mm)').fill('14:30');
  await dialog.getByRole('button', { name: 'Chốt giờ', exact: true }).click();

  await expect(page.getByText('Đã chốt giờ họp phụ huynh')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('row', { name: new RegExp(fixture.meetingTitle) }).getByText('Chưa chốt')).not.toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(fixture.meetingTitle) })).toContainText('14:30');

  const parentAuth = await mintParentSession(fixture.parentAccountId);
  expect(parentAuth).toBeTruthy();
  const parentContext = await browser.newContext({ baseURL: 'http://localhost:5175' });
  await parentContext.addCookies([{
    name: 'cmc.lms',
    value: parentAuth!.token,
    domain: 'localhost',
    path: '/',
    sameSite: 'Lax',
    httpOnly: true,
    secure: false,
  }]);
  const parentPage = await parentContext.newPage();
  await parentPage.goto('http://localhost:5175/#sessions');
  await expect(parentPage.getByText(fixture.meetingTitle)).toBeVisible({ timeout: 10_000 });
  await expect(parentPage.getByText('(chưa chốt giờ)')).not.toBeVisible();
  await expect(parentPage.getByText('14:30')).toBeVisible();
  await parentContext.close();
});
