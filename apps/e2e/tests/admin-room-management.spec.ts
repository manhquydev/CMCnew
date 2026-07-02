import { test, expect, type Page } from '@playwright/test';
import { withRls } from '@cmc/db';

// P6 UI wiring: room.update / room.archive were audited backend mutations with zero UI.
// This closes the gap by driving the real RoomsManager modal in class-workspace.tsx.
const EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@cmc.local';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'ChangeMe!123';
const FACILITY = 1;
const SUPER = { facilityIds: [] as number[], isSuperAdmin: true };

test.use({ baseURL: 'http://localhost:5173' });

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

let roomId: string;
let roomCode: string;
let roomName: string;
let updatedName: string;

test.beforeAll(async () => {
  const suffix = unique('E2ERM');
  roomCode = `${suffix}-C`;
  roomName = `E2E Room ${suffix}`;
  updatedName = `E2E Room ${suffix} Updated`;

  const room = await withRls(SUPER, (tx) =>
    tx.room.create({ data: { facilityId: FACILITY, code: roomCode, name: roomName, capacity: 20 } }),
  );
  roomId = room.id;
});

test.afterAll(async () => {
  if (!roomId) return;
  await withRls(SUPER, (tx) => tx.room.deleteMany({ where: { id: roomId } }));
});

async function loginAdmin(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.locator('nav').getByText('Tổng quan')).toBeVisible({ timeout: 10_000 });
}

test.describe('Room edit + archive', () => {
  test('staff edits a room name → persists; archive hides it from the room list', async ({ page }) => {
    await loginAdmin(page);
    await page.locator('nav a').filter({ hasText: 'Lớp học' }).click();
    await expect(page.getByRole('button', { name: /Quản lý phòng/ })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Quản lý phòng/ }).click();

    const roomRow = page.getByRole('row', { name: new RegExp(roomCode) });
    await expect(roomRow).toBeVisible({ timeout: 10_000 });
    await roomRow.getByRole('button', { name: 'Sửa' }).click();

    const editDialog = page.getByRole('dialog').filter({ hasText: 'Sửa phòng học' });
    await editDialog.getByLabel('Tên', { exact: true }).fill(updatedName);
    await editDialog.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('Đã cập nhật phòng học')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('button', { name: /Quản lý phòng/ })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Quản lý phòng/ }).click();
    await expect(page.getByText(updatedName)).toBeVisible({ timeout: 8_000 });

    page.once('dialog', (d) => d.accept());
    await page.getByRole('row', { name: new RegExp(roomCode) }).getByRole('button', { name: 'Lưu trữ' }).click();
    await expect(page.getByText('Đã lưu trữ phòng học')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(updatedName)).not.toBeVisible();
  });
});
