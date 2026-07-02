// Brevo transactional email sender — external recipients (parents/guardians). Graph's M365 tenant
// returns 550 5.7.708 (reputation block) on outbound-external mail; Brevo is the second transport
// for that traffic. Decision 0030. Mirrors graph-client.ts's shapes so drainOutbox can treat both
// transports uniformly.

import { RateLimitError, type OutgoingEmail, type SendDeps } from './graph-client.js';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export interface BrevoMailerConfig {
  apiKey: string;
  senderEmail: string;
  senderName: string;
}

// Null when the minimum set is unset → caller treats Brevo as unconfigured (rows stay queued).
// senderName defaults to senderEmail so a missing display name never blocks send.
export function brevoMailerFromEnv(): BrevoMailerConfig | null {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !senderEmail) return null;
  return { apiKey, senderEmail, senderName: process.env.BREVO_SENDER_NAME || senderEmail };
}

/**
 * Send one email via Brevo. Throws RateLimitError on 429 (worker backs off, same as Graph), plain
 * Error on any other non-2xx (worker counts the attempt). msg.mailbox is ignored — Brevo has a
 * single verified sender. Only deps.fetchImpl is used (Brevo auth is a stateless api-key, no token
 * step); deps.getToken is accepted for signature-uniformity and ignored.
 */
export async function sendViaBrevo(
  cfg: BrevoMailerConfig,
  msg: OutgoingEmail,
  deps: SendDeps = {},
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(BREVO_ENDPOINT, {
    method: 'POST',
    headers: { 'api-key': cfg.apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: cfg.senderName, email: cfg.senderEmail },
      to: [{ email: msg.to }],
      subject: msg.subject,
      htmlContent: msg.html,
    }),
  });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? '60');
    throw new RateLimitError(Number.isFinite(retryAfter) ? retryAfter : 60, 'brevo');
  }
  // Brevo returns 201 Created + { messageId } on success.
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo sendEmail HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
}
