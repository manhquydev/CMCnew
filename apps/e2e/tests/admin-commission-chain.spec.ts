import { test, expect } from '@playwright/test';

// P0 commission money-chain, end-to-end through the React frontend (decision 0024): sale creates a
// draft receipt FROM the opportunity record page (opportunityId attached), a director approves it,
// and the linked opportunity auto-advances O4→O5 with closedAt stamped. Previously only vitest
// integration tests (role-flows-commission-chain.int.test.ts) exercised this — this closes the E2E
// gap that no test ever WROTE the chain through the actual admin UI. super_admin bypasses all role
// checks (packages/auth/src/permissions.ts) so a single session can perform both the sale-side create
// and the director-side approve while still exercising the real business logic (auto-O5 advance).
const EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';
// A course that has a configured price at HQ (facility 1) in the dev seed (same fixture used by
// admin-receipt-provision.spec.ts).
const PRICED_COURSE = process.env.TEST_PRICED_COURSE ?? 'CRS_10512_5483';

test.use({ baseURL: 'http://localhost:5173' });

test('sale draft-receipt from opportunity → director approve → opportunity auto-wins to O5', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  // super_admin's default landing module is "Quản trị" (Plan D: module rail, not leaf nav).
  await expect(page.locator('nav a').filter({ hasText: 'Quản trị' })).toBeVisible({ timeout: 10_000 });

  // ── Create the opportunity (O1) through the CRM form. ──
  await page.locator('nav a').filter({ hasText: 'CRM' }).click();
  await expect(page.getByText('Tạo cơ hội mới')).toBeVisible({ timeout: 10_000 });

  const name = `E2E Commission ${Date.now().toString().slice(-6)}`;
  const phone = `09${Date.now().toString().slice(-8)}`;
  await page.getByLabel('Tên liên hệ').fill(name);
  await page.getByLabel('Số điện thoại').fill(phone);
  await page.getByRole('button', { name: 'Tạo cơ hội (O1)' }).click();
  await expect(page.getByText(`Đã tạo cơ hội cho ${name}`)).toBeVisible({ timeout: 8_000 });

  // ── Open the new opportunity's record page. Pipeline defaults to kanban view (view-defaults.ts):
  // the O1 card is a role="button" div, not a table row — clicking it navigates to /crm/opportunities/:id. ──
  await page.locator('[role="button"]').filter({ hasText: name }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 10_000 });
  const oppUrl = page.url();

  // ── Sale creates a draft receipt from the opportunity (opportunityId auto-attached). ──
  await page.getByRole('button', { name: 'Tạo phiếu thu' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Tạo phiếu thu từ cơ hội')).toBeVisible();

  await dialog.getByLabel('Khóa học').click({ force: true });
  await dialog.getByLabel('Khóa học').fill(PRICED_COURSE);
  await page.getByRole('option', { name: new RegExp(PRICED_COURSE) }).first().click();

  await dialog.getByRole('button', { name: 'Tạo phiếu nháp' }).click();
  await expect(page.getByText(/Đã tạo phiếu nháp/i)).toBeVisible({ timeout: 8_000 });

  // ── Director approves the draft from the finance panel. ──
  await page.locator('nav a').filter({ hasText: 'Tài chính' }).click();
  await expect(page.getByRole('button', { name: 'Duyệt' }).first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Duyệt' }).first().click();
  await expect(page.getByText(/Đã duyệt phiếu/i)).toBeVisible({ timeout: 10_000 });

  // ── The linked opportunity auto-advanced to O5 (won) — confirmed back on its record page.
  // "Thành công" only renders when stage === 'O5_ENROLLED' && closedAt is set (crm-shared.ts) —
  // the O5 stage button itself is NOT asserted here since opportunity-detail.tsx always renders
  // all 5 pipeline-stage buttons regardless of current stage, so it would prove nothing. ──
  await page.goto(oppUrl);
  await expect(page.getByText('Thành công')).toBeVisible({ timeout: 10_000 });
});
