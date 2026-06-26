import { test, expect } from '@playwright/test';

const EMAIL = process.env.TEST_TEACHING_EMAIL ?? 'admin@cmc.local';
const PASSWORD = process.env.TEST_TEACHING_PASSWORD ?? 'ChangeMe!123';

test.use({ baseURL: 'http://localhost:5174' });

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  // Wait until sidebar is ready
  await expect(page.locator('nav').getByText('Lịch dạy')).toBeVisible({ timeout: 10_000 });
}

test.describe('teaching navigation', () => {
  test('all nav group labels are visible in sidebar after login', async ({ page }) => {
    await login(page);

    const nav = page.locator('nav');
    await expect(nav.getByText('GIẢNG DẠY')).toBeVisible();
    await expect(nav.getByText('QUẢN LÝ LỚP')).toBeVisible();
    await expect(nav.getByText('GIAO TIẾP')).toBeVisible();
    await expect(nav.getByText('KINH DOANH')).toBeVisible();
  });

  test('clicking Chấm bài NavLink updates header section title', async ({ page }) => {
    await login(page);

    await page.locator('nav').getByText('Chấm bài').click();

    // Shell header shows SECTION_LABEL[activeSection] — "Chấm bài"
    await expect(page.getByRole('banner').getByText('Chấm bài')).toBeVisible({ timeout: 8_000 });
  });

  test('bell notification button is visible in header after login', async ({ page }) => {
    await login(page);

    await expect(page.getByRole('banner').getByRole('button', { name: 'Thông báo' })).toBeVisible();
  });
});
