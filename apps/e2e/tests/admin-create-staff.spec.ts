import { test, expect } from '@playwright/test';

// E2E for the SSO-only staff onboarding form (tonight's change). The key regression guard is that the
// "Tạo người dùng" form has NO password field — staff authenticate via Microsoft SSO, and the backend
// auto-generates an unusable random hash. We then create a staff member end-to-end and assert the
// success toast + a new roster row.
const EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';

test.use({ baseURL: 'http://localhost:5173' });

async function loginAsSuperAdmin(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.locator('nav').getByText('Tổng quan')).toBeVisible({ timeout: 10_000 });
}

test.describe('create staff (SSO-only form)', () => {
  test('create-user form has NO password field and creates a staff member', async ({ page }) => {
    await loginAsSuperAdmin(page);

    // Open the org section + the create modal.
    await page.locator('nav').getByText('Cơ sở & Users').click();
    await page.getByRole('button', { name: 'Tạo người dùng' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Tạo người dùng')).toBeVisible();

    // ── Regression guard for the SSO-only change: there must be NO password field. ──
    await expect(dialog.getByLabel('Mật khẩu')).toHaveCount(0);
    await expect(dialog.getByText('Nhân sự đăng nhập bằng tài khoản CMC EDU')).toBeVisible();

    // Fill identity.
    const email = `e2e.staff.${Date.now().toString().slice(-8)}@cmc.test`;
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Tên hiển thị').fill('E2E Staff');

    // Vai trò (MultiSelect): open + pick 'sale'. force:true — the Mantine pills wrapper intercepts
    // the click meant for the inner search input. Options render in a portal (page-level), not the dialog.
    await dialog.getByLabel('Vai trò', { exact: true }).click({ force: true });
    await page.getByRole('option', { name: 'sale', exact: true }).click();
    await page.keyboard.press('Escape'); // close the still-open role dropdown

    // Facility is optional for super_admin (backend allows an empty facility set), so we skip the
    // second MultiSelect here and submit. primaryRole auto-defaults to the first selected role.
    await dialog.getByRole('button', { name: 'Tạo', exact: true }).click();

    // Success toast + the new user appears in the roster.
    await expect(page.getByText(/Đã tạo người dùng/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(email)).toBeVisible({ timeout: 8_000 });
  });
});
