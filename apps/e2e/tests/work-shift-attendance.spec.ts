import { test, expect } from '@playwright/test';

// NOTE: navigation through this test (module rail → sub-tab, Plan D's nav/IA restructure) is
// verified correct as far as the "Danh mục ca" step. The later CHECK-IN/CHECK-OUT assertion
// depends on IP/WiFi-allowlist state (FacilityNetwork) that this run's environment doesn't
// satisfy — a pre-existing environment/seed-data dependency, unrelated to the nav change.

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

test.describe('work shift and punch attendance surfaces', () => {
  test('admin can reach shift, punch, and WiFi configuration panels', async ({ page }) => {
    await login(page);
    // Module rail links (Plan D). Sub-tabs (Chấm công/Đăng ký ca under Công ca; IP WiFi chấm
    // công/Danh mục ca under Quản trị) live in the SubTabBar (AppShell.Main), not <nav> — click
    // the module first, then the sub-tab.
    const navLink = (label: string) => page.locator('nav a').filter({ hasText: new RegExp(`^${label}$`) });
    const subTab = (label: string) => page.getByRole('tab', { name: label });

    await expect(navLink('Công ca')).toBeVisible();
    await expect(navLink('Quản trị')).toBeVisible();

    await navLink('Quản trị').click();
    await expect(subTab('IP WiFi chấm công')).toBeVisible();
    await expect(subTab('Danh mục ca')).toBeVisible();

    await subTab('IP WiFi chấm công').click();
    const addWifiButton = page.getByRole('button', { name: 'Thêm IP WiFi công ty' });
    await expect(addWifiButton).toBeVisible({ timeout: 10_000 });
    await addWifiButton.click();
    await expect(page.getByLabel('Địa chỉ IP / CIDR')).toBeVisible();
    await page.keyboard.press('Escape');

    await subTab('Danh mục ca').click();
    const addGroupButton = page.getByRole('button', { name: 'Tạo nhóm ca' });
    await expect(addGroupButton).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Tạo mẫu ca' })).toBeVisible();
    await addGroupButton.click();
    await expect(page.getByRole('textbox', { name: 'Chế độ' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('main').getByText('Kinh doanh')).toBeVisible();
    await expect(page.getByRole('main').getByText('Giáo viên')).toBeVisible();

    await navLink('Công ca').click();
    await expect(subTab('Chấm công')).toBeVisible();
    await expect(subTab('Đăng ký ca')).toBeVisible();

    await subTab('Chấm công').click();
    await expect(page.getByRole('main').getByText(/WiFi công ty|Ngoài mạng công ty/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /CHECK-IN|CHECK-OUT/ })).toBeVisible();

    await subTab('Đăng ký ca').click();
    await expect(page.getByRole('main').getByText('Đăng ký công ca')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Tạo phiếu' })).toBeVisible();
  });
});
