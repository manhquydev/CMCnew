import { test, expect } from '@playwright/test';

// Verifies the teacher nav consolidation (Lịch 360): a giao_vien-only account's module rail
// (Plan D: module + sub-tab IA) resolves to 5 modules with a reduced/consolidated set of
// screens per module, instead of the 9 original standalone leaf sections. "Lớp học" and
// "Nhân sự" each collapse to a single visible sub-tab (student-mgmt / payroll-checkin), so
// their SubTabBar is suppressed (design §5.4) — the rail shows the MODULE label, and clicking
// it lands directly on the sole consolidated aggregate screen (itself internally tabbed).

const EMAIL = process.env.TEST_TEACHER_EMAIL ?? 'giaovien@cmc.local';
const EDU_DIRECTOR_EMAIL = process.env.TEST_EDU_DIRECTOR_EMAIL ?? 'giamdocdt@cmc.local';
const BIZ_DIRECTOR_EMAIL = process.env.TEST_BIZ_DIRECTOR_EMAIL ?? 'giamdockd@cmc.local';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';

test.use({ baseURL: 'http://localhost:5173' });

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  // giao_vien-only's default landing module is "Giảng dạy" (section 'schedule').
  await expect(page.locator('nav a').filter({ hasText: 'Giảng dạy' })).toBeVisible({ timeout: 10_000 });
}

async function loginTeacherSurface(page: import('@playwright/test').Page, email: string) {
  await page.goto('/?surface=teacher');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.locator('header').getByText(/Teacher Lite/)).toBeVisible({ timeout: 10_000 });
}

function exactNav(page: import('@playwright/test').Page, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.locator('nav a').filter({ hasText: new RegExp(`^${escaped}$`) });
}

test.describe('teacher nav consolidation', () => {
  test('giao_vien sees exactly the 5 modules with >=1 visible sub-tab, not the business/admin-only modules', async ({ page }) => {
    await login(page);
    // Anchored exact-text match — plain `hasText` substring matching would false-match e.g.
    // "CRM" against "CRM & Kinh doanh".
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const navLink = (label: string) => page.locator('nav a').filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`) });

    await expect(navLink('Giảng dạy')).toBeVisible();
    await expect(navLink('Lớp học')).toBeVisible();
    await expect(navLink('CRM & Kinh doanh')).toBeVisible();
    await expect(navLink('Nhân sự')).toBeVisible();
    await expect(navLink('Công ca')).toBeVisible();

    // Modules with zero visible sub-tabs for a teacher-only account must not render at all.
    for (const hiddenModule of ['Học sinh', 'Tài chính', 'Quản trị']) {
      await expect(navLink(hiddenModule)).toHaveCount(0);
    }
  });

  test('Lớp học (single sub-tab, bar suppressed) shows the consolidated Quản lý học sinh screen with Lớp học/Khóa học/Học bạ as tabs', async ({ page }) => {
    await login(page);
    await page.locator('nav a').filter({ hasText: 'Lớp học' }).click();

    await expect(page.getByRole('tab', { name: 'Lớp học' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: 'Khóa học' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Học bạ' })).toBeVisible();
  });

  test('Nhân sự (single sub-tab, bar suppressed) shows the consolidated Chấm công & lương screen with Phiếu lương/Chấm công as tabs', async ({ page }) => {
    await login(page);
    await page.locator('nav a').filter({ hasText: 'Nhân sự' }).click();

    await expect(page.getByRole('tab', { name: 'Phiếu lương' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: 'Chấm công' })).toBeVisible();
  });
});

test.describe('teacher.cmcvn surface scope', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test('giao_vien sees only teaching/LMS operations, not ERP finance or work-shift groups', async ({ page }) => {
    await loginTeacherSurface(page, EMAIL);

    await expect(exactNav(page, 'Lịch & buổi học')).toBeVisible();
    await expect(exactNav(page, 'Lớp & bài tập')).toBeVisible();

    for (const hiddenModule of ['Tài chính', 'CRM & Kinh doanh', 'Nhân sự', 'Công ca', 'Tiếp nhận học viên']) {
      await expect(exactNav(page, hiddenModule)).toHaveCount(0);
    }
    await expect(page.getByText('CMC Teacher Lite')).toBeVisible();
  });

  test('giam_doc_dao_tao sees training coordination and intake, not full finance', async ({ page }) => {
    await loginTeacherSurface(page, EDU_DIRECTOR_EMAIL);

    await expect(exactNav(page, 'Điều phối đào tạo')).toBeVisible();
    await expect(exactNav(page, 'Tiếp nhận học viên')).toBeVisible();
    await exactNav(page, 'Tiếp nhận học viên').click();
    await expect(page.getByText('Tạo học viên LMS', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Tiếp nhận học viên', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tạo học viên' })).toBeVisible();
    await expect(page.getByText('Lập phiếu thu', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Mã voucher', { exact: false })).toHaveCount(0);

    for (const hiddenModule of ['Tài chính', 'CRM & Kinh doanh', 'Nhân sự', 'Công ca']) {
      await expect(exactNav(page, hiddenModule)).toHaveCount(0);
    }
  });

  test('giam_doc_kinh_doanh lands on intake surface and direct /finance is rejected on teacher surface', async ({ page }) => {
    await page.goto('/finance?surface=teacher');
    await page.getByLabel('Email').fill(BIZ_DIRECTOR_EMAIL);
    await page.getByLabel('Mật khẩu').fill(PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();

    await expect(page.locator('header').getByText(/Teacher Lite/)).toBeVisible({ timeout: 10_000 });
    await expect(exactNav(page, 'Tiếp nhận học viên')).toBeVisible();
    await expect(page.getByText('Tạo học viên LMS', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Tài chính', { exact: true })).toHaveCount(0);
    await expect(exactNav(page, 'Tài chính')).toHaveCount(0);
  });
});
