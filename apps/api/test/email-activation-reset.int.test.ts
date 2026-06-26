import { describe, it, expect, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { Role } from '@cmc/auth';
import { appRouter } from '../src/routers/index.js';
import type { ApiContext } from '../src/context.js';
import { withRls, prisma } from '@cmc/db';
import { staffCaller, SUPER, uniq } from './helpers.js';

// Integration: staff onboarding (activation) + password reset over the real routers + DB.
// The raw token is never returned by the API, so we read it back out of the queued email's URL —
// exactly what a recipient would click.

function publicCaller() {
  const ctx: ApiContext = { c: {} as never, session: null, lms: null, ip: 'test-activation' };
  return appRouter.createCaller(ctx);
}

const tag = uniq('act');
const email = `${tag}@example.edu.vn`;
let userId: string | null = null;

function tokenFromOutbox(html: string): string {
  const m = html.match(/[?&]token=([^"&\s]+)/);
  if (!m) throw new Error('no token in email URL');
  return decodeURIComponent(m[1]);
}
async function latestEmailTo(addr: string, kind: string) {
  return withRls(SUPER, (tx) =>
    tx.emailOutbox.findFirst({ where: { toAddress: addr, templateKind: kind }, orderBy: { createdAt: 'desc' } }),
  );
}

afterAll(async () => {
  await withRls(SUPER, async (tx) => {
    await tx.emailOutbox.deleteMany({ where: { toAddress: email } });
    if (userId) {
      await tx.activationToken.deleteMany({ where: { subjectId: userId } });
      await tx.userFacility.deleteMany({ where: { userId } });
      await tx.appUser.deleteMany({ where: { id: userId } });
    }
  });
});

describe('staff activation + password reset', () => {
  it('user.create queues a staff_welcome activation email', async () => {
    const caller = await staffCaller();
    const user = await caller.user.create({
      email,
      displayName: 'Test Staff',
      password: 'initialPass123',
      roles: [Role.hr],
      primaryRole: Role.hr,
      facilityIds: [],
    });
    userId = user.id;
    const mail = await latestEmailTo(email, 'staff_welcome');
    expect(mail).toBeTruthy();
    const tok = await withRls(SUPER, (tx) =>
      tx.activationToken.findFirst({ where: { subjectId: user.id, kind: 'staff_account' } }),
    );
    expect(tok).toBeTruthy();
    // token stored hashed, never raw
    expect(tok!.tokenHash).not.toContain(tokenFromOutbox(mail!.bodyHtml));
  });

  it('activateSetPassword consumes the token and sets the password', async () => {
    const mail = await latestEmailTo(email, 'staff_welcome');
    const token = tokenFromOutbox(mail!.bodyHtml);
    await publicCaller().auth.activateSetPassword({ token, newPassword: 'newStrongPass123' });
    // reuse fails
    await expect(
      publicCaller().auth.activateSetPassword({ token, newPassword: 'another123' }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('password reset: unknown email is silent (no enumeration), known email queues reset', async () => {
    const before = await withRls(SUPER, (tx) => tx.activationToken.count({ where: { subjectId: userId! } }));
    await publicCaller().auth.requestPasswordReset({ email: `${uniq('nobody')}@example.edu.vn` });
    // no token for a random subject — count for our user unchanged
    const afterUnknown = await withRls(SUPER, (tx) => tx.activationToken.count({ where: { subjectId: userId! } }));
    expect(afterUnknown).toBe(before);

    await publicCaller().auth.requestPasswordReset({ email });
    const mail = await latestEmailTo(email, 'password_reset');
    expect(mail).toBeTruthy();
    const token = tokenFromOutbox(mail!.bodyHtml);
    await publicCaller().auth.resetPassword({ token, newPassword: 'resetPass12345' });
    // reused token rejected
    await expect(
      publicCaller().auth.resetPassword({ token, newPassword: 'again12345' }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
