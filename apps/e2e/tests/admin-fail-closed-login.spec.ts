import { test, expect } from '@playwright/test';

// Guards tonight's H1 change: staff login is FAIL-CLOSED. Only super_admin may use the password form
// (break-glass); every other role is SSO-only. A seeded non-super-admin (sale@cmc.local) with the
// CORRECT password must be refused with the "đăng nhập bằng CMC EDU" message and must NOT reach the app.
const STAFF_EMAIL = process.env.TEST_STAFF_EMAIL ?? 'sale@cmc.local';
const SEED_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';

test.use({ baseURL: 'http://localhost:5173' });

test.describe('staff password login is fail-closed', () => {
  test('a non-super-admin with the correct password is refused (SSO-only)', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill(STAFF_EMAIL);
    await page.getByLabel('Mật khẩu').fill(SEED_PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();

    // The fail-closed gate returns the SSO-only message; the app shell must never render.
    await expect(page.getByText(/CMC EDU/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('nav').getByText('Tổng quan')).toHaveCount(0);
  });

  test('the SSO sign-in option is offered on the login screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /CMC EDU/i })).toBeVisible({ timeout: 10_000 });
  });
});
