import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant: schedule.mySessions cross-class agenda.
// - giao_vien sees only their own sessions within the facility + date range.
// - giam_doc_dao_tao sees all facility sessions (no teacher filter unless explicitly passed).
// - Date-range filter is respected on both sides of the range.
// - No cross-facility leak: querying facilityId=A never returns rows from facilityId=B.
describe('schedule.mySessions — cross-class agenda authz + filtering', () => {
  const FAC_A = 1; // HQ — seeded
  const FAC_B = 2; // CS2 — seeded

  let teacherAId: string;
  let teacherBId: string;
  let courseId: string;
  let batchAId: string;
  let batchBId: string;
  // Indexed: 0=s1(FA,A,03-03), 1=s2(FA,A,03-05), 2=s3(FA,B,03-04), 3=s4(FB,A,03-03)
  const sessionIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    // Two teachers for FAC_A
    const teacherA = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('sched-ta@cmc.test'),
          displayName: 'Sched Teacher A',
          passwordHash: 'dummy',
          primaryRole: 'giao_vien',
          roles: ['giao_vien'],
          isActive: true,
          facilities: { create: [{ facilityId: FAC_A }] },
        },
      }),
    );
    teacherAId = teacherA.id;
    userIds.push(teacherAId);

    const teacherB = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('sched-tb@cmc.test'),
          displayName: 'Sched Teacher B',
          passwordHash: 'dummy',
          primaryRole: 'giao_vien',
          roles: ['giao_vien'],
          isActive: true,
          facilities: { create: [{ facilityId: FAC_A }] },
        },
      }),
    );
    teacherBId = teacherB.id;
    userIds.push(teacherBId);

    // Shared course
    const course = await withRls(SUPER, (tx) =>
      tx.course.create({ data: { code: uniq('MSCHED'), name: 'MySessions Test Course', program: 'UCREA' } }),
    );
    courseId = course.id;

    // Batch in FAC_A
    batchAId = (
      await withRls(SUPER, (tx) =>
        tx.classBatch.create({
          data: { facilityId: FAC_A, code: uniq('MSA'), courseId, name: 'Batch FAC_A', status: 'running' },
        }),
      )
    ).id;

    // Batch in FAC_B (to test cross-facility isolation)
    batchBId = (
      await withRls(SUPER, (tx) =>
        tx.classBatch.create({
          data: { facilityId: FAC_B, code: uniq('MSB'), courseId, name: 'Batch FAC_B', status: 'running' },
        }),
      )
    ).id;

    // Helper to create a session
    const mkSession = (facilityId: number, batchId: string, date: string, teacherId: string | null) =>
      withRls(SUPER, (tx) =>
        tx.classSession.create({
          data: {
            facilityId,
            classBatchId: batchId,
            sessionDate: new Date(date),
            startTime: '18:00',
            endTime: '19:30',
            status: 'planned',
            teacherId,
          },
        }),
      );

    // s0: FAC_A, batch A, teacher A, 2099-03-03
    const s0 = await mkSession(FAC_A, batchAId, '2099-03-03', teacherAId);
    // s1: FAC_A, batch A, teacher A, 2099-03-05
    const s1 = await mkSession(FAC_A, batchAId, '2099-03-05', teacherAId);
    // s2: FAC_A, batch A, teacher B, 2099-03-04
    const s2 = await mkSession(FAC_A, batchAId, '2099-03-04', teacherBId);
    // s3: FAC_B, batch B, teacher A — must NOT appear in FAC_A queries
    const s3 = await mkSession(FAC_B, batchBId, '2099-03-03', teacherAId);
    sessionIds.push(s0.id, s1.id, s2.id, s3.id);
  });

  afterAll(async () => {
    // Delete sessions (cascade from batch also works, but explicit is safer under RLS)
    await withRls(SUPER, (tx) => tx.classSession.deleteMany({ where: { id: { in: sessionIds } } }));
    await withRls(SUPER, (tx) => tx.classBatch.deleteMany({ where: { id: { in: [batchAId, batchBId] } } }));
    await withRls(SUPER, (tx) => tx.course.deleteMany({ where: { id: courseId } }));
    // Cascade on AppUser deletes UserFacility rows
    await withRls(SUPER, (tx) => tx.appUser.deleteMany({ where: { id: { in: userIds } } }));
  });

  it('giao_vien sees only own sessions in the date range', async () => {
    const caller = await staffCaller({
      userId: teacherAId,
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FAC_A],
    });
    const rows = await caller.schedule.mySessions({
      facilityId: FAC_A,
      from: '2099-03-01',
      to: '2099-03-31',
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(sessionIds[0]); // teacher A session
    expect(ids).toContain(sessionIds[1]); // teacher A session
    expect(ids).not.toContain(sessionIds[2]); // teacher B session — invisible
    expect(ids).not.toContain(sessionIds[3]); // FAC_B session — invisible
    expect(rows.length).toBe(2);
    // Verify batch relation is included
    expect(rows[0].batch).toBeDefined();
    expect(rows[0].batch.code).toBeTruthy();
  });

  it('giam_doc_dao_tao sees all sessions in the facility when no teacherId filter', async () => {
    const caller = await staffCaller({
      userId: teacherAId, // any valid user; role determines behavior
      roles: [Role.giam_doc_dao_tao],
      primaryRole: Role.giam_doc_dao_tao,
      isSuperAdmin: false,
      facilityIds: [FAC_A],
    });
    const rows = await caller.schedule.mySessions({
      facilityId: FAC_A,
      from: '2099-03-01',
      to: '2099-03-31',
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(sessionIds[0]);
    expect(ids).toContain(sessionIds[1]);
    expect(ids).toContain(sessionIds[2]); // teacher B — visible to manager
    expect(ids).not.toContain(sessionIds[3]); // FAC_B — never visible
    expect(rows.length).toBe(3);
  });

  it('date-range filter is respected: sessions outside the range are excluded', async () => {
    const caller = await staffCaller({
      userId: teacherAId,
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FAC_A],
    });
    // Narrow to a single day that only s1 (2099-03-05) falls in
    const rows = await caller.schedule.mySessions({
      facilityId: FAC_A,
      from: '2099-03-05',
      to: '2099-03-05',
    });
    expect(rows.map((r) => r.id)).toEqual([sessionIds[1]]);
  });

  it('no cross-facility leak: giam_doc_dao_tao of FAC_A cannot see FAC_B sessions via mySessions', async () => {
    const caller = await staffCaller({
      userId: teacherAId,
      roles: [Role.giam_doc_dao_tao],
      primaryRole: Role.giam_doc_dao_tao,
      isSuperAdmin: false,
      facilityIds: [FAC_A],
    });
    const rows = await caller.schedule.mySessions({
      facilityId: FAC_A,
      from: '2099-03-01',
      to: '2099-03-31',
    });
    expect(rows.map((r) => r.id)).not.toContain(sessionIds[3]);
  });
});
