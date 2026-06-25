import { test, expect } from '@playwright/test';

// Teaching app uses the same LoginGate as admin; credentials are staff accounts.
const EMAIL = process.env.TEST_TEACHING_EMAIL ?? 'admin@cmc.local';
const PASSWORD = process.env.TEST_TEACHING_PASSWORD ?? 'changeme-dev';

test.use({ baseURL: 'http://localhost:5174' });

test.describe('teaching smoke', () => {
  test('login form is visible on first load', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Email')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Mật khẩu')).toBeVisible();
  });

  test('login → workbench renders', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Mật khẩu').fill(PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    // AppShell header shows the app title after login.
    await expect(page.getByText('CMC · Teaching / ERP')).toBeVisible({ timeout: 10_000 });

    // First tab in Workbench is "Lớp học".
    await expect(page.getByRole('tab', { name: 'Lớp học' })).toBeVisible({ timeout: 8_000 });
  });

  test('wrong password shows error', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Mật khẩu').fill('wrong-password-xyz');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page.getByText(/đăng nhập thất bại/i)).toBeVisible({ timeout: 8_000 });
  });
});
