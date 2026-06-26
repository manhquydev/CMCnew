// Passwordless login OTP for LMS parents (R3). A parent proves ownership of a registered email by
// entering a 6-digit code we email via Microsoft Graph. Codes are stored hashed, single-use,
// short-lived and attempt-capped to defeat brute force of the 1e6 code space. No account enumeration:
// requestLoginOtp resolves the same whether or not the email is registered.

import { randomInt, createHash } from 'node:crypto';
import { withRls } from '@cmc/db';
import { sendEmailNow, type SendDeps } from '../lib/graph-client.js';
import { renderTemplate } from './email-templates.js';

const SYSTEM_CTX = { facilityIds: [] as number[], isSuperAdmin: true };
const OTP_TTL_MIN = 5;
const MAX_ATTEMPTS = 5;

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
function normEmail(email: string): string {
  return email.trim().toLowerCase();
}
/** Cryptographically-random 6-digit code (leading zeros preserved). */
function genCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Issue an OTP for `email` if it belongs to an active parent, and email it. Always resolves (silent
 * on unknown email). `deps` injects a mock sender for tests. Returns the raw code ONLY in non-prod
 * with Graph unconfigured (dev fallback) so the flow is testable before the tenant secret exists.
 */
export async function requestLoginOtp(email: string, deps: SendDeps = {}): Promise<{ devCode?: string }> {
  const emailHash = sha256(normEmail(email));
  const parent = await withRls(SYSTEM_CTX, (tx) =>
    tx.parentAccount.findFirst({ where: { email: normEmail(email), isActive: true }, select: { id: true } }),
  );
  if (!parent) return {}; // no enumeration

  const code = genCode();
  await withRls(SYSTEM_CTX, (tx) =>
    tx.loginOtp.create({
      data: { emailHash, codeHash: sha256(code), expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000) },
    }),
  );

  const { subject, html } = renderTemplate('otp_login', { code, expiresMinutes: OTP_TTL_MIN });
  const sent = await sendEmailNow({ mailbox: 'notify', to: normEmail(email), subject, html }, deps);
  if (!sent && process.env.NODE_ENV !== 'production') {
    // Dev only: Graph not configured yet → surface the code so the flow is testable. NEVER in prod.
    console.log(`[dev] LMS login OTP for ${normEmail(email)}: ${code}`);
    return { devCode: code };
  }
  return {};
}

/**
 * Verify a presented code for `email`. Returns the parent accountId on success, else null. Consumes
 * the code on success; increments attempts on a wrong code; rejects expired / over-attempt / used.
 */
export async function verifyLoginOtp(email: string, code: string): Promise<string | null> {
  const emailHash = sha256(normEmail(email));
  return withRls(SYSTEM_CTX, async (tx) => {
    const otp = await tx.loginOtp.findFirst({
      where: { emailHash, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) return null;
    if (otp.expiresAt.getTime() < Date.now() || otp.attempts >= MAX_ATTEMPTS) return null;
    if (otp.codeHash !== sha256(code)) {
      await tx.loginOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      return null;
    }
    await tx.loginOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    const parent = await tx.parentAccount.findFirst({
      where: { email: normEmail(email), isActive: true },
      select: { id: true },
    });
    return parent?.id ?? null;
  });
}
