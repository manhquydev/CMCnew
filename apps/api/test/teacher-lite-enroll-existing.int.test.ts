import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

const FACILITY = 1;
const OTHER_FACILITY = 2;

describe('Teacher Lite enroll existing student', () => {
  const cleanup = {
    courseIds: [] as string[],
    batchIds: [] as string[],
    studentIds: [] as string[],
  };
  let dbReachable = false;

  beforeAll(async () => {
    try {
      await superAdminUserId();
      dbReachable = true;
    } catch {
      console.warn('DB not reachable - Teacher Lite enroll existing tests skipped');
    }
  });

  afterAll(async () => {
    if (!dbReachable) return;
    await withRls(SUPER, async (tx) => {
      if (cleanup.studentIds.length) {
        await tx.enrollment.deleteMany({ where: { studentId: { in: cleanup.studentIds } } });
        await tx.recordEvent.deleteMany({ where: { entityId: { in: cleanup.studentIds } } });
        await tx.student.deleteMany({ where: { id: { in: cleanup.studentIds } } });
      }
      if (cleanup.batchIds.length) {
        await tx.enrollment.deleteMany({ where: { classBatchId: { in: cleanup.batchIds } } });
        await tx.classBatch.deleteMany({ where: { id: { in: cleanup.batchIds } } });
      }
      if (cleanup.courseIds.length) {
        await tx.course.deleteMany({ where: { id: { in: cleanup.courseIds } } });
      }
    });
  });

  async function createCourse() {
    return withRls(SUPER, async (tx) => {
      const code = uniq('CRS_TLE');
      const course = await tx.course.create({
        data: { code, name: `Teacher Lite Enroll Course ${code}`, program: 'UCREA' },
      });
      cleanup.courseIds.push(course.id);
      return course;
    });
  }

  async function createClass(capacity: number) {
    return withRls(SUPER, async (tx) => {
      const course = await createCourse();
      const code = uniq('TLE');
      const batch = await tx.classBatch.create({
        data: {
          facilityId: FACILITY,
          code,
          courseId: course.id,
          name: `Teacher Lite Enroll Batch ${code}`,
          status: 'running',
          capacity,
        },
      });
      cleanup.batchIds.push(batch.id);
      return batch;
    });
  }

  async function createStudent(facilityId: number = FACILITY) {
    return withRls(SUPER, async (tx) => {
      const studentCode = uniq('HS_TLE');
      const student = await tx.student.create({
        data: {
          facilityId,
          studentCode,
          fullName: `Teacher Lite Enroll Student ${studentCode}`,
          program: 'UCREA',
          lifecycle: 'admitted',
        },
      });
      cleanup.studentIds.push(student.id);
      return student;
    });
  }

  async function directorCaller(
    role: Role.giam_doc_kinh_doanh | Role.giam_doc_dao_tao = Role.giam_doc_dao_tao,
    facilityIds: number[] = [FACILITY],
  ) {
    return staffCaller({
      roles: [role],
      primaryRole: role,
      isSuperAdmin: false,
      facilityIds,
    });
  }

  it('director enrolls an existing student: row created, lifecycle flips, audit logged', async () => {
    if (!dbReachable) return;
    const batch = await createClass(20);
    const student = await createStudent();
    const caller = await directorCaller(Role.giam_doc_dao_tao);

    const result = await caller.teacherLite.enrollExistingStudent({
      facilityId: FACILITY,
      classBatchId: batch.id,
      studentId: student.id,
    });

    expect(result.enrollment.status).toBe('active');
    expect(result.enrollment.studentId).toBe(student.id);
    expect(result.overCapacity).toBe(false);
    expect(result.capacity).toBe(20);
    expect(result.enrolledCount).toBe(1);

    const proof = await withRls(SUPER, async (tx) => {
      const enrollment = await tx.enrollment.findUniqueOrThrow({ where: { id: result.enrollment.id } });
      const dbStudent = await tx.student.findUniqueOrThrow({ where: { id: student.id } });
      const events = await tx.recordEvent.findMany({
        where: { entityType: 'enrollment', entityId: result.enrollment.id },
      });
      return { enrollment, dbStudent, events };
    });
    expect(proof.enrollment.status).toBe('active');
    expect(proof.enrollment.archivedAt).toBeNull();
    expect(proof.dbStudent.lifecycle).toBe('active');
    expect(proof.events.some((e) => e.type === 'created')).toBe(true);
  });

  it('rejects a duplicate active enrollment with CONFLICT', async () => {
    if (!dbReachable) return;
    const batch = await createClass(20);
    const student = await createStudent();
    const caller = await directorCaller(Role.giam_doc_kinh_doanh);

    await caller.teacherLite.enrollExistingStudent({
      facilityId: FACILITY,
      classBatchId: batch.id,
      studentId: student.id,
    });

    await expect(
      caller.teacherLite.enrollExistingStudent({
        facilityId: FACILITY,
        classBatchId: batch.id,
        studentId: student.id,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a duplicate archived enrollment with CONFLICT (no P2002/500 leak)', async () => {
    if (!dbReachable) return;
    const batch = await createClass(20);
    const student = await createStudent();
    const caller = await directorCaller(Role.giam_doc_dao_tao);

    const first = await caller.teacherLite.enrollExistingStudent({
      facilityId: FACILITY,
      classBatchId: batch.id,
      studentId: student.id,
    });
    await withRls(SUPER, (tx) =>
      tx.enrollment.update({ where: { id: first.enrollment.id }, data: { archivedAt: new Date() } }),
    );

    await expect(
      caller.teacherLite.enrollExistingStudent({
        facilityId: FACILITY,
        classBatchId: batch.id,
        studentId: student.id,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('allows enrollment beyond capacity as a non-blocking soft warning', async () => {
    if (!dbReachable) return;
    const batch = await createClass(1);
    const s1 = await createStudent();
    const s2 = await createStudent();
    const caller = await directorCaller(Role.giam_doc_kinh_doanh);

    await caller.teacherLite.enrollExistingStudent({
      facilityId: FACILITY,
      classBatchId: batch.id,
      studentId: s1.id,
    });
    const second = await caller.teacherLite.enrollExistingStudent({
      facilityId: FACILITY,
      classBatchId: batch.id,
      studentId: s2.id,
    });

    expect(second.enrollment.status).toBe('active');
    expect(second.overCapacity).toBe(true);
    expect(second.capacity).toBe(1);
    expect(second.enrolledCount).toBe(2);
  });

  it('rejects cross-facility enrollment with FORBIDDEN', async () => {
    if (!dbReachable) return;
    const batch = await createClass(20);
    const student = await createStudent();
    const caller = await directorCaller(Role.giam_doc_dao_tao, [OTHER_FACILITY]);

    await expect(
      caller.teacherLite.enrollExistingStudent({
        facilityId: FACILITY,
        classBatchId: batch.id,
        studentId: student.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('teacher role cannot call the endpoint (permission-denied)', async () => {
    if (!dbReachable) return;
    const batch = await createClass(20);
    const student = await createStudent();
    const teacher = await staffCaller({
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

    await expect(
      teacher.teacherLite.enrollExistingStudent({
        facilityId: FACILITY,
        classBatchId: batch.id,
        studentId: student.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
