import { test, expect, type Page } from '@playwright/test';
import { mintParentSession } from '@cmc/auth';
import { hashPassword, withRls } from '@cmc/db';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';
const LMS_PASSWORD = process.env.TEST_LMS_STUDENT_PASSWORD ?? 'ChangeMe!123';
const FACILITY = 1;
const SUPER = { facilityIds: [] as number[], isSuperAdmin: true };
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

type Fixture = {
  courseId: string;
  batchId: string;
  batchCode: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  parentAccountId: string;
  parentName: string;
  sessionId: string;
  summary: string;
  teacherNote: string;
};

let fixture: Fixture;

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 1000)}`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loginAdmin(page: Page) {
  await page.goto('http://localhost:5173/schedule');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Mật khẩu').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  // Navigating to /schedule lands on the "Giảng dạy" module (Plan D: module rail, not leaf nav).
  await expect(page.locator('nav a').filter({ hasText: 'Giảng dạy' })).toBeVisible({ timeout: 10_000 });
  await page.goto('http://localhost:5173/schedule');
}

async function chooseMantineSelect(page: Page, textbox: ReturnType<Page['locator']>, option: string) {
  await textbox.click();
  await page.getByRole('option', { name: option }).click();
}

test.beforeAll(async () => {
  const suffix = unique('SE');
  const studentCode = `${suffix}-HS`;
  const batchCode = `${suffix}-B`;
  const studentName = `E2E Session Evidence ${suffix}`;
  const parentName = `Parent ${suffix}`;
  const summary = `E2E publish summary ${suffix}`;
  const teacherNote = `E2E teacher note ${suffix}`;

  fixture = await withRls(SUPER, async (tx) => {
    const course = await tx.course.create({
      data: { code: `${suffix}-C`, name: `Session Evidence E2E ${suffix}`, program: 'UCREA' },
    });
    const batch = await tx.classBatch.create({
      data: { facilityId: FACILITY, courseId: course.id, code: batchCode, name: `Session Evidence E2E ${suffix}`, status: 'running' },
    });
    const student = await tx.student.create({
      data: { facilityId: FACILITY, studentCode, fullName: studentName, program: 'UCREA', level: 'L1' },
    });
    await tx.studentAccount.create({
      data: {
        studentId: student.id,
        loginCode: studentCode,
        passwordHash: await hashPassword(LMS_PASSWORD),
        isActive: true,
      },
    });
    const parent = await tx.parentAccount.create({
      data: {
        email: `${suffix.toLowerCase()}@cmc.local`,
        displayName: parentName,
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
    const session = await tx.classSession.create({
      data: {
        facilityId: FACILITY,
        classBatchId: batch.id,
        sessionDate: new Date(`${todayKey()}T00:00:00.000Z`),
        startTime: '00:00',
        endTime: '00:01',
        status: 'confirmed',
      },
    });
    return {
      courseId: course.id,
      batchId: batch.id,
      batchCode,
      studentId: student.id,
      studentCode,
      studentName,
      parentAccountId: parent.id,
      parentName,
      sessionId: session.id,
      summary,
      teacherNote,
    };
  });
});

test.afterAll(async () => {
  if (!fixture) return;
  await withRls(SUPER, async (tx) => {
    const evidence = await tx.sessionEvidence.findUnique({
      where: { classSessionId: fixture.sessionId },
      select: { id: true },
    });
    const evidenceIds = evidence ? [evidence.id] : [];
    await tx.recordEvent.deleteMany({ where: { entityType: 'session_evidence', entityId: { in: evidenceIds } } });
    await tx.sessionStudentComment.deleteMany({ where: { sessionEvidenceId: { in: evidenceIds } } });
    await tx.sessionEvidencePhoto.deleteMany({ where: { sessionEvidenceId: { in: evidenceIds } } });
    await tx.sessionEvidence.deleteMany({ where: { id: { in: evidenceIds } } });
    await tx.classSession.deleteMany({ where: { id: fixture.sessionId } });
    await tx.enrollment.deleteMany({ where: { classBatchId: fixture.batchId } });
    await tx.guardian.deleteMany({ where: { parentAccountId: fixture.parentAccountId } });
    await tx.studentAccount.deleteMany({ where: { studentId: fixture.studentId } });
    await tx.parentAccount.deleteMany({ where: { id: fixture.parentAccountId } });
    await tx.student.deleteMany({ where: { id: fixture.studentId } });
    await tx.classBatch.deleteMany({ where: { id: fixture.batchId } });
    await tx.course.deleteMany({ where: { id: fixture.courseId } });
  });
});

test('admin publishes session photos/comments and LMS displays them for student and parent', async ({ browser }) => {
  const adminPage = await browser.newPage();
  await loginAdmin(adminPage);

  await expect(adminPage.getByText(fixture.batchCode)).toBeVisible({ timeout: 10_000 });
  await adminPage.getByTestId(`schedule-session-${fixture.sessionId}`).click();

  await expect(adminPage.getByText('Ảnh và nhận xét LMS')).toBeVisible({ timeout: 10_000 });
  await adminPage.getByLabel('Tóm tắt gửi LMS').fill(fixture.summary);
  await adminPage.locator('input[type="file"]').setInputFiles({
    name: 'session-evidence.png',
    mimeType: 'image/png',
    buffer: PNG_BYTES,
  });

  const commentRow = adminPage.getByTestId(`session-comment-row-${fixture.studentCode}`);
  await chooseMantineSelect(adminPage, commentRow.getByRole('textbox').nth(0), 'Tích cực');
  await chooseMantineSelect(adminPage, commentRow.getByRole('textbox').nth(1), 'Tư duy logic');
  await chooseMantineSelect(adminPage, commentRow.getByRole('textbox').nth(2), 'Luyện trình bày');
  await commentRow.getByRole('textbox').nth(3).fill(fixture.teacherNote);

  await adminPage.getByRole('button', { name: 'Publish LMS' }).click();
  await expect(adminPage.getByText('Đã publish ảnh và nhận xét lên LMS')).toBeVisible({ timeout: 15_000 });
  await expect(adminPage.getByText('Đã publish', { exact: true })).toBeVisible();
  await adminPage.close();

  const studentPage = await browser.newPage();
  await studentPage.goto('http://localhost:5175/');
  await studentPage.getByText('Học sinh', { exact: true }).click();
  await studentPage.getByLabel('Mã đăng nhập').fill(fixture.studentCode);
  await studentPage.getByLabel('Mật khẩu').fill(LMS_PASSWORD);
  await studentPage.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(studentPage.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10_000 });
  await studentPage.getByText('Buổi học').click();
  await expect(studentPage.getByText(fixture.summary)).toBeVisible({ timeout: 10_000 });
  await expect(studentPage.getByText(fixture.teacherNote)).toBeVisible();
  await studentPage.close();

  const parentAuth = await mintParentSession(fixture.parentAccountId);
  expect(parentAuth).toBeTruthy();
  const parentContext = await browser.newContext();
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
  await expect(parentPage.getByText(`Phụ huynh ${fixture.parentName}`)).toBeVisible({ timeout: 10_000 });
  await expect(parentPage.getByText(fixture.summary)).toBeVisible({ timeout: 10_000 });
  await expect(parentPage.getByText(fixture.teacherNote)).toBeVisible();
  await parentContext.close();
});
