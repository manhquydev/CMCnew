import { test, expect } from '@playwright/test';

// LMS has two login modes: parent (email/phone) and student (login code).
// Default test account is a parent; set TEST_LMS_MODE=student to switch.
const MODE = (process.env.TEST_LMS_MODE ?? 'parent') as 'parent' | 'student';
const ID_FIELD = process.env.TEST_LMS_ID ?? 'ph@cmc.local';
const PASSWORD = process.env.TEST_LMS_PASSWORD ?? 'Parent!123';

// Label of the id field changes per mode:
//   parent  → "Email hoặc số điện thoại"
//   student → "Mã đăng nhập"
const ID_LABEL = MODE === 'parent' ? 'Email hoặc số điện thoại' : 'Mã đăng nhập';
// SegmentedControl option label:
const MODE_LABEL = MODE === 'parent' ? 'Phụ huynh' : 'Học sinh';

test.use({ baseURL: 'http://localhost:5175' });

test.describe('lms smoke', () => {
  test('login gate is visible on first load', async ({ page }) => {
    await page.goto('/');
    // LmsLoginGate renders the SegmentedControl before the form fields.
    await expect(page.getByText('CMC · Học tập')).toBeVisible({ timeout: 10_000 });
    // Mantine SegmentedControl hides the radio <input>; assert the option labels instead.
    await expect(page.getByText('Phụ huynh', { exact: true })).toBeVisible();
    await expect(page.getByText('Học sinh', { exact: true })).toBeVisible();
  });

  test('login → app shell renders', async ({ page }) => {
    await page.goto('/');
    // Ensure the correct mode segment is selected.
    await page.getByText(MODE_LABEL, { exact: true }).click();
    await page.getByLabel(ID_LABEL).fill(ID_FIELD);
    await page.getByLabel('Mật khẩu').fill(PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    // After login, AppShell header appears with the LMS title.
    await expect(page.getByText('CMC · Học tập')).toBeVisible({ timeout: 10_000 });
    // The login form should be gone (no more submit button).
    await expect(page.getByRole('button', { name: 'Đăng nhập' })).not.toBeVisible();
    // Logout button visible in header.
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 8_000 });
  });

  test('wrong password shows error', async ({ page }) => {
    await page.goto('/');
    await page.getByText(MODE_LABEL, { exact: true }).click();
    await page.getByLabel(ID_LABEL).fill(ID_FIELD);
    await page.getByLabel('Mật khẩu').fill('wrong-password-xyz');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page.getByText(/đăng nhập thất bại/i)).toBeVisible({ timeout: 8_000 });
  });
});
