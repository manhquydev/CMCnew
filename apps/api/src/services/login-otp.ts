// Passwordless login OTP for LMS parents (R3). A parent proves ownership of a registered email by
// entering a 6-digit code we email via Microsoft Graph. Codes are stored hashed, single-use,
// short-lived and attempt-capped to defeat brute force of the 1e6 code space. No account enumeration:
// requestLoginOtp resolves the same whether or not the email is registered.

import { randomInt, createHash } from 'node:crypto';
import { withRls } from '@cmc/db';
import { graphMailerFromEnv, sendViaGraph, type SendDeps } from '../lib/graph-client.js';
import { brevoMailerFromEnv, sendViaBrevo } from '../lib/brevo-client.js';
import { decideTransport } from '../lib/email-routing.js';
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
  const to = normEmail(email);
  const msg = { mailbox: 'notify' as const, to, subject, html };
  const transport = decideTransport(to);
  const graphCfg = graphMailerFromEnv();
  const brevoCfg = brevoMailerFromEnv();
  const cfg = transport === 'brevo' ? brevoCfg : graphCfg;
  // Dev fallback (decided transport unconfigured) is detectable synchronously — surface the code so
  // the flow is testable before real credentials exist. NEVER in production.
  const transportDisabled = cfg === null;
  // Fire the send WITHOUT blocking the response: removes the network round-trip from the request
  // latency, shrinking the timing side-channel between known/unknown email (MED-3). No fallback
  // between transports if the decided one isn't configured — same silent-no-op shape sendEmailNow
  // already had when Graph alone was unconfigured.
  if (cfg) {
    const send = transport === 'brevo' ? sendViaBrevo(brevoCfg!, msg, deps) : sendViaGraph(graphCfg!, msg, deps);
    void send.catch((e) => console.error(`OTP email send failed (${transport})`, e));
  }
  if (transportDisabled && process.env.NODE_ENV !== 'production') {
    console.log(`[dev] LMS login OTP for ${to}: ${code}`);
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
    // Only consider a live OTP: unconsumed, unexpired, under the attempt cap. Putting attempts<MAX in
    // the filter means an over-capped code is simply "not found".
    const otp = await tx.loginOtp.findFirst({
      where: { emailHash, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) return null;

    if (otp.codeHash !== sha256(code)) {
      // Atomic, race-safe increment: only bumps while still under the cap (TOCTOU-proof). Concurrent
      // wrong guesses cannot push attempts past MAX nor be accepted.
      await tx.loginOtp.updateMany({
        where: { id: otp.id, attempts: { lt: MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      });
      return null;
    }
    // Atomic single-use consume: exactly one concurrent correct-code request wins.
    const consumed = await tx.loginOtp.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) return null;
    const parent = await tx.parentAccount.findFirst({
      where: { email: normEmail(email), isActive: true },
      select: { id: true },
    });
    return parent?.id ?? null;
  });
}
