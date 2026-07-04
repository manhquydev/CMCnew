import { test, expect } from '@playwright/test';

// P0 revenue + provisioning path, end-to-end through the React frontend (previously only the backend
// integration tests exercised it): create a new-student receipt draft → approve it → the staff sees
// the auto-provisioned LMS credential, whose loginCode is facility-prefixed (tonight's H2 change).
const EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';
// A course that has a configured price at HQ (facility 1) in the dev seed.
const PRICED_COURSE = process.env.TEST_PRICED_COURSE ?? 'UCREA-CB';

test.use({ baseURL: 'http://localhost:5173' });

test('receipt approve provisions a student + shows facility-prefixed LMS login code', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  // super_admin's default landing module is "Quản trị" (Plan D: module rail, not leaf nav).
  await expect(page.locator('nav a').filter({ hasText: 'Quản trị' })).toBeVisible({ timeout: 10_000 });

  await page.locator('nav a').filter({ hasText: 'Tài chính' }).click();

  // Scope to the "Lập phiếu thu" card so the shared Cơ sở/Khóa học labels are unambiguous.
  const form = page.locator('.mantine-Card-root').filter({ hasText: 'Lập phiếu thu' });
  await form.getByRole('button', { name: 'Học sinh mới' }).click();

  // Cơ sở: pick HQ.
  await form.getByLabel('Cơ sở').click({ force: true });
  await page.getByRole('option', { name: /HQ/ }).first().click();

  // Khóa học: searchable Select — type the course code, pick it.
  await form.getByLabel('Khóa học').click({ force: true });
  await form.getByLabel('Khóa học').fill(PRICED_COURSE);
  await page.getByRole('option', { name: new RegExp(PRICED_COURSE) }).first().click();

  await form.getByLabel('SĐT phụ huynh').fill(`09${Date.now().toString().slice(-8)}`);
  await form.getByLabel('Tên học sinh').fill(`E2E HS ${Date.now().toString().slice(-6)}`);

  await form.getByRole('button', { name: 'Tạo phiếu nháp' }).click();
  await expect(page.getByText(/Tạo phiếu thu thành công/i)).toBeVisible({ timeout: 10_000 });

  // Approve the newest draft (first "Duyệt" button) → the LMS credential modal appears.
  await page.getByRole('button', { name: 'Duyệt' }).first().click();
  await expect(page.getByText('Tài khoản LMS học sinh')).toBeVisible({ timeout: 10_000 });
  // The login code is facility-prefixed (e.g. HQ-HS-2026-0042) — tonight's global-uniqueness change.
  await expect(page.getByTestId('lms-login-code')).toHaveText(/^HQ-HS-/);
});
