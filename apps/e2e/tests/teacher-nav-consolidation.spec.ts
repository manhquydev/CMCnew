import { test, expect } from '@playwright/test';

// Verifies the teacher nav consolidation (Lịch 360): a giao_vien-only account sees 3
// aggregate nav sections (Lịch dạy, Quản lý học sinh, Lương & chấm công) instead of the
// 9 original standalone items, and each tab inside the aggregate screens still respects
// its own underlying permission.

const EMAIL = process.env.TEST_TEACHER_EMAIL ?? 'giaovien@cmc.local';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';

test.use({ baseURL: 'http://localhost:5173' });

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.locator('nav').getByText('Lịch dạy')).toBeVisible({ timeout: 10_000 });
}

test.describe('teacher nav consolidation', () => {
  test('giao_vien sees the 3 consolidated sections, not the 9 originals', async ({ page }) => {
    await login(page);
    const navLink = (label: string) => page.locator('nav a').filter({ hasText: label });

    await expect(navLink('Lịch dạy')).toBeVisible();
    await expect(navLink('Quản lý học sinh')).toBeVisible();
    await expect(navLink('Lương & chấm công')).toBeVisible();

    for (const hidden of ['Điểm danh', 'Chấm bài', 'Học bạ', 'Lớp học', 'Khóa học', 'Họp PH', 'Phiếu lương của tôi', 'Chấm công']) {
      await expect(navLink(hidden)).toHaveCount(0);
    }
  });

  test('Quản lý học sinh shows Lớp học/Khóa học/Học bạ as tabs', async ({ page }) => {
    await login(page);
    await page.locator('nav a').filter({ hasText: 'Quản lý học sinh' }).click();

    await expect(page.getByRole('tab', { name: 'Lớp học' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: 'Khóa học' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Học bạ' })).toBeVisible();
  });

  test('Lương & chấm công shows Phiếu lương/Chấm công as tabs', async ({ page }) => {
    await login(page);
    await page.locator('nav a').filter({ hasText: 'Lương & chấm công' }).click();

    await expect(page.getByRole('tab', { name: 'Phiếu lương' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: 'Chấm công' })).toBeVisible();
  });
});
