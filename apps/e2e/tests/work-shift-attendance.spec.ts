import { test, expect } from '@playwright/test';

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

test.describe('work shift and punch attendance surfaces', () => {
  test('admin can reach shift, punch, and WiFi configuration panels', async ({ page }) => {
    await login(page);
    const navLink = (label: string) => page.locator('nav a').filter({ hasText: new RegExp(`^${label}$`) });

    await expect(navLink('Chấm công')).toBeVisible();
    await expect(navLink('Đăng ký ca')).toBeVisible();
    await expect(navLink('IP WiFi chấm công')).toBeVisible();
    await expect(navLink('Danh mục ca')).toBeVisible();

    await navLink('IP WiFi chấm công').click();
    await expect(page.getByRole('main').getByText('Thêm IP WiFi công ty')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Địa chỉ IP / CIDR')).toBeVisible();

    await navLink('Danh mục ca').click();
    await expect(page.getByRole('main').getByText('Thêm nhóm ca')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('main').getByText('Thêm mẫu ca')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Chế độ' })).toBeVisible();
    await expect(page.getByRole('main').getByText('Kinh doanh')).toBeVisible();
    await expect(page.getByRole('main').getByText('Giáo viên')).toBeVisible();

    await navLink('Chấm công').click();
    await expect(page.getByRole('main').getByText(/WiFi công ty|Ngoài mạng công ty/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /CHECK-IN|CHECK-OUT/ })).toBeVisible();

    await navLink('Đăng ký ca').click();
    await expect(page.getByRole('main').getByText('Đăng ký công ca')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Tạo phiếu' })).toBeVisible();
  });
});
