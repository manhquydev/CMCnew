import { test, expect } from '@playwright/test';

// LMS auth (post SSO/OTP redirection):
//   - Student: login code + password (unchanged) — used for the happy/error smoke.
//   - Parent:  passwordless Email OTP (two steps) — smoke covers step 1 (request code).
// Seed: student loginCode TEST-001, password = SEED_SUPERADMIN_PASSWORD (default ChangeMe!123).
const STUDENT_CODE = process.env.TEST_LMS_STUDENT_CODE ?? 'TEST-001';
const STUDENT_PASSWORD = process.env.TEST_LMS_STUDENT_PASSWORD ?? 'ChangeMe!123';
const PARENT_EMAIL = process.env.TEST_LMS_PARENT_EMAIL ?? 'otp-probe@cmc.local';

test.use({ baseURL: 'http://localhost:5175' });

test.describe('lms smoke', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test('login gate is visible on first load', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Học tập cùng CMC/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Phụ huynh', { exact: true })).toBeVisible();
    await expect(page.getByText('Học sinh', { exact: true })).toBeVisible();
  });

  test('student login (code + password) → app shell renders', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Học sinh', { exact: true }).click();
    await page.getByLabel('Mã đăng nhập').fill(STUDENT_CODE);
    await page.getByLabel('Mật khẩu').fill(STUDENT_PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    // After login the app shell renders with a logout control.
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 30_000 });
  });

  test('student wrong password shows error', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Học sinh', { exact: true }).click();
    await page.getByLabel('Mã đăng nhập').fill(STUDENT_CODE);
    await page.getByLabel('Mật khẩu').fill('wrong-password-xyz');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page.getByText(/đăng nhập thất bại/i)).toBeVisible({ timeout: 8_000 });
  });

  test('parent OTP request (step 1) advances to code entry', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Phụ huynh', { exact: true }).click();
    await page.getByLabel('Email phụ huynh').fill(PARENT_EMAIL);
    await page.getByRole('button', { name: 'Gửi mã đăng nhập' }).click();

    // Step 2 view: the code-entry field + "sent to" confirmation appear.
    await expect(page.getByText(/Mã đã gửi đến/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Mã đăng nhập')).toBeVisible();
  });
});
