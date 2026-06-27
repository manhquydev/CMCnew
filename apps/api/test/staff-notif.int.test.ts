import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, superAdminUserId, uniq } from './helpers.js';

describe('staffNotif router — recipient isolation + idempotency', () => {
  const FAC_A = 1;
  const FAC_B = 2;

  let userAId: string;
  let userBId: string;
  const createdIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    userAId = await superAdminUserId();
    const userB = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('notif_user_b') + '@t.com',
          displayName: 'Notif Test B',
          passwordHash: 'x',
          isActive: true,
          primaryRole: 'giao_vien',
          roles: [],
          facilities: { create: [{ facilityId: FAC_A }] },
        },
      }),
    );
    userBId = userB.id;
    createdUserIds.push(userBId);
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      if (createdIds.length > 0) {
        await tx.staffNotification.deleteMany({ where: { id: { in: createdIds } } });
      }
      if (createdUserIds.length > 0) {
        await tx.appUser.deleteMany({ where: { id: { in: createdUserIds } } });
      }
    });
  });

  async function seedNotif(recipientId: string, facilityId: number, readAt?: Date) {
    const notif = await withRls(SUPER, (tx) =>
      tx.staffNotification.create({
        data: { recipientId, event: 'class_cancelled', title: 'T', body: 'B', facilityId, readAt },
      }),
    );
    createdIds.push(notif.id);
    return notif;
  }

  it('recipient isolation: staff A cannot read staff B notifications in same facility', async () => {
    const notifForB = await seedNotif(userBId, FAC_A);
    const callerA = await staffCaller({ userId: userAId });
    const list = await callerA.staffNotif.list({ facilityId: FAC_A });
    const found = list.find((n) => n.id === notifForB.id);
    expect(found).toBeUndefined();
  });

  it('facility isolation: staff A cannot read notifs belonging to facilityId=2', async () => {
    const notifFacB = await seedNotif(userAId, FAC_B);
    const callerA = await staffCaller({ userId: userAId });
    const list = await callerA.staffNotif.list({ facilityId: FAC_A });
    const found = list.find((n) => n.id === notifFacB.id);
    expect(found).toBeUndefined();
  });

  it('unreadCount returns correct count; drops to 0 after markAllRead', async () => {
    const n1 = await seedNotif(userAId, FAC_A);
    const n2 = await seedNotif(userAId, FAC_A);
    const callerA = await staffCaller({ userId: userAId });

    const count = await callerA.staffNotif.unreadCount({ facilityId: FAC_A });
    // At least 2 from this test (may be more from prior tests in same facility)
    expect(count).toBeGreaterThanOrEqual(2);

    await callerA.staffNotif.markAllRead({ facilityId: FAC_A });
    const after = await callerA.staffNotif.unreadCount({ facilityId: FAC_A });
    expect(after).toBe(0);

    // mark as already-read in tracker so afterAll cleanup still works
    void [n1, n2];
  });

  it('markAllRead idempotency: second call returns count:0, no error', async () => {
    const callerA = await staffCaller({ userId: userAId });
    const result = await callerA.staffNotif.markAllRead({ facilityId: FAC_A });
    expect(result.count).toBe(0);
  });

  it('markRead marks one; unreadCount drops by exactly 1', async () => {
    const n1 = await seedNotif(userAId, FAC_A);
    const n2 = await seedNotif(userAId, FAC_A);
    const callerA = await staffCaller({ userId: userAId });

    const before = await callerA.staffNotif.unreadCount({ facilityId: FAC_A });
    expect(before).toBeGreaterThanOrEqual(2);

    await callerA.staffNotif.markRead({ id: n1.id });
    const after = await callerA.staffNotif.unreadCount({ facilityId: FAC_A });
    expect(after).toBe(before - 1);

    // cleanup n2 via markAllRead so next test starts clean
    await callerA.staffNotif.markAllRead({ facilityId: FAC_A });
    void n2;
  });
});
