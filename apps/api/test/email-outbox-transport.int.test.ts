import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { withRls } from '@cmc/db';
import { enqueueEmail, runEmailOutbox } from '../src/services/email-outbox.js';
import { backfillEmailOutboxTransport } from '../backfill-email-outbox-transport.js';
import { SUPER, uniq } from './helpers.js';

// Integration: real Postgres. Exercises dual-transport routing, the no-op fix (one transport
// configured drains only its own rows), per-transport rate-limit isolation, and the migration
// backfill script's reclassification logic.

function fetchReturning(status: number, headers: Record<string, string> = {}) {
  return (async () => new Response(JSON.stringify({ messageId: 'm1' }), { status, headers })) as unknown as typeof fetch;
}
const getToken = async () => 'tok';

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    process.env = saved;
  });
}

const GRAPH_VARS = {
  GRAPH_TENANT_ID: 't',
  GRAPH_CLIENT_ID: 'c',
  GRAPH_CERT_PATH: '/x.pem',
  GRAPH_SENDER_NOTIFY: 'erp-notify@e.edu.vn',
  GRAPH_SENDER_PAYROLL: 'payroll@e.edu.vn',
  GRAPH_SENDER_HR: 'hr@e.edu.vn',
};
const FAKE_KEY = 'not-a-real-key'; // test fixture only, never a live credential
const BREVO_VARS = { BREVO_API_KEY: FAKE_KEY, BREVO_SENDER_EMAIL: 's@e.edu.vn', BREVO_SENDER_NAME: 'CMC' };
const UNSET_GRAPH = Object.fromEntries(
  [...Object.keys(GRAPH_VARS), 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET'].map((k) => [k, undefined]),
);
const UNSET_BREVO = Object.fromEntries(Object.keys(BREVO_VARS).map((k) => [k, undefined]));

const PREFIX = uniq('transporttest');
async function enqueue(dedup: string, to: string, staffDomain: string | undefined) {
  await withEnv({ STAFF_EMAIL_DOMAIN: staffDomain }, () =>
    withRls(SUPER, (tx) =>
      enqueueEmail(tx, {
        dedupKey: `${PREFIX}:${dedup}`,
        to,
        mailbox: 'notify',
        kind: 'account_security_alert',
        data: { action: 'test', at: '2026-06-26 00:00' },
      }),
    ),
  );
}
async function rows() {
  return withRls(SUPER, (tx) => tx.emailOutbox.findMany({ where: { dedupKey: { startsWith: PREFIX } } }));
}

beforeEach(async () => {
  await withRls(SUPER, (tx) => tx.emailOutbox.deleteMany({}));
});
afterAll(async () => {
  await withRls(SUPER, (tx) => tx.emailOutbox.deleteMany({}));
});

describe('decideTransport routing at enqueue time', () => {
  it('staff-domain recipient gets transport=graph; external gets transport=brevo', async () => {
    await enqueue('staff', 'teacher@cmcvn.edu.vn', 'cmcvn.edu.vn');
    await enqueue('parent', 'parent@gmail.com', 'cmcvn.edu.vn');
    const all = await rows();
    expect(all.find((r) => r.dedupKey.endsWith('staff'))?.transport).toBe('graph');
    expect(all.find((r) => r.dedupKey.endsWith('parent'))?.transport).toBe('brevo');
  });
});

describe('no-op fix: single-transport configuration drains only its own rows', () => {
  it('Brevo-only configured: brevo rows sent, graph rows stay queued (not failed)', async () => {
    await enqueue('g1', 'staff@cmcvn.edu.vn', 'cmcvn.edu.vn');
    await enqueue('b1', 'parent@gmail.com', 'cmcvn.edu.vn');
    const r = await withEnv({ ...UNSET_GRAPH, ...BREVO_VARS }, () =>
      runEmailOutbox(new Date(), { getToken, fetchImpl: fetchReturning(201) }),
    );
    expect(r.disabled).toBe(false);
    expect(r.sent).toBe(1);
    const all = await rows();
    expect(all.find((x) => x.transport === 'brevo')?.status).toBe('sent');
    expect(all.find((x) => x.transport === 'graph')?.status).toBe('queued');
  });

  it('Graph-only configured: graph rows sent, brevo rows stay queued (inverse)', async () => {
    await enqueue('g2', 'staff2@cmcvn.edu.vn', 'cmcvn.edu.vn');
    await enqueue('b2', 'parent2@gmail.com', 'cmcvn.edu.vn');
    const r = await withEnv({ ...GRAPH_VARS, ...UNSET_BREVO }, () =>
      runEmailOutbox(new Date(), { getToken, fetchImpl: fetchReturning(202) }),
    );
    expect(r.sent).toBe(1);
    const all = await rows();
    expect(all.find((x) => x.transport === 'graph')?.status).toBe('sent');
    expect(all.find((x) => x.transport === 'brevo')?.status).toBe('queued');
  });

  it('both unconfigured: worker no-ops (disabled:true), same as before this plan', async () => {
    await enqueue('none', 'anyone@cmcvn.edu.vn', 'cmcvn.edu.vn');
    const r = await withEnv({ ...UNSET_GRAPH, ...UNSET_BREVO }, () => runEmailOutbox(new Date()));
    expect(r.disabled).toBe(true);
  });
});

describe('per-transport rate-limit isolation', () => {
  it('a Brevo 429 reschedules only brevo-claimed rows; a concurrent graph row still sends', async () => {
    await enqueue('graph-ok', 'staff3@cmcvn.edu.vn', 'cmcvn.edu.vn');
    await enqueue('brevo-throttled', 'parent3@gmail.com', 'cmcvn.edu.vn');

    // Two different fetch behaviors per transport: Graph succeeds, Brevo 429s.
    const fetchImpl = (async (url: string) => {
      if (typeof url === 'string' && url.includes('brevo.com')) {
        return new Response('slow down', { status: 429, headers: { 'Retry-After': '99' } });
      }
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    const r = await withEnv({ ...GRAPH_VARS, ...BREVO_VARS }, () =>
      runEmailOutbox(new Date(), { getToken, fetchImpl }),
    );
    expect(r.sent).toBe(1); // the graph row
    expect(r.rescheduled).toBe(1); // the brevo row, backed off
    const all = await rows();
    expect(all.find((x) => x.transport === 'graph')?.status).toBe('sent');
    const brevoRow = all.find((x) => x.transport === 'brevo')!;
    expect(brevoRow.status).toBe('queued');
    expect(brevoRow.scheduledFor.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('migration backfill script (real implementation, not a duplicated copy)', () => {
  it('reclassifies an in-flight external row pinned to graph by the migration default, resets attempts', async () => {
    // Simulate a row created BEFORE this plan (transport defaulted to 'graph' by the migration),
    // already attempted against the broken Graph-external path.
    const row = await withRls(SUPER, (tx) =>
      tx.emailOutbox.create({
        data: {
          dedupKey: `${PREFIX}:preexisting`,
          toAddress: 'parent-preexisting@gmail.com',
          mailbox: 'notify',
          templateKind: 'account_security_alert',
          subject: 'x',
          bodyHtml: 'x',
          status: 'queued',
          transport: 'graph', // migration DEFAULT, not yet reclassified
          attempts: 3,
          lastError: 'Graph sendMail HTTP 550',
        },
      }),
    );

    const result = await withEnv({ STAFF_EMAIL_DOMAIN: 'cmcvn.edu.vn' }, () => backfillEmailOutboxTransport());
    expect(result.reclassified).toBeGreaterThanOrEqual(1);

    const after = await withRls(SUPER, (tx) => tx.emailOutbox.findUniqueOrThrow({ where: { id: row.id } }));
    expect(after.transport).toBe('brevo');
    expect(after.attempts).toBe(0);
    expect(after.lastError).toBeNull();
    await withRls(SUPER, (tx) => tx.emailOutbox.deleteMany({ where: { id: row.id } }));
  });

  it('leaves an already-correctly-classified row untouched (no unnecessary attempts reset)', async () => {
    const row = await withRls(SUPER, (tx) =>
      tx.emailOutbox.create({
        data: {
          dedupKey: `${PREFIX}:already-correct`,
          toAddress: 'staff-preexisting@cmcvn.edu.vn',
          mailbox: 'notify',
          templateKind: 'account_security_alert',
          subject: 'x',
          bodyHtml: 'x',
          status: 'queued',
          transport: 'graph',
          attempts: 2,
          lastError: 'transient network error',
        },
      }),
    );
    await withEnv({ STAFF_EMAIL_DOMAIN: 'cmcvn.edu.vn' }, () => backfillEmailOutboxTransport());
    const after = await withRls(SUPER, (tx) => tx.emailOutbox.findUniqueOrThrow({ where: { id: row.id } }));
    expect(after.transport).toBe('graph');
    expect(after.attempts).toBe(2); // untouched — not a reclassification target
    await withRls(SUPER, (tx) => tx.emailOutbox.deleteMany({ where: { id: row.id } }));
  });
});

describe('stale sending row survives transport de-configuration (Finding 13)', () => {
  it('a row stuck in "sending" for a since-de-configured transport is invisible to the claim query, not lost', async () => {
    // A row leased ('sending') by a transport that is no longer configured this tick — the claim
    // query only iterates `configured` transports, so this row is structurally unclaimable rather
    // than silently mis-sent or double-sent once its transport comes back.
    const staleSentAt = new Date(Date.now() - 10 * 60_000); // older than LEASE_MS (5 min)
    const row = await withRls(SUPER, (tx) =>
      tx.emailOutbox.create({
        data: {
          dedupKey: `${PREFIX}:stale-sending`,
          toAddress: 'parent-stale@gmail.com',
          mailbox: 'notify',
          templateKind: 'account_security_alert',
          subject: 'x',
          bodyHtml: 'x',
          status: 'sending',
          transport: 'brevo',
          scheduledFor: staleSentAt,
        },
      }),
    );

    // Brevo unconfigured this tick (Graph is) — the stale brevo row must not be touched.
    const r = await withEnv({ ...GRAPH_VARS, ...UNSET_BREVO }, () =>
      runEmailOutbox(new Date(), { getToken, fetchImpl: fetchReturning(202) }),
    );
    expect(r.sent).toBe(0); // nothing configured for graph to send in this test (no graph rows enqueued)

    const after = await withRls(SUPER, (tx) => tx.emailOutbox.findUniqueOrThrow({ where: { id: row.id } }));
    expect(after.status).toBe('sending'); // untouched, not reclaimed, not lost
    await withRls(SUPER, (tx) => tx.emailOutbox.deleteMany({ where: { id: row.id } }));
  });
});
