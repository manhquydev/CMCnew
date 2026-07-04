import { test, expect } from '@playwright/test';

const EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';

test.use({ baseURL: 'http://localhost:5173' });

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  // super_admin's default landing module is "Quản trị" (Plan D: module rail, not leaf nav).
  await expect(page.locator('nav a').filter({ hasText: 'Quản trị' })).toBeVisible({ timeout: 10_000 });
}

test.describe('admin HR panel', () => {
  test('Nhân sự & Lương sub-tab is reachable via the Nhân sự module', async ({ page }) => {
    await login(page);

    await page.locator('nav a').filter({ hasText: 'Nhân sự' }).click();
    await expect(page.getByRole('tab', { name: 'Nhân sự & Lương' })).toBeVisible();
  });

  test('clicking Nhân sự & Lương sub-tab renders the staff roster table', async ({ page }) => {
    await login(page);

    await page.locator('nav a').filter({ hasText: 'Nhân sự' }).click();
    await page.getByRole('tab', { name: 'Nhân sự & Lương' }).click();

    // PayrollPanel renders a staff roster table inside the main content area.
    await expect(page.getByRole('main').locator('table').first()).toBeVisible({ timeout: 10_000 });
  });

  test('bell notification button is visible in admin header after login', async ({ page }) => {
    await login(page);

    await expect(page.getByRole('banner').getByRole('button', { name: 'Thông báo' })).toBeVisible();
  });
});
