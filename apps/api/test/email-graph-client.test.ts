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
    delete process.env.GRAPH_TENANT_ID;
    delete process.env.GRAPH_CLIENT_ID;
    delete process.env.GRAPH_CERT_PATH;
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
  it('renders parent_welcome with subject + activation link', () => {
    const r = renderTemplate('parent_welcome', { parentName: 'Anh A', activationUrl: 'https://x/y?token=abc', expiresHours: 24 });
    expect(r.subject).toContain('Kích hoạt');
    expect(r.html).toContain('https://x/y?token=abc');
    expect(r.html).toContain('Anh A');
  });

  it('escapes HTML in user-supplied fields', () => {
    expect(esc('<script>')).toBe('&lt;script&gt;');
    const r = renderTemplate('payslip_ready', { displayName: '<b>x</b>', period: '2026-06' });
    expect(r.html).not.toContain('<b>x</b>');
    expect(r.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
