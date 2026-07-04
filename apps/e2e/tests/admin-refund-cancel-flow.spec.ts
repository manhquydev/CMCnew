import { test, expect } from '@playwright/test';

// P1 refund ledger (decision 0028, plans/260702-1109-finance-ops/phase-05-validation.md), end-to-end
// through the React frontend: approve a receipt → cancel it with a manual refund amount entered in
// the same modal → the cancelled row shows the refund total and the audit note is visible in Nhật ký.
// Backend guard (sum-cap, approved-before-cancel) is already integration-tested; this closes the gap
// that no E2E ever drove the refund entry through the real cancel-modal UI.
const EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';
const PRICED_COURSE = process.env.TEST_PRICED_COURSE ?? 'CRS_10512_5483';

test.use({ baseURL: 'http://localhost:5173' });

test('cancel an approved receipt with a refund amount → RefundRecord + audit visible', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  // super_admin's default landing module is "Quản trị" (Plan D: module rail, not leaf nav).
  await expect(page.locator('nav a').filter({ hasText: 'Quản trị' })).toBeVisible({ timeout: 10_000 });

  await page.locator('nav a').filter({ hasText: 'Tài chính' }).click();

  const studentName = `E2E Refund HS ${Date.now().toString().slice(-6)}`;

  const form = page.locator('.mantine-Card-root').filter({ hasText: 'Lập phiếu thu' });
  await form.getByRole('button', { name: 'Học sinh mới' }).click();
  await form.getByLabel('Cơ sở').click({ force: true });
  await page.getByRole('option', { name: /HQ/ }).first().click();
  await form.getByLabel('Khóa học').click({ force: true });
  await form.getByLabel('Khóa học').fill(PRICED_COURSE);
  await page.getByRole('option', { name: new RegExp(PRICED_COURSE) }).first().click();
  await form.getByLabel('SĐT phụ huynh').fill(`09${Date.now().toString().slice(-8)}`);
  await form.getByLabel('Tên học sinh').fill(studentName);
  await form.getByRole('button', { name: 'Tạo phiếu nháp' }).click();
  await expect(page.getByText(/Tạo phiếu thu thành công/i)).toBeVisible({ timeout: 10_000 });

  // Approve the newest (top) draft — dismiss the LMS credential modal that appears on new-student approve.
  await page.getByRole('button', { name: 'Duyệt' }).first().click();
  await expect(page.getByText('Tài khoản LMS học sinh')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Đã ghi nhận' }).click();

  // The receipt list is ordered createdAt desc, so the row we just approved is the top data row.
  // NOTE: cannot match by studentName here — the "Học sinh" cell reads from a client-side student
  // list fetched once on mount, which is never refetched after approve auto-provisions a new
  // student, so it falls back to a truncated id instead of the name (pre-existing FE staleness,
  // out of scope for this validation-only phase).
  const receiptsCard = page.locator('.mantine-Card-root').filter({ hasText: 'Phiếu thu' });
  const row = receiptsCard.locator('tbody tr').first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row.getByText('Đã duyệt')).toBeVisible();

  await row.getByRole('button', { name: 'Hủy' }).click();
  const cancelModal = page.getByRole('dialog').filter({ hasText: 'Hủy phiếu thu' });
  await cancelModal.getByLabel('Lý do hủy').fill('E2E: hủy để test hoàn tiền');
  await cancelModal.getByLabel('Hoàn tiền (tùy chọn, VNĐ)').fill('500000');
  await cancelModal.getByRole('button', { name: 'Xác nhận hủy' }).click();

  await expect(page.getByText('Đã hủy phiếu thu')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Đã ghi hoàn tiền/)).toBeVisible({ timeout: 10_000 });

  // Reload put the just-cancelled receipt back at the top (createdAt desc is stable across the
  // status change — it's still the newest row).
  const cancelledRow = receiptsCard.locator('tbody tr').first();
  await expect(cancelledRow.getByText('Đã hủy')).toBeVisible({ timeout: 10_000 });
  await expect(cancelledRow.getByText('500.000đ')).toBeVisible({ timeout: 10_000 });

  await cancelledRow.getByRole('button', { name: 'Nhật ký' }).click();
  await expect(page.getByText(/Hoàn tiền 500\.000đ/)).toBeVisible({ timeout: 10_000 });
});
