import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { withRls } from '@cmc/db';
import { enqueueEmail, runEmailOutbox } from '../src/services/email-outbox.js';
import { SUPER, uniq } from './helpers.js';

// Integration: real Postgres. Exercises the outbox enqueue/idempotency and the worker's send,
// rate-cap, 429-backoff and hard-fail paths with a mocked Graph sender (injected fetch/getToken).

const getToken = async () => 'tok';
function fetchReturning(status: number, headers: Record<string, string> = {}) {
  return (async () => new Response(null, { status, headers })) as unknown as typeof fetch;
}

// Set GRAPH_* so graphMailerFromEnv() is non-null inside the worker; sends are mocked via deps.
function withGraphEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved = { ...process.env };
  process.env.GRAPH_TENANT_ID = 't';
  process.env.GRAPH_CLIENT_ID = 'c';
  process.env.GRAPH_CERT_PATH = '/x.pem';
  process.env.GRAPH_SENDER_NOTIFY = 'erp-notify@e.edu.vn';
  process.env.GRAPH_SENDER_PAYROLL = 'payroll@e.edu.vn';
  process.env.GRAPH_SENDER_HR = 'hr@e.edu.vn';
  return fn().finally(() => {
    process.env = saved;
  });
}

const PREFIX = uniq('emailtest');
async function enqueue(dedup: string, mailbox: 'notify' | 'payroll' | 'hr' = 'notify') {
  await withRls(SUPER, (tx) =>
    enqueueEmail(tx, {
      dedupKey: `${PREFIX}:${dedup}`,
      to: 'a@b.com',
      mailbox,
      kind: 'password_reset',
      data: { resetUrl: 'https://x/r?token=1', expiresMinutes: 30 },
    }),
  );
}
async function rows() {
  return withRls(SUPER, (tx) => tx.emailOutbox.findMany({ where: { dedupKey: { startsWith: PREFIX } } }));
}

beforeEach(async () => {
  await withRls(SUPER, (tx) => tx.emailOutbox.deleteMany({ where: { dedupKey: { startsWith: PREFIX } } }));
});
afterAll(async () => {
  await withRls(SUPER, (tx) => tx.emailOutbox.deleteMany({ where: { dedupKey: { startsWith: PREFIX } } }));
});

describe('email outbox', () => {
  it('no-op when Graph unconfigured: rows stay queued, no throw', async () => {
    await enqueue('noop');
    const r = await runEmailOutbox(new Date()); // GRAPH_* not set here
    expect(r.disabled).toBe(true);
    expect(r.sent).toBe(0);
    expect((await rows())[0]?.status).toBe('queued');
  });

  it('enqueue is idempotent on dedupKey', async () => {
    await enqueue('dup');
    await enqueue('dup');
    expect((await rows()).length).toBe(1);
  });

  it('happy path: sends once and marks sent', async () => {
    await enqueue('ok');
    await withGraphEnv(() => runEmailOutbox(new Date(), { getToken, fetchImpl: fetchReturning(202) }));
    const all = await rows();
    expect(all[0].status).toBe('sent');
    expect(all[0].sentAt).not.toBeNull();
  });

  it('rate cap: one run sends at most 20', async () => {
    for (let i = 0; i < 25; i++) await enqueue(`bulk${i}`);
    const r = await withGraphEnv(() => runEmailOutbox(new Date(), { getToken, fetchImpl: fetchReturning(202) }));
    expect(r.sent).toBe(20);
    const remaining = (await rows()).filter((x) => x.status === 'queued').length;
    expect(remaining).toBe(5);
  });

  it('429: row returns to queued with a future schedule (no data loss)', async () => {
    await enqueue('throttled');
    const now = new Date();
    await withGraphEnv(() =>
      runEmailOutbox(now, { getToken, fetchImpl: fetchReturning(429, { 'Retry-After': '120' }) }),
    );
    const row = (await rows())[0];
    expect(row.status).toBe('queued');
    expect(row.scheduledFor.getTime()).toBeGreaterThan(now.getTime());
  });

  it('hard failure: ends failed after MAX_ATTEMPTS', async () => {
    await enqueue('broken');
    // Drive attempts to the cap by ticking past each backoff window.
    let now = new Date();
    for (let i = 0; i < 5; i++) {
      await withGraphEnv(() => runEmailOutbox(now, { getToken, fetchImpl: fetchReturning(500) }));
      now = new Date(now.getTime() + 31 * 60_000); // jump beyond the max backoff
    }
    expect((await rows())[0].status).toBe('failed');
  });
});
