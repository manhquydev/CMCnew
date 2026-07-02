import { test, expect } from '@playwright/test';
import { Role, mintStaffSession } from '@cmc/auth';
import { withRls } from '@cmc/db';

// HTTP-level coverage for the /upload/session-photo permission gate added this
// session — no tRPC router involved, so this can't be exercised via appRouter.createCaller
// like the *.int.test.ts suite; it needs a real request against the running API.
const API_URL = 'http://localhost:4000';
const SUPER = { facilityIds: [] as number[], isSuperAdmin: true };
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef]);

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 1000)}`;
}

async function mintCookieHeader(email: string): Promise<string> {
  const auth = await mintStaffSession(email);
  expect(auth).toBeTruthy();
  return `cmc.session=${auth!.token}`;
}

test.describe('session-photo upload permission gate', () => {
  let teacherEmail: string;
  let outsiderEmail: string;
  const createdUserIds: string[] = [];

  test.beforeAll(async () => {
    const suffix = unique('SPU');
    teacherEmail = `${suffix}-teacher@cmc.test`;
    outsiderEmail = `${suffix}-outsider@cmc.test`;

    const teacher = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: { email: teacherEmail, displayName: 'E2E Teacher', passwordHash: 'x', primaryRole: Role.giao_vien, roles: [Role.giao_vien], isActive: true, facilities: { create: [{ facilityId: 1 }] } },
      }),
    );
    // 'sale' has no sessionEvidence.upsertDraft grant — must be rejected by the upload gate.
    const outsider = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: { email: outsiderEmail, displayName: 'E2E Outsider', passwordHash: 'x', primaryRole: Role.sale, roles: [Role.sale], isActive: true, facilities: { create: [{ facilityId: 1 }] } },
      }),
    );
    createdUserIds.push(teacher.id, outsider.id);
  });

  test.afterAll(async () => {
    await withRls(SUPER, (tx) => tx.appUser.deleteMany({ where: { id: { in: createdUserIds } } }));
  });

  test('rejects an authenticated staff member without sessionEvidence.upsertDraft', async ({ request }) => {
    const cookie = await mintCookieHeader(outsiderEmail);
    const res = await request.post(`${API_URL}/upload/session-photo`, {
      headers: { Cookie: cookie },
      data: PNG_BYTES,
    });
    expect(res.status()).toBe(403);
  });

  test('accepts a teacher and returns a usable photo ref', async ({ request }) => {
    const cookie = await mintCookieHeader(teacherEmail);
    const res = await request.post(`${API_URL}/upload/session-photo`, {
      headers: { Cookie: cookie },
      data: PNG_BYTES,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ref).toMatch(/^[a-f0-9]{64}$/);
  });

  test('rejects an unauthenticated request', async ({ request }) => {
    const res = await request.post(`${API_URL}/upload/session-photo`, { data: PNG_BYTES });
    expect(res.status()).toBe(401);
  });
});
