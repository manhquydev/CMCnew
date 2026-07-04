import { test, expect } from '@playwright/test';

// P2 email outbox (plans/260702-1109-finance-ops/phase-05-validation.md), end-to-end through the
// React frontend: approve a receipt, send its receipt email via the outbox panel, and confirm the
// row is visible in the outbox admin surface. Backend guards (secret-kind retry block, dedup,
// notif union) are already integration-tested in email-outbox-router.int.test.ts; this closes the
// gap that no E2E ever drove send+list through the real UI.
//
// The retry path itself needs a FAILED row. Forcing a real send failure requires control over the
// Graph mail transport (network fault injection or invalid credentials), which this UI-only E2E has
// no way to trigger deterministically — a failure only happens if this environment's Graph
// credentials are absent/invalid, which is environment state, not something the test can assert.
// So this spec observes whichever outcome actually occurs: if the row lands in "Thất bại" (Graph
// send failed in this environment), it drives the real retry button and asserts the requeue; if it
// lands in "Đang chờ"/"Đã gửi" (Graph is configured and working), it asserts the row is visible in
// the outbox list instead. Either branch proves real UI behavior — neither is skipped.
const EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';
const PRICED_COURSE = process.env.TEST_PRICED_COURSE ?? 'UCREA-CB';

test.use({ baseURL: 'http://localhost:5173' });

test('send a receipt email → visible in outbox admin surface → retry path if failed', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  // super_admin's default landing module is "Quản trị" (Plan D: module rail, not leaf nav).
  await expect(page.locator('nav a').filter({ hasText: 'Quản trị' })).toBeVisible({ timeout: 10_000 });

  await page.locator('nav a').filter({ hasText: 'Tài chính' }).click();

  const studentName = `E2E Email HS ${Date.now().toString().slice(-6)}`; // used only to fill the create-form field
  const parentEmail = `e2e-outbox-${Date.now()}@email-outbox-e2e-test.com`;

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

  // The send form takes the receipt's UUID, not its human code. "In" opens /files/receipt/:id in a
  // new tab (window.open) — capture that tab's URL to extract the UUID, then close it.
  const [printPage] = await Promise.all([
    page.waitForEvent('popup'),
    row.getByRole('button', { name: 'In' }).click(),
  ]);
  const printUrl = printPage.url();
  await printPage.close();
  const uuidMatch = printUrl.match(/receipt\/([0-9a-f-]{36})/i);
  expect(uuidMatch).toBeTruthy();
  const uuid = uuidMatch![1];

  // "Hộp thư gửi đi" is now a Tài chính sub-tab (Plan D) — module is already active, click the tab.
  await page.getByRole('tab', { name: 'Hộp thư gửi đi' }).click();
  const sendCard = page.locator('.mantine-Card-root').filter({ hasText: 'Gửi phiếu thu qua email' });
  await sendCard.getByLabel('Mã phiếu thu (ID)').fill(uuid);
  await sendCard.getByLabel(/Email người nhận/).fill(parentEmail);
  await sendCard.getByRole('button', { name: 'Gửi', exact: true }).click();
  await expect(page.getByText(new RegExp(`Đã xếp hàng gửi phiếu thu tới ${parentEmail}`))).toBeVisible({
    timeout: 10_000,
  });

  // Confirm the row is visible in the outbox admin surface (queued, not yet drained by the cron worker).
  const outboxCard = page.locator('.mantine-Card-root').filter({ hasText: 'Hộp thư gửi đi' });
  const statusFilter = outboxCard.getByPlaceholder('Tất cả trạng thái');
  await statusFilter.click();
  await page.getByRole('option', { name: 'Đang chờ' }).click();
  const outboxRow = outboxCard.locator('tr').filter({ hasText: parentEmail });
  await expect(outboxRow).toBeVisible({ timeout: 15_000 });

  // Give the cron worker a window to drain the row, then re-check its terminal status.
  await page.waitForTimeout(8_000);
  await outboxCard.getByRole('button', { name: 'Làm mới' }).click();
  await statusFilter.click();
  await page.getByRole('option', { name: 'Thất bại' }).click();
  await expect(outboxCard.getByText('Đang tải...')).toBeHidden({ timeout: 10_000 });
  const failedRow = outboxCard.locator('tr').filter({ hasText: parentEmail });

  if (await failedRow.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await failedRow.getByRole('button', { name: 'Gửi lại' }).click();
    await expect(page.getByText('Đã xếp hàng gửi lại')).toBeVisible({ timeout: 10_000 });
  } else {
    // Graph transport succeeded (or is still queued) in this environment — assert the row reached a
    // non-failed pending/terminal state instead, which still proves the send→outbox-visible path.
    // Probe each remaining status filter in turn rather than trying to reset to "no filter" — the
    // Select's placeholder text is not a selectable listbox option.
    let found = false;
    for (const label of ['Đang chờ', 'Đang gửi', 'Đã gửi']) {
      await statusFilter.click();
      await page.getByRole('option', { name: label }).click();
      await expect(outboxCard.getByText('Đang tải...')).toBeHidden({ timeout: 10_000 });
      if (await outboxCard.locator('tr').filter({ hasText: parentEmail }).isVisible({ timeout: 3_000 }).catch(() => false)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  }
});
