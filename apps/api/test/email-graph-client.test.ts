import { describe, it, expect } from 'vitest';
import {
  graphMailerFromEnv,
  senderAddress,
  sendViaGraph,
  RateLimitError,
  type GraphMailerConfig,
} from '../src/lib/graph-client.js';
import { renderTemplate, esc } from '../src/services/email-templates.js';

// Pure unit tests — no DB. Exercise the Graph send logic (via injected fetch) and templates.

const CFG: GraphMailerConfig = {
  tenantId: 't',
  clientId: 'c',
  certPath: '/x.pem',
  senders: { notify: 'erp-notify@e.edu.vn', payroll: 'payroll@e.edu.vn', hr: 'hr@e.edu.vn' },
};

const fakeToken = async () => 'token-123';

describe('graphMailerFromEnv', () => {
  it('returns null when required vars are unset (no-op path)', () => {
    const saved = { ...process.env };
    // graphMailerFromEnv reads GRAPH_* WITH ENTRA_* fallbacks + the sender mailboxes. Clear every
    // source (incl. the ENTRA_* aliases) so this no-op assertion is deterministic on a box whose real
    // .env configures live email — otherwise the fallback keeps the config non-null (and the test
    // would proceed to use a real client secret).
    for (const k of [
      'GRAPH_TENANT_ID', 'ENTRA_TENANT_ID', 'GRAPH_CLIENT_ID', 'ENTRA_CLIENT_ID',
      'GRAPH_CLIENT_SECRET', 'ENTRA_CLIENT_SECRET', 'GRAPH_CERT_PATH',
      'GRAPH_SENDER_NOTIFY', 'GRAPH_SENDER_PAYROLL', 'GRAPH_SENDER_HR',
    ]) {
      delete process.env[k];
    }
    expect(graphMailerFromEnv()).toBeNull();
    Object.assign(process.env, saved);
  });
});

describe('senderAddress', () => {
  it('resolves a configured mailbox key', () => {
    expect(senderAddress(CFG, 'payroll')).toBe('payroll@e.edu.vn');
  });
  it('throws for an unconfigured mailbox', () => {
    const bad = { ...CFG, senders: { ...CFG.senders, hr: '' } };
    expect(() => senderAddress(bad, 'hr')).toThrow(/not configured/);
  });
});

describe('sendViaGraph', () => {
  it('POSTs to the sender mailbox and succeeds on 202', async () => {
    let calledUrl = '';
    let calledBody: any = null;
    const fetchImpl = (async (url: string, init: any) => {
      calledUrl = url;
      calledBody = JSON.parse(init.body);
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    await sendViaGraph(
      CFG,
      { mailbox: 'notify', to: 'a@b.com', subject: 'Hi', html: '<p>x</p>' },
      { getToken: fakeToken, fetchImpl },
    );
    expect(calledUrl).toContain('/users/erp-notify%40e.edu.vn/sendMail');
    expect(calledBody.message.toRecipients[0].emailAddress.address).toBe('a@b.com');
    expect(calledBody.saveToSentItems).toBe(false);
  });

  it('throws RateLimitError on 429 with Retry-After', async () => {
    const fetchImpl = (async () =>
      new Response('slow down', { status: 429, headers: { 'Retry-After': '42' } })) as unknown as typeof fetch;
    await expect(
      sendViaGraph(CFG, { mailbox: 'notify', to: 'a@b.com', subject: 's', html: 'h' }, { getToken: fakeToken, fetchImpl }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('throws a plain Error on other non-2xx', async () => {
    const fetchImpl = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    await expect(
      sendViaGraph(CFG, { mailbox: 'notify', to: 'a@b.com', subject: 's', html: 'h' }, { getToken: fakeToken, fetchImpl }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe('templates', () => {
  it('renders otp_login with the code in the body but NOT the subject (security: avoids leaking the OTP into inbox/notification previews)', () => {
    const r = renderTemplate('otp_login', { code: '123456', expiresMinutes: 5 });
    expect(r.subject).not.toContain('123456');
    expect(r.html).toContain('123456');
  });

  it('escapes HTML in user-supplied fields', () => {
    expect(esc('<script>')).toBe('&lt;script&gt;');
    const r = renderTemplate('payslip_ready', { displayName: '<b>x</b>', period: '2026-06' });
    expect(r.html).not.toContain('<b>x</b>');
    expect(r.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
