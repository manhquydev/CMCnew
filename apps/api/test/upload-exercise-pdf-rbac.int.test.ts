import { beforeAll, describe, expect, it } from 'vitest';
import { Role, login } from '@cmc/auth';
import { hashPassword } from '@cmc/db';
import { prisma, withRls, SUPER, uniq } from './helpers.js';
import { COOKIE_NAME } from '../src/context.js';

// index.ts binds a real port unless NODE_ENV==='test' (Vitest's default) and schedules cron jobs
// unless DISABLE_CRON=1 — set the latter before the dynamic import so module-init stays inert.
// Must be a dynamic import: static imports are hoisted ahead of this assignment.
process.env.DISABLE_CRON = '1';

let app: (typeof import('../src/index.js'))['app'];

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
  ({ app } = await import('../src/index.js'));
});

const PASSWORD = 'correct-horse-battery';
const MIN_PDF = Buffer.from('%PDF-1.4\n%mock exercise pdf%\n');

async function makeStaff(role: Role): Promise<{ email: string }> {
  const email = `${uniq('uploadrbac')}@cmc.test`;
  const passwordHash = await hashPassword(PASSWORD);
  await withRls(SUPER, (tx) =>
    tx.appUser.create({
      data: {
        email,
        displayName: 'Upload RBAC Test',
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

describe('POST /upload/exercise-pdf RBAC gate', () => {
  it('403s a staff session without exercise.upsert (sale)', async () => {
    const { email } = await makeStaff(Role.sale);
    const token = await tokenFor(email);
    const res = await app.request('/upload/exercise-pdf', {
      method: 'POST',
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
      body: MIN_PDF,
    });
    expect(res.status).toBe(403);
  });

  it('allows a director with exercise.upsert (giam_doc_dao_tao) to upload', async () => {
    const { email } = await makeStaff(Role.giam_doc_dao_tao);
    const token = await tokenFor(email);
    const res = await app.request('/upload/exercise-pdf', {
      method: 'POST',
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
      body: MIN_PDF,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ref: string };
    expect(json.ref).toMatch(/^[a-f0-9]{64}$/);
  });

  it('401s an unauthenticated request before any RBAC check', async () => {
    const res = await app.request('/upload/exercise-pdf', {
      method: 'POST',
      body: MIN_PDF,
    });
    expect(res.status).toBe(401);
  });
});
