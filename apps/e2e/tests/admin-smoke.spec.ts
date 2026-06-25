import { test, expect } from '@playwright/test';

// Credentials come from environment; fall back to dev seed defaults.
const EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'changeme-dev';

test.use({ baseURL: 'http://localhost:5173' });

test.describe('admin smoke', () => {
  test('login form is visible on first load', async ({ page }) => {
    await page.goto('/');
    // LoginGate renders while session check is in-flight; wait for form to settle.
    await expect(page.getByLabel('Email')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Mật khẩu')).toBeVisible();
  });

  test('login → dashboard renders', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Mật khẩu').fill(PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    // After successful login the AppShell header appears with the app title.
    await expect(page.getByText('CMC · Admin')).toBeVisible({ timeout: 10_000 });

    // At least one Tabs.Tab should be visible (Tổng quan is the first tab).
    await expect(page.getByRole('tab', { name: 'Tổng quan' })).toBeVisible({ timeout: 8_000 });
  });

  test('wrong password shows error', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Mật khẩu').fill('wrong-password-xyz');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page.getByText(/đăng nhập thất bại/i)).toBeVisible({ timeout: 8_000 });
  });
});
