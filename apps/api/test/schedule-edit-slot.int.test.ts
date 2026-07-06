import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { Role } from '@cmc/auth';
import { seedCurriculum, courseCode, defaultCsvPath } from '@cmc/db/seed-curriculum';
import { staffCaller, withRls, SUPER, uniq, prisma } from './helpers.js';

/** A Tuesday safely in the past — used to prove editSlot(applyToFuture) never touches it. */
const PAST_TUESDAY = '2020-01-07';
/** Far-future Tuesdays (dow=2), one per week, verified via enumerateSessions-style math. */
const FUTURE_TUESDAYS = ['2095-01-04', '2095-01-11', '2095-01-18', '2095-01-25'];

describe('schedule.editSlot', () => {
  const FAC = 1;
  const FAC2 = 2;
  let courseId: string; // fresh course, no curriculum — isolates non-curriculum scenarios
  let roomId: string;
  let room2Id: string;
  let teacherId: string;
  let teacher2Id: string; // second FAC1 teacher — for reassignment scenarios
  let teacherFac2Id: string; // FAC2-only teacher — for the facility-guard rejection

  const batchIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const [course, room1, room2, t1, t2, t3] = await withRls(SUPER, async (tx) =>
      Promise.all([
        tx.course.create({ data: { code: uniq('SES-CRS'), name: 'Edit Slot Course', program: 'UCREA' } }),
        tx.room.create({ data: { facilityId: FAC, code: uniq('SES-R'), name: 'Edit Slot Room FAC1' } }),
        tx.room.create({ data: { facilityId: FAC2, code: uniq('SES-R2'), name: 'Edit Slot Room FAC2' } }),
        tx.appUser.create({
          data: {
            email: uniq('ses-t1@cmc.test'),
            displayName: 'SES Teacher 1',
            passwordHash: 'dummy',
            primaryRole: 'giao_vien',
            roles: ['giao_vien'],
            isActive: true,
            facilities: { create: [{ facilityId: FAC }] },
          },
        }),
        tx.appUser.create({
          data: {
            email: uniq('ses-t2@cmc.test'),
            displayName: 'SES Teacher 2',
            passwordHash: 'dummy',
            primaryRole: 'giao_vien',
            roles: ['giao_vien'],
            isActive: true,
            facilities: { create: [{ facilityId: FAC }] },
          },
        }),
        tx.appUser.create({
          data: {
            email: uniq('ses-t3@cmc.test'),
            displayName: 'SES Teacher 3 (FAC2 only)',
            passwordHash: 'dummy',
            primaryRole: 'giao_vien',
            roles: ['giao_vien'],
            isActive: true,
            facilities: { create: [{ facilityId: FAC2 }] },
          },
        }),
      ]),
    );
    courseId = course.id;
    roomId = room1.id;
    room2Id = room2.id;
    teacherId = t1.id;
    teacher2Id = t2.id;
    teacherFac2Id = t3.id;
    userIds.push(t1.id, t2.id, t3.id);
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.classSession.deleteMany({ where: { classBatchId: { in: batchIds } } });
      await tx.scheduleSlot.deleteMany({ where: { classBatchId: { in: batchIds } } });
      await tx.classBatch.deleteMany({ where: { id: { in: batchIds } } });
      await tx.room.deleteMany({ where: { id: { in: [roomId, room2Id] } } }).catch(() => {});
      await tx.appUser.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
      await tx.course.delete({ where: { id: courseId } }).catch(() => {});
    });
  });

  async function makeBatch(code: string, useCourseId = courseId) {
    const batch = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: { facilityId: FAC, code: uniq(code), courseId: useCourseId, name: `Edit slot ${code}`, status: 'running' },
      }),
    );
    batchIds.push(batch.id);
    return batch;
  }
  async function makeSlot(batchId: string, over: Partial<{ dayOfWeek: number; startTime: string; endTime: string; roomId: string | null; teacherId: string | null }> = {}) {
    return withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: {
          facilityId: FAC,
          classBatchId: batchId,
          dayOfWeek: 2,
          startTime: '18:00',
          endTime: '19:00',
          ...over,
        },
      }),
    );
  }
  async function makeSession(
    batchId: string,
    sessionDate: string,
    over: Partial<{ startTime: string; endTime: string; roomId: string | null; teacherId: string | null }> = {},
  ) {
    return withRls(SUPER, (tx) =>
      tx.classSession.create({
        data: {
          facilityId: FAC,
          classBatchId: batchId,
          sessionDate: new Date(sessionDate),
          startTime: '18:00',
          endTime: '19:00',
          status: 'planned',
          ...over,
        },
      }),
    );
  }

  it('without applyToFuture: only the template changes — already-generated sessions keep their old teacher', async () => {
    const batch = await makeBatch('ESL-NOAPPLY');
    const slot = await makeSlot(batch.id, { teacherId });
    const session = await makeSession(batch.id, FUTURE_TUESDAYS[0]!, { teacherId });

    const caller = await staffCaller();
    const res = await caller.schedule.editSlot({ slotId: slot.id, teacherId: teacher2Id });
    expect(res.movedSessions).toBe(0);

    const updatedSlot = await withRls(SUPER, (tx) => tx.scheduleSlot.findUniqueOrThrow({ where: { id: slot.id } }));
    expect(updatedSlot.teacherId).toBe(teacher2Id);
    const untouchedSession = await withRls(SUPER, (tx) => tx.classSession.findUniqueOrThrow({ where: { id: session.id } }));
    expect(untouchedSession.teacherId).toBe(teacherId); // unchanged

    const events = await withRls(SUPER, (tx) =>
      tx.recordEvent.findMany({ where: { entityType: 'class_batch', entityId: batch.id, type: 'updated' } }),
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it('applyToFuture=true: future sessions update, the past session is left untouched', async () => {
    const batch = await makeBatch('ESL-APPLY');
    const slot = await makeSlot(batch.id);
    const past = await makeSession(batch.id, PAST_TUESDAY);
    const futures = await Promise.all(FUTURE_TUESDAYS.map((d) => makeSession(batch.id, d)));

    const caller = await staffCaller();
    const res = await caller.schedule.editSlot({
      slotId: slot.id,
      startTime: '19:00',
      endTime: '20:00',
      applyToFuture: true,
    });
    expect(res.movedSessions).toBe(4);

    const pastAfter = await withRls(SUPER, (tx) => tx.classSession.findUniqueOrThrow({ where: { id: past.id } }));
    expect(pastAfter.startTime).toBe('18:00'); // untouched — it's in the past

    const futuresAfter = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({ where: { id: { in: futures.map((f) => f.id) } } }),
    );
    expect(futuresAfter.every((s) => s.startTime === '19:00' && s.endTime === '20:00')).toBe(true);
  });

  it('changing dayOfWeek shifts matched future sessions to the corresponding weekday', async () => {
    const batch = await makeBatch('ESL-DOW');
    const slot = await makeSlot(batch.id);
    const s1 = await makeSession(batch.id, FUTURE_TUESDAYS[0]!);
    const s2 = await makeSession(batch.id, FUTURE_TUESDAYS[1]!);

    const caller = await staffCaller();
    // Tuesday(2) → Friday(5): +3 days.
    await caller.schedule.editSlot({ slotId: slot.id, dayOfWeek: 5, applyToFuture: true });

    const after = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({ where: { id: { in: [s1.id, s2.id] } }, orderBy: { sessionDate: 'asc' } }),
    );
    expect(after.every((s) => s.sessionDate.getUTCDay() === 5)).toBe(true);
    expect(after[0]!.sessionDate.toISOString().slice(0, 10)).toBe('2095-01-07');
    expect(after[1]!.sessionDate.toISOString().slice(0, 10)).toBe('2095-01-14');
  });

  it('recompute keeps the curriculum mapping correct after a reorder-eligible edit', async () => {
    await seedCurriculum(prisma, readFileSync(defaultCsvPath(), 'utf8'));
    const ucreaL1 = await withRls(SUPER, (tx) =>
      tx.course.findUniqueOrThrow({ where: { code: courseCode('UCREA', 'L1') } }),
    );
    const unit1 = await withRls(SUPER, (tx) =>
      tx.curriculumUnit.findFirstOrThrow({ where: { courseId: ucreaL1.id }, orderBy: { orderGlobal: 'asc' } }),
    );
    const batch = await makeBatch('ESL-CURR', ucreaL1.id);
    const slot = await makeSlot(batch.id, { startTime: '08:00', endTime: '09:00' });
    const caller = await staffCaller();
    await caller.schedule.generateSessions({
      classBatchId: batch.id,
      startDate: FUTURE_TUESDAYS[0]!,
      endDate: FUTURE_TUESDAYS[3]!,
    });
    const before = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({ where: { classBatchId: batch.id }, orderBy: { sessionDate: 'asc' } }),
    );
    expect(before).toHaveLength(4);
    expect(before.every((s) => s.curriculumUnitId === unit1.id)).toBe(true);

    await caller.schedule.editSlot({ slotId: slot.id, startTime: '09:00', endTime: '10:00', applyToFuture: true });

    const after = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({ where: { classBatchId: batch.id }, orderBy: { sessionDate: 'asc' } }),
    );
    // Uniform time shift doesn't change relative chronological order → mapping stays intact.
    expect(after.every((s) => s.curriculumUnitId === unit1.id)).toBe(true);
    expect(after.every((s) => s.startTime === '09:00')).toBe(true);
  });

  it('cross-class scoping: editing batch A applyToFuture does not touch batch B (red-team #5)', async () => {
    const batchA = await makeBatch('ESL-CROSS-A');
    const batchB = await makeBatch('ESL-CROSS-B');
    const slotA = await makeSlot(batchA.id);
    await makeSlot(batchB.id);
    const sessionA = await makeSession(batchA.id, FUTURE_TUESDAYS[0]!);
    const sessionB = await makeSession(batchB.id, FUTURE_TUESDAYS[0]!);

    const caller = await staffCaller();
    await caller.schedule.editSlot({ slotId: slotA.id, startTime: '20:00', endTime: '21:00', applyToFuture: true });

    const aAfter = await withRls(SUPER, (tx) => tx.classSession.findUniqueOrThrow({ where: { id: sessionA.id } }));
    const bAfter = await withRls(SUPER, (tx) => tx.classSession.findUniqueOrThrow({ where: { id: sessionB.id } }));
    expect(aAfter.startTime).toBe('20:00');
    expect(bAfter.startTime).toBe('18:00'); // batch B untouched
  });

  it('unique-key collision within the same batch throws CONFLICT and rolls back (red-team #6)', async () => {
    const batch = await makeBatch('ESL-UNIQUE');
    const slot = await makeSlot(batch.id);
    const moving = await makeSession(batch.id, FUTURE_TUESDAYS[0]!, { startTime: '18:00' });
    // Another already-generated session occupying the exact slot this edit wants to move into.
    await makeSession(batch.id, FUTURE_TUESDAYS[0]!, { startTime: '19:00' });

    const caller = await staffCaller();
    await expect(
      caller.schedule.editSlot({ slotId: slot.id, startTime: '19:00', endTime: '20:00', applyToFuture: true }),
    ).rejects.toThrow();

    const unchanged = await withRls(SUPER, (tx) => tx.classSession.findUniqueOrThrow({ where: { id: moving.id } }));
    expect(unchanged.startTime).toBe('18:00'); // no partial update
  });

  it('room conflict against another batch throws CONFLICT and rolls back', async () => {
    const batch = await makeBatch('ESL-ROOMCONF');
    const slot = await makeSlot(batch.id, { roomId });
    const moving = await makeSession(batch.id, FUTURE_TUESDAYS[2]!, { startTime: '18:00', roomId });

    const otherBatch = await makeBatch('ESL-ROOMCONF-OTHER');
    await makeSession(otherBatch.id, FUTURE_TUESDAYS[2]!, { startTime: '19:30', endTime: '20:30', roomId });

    const caller = await staffCaller();
    await expect(
      caller.schedule.editSlot({ slotId: slot.id, startTime: '19:00', endTime: '20:00', applyToFuture: true }),
    ).rejects.toThrow();

    const unchanged = await withRls(SUPER, (tx) => tx.classSession.findUniqueOrThrow({ where: { id: moving.id } }));
    expect(unchanged.startTime).toBe('18:00');
  });

  it('rejects a cross-facility room/teacher ref (facility guard)', async () => {
    const batch = await makeBatch('ESL-FACGUARD');
    const slot = await makeSlot(batch.id);
    const caller = await staffCaller();

    await expect(caller.schedule.editSlot({ slotId: slot.id, roomId: room2Id })).rejects.toThrow();
    await expect(caller.schedule.editSlot({ slotId: slot.id, teacherId: teacherFac2Id })).rejects.toThrow();

    const unchanged = await withRls(SUPER, (tx) => tx.scheduleSlot.findUniqueOrThrow({ where: { id: slot.id } }));
    expect(unchanged.roomId).toBeNull();
  });

  it('rejects giao_vien / sale from calling editSlot (authz-deny, red-team #7)', async () => {
    const batch = await makeBatch('ESL-AUTHZ');
    const slot = await makeSlot(batch.id);

    const teacher = await staffCaller({ primaryRole: Role.giao_vien, roles: [Role.giao_vien], isSuperAdmin: false, facilityIds: [FAC] });
    await expect(teacher.schedule.editSlot({ slotId: slot.id, teacherId: teacher2Id })).rejects.toThrow();

    const sale = await staffCaller({ primaryRole: Role.sale, roles: [Role.sale], isSuperAdmin: false, facilityIds: [FAC] });
    await expect(sale.schedule.editSlot({ slotId: slot.id, teacherId: teacher2Id })).rejects.toThrow();

    const unchanged = await withRls(SUPER, (tx) => tx.scheduleSlot.findUniqueOrThrow({ where: { id: slot.id } }));
    expect(unchanged.teacherId).toBeNull();
  });
});
