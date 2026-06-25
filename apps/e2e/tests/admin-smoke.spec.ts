import { test, expect } from '@playwright/test';

// Credentials come from environment; fall back to dev seed defaults.
const EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';

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

    // After successful login the sidebar nav appears (AppShell layout).
    // "Tổng quan" is the first nav item in the sidebar.
    await expect(page.locator('nav').getByText('Tổng quan')).toBeVisible({ timeout: 10_000 });
  });

  test('wrong password shows error', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Mật khẩu').fill('wrong-password-xyz');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page.getByText(/đăng nhập thất bại/i)).toBeVisible({ timeout: 8_000 });
  });

  // Exercises the operational create-course flow end-to-end: form validation (F2)
  // blocks an empty submit, and a success toast (F1) confirms the write.
  test('create course: validation blocks empty, then succeeds with toast', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Mật khẩu').fill(PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.locator('nav').getByText('Tổng quan')).toBeVisible({ timeout: 10_000 });

    // Navigate to Khóa học via sidebar nav (NavLink renders as a button in the nav).
    await page.locator('nav').getByText('Khóa học').click();
    // Button uses an SVG icon (not text "+") so exact name is "Tạo khóa".
    await page.getByRole('button', { name: 'Tạo khóa' }).click();

    // Scope to the modal so the submit "Tạo" isn't confused with "+ Tạo khóa".
    const dialog = page.getByRole('dialog');
    const submit = dialog.getByRole('button', { name: 'Tạo', exact: true });

    // Empty submit → field-level validation error, no network write.
    await submit.click();
    await expect(dialog.getByText('Nhập mã khóa')).toBeVisible();

    // Fill required fields (program defaults to UCREA) and submit.
    const code = `E2E${Date.now().toString().slice(-6)}`;
    await dialog.getByLabel('Mã').fill(code);
    await dialog.getByLabel('Tên').fill(`E2E course ${code}`);
    await submit.click();

    // Success toast (F1) confirms the create succeeded.
    await expect(page.getByText(/Đã tạo khóa/i)).toBeVisible({ timeout: 8_000 });
  });
});
