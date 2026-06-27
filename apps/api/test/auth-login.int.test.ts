import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { Role, login, resolveSession } from '@cmc/auth';
import { hashPassword } from '@cmc/db';
import { prisma, withRls, SUPER, uniq } from './helpers.js';
import { checkLoginLimit, clearLoginLimit, recordLoginFailure, __resetRateLimitStore } from '../src/rate-limit.js';

// Auth is the most security-critical seam yet had zero coverage (review C8). These tests lock the
// invariants the login flow depends on: bad credentials rejected, deactivated users blocked,
// tokenVersion bump invalidating outstanding JWTs (forced logout), and login rate-limiting.

const PASSWORD = 'correct-horse-battery';

async function makeUser(opts: { isActive?: boolean } = {}): Promise<{ id: string; email: string }> {
  const email = `${uniq('authtest')}@cmc.test`;
  const passwordHash = await hashPassword(PASSWORD);
  const u = await withRls(SUPER, (tx) =>
    tx.appUser.create({
      data: {
        email,
        displayName: 'Auth Test',
        passwordHash,
        roles: [Role.giao_vien],
        primaryRole: Role.giao_vien,
        isActive: opts.isActive ?? true,
      },
      select: { id: true, email: true },
    }),
  );
  return u;
}

describe('auth login invariants', () => {
  beforeAll(async () => {
    // hashPassword/withRls touch the DB; surface a clear error if the env isn't wired.
    await prisma.$queryRaw`SELECT 1`;
  });

  it('accepts correct credentials and issues a resolvable session', async () => {
    const u = await makeUser();
    const result = await login(u.email, PASSWORD);
    expect(result).not.toBeNull();
    const session = await resolveSession(result!.token);
    expect(session?.userId).toBe(u.id);
  });

  it('rejects a wrong password', async () => {
    const u = await makeUser();
    expect(await login(u.email, 'wrong-password')).toBeNull();
  });

  it('rejects an unknown email', async () => {
    expect(await login(`${uniq('nope')}@cmc.test`, PASSWORD)).toBeNull();
  });

  it('blocks a deactivated user even with the correct password', async () => {
    const u = await makeUser({ isActive: false });
    expect(await login(u.email, PASSWORD)).toBeNull();
  });

  it('invalidates an outstanding token when tokenVersion is bumped (forced logout)', async () => {
    const u = await makeUser();
    const result = await login(u.email, PASSWORD);
    expect(await resolveSession(result!.token)).not.toBeNull();

    // Simulate deactivate / role change which bumps tokenVersion.
    await withRls(SUPER, (tx) =>
      tx.appUser.update({ where: { id: u.id }, data: { tokenVersion: { increment: 1 } } }),
    );
    expect(await resolveSession(result!.token)).toBeNull();
  });

  it('resolveSession rejects a deactivated user mid-session', async () => {
    const u = await makeUser();
    const result = await login(u.email, PASSWORD);
    await withRls(SUPER, (tx) => tx.appUser.update({ where: { id: u.id }, data: { isActive: false } }));
    expect(await resolveSession(result!.token)).toBeNull();
  });
});

describe('login rate limiting', () => {
  beforeEach(() => __resetRateLimitStore());

  it('throws TOO_MANY_REQUESTS after 5 FAILED attempts for the same IP+identifier', () => {
    const ip = '203.0.113.7';
    const id = 'victim@cmc.test';
    // Only failures count: 5 failed attempts each pass the pre-check then record a failure.
    for (let i = 0; i < 5; i++) {
      expect(() => checkLoginLimit(ip, id)).not.toThrow();
      recordLoginFailure(ip, id);
    }
    try {
      checkLoginLimit(ip, id);
      throw new Error('expected rate limit to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe('TOO_MANY_REQUESTS');
    }
  });

  it('does NOT count successful logins — a shared-NAT IP is never locked by valid sign-ins', () => {
    const ip = '198.51.100.5';
    // 50 successful logins from one IP (different users), no failures recorded → never throttled.
    for (let i = 0; i < 50; i++) {
      expect(() => checkLoginLimit(ip, `user${i}@cmc.test`)).not.toThrow();
      clearLoginLimit(ip, `user${i}@cmc.test`); // success path
    }
    expect(() => checkLoginLimit(ip, 'another@cmc.test')).not.toThrow();
  });

  it('clearLoginLimit resets the per-identifier counter after a successful login', () => {
    const ip = '203.0.113.8';
    const id = 'good@cmc.test';
    for (let i = 0; i < 4; i++) {
      checkLoginLimit(ip, id);
      recordLoginFailure(ip, id); // 4 failed attempts
    }
    clearLoginLimit(ip, id); // success on the 5th attempt clears the pair bucket
    // Window restarts for this identifier: 5 more failures allowed before throwing.
    for (let i = 0; i < 5; i++) {
      expect(() => checkLoginLimit(ip, id)).not.toThrow();
      recordLoginFailure(ip, id);
    }
    expect(() => checkLoginLimit(ip, id)).toThrow(TRPCError);
  });

  it('is case-insensitive on the identifier', () => {
    const ip = '203.0.113.9';
    for (let i = 0; i < 5; i++) recordLoginFailure(ip, 'User@CMC.test');
    expect(() => checkLoginLimit(ip, 'user@cmc.test')).toThrow(TRPCError);
  });

  it('per-IP limit throttles credential-stuffing across many identifiers', () => {
    const ip = '203.0.113.10';
    // 20 failures spread across distinct identifiers (1 each, so no pair hits its 5-limit first).
    for (let i = 0; i < 20; i++) recordLoginFailure(ip, `acct${i}@cmc.test`);
    expect(() => checkLoginLimit(ip, 'fresh@cmc.test')).toThrow(TRPCError);
  });
});
