import { test, expect } from '@playwright/test';

// Verifies the F0 Part B consolidation: the single admin app now hosts BOTH
// back-office modules (Tổng quan, Học sinh, Tài chính) AND the teaching-origin
// modules (Lịch dạy) under one role-filtered nav — and the F1 fix that a brand-new
// student can be onboarded through the receipt form (not a removed manual button).
// Nav items render as NavLink <a> elements; target them by link role to avoid
// matching the section-group <p> headers that share the same text.

const EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';

test.use({ baseURL: 'http://localhost:5173' });

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.locator('nav').getByText('Tổng quan')).toBeVisible({ timeout: 10_000 });
}

test.describe('unified staff shell (F0B + F1)', () => {
  test('one app surfaces both back-office and teaching modules in the nav', async ({ page }) => {
    await login(page);
    // Nav items are NavLink <a> elements; group headers are <p> with the same text,
    // so scope to <a> to target the link (Mantine prefixes an icon into the a11y name).
    const navLink = (label: string) => page.locator('nav a').filter({ hasText: label });
    // Back-office (admin-origin)
    await expect(navLink('Học sinh')).toBeVisible();
    await expect(navLink('Tài chính')).toBeVisible();
    // Teaching-origin (ported in F0B) — proof the two apps are unified
    await expect(navLink('Lịch dạy')).toBeVisible();
    await expect(navLink('CRM')).toBeVisible();
  });

  test('a brand-new student can be onboarded via the receipt form (F1 B1 fix)', async ({ page }) => {
    await login(page);
    // Go to Finance, where receipts are created.
    await page.locator('nav a').filter({ hasText: 'Tài chính' }).click();
    // The new-student branch must be reachable (the manual "Thêm học sinh" button was removed).
    await page.getByRole('button', { name: 'Học sinh mới' }).click();
    // New-student fields appear — onboarding is NOT a dead end.
    await expect(page.getByLabel('SĐT phụ huynh')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Tên học sinh')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tạo phiếu nháp' })).toBeVisible();
  });
});
