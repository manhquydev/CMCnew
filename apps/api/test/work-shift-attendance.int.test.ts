import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role, type RequestSession } from '@cmc/auth';
import { appRouter } from '../src/routers/index.js';
import type { ApiContext } from '../src/context.js';
import { staffSession, withRls, SUPER, uniq } from './helpers.js';
import { ictDateKey } from '../src/lib/attendance-penalty.js';

const FACILITY_ID = 1;

function dateString(day: number): string {
  return `2099-01-${String(day).padStart(2, '0')}`;
}

async function caller(over: Partial<RequestSession>, ip = '127.0.0.1') {
  const session = await staffSession(over);
  const ctx: ApiContext = { c: {} as never, session, lms: null, ip };
  return appRouter.createCaller(ctx);
}

async function staff(role: Role, managerId?: string) {
  const user = await withRls(SUPER, (tx) =>
    tx.appUser.create({
      data: {
        email: uniq(`${role}@cmc.test`),
        displayName: `${role} test`,
        passwordHash: 'test',
        primaryRole: role,
        roles: [role],
        isActive: true,
        facilities: { create: [{ facilityId: FACILITY_ID }] },
      },
    }),
  );
  await withRls(SUPER, (tx) =>
    tx.employmentProfile.create({
      data: {
        facilityId: FACILITY_ID,
        userId: user.id,
        position: role,
        managerId,
      },
    }),
  );
  return user;
}

