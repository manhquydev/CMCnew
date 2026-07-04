import { test, expect } from '@playwright/test';

// Verifies the F0 Part B consolidation: the single admin app now hosts BOTH
// back-office modules (Quản trị, Học sinh, Tài chính) AND the teaching-origin
// modules (Giảng dạy) under one role-filtered nav — and the F1 fix that a brand-new
// student can be onboarded through the receipt form (not a removed manual button).
//
// Nav items are module rail links (one per nav group, Plan D's module + sub-tab IA —
// see docs/journals/260704-1630-plan-d-nav-module-subtab-ia-completed.md). The rail shows
// MODULE labels (e.g. "Giảng dạy"), not individual screen labels (e.g. "Lịch dạy", now a
// sub-tab reached by clicking into the module) — target the rail by module label, scoped to
// <a> to avoid matching the sub-tab strip (which lives in AppShell.Main, not <nav>, and
// renders as Tabs.Tab, not <a>).

const EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';

test.use({ baseURL: 'http://localhost:5173' });

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  // super_admin's default landing module is "Quản trị" (section 'overview').
  await expect(page.locator('nav a').filter({ hasText: 'Quản trị' })).toBeVisible({ timeout: 10_000 });
}

test.describe('unified staff shell (F0B + F1)', () => {
  test('one app surfaces both back-office and teaching modules in the nav', async ({ page }) => {
    await login(page);
    // Nav items are module rail NavLink <a> elements (Plan D: one per nav group).
    const navLink = (label: string) => page.locator('nav a').filter({ hasText: label });
    // Back-office (admin-origin)
    await expect(navLink('Học sinh')).toBeVisible();
    await expect(navLink('Tài chính')).toBeVisible();
    // Teaching-origin (ported in F0B) — proof the two apps are unified
    await expect(navLink('Giảng dạy')).toBeVisible();
    await expect(navLink('CRM & Kinh doanh')).toBeVisible();
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
