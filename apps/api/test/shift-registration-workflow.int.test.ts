import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

const FACILITY_ID = 1;

/** Today in Asia/Ho_Chi_Minh as 'YYYY-MM-DD' — mirrors saigonToday() in the router so
 * the future-date assertions don't go flaky around midnight or in a different-TZ CI runner. */
function saigonToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TODAY = saigonToday();
const YESTERDAY = addDays(TODAY, -1);
const TOMORROW = addDays(TODAY, 1);

describe('shift registration workflow (create-lock, future-date, updateDates, list)', () => {
  let groupId: string;
  let templateId: string;
  const createdUserIds: string[] = [];
  const createdRegIds: string[] = [];

  async function makeStaff(role: Role, managerId?: string) {
    const user = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq(`${role}@cmc.test`),
          displayName: `${role} workflow test`,
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
        data: { facilityId: FACILITY_ID, userId: user.id, position: role, managerId },
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  function callerFor(userId: string, role: Role) {
    return staffCaller({ userId, roles: [role], primaryRole: role, isSuperAdmin: false, facilityIds: [FACILITY_ID] });
  }

  beforeAll(async () => {
    const setup = await withRls(SUPER, async (tx) => {
      const group = await tx.shiftGroup.upsert({
        where: { facilityId_code: { facilityId: FACILITY_ID, code: 'KINH_DOANH' } },
        update: { name: 'Kinh doanh', selectionMode: 'SINGLE' },
        create: { facilityId: FACILITY_ID, code: 'KINH_DOANH', name: 'Kinh doanh', selectionMode: 'SINGLE' },
      });
      const template = await tx.shiftTemplate.findFirst({
        where: { shiftGroupId: group.id, archivedAt: null },
        orderBy: { sortOrder: 'asc' },
      }) ?? await tx.shiftTemplate.create({
        data: { facilityId: FACILITY_ID, shiftGroupId: group.id, code: 'WORKFLOW_TEST_1', name: 'Workflow Test 1', startTime: '20:00', endTime: '21:00', hours: 8 },
      });
      return { group, template };
    });
    groupId = setup.group.id;
    templateId = setup.template.id;
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.recordEvent.deleteMany({ where: { entityType: 'shift_registration', entityId: { in: createdRegIds } } }).catch(() => {});
      await tx.shiftRegistration.deleteMany({ where: { id: { in: createdRegIds } } }).catch(() => {});
      await tx.shiftRegistration.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await tx.employmentProfile.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await tx.appUser.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
    });
  });

  describe('create-lock', () => {
    it('blocks create when the user has a draft registration', async () => {
      const user = await makeStaff(Role.sale);
      const caller = await callerFor(user.id, Role.sale);
      const first = await caller.shiftRegistration.create({ facilityId: FACILITY_ID, fromDate: TOMORROW, toDate: TOMORROW });
      createdRegIds.push(first.id);

      await expect(
        caller.shiftRegistration.create({ facilityId: FACILITY_ID, fromDate: TOMORROW, toDate: TOMORROW }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('blocks create when the user has a submitted registration', async () => {
      const user = await makeStaff(Role.sale);
      const caller = await callerFor(user.id, Role.sale);
      const reg = await caller.shiftRegistration.create({ facilityId: FACILITY_ID, fromDate: TOMORROW, toDate: TOMORROW });
      createdRegIds.push(reg.id);
      await caller.shiftRegistration.updateEntry({
        registrationId: reg.id,
        date: TOMORROW,
        entries: [{ shiftTemplateId: templateId, type: 'work' }],
      });
      await caller.shiftRegistration.submit({ id: reg.id });

      await expect(
        caller.shiftRegistration.create({ facilityId: FACILITY_ID, fromDate: TOMORROW, toDate: TOMORROW }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('allows create when existing registrations are only approved/cancelled', async () => {
      const user = await makeStaff(Role.sale);
      const [approved, cancelled] = await withRls(SUPER, (tx) =>
        Promise.all([
          tx.shiftRegistration.create({
            data: { facilityId: FACILITY_ID, userId: user.id, fromDate: new Date(TOMORROW), toDate: new Date(TOMORROW), status: 'approved', shiftGroupId: groupId },
          }),
          tx.shiftRegistration.create({
            data: { facilityId: FACILITY_ID, userId: user.id, fromDate: new Date(TOMORROW), toDate: new Date(TOMORROW), status: 'cancelled', shiftGroupId: groupId },
          }),
        ]),
      );
      createdRegIds.push(approved.id, cancelled.id);

      const caller = await callerFor(user.id, Role.sale);
      const created = await caller.shiftRegistration.create({ facilityId: FACILITY_ID, fromDate: TOMORROW, toDate: TOMORROW });
      createdRegIds.push(created.id);
      expect(created.status).toBe('draft');
    });
  });

  describe('future-date guard', () => {
    it('rejects create with fromDate = today or in the past, accepts tomorrow', async () => {
      const user = await makeStaff(Role.sale);
      const caller = await callerFor(user.id, Role.sale);

      await expect(
        caller.shiftRegistration.create({ facilityId: FACILITY_ID, fromDate: TODAY, toDate: TODAY }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        caller.shiftRegistration.create({ facilityId: FACILITY_ID, fromDate: YESTERDAY, toDate: YESTERDAY }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      const created = await caller.shiftRegistration.create({ facilityId: FACILITY_ID, fromDate: TOMORROW, toDate: TOMORROW });
      createdRegIds.push(created.id);
      expect(created.status).toBe('draft');
    });

    it('rejects updateDates with fromDate = today or in the past, accepts tomorrow', async () => {
      const user = await makeStaff(Role.sale);
      const caller = await callerFor(user.id, Role.sale);
      const reg = await caller.shiftRegistration.create({ facilityId: FACILITY_ID, fromDate: TOMORROW, toDate: TOMORROW });
      createdRegIds.push(reg.id);

      await expect(
        caller.shiftRegistration.updateDates({ id: reg.id, fromDate: TODAY, toDate: TODAY }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        caller.shiftRegistration.updateDates({ id: reg.id, fromDate: YESTERDAY, toDate: YESTERDAY }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      const dayAfter = addDays(TOMORROW, 1);
      const updated = await caller.shiftRegistration.updateDates({ id: reg.id, fromDate: TOMORROW, toDate: dayAfter });
      expect(updated.toDate.toISOString().slice(0, 10)).toBe(dayAfter);
    });

    it('rejects submit when fromDate is today or in the past', async () => {
      const user = await makeStaff(Role.sale);
      const reg = await withRls(SUPER, (tx) =>
        tx.shiftRegistration.create({
          data: { facilityId: FACILITY_ID, userId: user.id, fromDate: new Date(TODAY), toDate: new Date(TODAY), status: 'draft', shiftGroupId: groupId },
        }),
      );
      createdRegIds.push(reg.id);
      await withRls(SUPER, (tx) =>
        tx.shiftRegistrationEntry.create({
          data: { registrationId: reg.id, date: new Date(TODAY), shiftTemplateId: templateId, type: 'work', hours: 8 },
        }),
      );

      const caller = await callerFor(user.id, Role.sale);
      await expect(caller.shiftRegistration.submit({ id: reg.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  describe('updateDates', () => {
    it('deletes out-of-range entries and keeps in-range ones, non-owner is FORBIDDEN, submitted is CONFLICT, audit is logged', async () => {
      const user = await makeStaff(Role.sale);
      const other = await makeStaff(Role.sale);
      const caller = await callerFor(user.id, Role.sale);
      const otherCaller = await callerFor(other.id, Role.sale);

      const from = TOMORROW;
      const to = addDays(TOMORROW, 5);
      const reg = await caller.shiftRegistration.create({ facilityId: FACILITY_ID, fromDate: from, toDate: to });
      createdRegIds.push(reg.id);

      const keepDate1 = addDays(TOMORROW, 1);
      const keepDate2 = addDays(TOMORROW, 2);
      const dropDate = addDays(TOMORROW, 5);
      await caller.shiftRegistration.updateEntry({ registrationId: reg.id, date: keepDate1, entries: [{ shiftTemplateId: templateId, type: 'work' }] });
      await caller.shiftRegistration.updateEntry({ registrationId: reg.id, date: keepDate2, entries: [{ shiftTemplateId: templateId, type: 'work' }] });
      await caller.shiftRegistration.updateEntry({ registrationId: reg.id, date: dropDate, entries: [{ shiftTemplateId: templateId, type: 'work' }] });

      const entriesBefore = await withRls(SUPER, (tx) => tx.shiftRegistrationEntry.count({ where: { registrationId: reg.id } }));
      expect(entriesBefore).toBe(3);

      // non-owner -> FORBIDDEN
      await expect(
        otherCaller.shiftRegistration.updateDates({ id: reg.id, fromDate: keepDate1, toDate: keepDate2 }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      // narrow the range: dropDate falls outside, keepDate1/keepDate2 stay in range
      const updated = await caller.shiftRegistration.updateDates({ id: reg.id, fromDate: keepDate1, toDate: keepDate2 });
      expect(updated.fromDate.toISOString().slice(0, 10)).toBe(keepDate1);
      expect(updated.toDate.toISOString().slice(0, 10)).toBe(keepDate2);

      const entriesAfter = await withRls(SUPER, (tx) =>
        tx.shiftRegistrationEntry.findMany({ where: { registrationId: reg.id }, select: { date: true } }),
      );
      expect(entriesAfter).toHaveLength(2);
      const remainingDates = entriesAfter.map((e) => e.date.toISOString().slice(0, 10)).sort();
      expect(remainingDates).toEqual([keepDate1, keepDate2].sort());

      // audit log recorded
      const events = await withRls(SUPER, (tx) =>
        tx.recordEvent.findMany({ where: { entityType: 'shift_registration', entityId: reg.id, type: 'updated' } }),
      );
      expect(events.length).toBeGreaterThanOrEqual(1);

      // submitted ticket -> CONFLICT
      await caller.shiftRegistration.submit({ id: reg.id });
      await expect(
        caller.shiftRegistration.updateDates({ id: reg.id, fromDate: keepDate1, toDate: keepDate1 }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('list include', () => {
    it('attaches owner user.displayName/email; manager sees others, plain staff sees only own', async () => {
      const manager = await makeStaff(Role.giam_doc_kinh_doanh);
      const employee = await makeStaff(Role.sale, manager.id);
      const peer = await makeStaff(Role.sale);

      const employeeCaller = await callerFor(employee.id, Role.sale);
      const peerCaller = await callerFor(peer.id, Role.sale);
      const managerCaller = await callerFor(manager.id, Role.giam_doc_kinh_doanh);

      const reg = await employeeCaller.shiftRegistration.create({ facilityId: FACILITY_ID, fromDate: TOMORROW, toDate: TOMORROW });
      createdRegIds.push(reg.id);

      const employeeList = await employeeCaller.shiftRegistration.list({ facilityId: FACILITY_ID });
      const own = employeeList.find((r) => r.id === reg.id);
      expect(own?.user?.displayName).toBe(employee.displayName);
      expect(own?.user?.email).toBe(employee.email);

      const managerList = await managerCaller.shiftRegistration.list({ facilityId: FACILITY_ID });
      expect(managerList.some((r) => r.id === reg.id)).toBe(true);

      const peerList = await peerCaller.shiftRegistration.list({ facilityId: FACILITY_ID });
      expect(peerList.some((r) => r.id === reg.id)).toBe(false);
    });
  });
});
