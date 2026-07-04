/**
 * Integration tests for employee code generation (CMC0001…, Plan B).
 *
 * Covers: assignment on first upsert (sequential, padded), immutability on
 * subsequent updates, atomicity under concurrent creation, the Phase 1
 * migration backfill invariant, and shiftRegistration.list display.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

const FACILITY_ID = 1;
const CODE_RE = /^CMC\d{4,}$/;

function saigonToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const TOMORROW = addDays(saigonToday(), 1);

describe('employee code generation & display (Plan B)', () => {
  const createdUserIds: string[] = [];
  const createdRegIds: string[] = [];
  // Snapshot of the already-coded profiles as they stood before this suite creates any new
  // ones — captured once at file load so the backfill assertions never race the "cấp mã mới"/
  // "atomic" tests below, and never hardcode a specific pre-existing count.
  const preExistingCodesPromise = withRls(SUPER, (tx) =>
    tx.employmentProfile.findMany({
      where: { employeeCode: { not: null } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { employeeCode: true },
    }),
  );

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.shiftRegistration.deleteMany({ where: { id: { in: createdRegIds } } }).catch(() => {});
      await tx.shiftRegistration.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await tx.employmentProfile.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await tx.appUser.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
    });
  });

  async function makeUser(prefix: string) {
    const u = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq(`${prefix}@cmc.test`),
          displayName: `Test ${prefix}`,
          passwordHash: 'dummy',
          roles: [Role.sale],
          primaryRole: Role.sale,
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY_ID }] },
        },
        select: { id: true },
      }),
    );
    createdUserIds.push(u.id);
    return u;
  }

  async function currentCounterSeq(): Promise<number> {
    const counter = await withRls(SUPER, (tx) => tx.employeeCodeCounter.findUnique({ where: { id: 1 } }));
    return counter?.lastSeq ?? 0;
  }

  describe('cấp mã mới', () => {
    it('assigns a code matching CMC#### on first upsert', async () => {
      const su = await staffCaller();
      const target = await makeUser('code-new');
      const profile = await su.payroll.profileUpsert({
        userId: target.id, facilityId: FACILITY_ID, position: 'sale', dependents: 0,
      });
      expect(profile.employeeCode).toMatch(CODE_RE);
    });

    it('two consecutive new profiles get adjacent, distinct codes', async () => {
      const su = await staffCaller();
      const startSeq = await currentCounterSeq();
      const first = await makeUser('code-seq-1');
      const second = await makeUser('code-seq-2');

      const p1 = await su.payroll.profileUpsert({
        userId: first.id, facilityId: FACILITY_ID, position: 'sale', dependents: 0,
      });
      const p2 = await su.payroll.profileUpsert({
        userId: second.id, facilityId: FACILITY_ID, position: 'sale', dependents: 0,
      });

      expect(p1.employeeCode).toBe(`CMC${String(startSeq + 1).padStart(4, '0')}`);
      expect(p2.employeeCode).toBe(`CMC${String(startSeq + 2).padStart(4, '0')}`);
      expect(p1.employeeCode).not.toBe(p2.employeeCode);
    });
  });

  describe('một lần / immutable', () => {
    it('does not change employeeCode on a subsequent update', async () => {
      const su = await staffCaller();
      const target = await makeUser('code-immutable');
      const created = await su.payroll.profileUpsert({
        userId: target.id, facilityId: FACILITY_ID, position: 'sale', dependents: 0,
      });
      expect(created.employeeCode).toMatch(CODE_RE);

      const updated = await su.payroll.profileUpsert({
        userId: target.id, facilityId: FACILITY_ID, position: 'sale_senior', dependents: 1,
      });
      expect(updated.employeeCode).toBe(created.employeeCode);
    });
  });

  describe('atomic / no collision', () => {
    it('two concurrent profileUpsert creates produce distinct codes, no unique-constraint violation', async () => {
      const su = await staffCaller();
      const a = await makeUser('code-atomic-a');
      const b = await makeUser('code-atomic-b');

      const [pa, pb] = await Promise.all([
        su.payroll.profileUpsert({ userId: a.id, facilityId: FACILITY_ID, position: 'sale', dependents: 0 }),
        su.payroll.profileUpsert({ userId: b.id, facilityId: FACILITY_ID, position: 'sale', dependents: 0 }),
      ]);

      expect(pa.employeeCode).toMatch(CODE_RE);
      expect(pb.employeeCode).toMatch(CODE_RE);
      expect(pa.employeeCode).not.toBe(pb.employeeCode);
    });
  });

  describe('backfill (Phase 1 migration)', () => {
    it('pre-existing backfilled profiles have unique, sequential CMC#### codes by createdAt/id order', async () => {
      const preExisting = await preExistingCodesPromise;
      expect(preExisting.length).toBeGreaterThan(0);

      const codes = preExisting.map((p) => p.employeeCode);
      const expected = Array.from({ length: codes.length }, (_, i) => `CMC${String(i + 1).padStart(4, '0')}`);
      expect(codes).toEqual(expected);
      expect(new Set(codes).size).toBe(codes.length);

      // Counter must have kept pace with (>=) the backfilled count — it will exceed this
      // once this suite's own new-profile tests have run, so only a lower bound is asserted.
      const seq = await currentCounterSeq();
      expect(seq).toBeGreaterThanOrEqual(preExisting.length);
    });
  });

  describe('display (shiftRegistration.list)', () => {
    it('surfaces user.employeeCode for a coded owner, and falls back gracefully without one', async () => {
      const su = await staffCaller();
      const group = await withRls(SUPER, (tx) =>
        tx.shiftGroup.upsert({
          where: { facilityId_code: { facilityId: FACILITY_ID, code: 'KINH_DOANH' } },
          update: {},
          create: { facilityId: FACILITY_ID, code: 'KINH_DOANH', name: 'Kinh doanh', selectionMode: 'SINGLE' },
        }),
      );
      const withProfile = await makeUser('code-display-with');
      const withoutProfile = await makeUser('code-display-without');
      const profile = await su.payroll.profileUpsert({
        userId: withProfile.id, facilityId: FACILITY_ID, position: 'sale', dependents: 0,
      });

      function callerFor(userId: string) {
        return staffCaller({ userId, roles: [Role.sale], primaryRole: Role.sale, isSuperAdmin: false, facilityIds: [FACILITY_ID] });
      }
      const regWith = await (await callerFor(withProfile.id)).shiftRegistration.create({
        facilityId: FACILITY_ID, fromDate: TOMORROW, toDate: TOMORROW,
      });
      createdRegIds.push(regWith.id);
      // withoutProfile has no EmploymentProfile, so shiftRegistration.create's onboarding guard
      // (unrelated to what's under test here) would reject it — insert the row directly to
      // isolate the list-query display/fallback behavior we actually want to verify.
      const regWithout = await withRls(SUPER, (tx) =>
        tx.shiftRegistration.create({
          data: {
            facilityId: FACILITY_ID, userId: withoutProfile.id,
            fromDate: new Date(TOMORROW), toDate: new Date(TOMORROW),
            status: 'draft', shiftGroupId: group.id,
          },
        }),
      );
      createdRegIds.push(regWithout.id);

      const list = await su.shiftRegistration.list({ facilityId: FACILITY_ID });
      const rowWith = list.find((r) => r.id === regWith.id);
      const rowWithout = list.find((r) => r.id === regWithout.id);

      expect(rowWith?.user?.employeeCode).toBe(profile.employeeCode);
      expect(() => rowWithout?.user?.employeeCode).not.toThrow();
      expect(rowWithout?.user?.employeeCode ?? null).toBeNull();
    });
  });
});
