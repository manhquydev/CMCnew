import { test, expect, type Page } from '@playwright/test';
import { PrismaClient, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';
const LMS_PASSWORD = process.env.TEST_LMS_STUDENT_PASSWORD ?? 'ChangeMe!123';
const FACILITY = 1;
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const prisma = new PrismaClient();
const SUPER = { facilityIds: [] as number[], isSuperAdmin: true };
type PrismaTx = Prisma.TransactionClient;

type Fixture = {
  courseId: string;
  batchId: string;
  batchCode: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  parentAccountId: string;
  parentEmail: string;
  parentName: string;
  sessionId: string;
  summary: string;
  teacherNote: string;
};

let fixture: Fixture;

function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

function withRls<T>(
  ctx: { facilityIds: number[]; isSuperAdmin: boolean },
  fn: (tx: PrismaTx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      "SELECT set_config('app.facility_ids', $1, true), set_config('app.is_super_admin', $2, true), set_config('app.principal_kind', $3, true), set_config('app.student_ids', $4, true), set_config('app.account_id', $5, true)",
      ctx.facilityIds.join(','),
      ctx.isSuperAdmin ? 'true' : 'false',
      'staff',
      '',
      '',
    );
    return fn(tx);
  });
}

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 1000)}`;
}

function todayLocalDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  const parentEmail = `${suffix.toLowerCase()}@cmc.local`;
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
        email: parentEmail,
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
        sessionDate: new Date(`${todayLocalDateKey()}T00:00:00.000Z`),
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
      parentEmail,
      parentName,
      sessionId: session.id,
      summary,
      teacherNote,
    };
  });
});

test.afterAll(async () => {
  if (fixture) {
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
  }
  await prisma.$disconnect();
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
  await studentPage.getByRole('button', { name: 'Đăng nhập bằng mã học sinh (dự phòng)' }).click();
  await studentPage.getByLabel('Mã học sinh').fill(fixture.studentCode);
  await studentPage.getByLabel('Mật khẩu').fill(LMS_PASSWORD);
  await studentPage.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(studentPage.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10_000 });
  await studentPage.getByText('Buổi học').click();
  await expect(studentPage.getByText(fixture.summary)).toBeVisible({ timeout: 10_000 });
  await expect(studentPage.getByText(fixture.teacherNote)).toBeVisible();
  await studentPage.close();

  const parentContext = await browser.newContext();
  const parentPage = await parentContext.newPage();
  await parentPage.goto('http://localhost:5175/#sessions');
  await parentPage.getByText('Phụ huynh', { exact: true }).click();
  await parentPage.getByLabel('Email phụ huynh').fill(fixture.parentEmail);
  await parentPage.getByRole('button', { name: 'Gửi mã đăng nhập' }).click();
  await expect(parentPage.getByText(/Mã đã gửi đến/i)).toBeVisible({ timeout: 10_000 });
  await parentPage.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(parentPage.getByText(`Phụ huynh ${fixture.parentName}`)).toBeVisible({ timeout: 10_000 });
  await expect(parentPage.getByText(fixture.summary)).toBeVisible({ timeout: 10_000 });
  await expect(parentPage.getByText(fixture.teacherNote)).toBeVisible();
  await parentContext.close();
});
