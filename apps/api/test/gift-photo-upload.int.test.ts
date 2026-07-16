import { beforeAll, describe, expect, it } from 'vitest';
import { Role, login, loginStudent } from '@cmc/auth';
import { hashPassword } from '@cmc/db';
import { prisma, withRls, SUPER, uniq } from './helpers.js';
import { COOKIE_NAME, LMS_COOKIE_NAME } from '../src/context.js';

// index.ts binds a real port unless NODE_ENV==='test' (Vitest's default) and schedules cron jobs
// unless DISABLE_CRON=1 — set the latter before the dynamic import so module-init stays inert.
process.env.DISABLE_CRON = '1';

let app: (typeof import('../src/index.js'))['app'];

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
  ({ app } = await import('../src/index.js'));
});

const PASSWORD = 'correct-horse-battery';
const LMS_PASSWORD = 'ChangeMe!123';

// A structurally-minimal but magic-byte-valid PNG (header + IHDR-ish filler bytes — the store
// only ever checks the 8-byte PNG signature, not full chunk structure).
const MIN_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('mock gift photo'),
]);
const NOT_AN_IMAGE = Buffer.from('this is plain text, not an image');

async function makeStaff(role: Role): Promise<{ email: string }> {
  const email = `${uniq('giftphoto')}@cmc.test`;
  const passwordHash = await hashPassword(PASSWORD);
  await withRls(SUPER, (tx) =>
    tx.appUser.create({
      data: {
        email,
        displayName: 'Gift Photo Test Staff',
        passwordHash,
        roles: [role],
        primaryRole: role,
        isActive: true,
      },
    }),
  );
  return { email };
}

async function tokenFor(email: string): Promise<string> {
  const result = await login(email, PASSWORD);
  if (!result) throw new Error('login failed in test fixture');
  return result.token;
}

async function makeStudentInFacility(facilityId: number): Promise<{ loginCode: string }> {
  const loginCode = `${uniq('GIFTSTU')}-HS`;
  await withRls(SUPER, async (tx) => {
    const student = await tx.student.create({
      data: {
        facilityId,
        studentCode: loginCode,
        fullName: `Gift Photo Test Student ${loginCode}`,
        program: 'UCREA',
        level: 'L1',
      },
    });
    await tx.studentAccount.create({
      data: {
        studentId: student.id,
        loginCode,
        passwordHash: await hashPassword(LMS_PASSWORD),
        isActive: true,
      },
    });
  });
  return { loginCode };
}

async function lmsTokenForStudent(loginCode: string): Promise<string> {
  const result = await loginStudent(loginCode, LMS_PASSWORD);
  if (!result) throw new Error('LMS student login failed in test fixture');
  return result.token;
}

describe('gift-photo store + endpoints', () => {
  it('403s upload for a staff session without rewards.giftCreate (giao_vien)', async () => {
    const { email } = await makeStaff(Role.giao_vien);
    const token = await tokenFor(email);
    const res = await app.request('/upload/gift-photo', {
      method: 'POST',
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
      body: MIN_PNG,
    });
    expect(res.status).toBe(403);
  });

  it('401s an unauthenticated upload before any RBAC check', async () => {
    const res = await app.request('/upload/gift-photo', { method: 'POST', body: MIN_PNG });
    expect(res.status).toBe(401);
  });

  it('400s a non-image upload', async () => {
    const { email } = await makeStaff(Role.giam_doc_kinh_doanh);
    const token = await tokenFor(email);
    const res = await app.request('/upload/gift-photo', {
      method: 'POST',
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
      body: NOT_AN_IMAGE,
    });
    expect(res.status).toBe(400);
  });

  it('413s an oversized upload', async () => {
    const { email } = await makeStaff(Role.giam_doc_kinh_doanh);
    const token = await tokenFor(email);
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1);
    const res = await app.request('/upload/gift-photo', {
      method: 'POST',
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
      body: oversized,
    });
    expect(res.status).toBe(413);
  });

  it('allows giam_doc_kinh_doanh to upload a PNG and returns a 64-hex ref', async () => {
    const { email } = await makeStaff(Role.giam_doc_kinh_doanh);
    const token = await tokenFor(email);
    const res = await app.request('/upload/gift-photo', {
      method: 'POST',
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
      body: MIN_PNG,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ref: string };
    expect(json.ref).toMatch(/^[a-f0-9]{64}$/);
  });

  it('serves the photo (200 + correct content-type) to an LMS principal in the SAME facility as the gift, and 403s a DIFFERENT facility, and 401s anonymous', async () => {
    const { email } = await makeStaff(Role.giam_doc_kinh_doanh);
    const staffToken = await tokenFor(email);
    const uploadRes = await app.request('/upload/gift-photo', {
      method: 'POST',
      headers: { Cookie: `${COOKIE_NAME}=${staffToken}` },
      body: MIN_PNG,
    });
    const { ref } = (await uploadRes.json()) as { ref: string };

    const gift = await withRls(SUPER, (tx) =>
      tx.gift.create({
        data: {
          facilityId: 1,
          name: `E2E Gift ${uniq('gift')}`,
          imageUrl: ref,
          starsRequired: 10,
        },
      }),
    );

    const { loginCode: sameFacilityCode } = await makeStudentInFacility(1);
    const sameFacilityToken = await lmsTokenForStudent(sameFacilityCode);
    const sameFacilityRes = await app.request(`/files/gift-photo/${ref}`, {
      headers: { Cookie: `${LMS_COOKIE_NAME}=${sameFacilityToken}` },
    });
    expect(sameFacilityRes.status).toBe(200);
    expect(sameFacilityRes.headers.get('content-type')).toBe('image/png');

    const { loginCode: otherFacilityCode } = await makeStudentInFacility(2);
    const otherFacilityToken = await lmsTokenForStudent(otherFacilityCode);
    const otherFacilityRes = await app.request(`/files/gift-photo/${ref}`, {
      headers: { Cookie: `${LMS_COOKIE_NAME}=${otherFacilityToken}` },
    });
    expect(otherFacilityRes.status).toBe(403);

    const anonRes = await app.request(`/files/gift-photo/${ref}`);
    expect(anonRes.status).toBe(401);

    await withRls(SUPER, (tx) => tx.gift.delete({ where: { id: gift.id } }));
  });
});
