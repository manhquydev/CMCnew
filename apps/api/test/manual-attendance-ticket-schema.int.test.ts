import { describe, it, expect } from 'vitest';
import { withRls, SUPER, uniq } from './helpers.js';

const FACILITY_A = 1;
const FACILITY_B = 2;

async function fakeUserId() {
  // FK-less table (no relation to app_user) — any UUID works for schema-level tests.
  return crypto.randomUUID();
}

describe('manual_attendance_ticket schema — unique(userId,dateKey) + RLS', () => {
  it('rejects a second ticket for the same user + dateKey', async () => {
    const userId = await fakeUserId();
    const dateKey = '2099-02-01';
    await withRls(SUPER, (tx) =>
      tx.manualAttendanceTicket.create({
        data: { facilityId: FACILITY_A, userId, dateKey, reason: uniq('reason') },
      }),
    );
    await expect(
      withRls(SUPER, (tx) =>
        tx.manualAttendanceTicket.create({
          data: { facilityId: FACILITY_A, userId, dateKey, reason: uniq('reason-again') },
        }),
      ),
    ).rejects.toThrow();
  });

  it('allows the same user to have tickets on different days', async () => {
    const userId = await fakeUserId();
    await withRls(SUPER, (tx) =>
      tx.manualAttendanceTicket.create({
        data: { facilityId: FACILITY_A, userId, dateKey: '2099-02-02', reason: uniq('r') },
      }),
    );
    const second = await withRls(SUPER, (tx) =>
      tx.manualAttendanceTicket.create({
        data: { facilityId: FACILITY_A, userId, dateKey: '2099-02-03', reason: uniq('r') },
      }),
    );
    expect(second.dateKey).toBe('2099-02-03');
  });

  it('RLS: staff at facility A cannot read a ticket created at facility B', async () => {
    const userId = await fakeUserId();
    const ticket = await withRls(SUPER, (tx) =>
      tx.manualAttendanceTicket.create({
        data: { facilityId: FACILITY_B, userId, dateKey: '2099-02-04', reason: uniq('r') },
      }),
    );
    const seenByA = await withRls({ facilityIds: [FACILITY_A], isSuperAdmin: false }, (tx) =>
      tx.manualAttendanceTicket.findMany({ where: { id: ticket.id } }),
    );
    expect(seenByA).toHaveLength(0);

    const seenByB = await withRls({ facilityIds: [FACILITY_B], isSuperAdmin: false }, (tx) =>
      tx.manualAttendanceTicket.findMany({ where: { id: ticket.id } }),
    );
    expect(seenByB).toHaveLength(1);

    const seenBySuper = await withRls(SUPER, (tx) =>
      tx.manualAttendanceTicket.findMany({ where: { id: ticket.id } }),
    );
    expect(seenBySuper).toHaveLength(1);
  });
});