describe('work shift registration + punch attendance hardening', () => {
  let managerId: string;
  let otherManagerId: string;
  let saleId: string;
  let peerSaleId: string;
  let orphanSaleId: string;
  let punchTestId: string;
  let debounceTestId: string;
  let rejectTestId: string;
  let allDayTestId: string;
  let allDayTest2Id: string;
  let dayResetTestId: string;
  let kdTemplateId: string;
  let kdTemplate2Id: string;
  let gvTemplateId: string;
  const createdUserIds: string[] = [];
  const createdNetworkIds: string[] = [];

  beforeAll(async () => {
    const manager = await staff(Role.giam_doc_kinh_doanh);
    const otherManager = await staff(Role.giam_doc_kinh_doanh);
    const sale = await staff(Role.sale, manager.id);
    const peerSale = await staff(Role.sale, otherManager.id);
    const orphanSale = await staff(Role.sale);
    const punchTest = await staff(Role.sale, manager.id);
    const debounceTest = await staff(Role.sale, manager.id);
    const rejectTest = await staff(Role.sale, manager.id);
    const allDayTest = await staff(Role.sale, manager.id);
    const allDayTest2 = await staff(Role.sale, manager.id);
    const dayResetTest = await staff(Role.sale, manager.id);
    managerId = manager.id;
    otherManagerId = otherManager.id;
    saleId = sale.id;
    peerSaleId = peerSale.id;
    orphanSaleId = orphanSale.id;
    punchTestId = punchTest.id;
    debounceTestId = debounceTest.id;
    rejectTestId = rejectTest.id;
    allDayTestId = allDayTest.id;
    allDayTest2Id = allDayTest2.id;
    dayResetTestId = dayResetTest.id;
    createdUserIds.push(manager.id, otherManager.id, sale.id, peerSale.id, orphanSale.id, punchTest.id, debounceTest.id, rejectTest.id, allDayTest.id, allDayTest2.id, dayResetTest.id);

    const templates = await withRls(SUPER, async (tx) => {
      const kd = await tx.shiftGroup.upsert({
        where: { facilityId_code: { facilityId: FACILITY_ID, code: 'KINH_DOANH' } },
        update: { name: 'Kinh doanh', selectionMode: 'SINGLE' },
        create: { facilityId: FACILITY_ID, code: 'KINH_DOANH', name: 'Kinh doanh', selectionMode: 'SINGLE' },
      });
      const gv = await tx.shiftGroup.upsert({
        where: { facilityId_code: { facilityId: FACILITY_ID, code: 'GIAO_VIEN' } },
        update: { name: 'Giáo viên', selectionMode: 'MULTIPLE' },
        create: { facilityId: FACILITY_ID, code: 'GIAO_VIEN', name: 'Giáo viên', selectionMode: 'MULTIPLE' },
      });
      const kdTemplates = await tx.shiftTemplate.findMany({
        where: { shiftGroupId: kd.id, archivedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
      const kd1 = kdTemplates[0] ?? await tx.shiftTemplate.create({
        data: { facilityId: FACILITY_ID, shiftGroupId: kd.id, code: 'TEST_KD_1', name: 'Test KD 1', startTime: '22:00', endTime: '23:00', hours: 8 },
      });
      const kd2 = kdTemplates.find((template) => template.id !== kd1.id) ?? await tx.shiftTemplate.create({
        data: { facilityId: FACILITY_ID, shiftGroupId: kd.id, code: 'TEST_KD_2', name: 'Test KD 2', startTime: '23:00', endTime: '23:59', hours: 8 },
      });
      const gv1 = await tx.shiftTemplate.findFirst({
        where: { shiftGroupId: gv.id, archivedAt: null },
        orderBy: { sortOrder: 'asc' },
      }) ?? await tx.shiftTemplate.create({
        data: { facilityId: FACILITY_ID, shiftGroupId: gv.id, code: 'TEST_GV_1', name: 'Test GV 1', startTime: '21:30', endTime: '22:30', hours: 4 },
      });
      return { kd1, kd2, gv1 };
    });
    kdTemplateId = templates.kd1.id;
    kdTemplate2Id = templates.kd2.id;
    gvTemplateId = templates.gv1.id;
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.staffNotification.deleteMany({ where: { recipientId: { in: createdUserIds } } }).catch(() => {});
      await tx.timePunch.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await tx.shiftRegistration.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await tx.facilityNetwork.deleteMany({ where: { id: { in: createdNetworkIds } } }).catch(() => {});
      await tx.employmentProfile.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await tx.appUser.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
    });
  });

  it('scopes shift registrations to owner, assigned manager, or HR/super-admin', async () => {
    const employee = await caller({ userId: saleId, roles: [Role.sale], primaryRole: Role.sale, isSuperAdmin: false, facilityIds: [FACILITY_ID] });
    const manager = await caller({ userId: managerId, roles: [Role.giam_doc_kinh_doanh], primaryRole: Role.giam_doc_kinh_doanh, isSuperAdmin: false, facilityIds: [FACILITY_ID] });
    const peer = await caller({ userId: peerSaleId, roles: [Role.sale], primaryRole: Role.sale, isSuperAdmin: false, facilityIds: [FACILITY_ID] });

    const reg = await employee.shiftRegistration.create({ facilityId: FACILITY_ID, fromDate: dateString(1), toDate: dateString(1) });
    await employee.shiftRegistration.updateEntry({
      registrationId: reg.id,
      date: dateString(1),
      entries: [{ shiftTemplateId: kdTemplateId, type: 'work' }],
    });
    await employee.shiftRegistration.submit({ id: reg.id });

    expect((await manager.shiftRegistration.list({ facilityId: FACILITY_ID })).some((r) => r.id === reg.id)).toBe(true);
    expect((await peer.shiftRegistration.list({ facilityId: FACILITY_ID })).some((r) => r.id === reg.id)).toBe(false);
    await expect(peer.shiftRegistration.get({ id: reg.id })).rejects.toThrow();
  });

  it('validates date ranges, entry date bounds, and template group membership', async () => {
    const employee = await caller({ userId: peerSaleId, roles: [Role.sale], primaryRole: Role.sale, isSuperAdmin: false, facilityIds: [FACILITY_ID] });

    await expect(employee.shiftRegistration.create({
      facilityId: FACILITY_ID,
      fromDate: dateString(5),
      toDate: dateString(4),
    })).rejects.toThrow();

    const reg = await employee.shiftRegistration.create({ facilityId: FACILITY_ID, fromDate: dateString(6), toDate: dateString(6) });
    await expect(employee.shiftRegistration.updateEntry({
      registrationId: reg.id,
      date: dateString(7),
      entries: [{ shiftTemplateId: kdTemplateId, type: 'work' }],
    })).rejects.toThrow();
    await expect(employee.shiftRegistration.updateEntry({
      registrationId: reg.id,
      date: dateString(6),
      entries: [
        { shiftTemplateId: kdTemplateId, type: 'work' },
        { shiftTemplateId: kdTemplate2Id, type: 'work' },
      ],
    })).rejects.toThrow();
    await expect(employee.shiftRegistration.updateEntry({
      registrationId: reg.id,
      date: dateString(6),
      entries: [{ shiftTemplateId: gvTemplateId, type: 'work' }],
    })).rejects.toThrow();
  });

  it('allows director fallback approval and supersedes only overlapping approved registrations', async () => {
    const manager = await caller({ userId: managerId, roles: [Role.giam_doc_kinh_doanh], primaryRole: Role.giam_doc_kinh_doanh, isSuperAdmin: false, facilityIds: [FACILITY_ID] });
    const group = await withRls(SUPER, (tx) => tx.shiftGroup.findFirstOrThrow({ where: { facilityId: FACILITY_ID, code: 'KINH_DOANH' } }));

    const unresolved = await withRls(SUPER, (tx) =>
      tx.shiftRegistration.create({
        data: {
          facilityId: FACILITY_ID,
          userId: orphanSaleId,
          fromDate: new Date(dateString(10)),
          toDate: new Date(dateString(10)),
          status: 'submitted',
          shiftGroupId: group.id,
          managerId: null,
        },
      }),
    );
    expect((await manager.shiftRegistration.approve({ id: unresolved.id })).approvedById).toBe(managerId);

    const [overlapOld, nonOverlapOld, next] = await withRls(SUPER, (tx) =>
      Promise.all([
        tx.shiftRegistration.create({
          data: { facilityId: FACILITY_ID, userId: saleId, fromDate: new Date(dateString(12)), toDate: new Date(dateString(14)), status: 'approved', shiftGroupId: group.id, managerId },
        }),
        tx.shiftRegistration.create({
          data: { facilityId: FACILITY_ID, userId: saleId, fromDate: new Date(dateString(20)), toDate: new Date(dateString(21)), status: 'approved', shiftGroupId: group.id, managerId },
        }),
        tx.shiftRegistration.create({
          data: { facilityId: FACILITY_ID, userId: saleId, fromDate: new Date(dateString(13)), toDate: new Date(dateString(13)), status: 'submitted', shiftGroupId: group.id, managerId },
        }),
      ]),
    );
    await manager.shiftRegistration.approve({ id: next.id });
    const [overlapAfter, nonOverlapAfter] = await withRls(SUPER, (tx) =>
      Promise.all([
        tx.shiftRegistration.findUniqueOrThrow({ where: { id: overlapOld.id } }),
        tx.shiftRegistration.findUniqueOrThrow({ where: { id: nonOverlapOld.id } }),
      ]),
    );
    expect(overlapAfter.status).toBe('cancelled');
    expect(overlapAfter.supersededById).toBe(next.id);
    expect(nonOverlapAfter.status).toBe('approved');
  });

  it('outside-IP punch without a reason returns requiresReason and creates nothing', async () => {
    const employee = await caller({ userId: saleId, roles: [Role.sale], primaryRole: Role.sale, isSuperAdmin: false, facilityIds: [FACILITY_ID] }, '203.0.113.44');
    const result = await employee.checkInOut.punch();
    expect(result).toEqual({ requiresReason: true });
    const status = await employee.checkInOut.todayStatus();
    expect(status.status).toBe('not_punched');
  });

  it('queues a daily ticket for direct manager approval, attaches later punches silently, and scopes history', async () => {
    const employee = await caller({ userId: saleId, roles: [Role.sale], primaryRole: Role.sale, isSuperAdmin: false, facilityIds: [FACILITY_ID] }, '203.0.113.44');
    const manager = await caller({ userId: managerId, roles: [Role.giam_doc_kinh_doanh], primaryRole: Role.giam_doc_kinh_doanh, isSuperAdmin: false, facilityIds: [FACILITY_ID] });
    const otherManager = await caller({ userId: otherManagerId, roles: [Role.giam_doc_kinh_doanh], primaryRole: Role.giam_doc_kinh_doanh, isSuperAdmin: false, facilityIds: [FACILITY_ID] });
    const peer = await caller({ userId: peerSaleId, roles: [Role.sale], primaryRole: Role.sale, isSuperAdmin: false, facilityIds: [FACILITY_ID] });

    const punch = await employee.checkInOut.punch({ reason: 'Khách hàng gấp, làm việc tại nhà khách' });
    expect(punch.method).toBe('manual');

    // Second punch same day: no reason needed, attaches to the same ticket silently.
    await withRls(SUPER, (tx) => tx.timePunch.update({ where: { id: punch.id }, data: { timestamp: new Date(Date.now() - 60_000) } }));
    const secondPunch = await employee.checkInOut.punch();
    expect(secondPunch.method).toBe('manual');

    const pending = await manager.checkInOut.pendingManual({ facilityId: FACILITY_ID });
    const ticket = pending.find((t) => t.userId === saleId);
    expect(ticket).toBeTruthy();
    expect(ticket!.punchCount).toBe(2);
    expect((await otherManager.checkInOut.pendingManual({ facilityId: FACILITY_ID })).some((t) => t.id === ticket!.id)).toBe(false);

    await expect(peer.checkInOut.history({ userId: saleId, fromDate: '2020-01-01', toDate: '2099-12-31' })).rejects.toThrow();
    const managerView = await manager.checkInOut.history({ userId: saleId, fromDate: '2020-01-01', toDate: '2099-12-31' });
    const managerViewPunch = managerView.find((p) => p.id === punch.id);
    expect(managerViewPunch).toBeTruthy();
    expect(managerViewPunch!.ipAddress).toBe('203.0.113.44'); // manager view keeps IP for audit

    // Self-view: the employee's own history never includes ipAddress (privacy — M2).
    const selfView = await employee.checkInOut.history({ fromDate: '2020-01-01', toDate: '2099-12-31' });
    const selfViewPunch = selfView.find((p) => p.id === punch.id);
    expect(selfViewPunch).toBeTruthy();
    expect(selfViewPunch).not.toHaveProperty('ipAddress');

    // Self-approve / cross-manager approve both forbidden.
    await expect(employee.checkInOut.approveManual({ ticketId: ticket!.id })).rejects.toThrow();
    await expect(otherManager.checkInOut.approveManual({ ticketId: ticket!.id })).rejects.toThrow();

    const approved = await manager.checkInOut.approveManual({ ticketId: ticket!.id });
    expect(approved.status).toBe('approved');
    expect(approved.approvedById).toBe(managerId);

    const punchesAfter = await withRls(SUPER, (tx) =>
      tx.timePunch.findMany({ where: { id: { in: [punch.id, secondPunch.id] } } }),
    );
    expect(punchesAfter.every((p) => p.approvedAt !== null)).toBe(true);

    // A punch created AFTER approval auto-inherits the approval (no separate re-approval).
    await withRls(SUPER, (tx) => tx.timePunch.update({ where: { id: secondPunch.id }, data: { timestamp: new Date(Date.now() - 60_000) } }));
    const thirdPunch = await employee.checkInOut.punch();
    expect(thirdPunch.approvedAt).toBeTruthy();

    // Re-approving / rejecting an already-approved ticket a second time via approve is a no-op guard.
    await expect(manager.checkInOut.approveManual({ ticketId: ticket!.id })).rejects.toThrow();

    // Rejecting an ALREADY-APPROVED ticket un-stamps every one of its manual punches —
    // they must fall back out of payroll (approvedAt/approvedById cleared).
    const rejectedAfterApproval = await manager.checkInOut.rejectManual({ ticketId: ticket!.id });
    expect(rejectedAfterApproval.status).toBe('rejected');
    const punchesAfterReject = await withRls(SUPER, (tx) =>
      tx.timePunch.findMany({ where: { id: { in: [punch.id, secondPunch.id, thirdPunch.id] } } }),
    );
    expect(punchesAfterReject.every((p) => p.approvedAt === null && p.approvedById === null)).toBe(true);
  });

  it('rejects a ticket, un-stamps prior approval, and allows resubmission with a new reason', async () => {
    const employee = await caller({ userId: rejectTestId, roles: [Role.sale], primaryRole: Role.sale, isSuperAdmin: false, facilityIds: [FACILITY_ID] }, '203.0.113.55');
    const manager = await caller({ userId: managerId, roles: [Role.giam_doc_kinh_doanh], primaryRole: Role.giam_doc_kinh_doanh, isSuperAdmin: false, facilityIds: [FACILITY_ID] });

    const punch = await employee.checkInOut.punch({ reason: 'Đi công tác đối tác' });
    const pendingBefore = await manager.checkInOut.pendingManual({ facilityId: FACILITY_ID });
    const ticket = pendingBefore.find((t) => t.userId === rejectTestId)!;

    const rejected = await manager.checkInOut.rejectManual({ ticketId: ticket.id, note: 'Không hợp lệ' });
    expect(rejected.status).toBe('rejected');
    const punchAfterReject = await withRls(SUPER, (tx) => tx.timePunch.findUniqueOrThrow({ where: { id: punch.id } }));
    expect(punchAfterReject.approvedAt).toBeNull();

    // Same-day re-punch without a reason signals resubmit is required (backdate past debounce first).
    await withRls(SUPER, (tx) => tx.timePunch.update({ where: { id: punch.id }, data: { timestamp: new Date(Date.now() - 60_000) } }));
    const requiresResubmit = await employee.checkInOut.punch();
    expect(requiresResubmit).toEqual({ requiresReason: true, resubmit: true });

    const resubmitted = await employee.checkInOut.punch({ reason: 'Lý do mới: khách hàng khẩn cấp tại chi nhánh' });
    expect(resubmitted.method).toBe('manual');
    const pendingAfterResubmit = await manager.checkInOut.pendingManual({ facilityId: FACILITY_ID });
    expect(pendingAfterResubmit.some((t) => t.id === ticket.id)).toBe(true);

    await expect(manager.checkInOut.rejectManual({ ticketId: ticket.id })).resolves.toBeTruthy();
  });

  it('allows center manager to configure facility WiFi IP ranges through API', async () => {
    const manager = await caller({ userId: managerId, roles: [Role.giam_doc_kinh_doanh], primaryRole: Role.giam_doc_kinh_doanh, isSuperAdmin: false, facilityIds: [FACILITY_ID] });
    const created = await manager.facilityNetwork.create({
      facilityId: FACILITY_ID,
      ipAddress: `10.${process.pid % 200}.${Math.floor(performance.now()) % 200}.0/24`,
      label: 'Test WiFi',
    });
    createdNetworkIds.push(created.id);
    expect((await manager.facilityNetwork.list({ facilityId: FACILITY_ID })).some((n) => n.id === created.id)).toBe(true);
    await manager.facilityNetwork.delete({ id: created.id });
    const after = await withRls(SUPER, (tx) => tx.facilityNetwork.findUniqueOrThrow({ where: { id: created.id } }));
    expect(after.archivedAt).toBeTruthy();
  });

  it('auto-accepts punches from an allowed facility IP', async () => {
    const allowedIp = '198.51.100.7';
    const net = await withRls(SUPER, (tx) =>
      tx.facilityNetwork.create({ data: { facilityId: FACILITY_ID, ipAddress: '198.51.100.0/24', label: 'Test allowed net', isActive: true } }),
    );
    createdNetworkIds.push(net.id);

    const employee = await caller({ userId: punchTestId, roles: [Role.sale], primaryRole: Role.sale, isSuperAdmin: false, facilityIds: [FACILITY_ID] }, allowedIp);
    const punch = await employee.checkInOut.punch();
    expect(punch.method).toBe('ip');
    expect(punch.ipAllowed).toBe(true);

    const status = await employee.checkInOut.todayStatus();
    expect(status.status).toBe('checked_in');
    expect(status.checkIn?.method).toBe('ip');
  });

  it('rejects a second punch inside the debounce window but allows one once it is old enough', async () => {
    const employee = await caller({ userId: debounceTestId, roles: [Role.sale], primaryRole: Role.sale, isSuperAdmin: false, facilityIds: [FACILITY_ID] });
    const first = await employee.checkInOut.punch();

    // Called back-to-back — real elapsed time is far under the 5s debounce window —
    // must reject, not silently create a second row (the C2 double-punch race this guards).
    await expect(employee.checkInOut.punch()).rejects.toThrow();

    // Backdate the punch beyond the debounce window instead of sleeping the suite for
    // 5+ real seconds; timestamp is DB-server `now()` so faking the JS clock can't move it.
    await withRls(SUPER, (tx) =>
      tx.timePunch.update({ where: { id: first.id }, data: { timestamp: new Date(Date.now() - 60_000) } }),
    );
    const second = await employee.checkInOut.punch();
    expect(second.id).not.toBe(first.id);
  });

  it('debounce is 5s, not 30s: a punch backdated by 6s (would still be blocked under the old 30s window) succeeds', async () => {
    const employee = await caller({ userId: allDayTestId, roles: [Role.sale], primaryRole: Role.sale, isSuperAdmin: false, facilityIds: [FACILITY_ID] });
    const first = await employee.checkInOut.punch();
    await withRls(SUPER, (tx) =>
      tx.timePunch.update({ where: { id: first.id }, data: { timestamp: new Date(Date.now() - 6_000) } }),
    );
    const second = await employee.checkInOut.punch();
    expect(second.id).not.toBe(first.id);
  });

  it('allows punching more than twice a day; todayStatus always tracks (first, last) — no lock after checkout', async () => {
    const employee = await caller({ userId: allDayTest2Id, roles: [Role.sale], primaryRole: Role.sale, isSuperAdmin: false, facilityIds: [FACILITY_ID] });
    const backdate = (id: string, ms: number) =>
      withRls(SUPER, (tx) => tx.timePunch.update({ where: { id }, data: { timestamp: new Date(Date.now() - ms) } }));

    const first = await employee.checkInOut.punch();
    await backdate(first.id, 60_000);
    const second = await employee.checkInOut.punch(); // check-out
    await backdate(second.id, 60_000);
    const third = await employee.checkInOut.punch(); // 3rd punch same day — must succeed, no completed-lock
    await backdate(third.id, 60_000);
    const fourth = await employee.checkInOut.punch(); // 4th punch — still allowed

    const status = await employee.checkInOut.todayStatus();
    expect(status.status).toBe('completed');
    expect(status.checkIn?.id).toBe(first.id); // unchanged: first punch of the day
    expect(status.checkOut?.id).toBe(fourth.id); // updates to the latest punch each time
  });

  it('resets across the ICT day boundary: yesterday\'s punch/ticket never leak into today', async () => {
    const employee = await caller({ userId: dayResetTestId, roles: [Role.sale], primaryRole: Role.sale, isSuperAdmin: false, facilityIds: [FACILITY_ID] }, '203.0.113.77');
    const yesterdayTimestamp = new Date(Date.now() - 26 * 60 * 60 * 1000); // 26h ago — safely the prior ICT day
    const yesterdayDateKey = ictDateKey(yesterdayTimestamp);

    // Yesterday's leftovers: an old manual punch AND its (approved) daily ticket.
    await withRls(SUPER, (tx) =>
      tx.manualAttendanceTicket.create({
        data: { facilityId: FACILITY_ID, userId: dayResetTestId, dateKey: yesterdayDateKey, reason: 'yesterday-leftover', status: 'approved', approvedAt: yesterdayTimestamp },
      }),
    );
    await withRls(SUPER, (tx) =>
      tx.timePunch.create({
        data: { facilityId: FACILITY_ID, userId: dayResetTestId, ipAddress: '203.0.113.77', method: 'manual', timestamp: yesterdayTimestamp, approvedAt: yesterdayTimestamp },
      }),
    );

    // Today: todayStatus must not see yesterday's punch at all.
    const status = await employee.checkInOut.todayStatus();
    expect(status.status).toBe('not_punched');

    // Today: punching outside WiFi still requires a FRESH reason — yesterday's (approved)
    // ticket must not silently cover today (tickets are per ICT day, not per user).
    const result = await employee.checkInOut.punch();
    expect(result).toEqual({ requiresReason: true });
  });
});
