import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant (decision 0010): Callio call sync counts a "valid" KPI call as outbound AND
// billDuration > 5s, maps each extension to a staff member via EmploymentProfile.callioExt, and
// freezes the tally in a CallMetric snapshot (idempotent per user+period). Token unset → no-op.
// The dialer is mocked (vi.stubGlobal fetch) so the rule is proven without a live Phonenet.
describe('Callio call-metrics sync (decision 0010)', () => {
  const FACILITY = 1;
  const PERIOD = '2099-03';
  const EXT = '99001';
  let employeeId: string;

  // 3 outbound + 1 inbound for our ext: only the two outbound >5s are valid (7s, 9s).
  const CDR_PAGE = {
    docs: [
      { direction: 'outbound', billDuration: 7, fromExt: EXT, startTime: 4083436800000 },
      { direction: 'outbound', billDuration: 3, fromExt: EXT, startTime: 4083436800000 }, // too short
      { direction: 'outbound', billDuration: 9, fromExt: EXT, startTime: 4083436800000 },
      { direction: 'inbound', billDuration: 40, fromExt: EXT, startTime: 4083436800000 }, // inbound
      { direction: 'outbound', billDuration: 12, fromExt: '88002', startTime: 4083436800000 }, // other ext
    ],
    hasNextPage: false,
  };

  beforeAll(async () => {
    const sellerEmail = uniq('callio-seller@cmc.test');
    const u = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: sellerEmail, displayName: 'Callio Seller', passwordHash: 'dummy',
          primaryRole: 'sale', roles: ['sale'], isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      }),
    );
    employeeId = u.id;
    const caller = await staffCaller();
    await caller.payroll.profileUpsert({ userId: employeeId, facilityId: FACILITY, position: 'sales', callioExt: EXT, dependents: 0 });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    delete process.env.CALLIO_API_BASE;
    delete process.env.CALLIO_API_TOKEN;
    await withRls(SUPER, async (tx) => {
      await tx.callMetric.deleteMany({ where: { userId: employeeId } });
      await tx.employmentProfile.deleteMany({ where: { userId: employeeId } });
      await tx.appUser.deleteMany({ where: { id: employeeId } });
    });
  });

  it('no-op when Callio is not configured (no token)', async () => {
    delete process.env.CALLIO_API_BASE;
    delete process.env.CALLIO_API_TOKEN;
    const caller = await staffCaller();
    const res = await caller.payroll.syncCallMetrics({ facilityId: FACILITY, periodKey: PERIOD });
    expect(res.synced).toBe(0);
    expect(res.skipped).toBe('callio-not-configured');
  });

  it('counts only outbound calls > 5s talk and snapshots per user', async () => {
    process.env.CALLIO_API_BASE = 'https://callio.test';
    process.env.CALLIO_API_TOKEN = 'test-token';
    // Mock the dialer: return our fixed CDR page, then signal no more pages.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(CDR_PAGE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const caller = await staffCaller();
    const res = await caller.payroll.syncCallMetrics({ facilityId: FACILITY, periodKey: PERIOD });
    expect(res.synced).toBe(1);

    const metric = await withRls(SUPER, (tx) =>
      tx.callMetric.findUniqueOrThrow({ where: { userId_periodKey: { userId: employeeId, periodKey: PERIOD } } }),
    );
    expect(metric.validCalls).toBe(2); // 7s + 9s outbound
    expect(metric.totalCalls).toBe(4); // all records for our ext (excludes the other ext)
    expect(metric.totalTalkSec).toBe(16); // 7 + 9
  });

  it('re-sync is idempotent (one row per user+period, refreshed)', async () => {
    process.env.CALLIO_API_BASE = 'https://callio.test';
    process.env.CALLIO_API_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(CDR_PAGE), { status: 200 })));

    const caller = await staffCaller();
    await caller.payroll.syncCallMetrics({ facilityId: FACILITY, periodKey: PERIOD });
    const rows = await withRls(SUPER, (tx) => tx.callMetric.findMany({ where: { userId: employeeId, periodKey: PERIOD } }));
    expect(rows.length).toBe(1);
    expect(rows[0]?.validCalls).toBe(2);
  });
});
