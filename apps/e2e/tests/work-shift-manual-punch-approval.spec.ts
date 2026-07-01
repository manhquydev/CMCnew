import { test, expect } from '@playwright/test';
import { Role, mintStaffSession } from '@cmc/auth';
import { withRls } from '@cmc/db';

const FACILITY = 1;
const SUPER = { facilityIds: [] as number[], isSuperAdmin: true };

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 1000)}`;
}

type Fixture = {
  managerId: string;
  managerEmail: string;
  staffId: string;
  punchId: string;
};

let fixture: Fixture;

test.beforeAll(async () => {
  const suffix = unique('WSM');
  const managerEmail = `${suffix}-manager@cmc.test`;

  const manager = await withRls(SUPER, (tx) =>
    tx.appUser.create({
      data: {
        email: managerEmail,
        displayName: `E2E Manager ${suffix}`,
        passwordHash: 'unused',
        primaryRole: Role.quan_ly,
        roles: [Role.quan_ly],
        isActive: true,
        facilities: { create: [{ facilityId: FACILITY }] },
      },
    }),
  );
  await withRls(SUPER, (tx) =>
    tx.employmentProfile.create({ data: { facilityId: FACILITY, userId: manager.id, position: 'quan_ly' } }),
  );

  const staff = await withRls(SUPER, (tx) =>
    tx.appUser.create({
      data: {
        email: `${suffix}-staff@cmc.test`,
        displayName: `E2E Staff ${suffix}`,
        passwordHash: 'unused',
        primaryRole: Role.sale,
        roles: [Role.sale],
        isActive: true,
        facilities: { create: [{ facilityId: FACILITY }] },
      },
    }),
  );
  await withRls(SUPER, (tx) =>
    tx.employmentProfile.create({ data: { facilityId: FACILITY, userId: staff.id, position: 'sale', managerId: manager.id } }),
  );

  // Seed a manual (outside-WiFi) punch directly — this test targets the manager's
  // approve action in the UI, not the punch-creation flow (already covered elsewhere).
  const punch = await withRls(SUPER, (tx) =>
    tx.timePunch.create({
      data: { facilityId: FACILITY, userId: staff.id, ipAddress: '203.0.113.99', method: 'manual' },
    }),
  );

  fixture = { managerId: manager.id, managerEmail, staffId: staff.id, punchId: punch.id };
});

test.afterAll(async () => {
  await withRls(SUPER, async (tx) => {
    await tx.timePunch.deleteMany({ where: { userId: fixture.staffId } });
    await tx.employmentProfile.deleteMany({ where: { userId: { in: [fixture.managerId, fixture.staffId] } } });
    await tx.appUser.deleteMany({ where: { id: { in: [fixture.managerId, fixture.staffId] } } });
  });
});

test('manager sees and approves a manual (outside-WiFi) punch from the checkin panel', async ({ browser }) => {
  const auth = await mintStaffSession(fixture.managerEmail);
  expect(auth).toBeTruthy();

  const context = await browser.newContext();
  await context.addCookies([{
    name: 'cmc.session',
    value: auth!.token,
    domain: 'localhost',
    path: '/',
    sameSite: 'Lax',
    httpOnly: true,
    secure: false,
  }]);
  const page = await context.newPage();
  await page.goto('http://localhost:5173/checkin');

  await expect(page.getByText('Chờ duyệt ngoài WiFi')).toBeVisible({ timeout: 10_000 });
  const row = page.getByRole('row').filter({ hasText: '203.0.113.99' });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Duyệt' }).click();
  await expect(row).not.toBeVisible({ timeout: 10_000 });

  const approved = await withRls(SUPER, (tx) => tx.timePunch.findUniqueOrThrow({ where: { id: fixture.punchId } }));
  expect(approved.approvedById).toBe(fixture.managerId);
  expect(approved.approvedAt).toBeTruthy();

  await context.close();
});
