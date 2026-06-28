import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createHash } from 'node:crypto';
import { appRouter } from '../src/routers/index.js';
import type { ApiContext } from '../src/context.js';
import { withRls } from '@cmc/db';
import { staffCaller, SUPER, uniq } from './helpers.js';

// Integration: parent passwordless Email OTP login. Graph is unconfigured in tests, so requestLoginOtp
// returns the code via devCode (dev fallback) — that's what we feed back into otpVerify.

function publicCaller(ip = 'otp-test') {
  // Minimal Hono ctx: setLmsCookie → hono setCookie → c.header('set-cookie', …). A no-op header suffices.
  const c = { header: () => undefined } as unknown as ApiContext['c'];
  const ctx: ApiContext = { c, session: null, lms: null, ip };
  return appRouter.createCaller(ctx);
}

const tag = uniq('otp');
const email = `${tag}@example.edu.vn`;
const emailHash = createHash('sha256').update(email.toLowerCase()).digest('hex');
let parentId: string | null = null;

// This suite relies on the OTP dev fallback (devCode returned when Graph is unconfigured). On a box
// whose real .env configures email (GRAPH_SENDER_*), the service would attempt a real send and omit
// devCode. Clear the sender vars for the suite so the dev-fallback path is exercised deterministically.
let savedEnv: NodeJS.ProcessEnv;
beforeAll(() => {
  savedEnv = { ...process.env };
  for (const k of ['GRAPH_SENDER_NOTIFY', 'GRAPH_SENDER_PAYROLL', 'GRAPH_SENDER_HR']) {
    delete process.env[k];
  }
});

afterAll(async () => {
  await withRls(SUPER, async (tx) => {
    await tx.loginOtp.deleteMany({ where: { emailHash } });
    await tx.emailOutbox.deleteMany({ where: { toAddress: email } });
    if (parentId) {
      await tx.guardian.deleteMany({ where: { parentAccountId: parentId } });
      await tx.parentAccount.deleteMany({ where: { id: parentId } });
    }
  });
  process.env = savedEnv;
});

describe('parent Email OTP login', () => {
  it('issues an OTP to a registered parent and logs them in', async () => {
    const staff = await staffCaller();
    const parent = await staff.guardian.parentCreate({ displayName: 'PH Test', email, password: 'temp123' });
    parentId = parent.id;

    const req = await publicCaller().lmsAuth.otpRequest({ email });
    expect(req.ok).toBe(true);
    expect(req.devCode).toMatch(/^\d{6}$/); // dev fallback (Graph unconfigured)

    const verify = await publicCaller().lmsAuth.otpVerify({ email, code: req.devCode! });
    expect(verify.principal.kind).toBe('parent');
    expect(verify.principal.accountId).toBe(parentId);
  });

  it('rejects a wrong code and counts the attempt', async () => {
    await publicCaller().lmsAuth.otpRequest({ email });
    await expect(publicCaller().lmsAuth.otpVerify({ email, code: '000000' })).rejects.toBeInstanceOf(TRPCError);
  });

  it('locks the code after 5 wrong attempts — a later correct code is rejected', async () => {
    const req = await publicCaller(`otp-cap-${Date.now()}`).lmsAuth.otpRequest({ email });
    const code = req.devCode!;
    for (let i = 0; i < 5; i++) {
      await expect(
        publicCaller(`otp-cap-${i}`).lmsAuth.otpVerify({ email, code: '111111' }),
      ).rejects.toBeInstanceOf(TRPCError);
    }
    // correct code now refused — attempt cap reached
    await expect(
      publicCaller(`otp-cap-final`).lmsAuth.otpVerify({ email, code }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('unknown email is silent (no enumeration): ok, no devCode, no otp row', async () => {
    const other = `${uniq('nobody')}@example.edu.vn`;
    const otherHash = createHash('sha256').update(other.toLowerCase()).digest('hex');
    const req = await publicCaller().lmsAuth.otpRequest({ email: other });
    expect(req.ok).toBe(true);
    expect((req as { devCode?: string }).devCode).toBeUndefined();
    const rows = await withRls(SUPER, (tx) => tx.loginOtp.count({ where: { emailHash: otherHash } }));
    expect(rows).toBe(0);
  });
});
