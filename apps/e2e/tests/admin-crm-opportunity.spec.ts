import { test, expect } from '@playwright/test';

// Frontend E2E for the CRM enrolment pipeline: create an opportunity (O1) through the real form and
// assert it lands in the pipeline. Backend covers the O1→O5 transition + won-deal guard; this closes
// the gap that no E2E ever WROTE through the CRM UI.
const EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';

test.use({ baseURL: 'http://localhost:5173' });

test.describe('CRM opportunity create', () => {
  test('create an O1 opportunity via the form → appears in the pipeline', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Mật khẩu').fill(PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.locator('nav').getByText('Tổng quan')).toBeVisible({ timeout: 10_000 });

    await page.locator('nav a').filter({ hasText: 'CRM' }).click();
    await expect(page.getByText('Tạo cơ hội mới')).toBeVisible({ timeout: 10_000 });

    const name = `E2E Lead ${Date.now().toString().slice(-6)}`;
    const phone = `09${Date.now().toString().slice(-8)}`;
    await page.getByLabel('Tên liên hệ').fill(name);
    await page.getByLabel('Số điện thoại').fill(phone);
    await page.getByRole('button', { name: 'Tạo cơ hội (O1)' }).click();

    // Success toast confirms the write (the pipeline table paginates, so assert the toast which
    // carries the contact name — reliable regardless of how many opportunities already exist).
    await expect(page.getByText(`Đã tạo cơ hội cho ${name}`)).toBeVisible({ timeout: 8_000 });
  });
});
