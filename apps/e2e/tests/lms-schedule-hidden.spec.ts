import { test, expect, type Page } from '@playwright/test';
import { PrismaClient, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Phase 1 regression guard: "Lịch học & Nội dung" (schedule) must not appear in the
// LMS nav for students or parents, and typing #schedule directly must fall back to
// the default tab (HS -> exercises, PH -> overview) without a console error.
// Product decision (plan Session 2): hidden hard for both roles, no content
// preservation this round — CurriculumSessionsTab stays in the codebase, unreachable.
const LMS_URL = 'http://localhost:5175';
const LMS_PASSWORD = process.env.TEST_LMS_STUDENT_PASSWORD ?? 'ChangeMe!123';
const FACILITY = 1;
const SUPER = { facilityIds: [] as number[], isSuperAdmin: true };
const prisma = new PrismaClient();
type PrismaTx = Prisma.TransactionClient;

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 1000)}`;
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

function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

type Fixture = {
  studentId: string;
  studentCode: string;
  parentAccountId: string;
  parentEmail: string;
  parentName: string;
};

let fixture: Fixture;

test.beforeAll(async () => {
  const suffix = unique('SCHED');
  const studentCode = `${suffix}-HS`;
  const parentEmail = `${suffix.toLowerCase()}@cmc.local`;
  const parentName = `Parent ${suffix}`;

  fixture = await withRls(SUPER, async (tx) => {
    const student = await tx.student.create({
      data: {
        facilityId: FACILITY,
        studentCode,
        fullName: `E2E Schedule Student ${suffix}`,
        program: 'UCREA',
        level: 'L1',
      },
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
    return { studentId: student.id, studentCode, parentAccountId: parent.id, parentEmail, parentName };
  });
});

test.afterAll(async () => {
  if (fixture) {
    await withRls(SUPER, async (tx) => {
      await tx.guardian.deleteMany({ where: { parentAccountId: fixture.parentAccountId } });
      await tx.studentAccount.deleteMany({ where: { studentId: fixture.studentId } });
      await tx.parentAccount.deleteMany({ where: { id: fixture.parentAccountId } });
      await tx.student.deleteMany({ where: { id: fixture.studentId } });
    });
  }
  await prisma.$disconnect();
});

// Pre-existing Mantine dev-mode noise from navlinkStyles()'s data-attribute selectors
// (present on every NavLink, unrelated to this feature) — not a regression to guard.
const KNOWN_NOISE = /Unsupported style property/;

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !KNOWN_NOISE.test(msg.text())) errors.push(msg.text());
  });
  return errors;
}

async function loginStudent(page: Page) {
  await page.goto(`${LMS_URL}/`);
  await page.getByText('Học sinh', { exact: true }).click();
  await page.getByRole('button', { name: 'Đăng nhập bằng mã học sinh (dự phòng)' }).click();
  await page.getByLabel('Mã học sinh').fill(fixture.studentCode);
  await page.getByLabel('Mật khẩu').fill(LMS_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 15_000 });
}

async function loginParent(page: Page) {
  await page.goto(`${LMS_URL}/`);
  await page.getByText('Phụ huynh', { exact: true }).click();
  await page.getByLabel('Email phụ huynh').fill(fixture.parentEmail);
  await page.getByRole('button', { name: 'Gửi mã đăng nhập' }).click();
  await expect(page.getByText(/Mã đã gửi đến/i)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.getByText(`Phụ huynh ${fixture.parentName}`)).toBeVisible({ timeout: 10_000 });
}

test.describe('LMS schedule tab hidden (HS + PH)', () => {
  test('student: no schedule nav item; #schedule falls back to exercises, no console error', async ({ page }) => {
    const errors = trackConsoleErrors(page);

    await loginStudent(page);
    await expect(page.getByText('Lịch học & Nội dung', { exact: true })).toHaveCount(0);

    await page.evaluate(() => {
      window.location.hash = 'schedule';
    });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Lịch học & Nội dung', { exact: true })).toHaveCount(0);
    // Default fallback for HS is 'exercises'.
    await expect(page.getByText('Bài tập', { exact: true }).first()).toBeVisible();

    expect(errors, `console/page errors: ${errors.join('; ')}`).toEqual([]);
  });

  test('parent: no schedule nav item; #schedule falls back to overview, no console error', async ({ page }) => {
    const errors = trackConsoleErrors(page);

    await loginParent(page);
    await expect(page.getByText('Lịch học & Nội dung', { exact: true })).toHaveCount(0);

    await page.evaluate(() => {
      window.location.hash = 'schedule';
    });
    await page.reload();
    await expect(page.getByText(`Phụ huynh ${fixture.parentName}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Lịch học & Nội dung', { exact: true })).toHaveCount(0);
    // Default fallback for PH is 'overview'.
    await expect(page.getByText('Tổng quan', { exact: true }).first()).toBeVisible();

    expect(errors, `console/page errors: ${errors.join('; ')}`).toEqual([]);
  });
});
