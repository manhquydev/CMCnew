import { describe, it, expect } from 'vitest';
import { brevoMailerFromEnv, sendViaBrevo, type BrevoMailerConfig } from '../src/lib/brevo-client.js';
import { RateLimitError } from '../src/lib/graph-client.js';

// Pure unit tests — no DB. Mirrors email-graph-client.test.ts's shape for the Brevo transport.

const FAKE_KEY = 'not-a-real-key-123'; // test fixture only, never a live credential
const CFG: BrevoMailerConfig = { apiKey: FAKE_KEY, senderEmail: 'sender@e.edu.vn', senderName: 'CMC' };

describe('brevoMailerFromEnv', () => {
  it('returns null when required vars are unset (no-op path)', () => {
    const saved = { ...process.env };
    for (const k of ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME']) delete process.env[k];
    expect(brevoMailerFromEnv()).toBeNull();
    Object.assign(process.env, saved);
  });

  it('senderName defaults to senderEmail when unset', () => {
    const saved = { ...process.env };
    process.env.BREVO_API_KEY = FAKE_KEY;
    process.env.BREVO_SENDER_EMAIL = 'x@e.edu.vn';
    delete process.env.BREVO_SENDER_NAME;
    expect(brevoMailerFromEnv()).toEqual({ apiKey: FAKE_KEY, senderEmail: 'x@e.edu.vn', senderName: 'x@e.edu.vn' });
    process.env = saved;
  });
});

describe('sendViaBrevo', () => {
  it('POSTs with the api-key header and expected body shape, succeeds on 201', async () => {
    let calledUrl = '';
    let calledHeaders: Record<string, string> = {};
    let calledBody: any = null;
    const fetchImpl = (async (url: string, init: any) => {
      calledUrl = url;
      calledHeaders = init.headers;
      calledBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ messageId: 'm1' }), { status: 201 });
    }) as unknown as typeof fetch;

    await sendViaBrevo(CFG, { mailbox: 'notify', to: 'parent@gmail.com', subject: 'Hi', html: '<p>x</p>' }, { fetchImpl });

    expect(calledUrl).toBe('https://api.brevo.com/v3/smtp/email');
    expect(calledHeaders['api-key']).toBe('k-123');
    expect(calledBody.sender).toEqual({ name: 'CMC', email: 'sender@e.edu.vn' });
    expect(calledBody.to).toEqual([{ email: 'parent@gmail.com' }]);
    expect(calledBody.htmlContent).toBe('<p>x</p>');
  });

  it('throws RateLimitError labeled "brevo" on 429 with Retry-After', async () => {
    const fetchImpl = (async () =>
      new Response('slow down', { status: 429, headers: { 'Retry-After': '42' } })) as unknown as typeof fetch;
    await expect(
      sendViaBrevo(CFG, { mailbox: 'notify', to: 'a@b.com', subject: 's', html: 'h' }, { fetchImpl }),
    ).rejects.toBeInstanceOf(RateLimitError);
    try {
      await sendViaBrevo(CFG, { mailbox: 'notify', to: 'a@b.com', subject: 's', html: 'h' }, { fetchImpl });
    } catch (e) {
      expect((e as Error).message).toContain('brevo');
      expect((e as Error).message).not.toContain('Graph');
    }
  });

  it('throws a plain Error on other non-2xx', async () => {
    const fetchImpl = (async () => new Response('bad request', { status: 400 })) as unknown as typeof fetch;
    await expect(
      sendViaBrevo(CFG, { mailbox: 'notify', to: 'a@b.com', subject: 's', html: 'h' }, { fetchImpl }),
    ).rejects.toThrow(/HTTP 400/);
  });
});
