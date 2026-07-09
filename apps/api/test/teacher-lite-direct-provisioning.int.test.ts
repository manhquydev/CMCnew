import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DEFAULT_STUDENT_PASSWORD, Role, loginFamilyByPhone } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

const FACILITY = 1;

let phoneCounter = 0;
function freshPhone(): string {
  const digits = `${uniq('').replace(/\D/g, '')}${++phoneCounter}`.slice(-9).padStart(9, '0');
  return `0${digits}`;
}

describe('Teacher Lite direct provisioning', () => {
  const cleanup = {
    courseIds: [] as string[],
    batchIds: [] as string[],
    studentIds: [] as string[],
    parentIds: [] as string[],
    outboxKeys: [] as string[],
  };
  let dbReachable = false;

  beforeAll(async () => {
    try {
      await superAdminUserId();
      dbReachable = true;
    } catch {
      console.warn('DB not reachable - Teacher Lite direct provisioning tests skipped');
    }
  });

  afterAll(async () => {
    if (!dbReachable) return;
    await withRls(SUPER, async (tx) => {
      if (cleanup.outboxKeys.length) {
        await tx.emailOutbox.deleteMany({ where: { dedupKey: { in: cleanup.outboxKeys } } });
      }
      if (cleanup.studentIds.length) {
        await tx.studentAccount.deleteMany({ where: { studentId: { in: cleanup.studentIds } } });
        await tx.enrollment.deleteMany({ where: { studentId: { in: cleanup.studentIds } } });
        await tx.guardian.deleteMany({ where: { studentId: { in: cleanup.studentIds } } });
        await tx.recordEvent.deleteMany({ where: { entityId: { in: cleanup.studentIds } } });
        await tx.student.deleteMany({ where: { id: { in: cleanup.studentIds } } });
      }
      if (cleanup.parentIds.length) {
        await tx.guardianLinkRequest.deleteMany({ where: { requestedByAccountId: { in: cleanup.parentIds } } });
        await tx.parentAccount.deleteMany({ where: { id: { in: cleanup.parentIds } } });
      }
      if (cleanup.batchIds.length) {
        await tx.enrollment.deleteMany({ where: { classBatchId: { in: cleanup.batchIds } } });
        await tx.classBatch.deleteMany({ where: { id: { in: cleanup.batchIds } } });
      }
      if (cleanup.courseIds.length) {
        await tx.curriculumUnit.deleteMany({ where: { courseId: { in: cleanup.courseIds } } });
        await tx.course.deleteMany({ where: { id: { in: cleanup.courseIds } } });
      }
    });
  });

  async function createClass() {
    return withRls(SUPER, async (tx) => {
      const course = await createCourse();
      const code = uniq('TLB');
      const batch = await tx.classBatch.create({
        data: {
          facilityId: FACILITY,
          code,
          courseId: course.id,
          name: `Teacher Lite Batch ${code}`,
          status: 'running',
          capacity: 20,
        },
      });
      cleanup.batchIds.push(batch.id);
      return batch;
    });
  }

  /** Creates a bare course with no curriculum — used by tests that don't generate sessions. */
  async function createCourse() {
    return withRls(SUPER, async (tx) => {
      const code = uniq('CRS_TL');
      const course = await tx.course.create({
        data: { code, name: `Teacher Lite Course ${code}`, program: 'UCREA' },
      });
      cleanup.courseIds.push(course.id);
      return course;
    });
  }

  /**
   * Creates a course with a single curriculum unit (`sessions` count controls how many
   * ClassSession rows teacherLite.createClass generates — session count is server-truth from
   * Σ curriculumUnit.sessions, see BUG 1 fix).
   */
  async function createCourseWithCurriculum(sessions: number) {
    return withRls(SUPER, async (tx) => {
      const code = uniq('CRS_TLC');
      const course = await tx.course.create({
        data: { code, name: `Teacher Lite Curriculum Course ${code}`, program: 'UCREA' },
      });
      cleanup.courseIds.push(course.id);
      await tx.curriculumUnit.create({
        data: {
          courseId: course.id,
          unitCode: uniq('U'),
          seqInLevel: 1,
          orderGlobal: 1,
          unitType: 'LESSON',
          theme: 'Teacher Lite fixture unit',
          sessions,
        },
      });
      return course;
    });
  }

  async function directorCaller(role: Role.giam_doc_kinh_doanh | Role.giam_doc_dao_tao) {
    return staffCaller({
      roles: [role],
      primaryRole: role,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });
  }

  it('business director direct-creates parent, student, guardian, LMS account, enrollment, and email proof', async () => {
    if (!dbReachable) return;
    const batch = await createClass();
    const caller = await directorCaller(Role.giam_doc_kinh_doanh);
    const parentEmail = `${uniq('tl-parent')}@example.com`;
    const result = await caller.teacherLite.createFamilyStudentAndEnroll({
      facilityId: FACILITY,
      classBatchId: batch.id,
      parentName: 'Teacher Lite Parent',
      parentEmail: parentEmail.toUpperCase(),
      parentPhone: freshPhone(),
      studentName: `Teacher Lite Student ${uniq('S')}`,
      program: 'UCREA',
    });
    cleanup.parentIds.push(result.parentAccountId);
    cleanup.studentIds.push(result.studentId);
    cleanup.outboxKeys.push(`teacher_lite_lms_account_ready:${result.studentId}`);

    expect(result.createdStudent).toBe(true);
    expect(result.lmsAccount.familyPhone).toMatch(/^84\d{9}$/);
    expect(result.lmsAccount.loginCode).toMatch(/^HQ-HS-\d{4}-\d{4}$/);
    expect(result.lmsAccount.tempPassword).toBe(DEFAULT_STUDENT_PASSWORD);

    const proof = await withRls(SUPER, async (tx) => {
      const parent = await tx.parentAccount.findUniqueOrThrow({ where: { id: result.parentAccountId } });
      const enrollment = await tx.enrollment.findUniqueOrThrow({ where: { id: result.enrollmentId } });
      const guardian = await tx.guardian.findUniqueOrThrow({
        where: { parentAccountId_studentId: { parentAccountId: result.parentAccountId, studentId: result.studentId } },
      });
      const outbox = await tx.emailOutbox.findUnique({
        where: { dedupKey: `teacher_lite_lms_account_ready:${result.studentId}` },
      });
      const receiptCount = await tx.receipt.count({
        where: {
          OR: [
            { studentId: result.studentId },
            { parentPhone: result.lmsAccount.familyPhone },
            { parentEmail: parentEmail.toLowerCase() },
          ],
        },
      });
      const contactCount = await tx.contact.count({ where: { phone: result.lmsAccount.familyPhone } });
      const opportunityCount = await tx.opportunity.count({
        where: { contact: { phone: result.lmsAccount.familyPhone } },
      });
      const coursePriceCount = await tx.coursePrice.count({
        where: { facilityId: FACILITY, courseId: batch.courseId },
      });
      return {
        parent,
        enrollment,
        guardian,
        outbox,
        receiptCount,
        contactCount,
        opportunityCount,
        coursePriceCount,
      };
    });
    expect(proof.parent.email).toBe(parentEmail.toLowerCase());
    expect(proof.parent.phone).toBe(result.lmsAccount.familyPhone);
    expect(proof.enrollment.status).toBe('active');
    expect(proof.enrollment.createdByReceiptId).toBeNull();
    expect(proof.guardian.facilityId).toBe(FACILITY);
    expect(proof.outbox?.templateKind).toBe('lms_account_ready');
    expect(proof.receiptCount).toBe(0);
    expect(proof.contactCount).toBe(0);
    expect(proof.opportunityCount).toBe(0);
    expect(proof.coursePriceCount).toBe(0);

    const familyLogin = await loginFamilyByPhone(result.lmsAccount.familyPhone, DEFAULT_STUDENT_PASSWORD);
    expect(familyLogin?.children.some((child) => child.id === result.studentId)).toBe(true);
  });

  it('returning family (existing account, rotated password) does NOT get handed the default password', async () => {
    if (!dbReachable) return;
    const batch1 = await createClass();
    const batch2 = await createClass();
    const caller = await directorCaller(Role.giam_doc_kinh_doanh);
    const parentEmail = `${uniq('tl-returning')}@example.com`;
    const parentPhone = freshPhone();

    const first = await caller.teacherLite.createFamilyStudentAndEnroll({
      facilityId: FACILITY,
      classBatchId: batch1.id,
      parentName: 'Returning Family Parent',
      parentEmail,
      parentPhone,
      studentName: `Returning Family Student One ${uniq('S')}`,
      program: 'UCREA',
      sendEmail: false,
    });
    cleanup.parentIds.push(first.parentAccountId);
    cleanup.studentIds.push(first.studentId);

    expect(first.lmsAccount.tempPassword).toBe(DEFAULT_STUDENT_PASSWORD);
    expect(first.lmsAccount.passwordWasSet).toBe(true);

    // Simulate the parent self-service rotating their family password (decision 0033 D6a) —
    // provisioning a 2nd child for the same phone must NOT keep claiming the old default.
    await withRls(SUPER, (tx) =>
      tx.parentAccount.update({
        where: { id: first.parentAccountId },
        data: { passwordHash: 'rotated-hash-not-default' },
      }),
    );

    const second = await caller.teacherLite.createFamilyStudentAndEnroll({
      facilityId: FACILITY,
      classBatchId: batch2.id,
      parentName: 'Returning Family Parent',
      parentEmail,
      parentPhone,
      studentName: `Returning Family Student Two ${uniq('S')}`,
      program: 'UCREA',
      sendEmail: false,
    });
    cleanup.studentIds.push(second.studentId);

    expect(second.parentAccountId).toBe(first.parentAccountId);
    expect(second.createdStudent).toBe(true);
    expect(second.lmsAccount.passwordWasSet).toBe(false);
    expect(second.lmsAccount.tempPassword).not.toBe(DEFAULT_STUDENT_PASSWORD);
  });

  it('same-name siblings with different DOB create two distinct students (no wrong-student attach)', async () => {
    if (!dbReachable) return;
    const batch1 = await createClass();
    const batch2 = await createClass();
    const caller = await directorCaller(Role.giam_doc_dao_tao);
    const parentEmail = `${uniq('tl-siblings')}@example.com`;
    const parentPhone = freshPhone();
    const sharedName = `Nguyễn Văn Same ${uniq('N')}`;

    const first = await caller.teacherLite.createFamilyStudentAndEnroll({
      facilityId: FACILITY,
      classBatchId: batch1.id,
      parentName: 'Sibling Parent',
      parentEmail,
      parentPhone,
      studentName: sharedName,
      studentDob: new Date('2015-01-01'),
      program: 'UCREA',
      sendEmail: false,
    });
    cleanup.parentIds.push(first.parentAccountId);
    cleanup.studentIds.push(first.studentId);

    const second = await caller.teacherLite.createFamilyStudentAndEnroll({
      facilityId: FACILITY,
      classBatchId: batch2.id,
      parentName: 'Sibling Parent',
      parentEmail,
      parentPhone,
      studentName: sharedName,
      studentDob: new Date('2017-03-15'),
      program: 'UCREA',
      sendEmail: false,
    });
    cleanup.studentIds.push(second.studentId);

    expect(second.parentAccountId).toBe(first.parentAccountId);
    expect(second.studentId).not.toBe(first.studentId);
    expect(second.createdStudent).toBe(true);

    const studentCount = await withRls(SUPER, (tx) =>
      tx.student.count({ where: { id: { in: [first.studentId, second.studentId] } } }),
    );
    expect(studentCount).toBe(2);
  });

  it('reactivates a withdrawn enrollment instead of leaving it stale (Finding 3/4)', async () => {
    if (!dbReachable) return;
    const batch = await createClass();
    const caller = await directorCaller(Role.giam_doc_kinh_doanh);
    const input = {
      facilityId: FACILITY,
      classBatchId: batch.id,
      parentName: 'Reactivate Parent',
      parentEmail: `${uniq('tl-reactivate')}@example.com`,
      parentPhone: freshPhone(),
      studentName: `Reactivate Student ${uniq('S')}`,
      program: 'UCREA' as const,
      sendEmail: false,
    };

    const first = await caller.teacherLite.createFamilyStudentAndEnroll(input);
    cleanup.parentIds.push(first.parentAccountId);
    cleanup.studentIds.push(first.studentId);

    await withRls(SUPER, (tx) =>
      tx.enrollment.update({ where: { id: first.enrollmentId }, data: { status: 'withdrawn' } }),
    );

    const second = await caller.teacherLite.createFamilyStudentAndEnroll(input);

    expect(second.enrollmentId).toBe(first.enrollmentId);
    const proof = await withRls(SUPER, (tx) =>
      tx.enrollment.findUniqueOrThrow({ where: { id: first.enrollmentId } }),
    );
    expect(proof.status).toBe('active');
  });

  it('teacher cannot call the direct setup endpoint', async () => {
    if (!dbReachable) return;
    const batch = await createClass();
    const teacher = await staffCaller({
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

    await expect(teacher.teacherLite.createFamilyStudentAndEnroll({
      facilityId: FACILITY,
      classBatchId: batch.id,
      parentName: 'Blocked Parent',
      parentEmail: `${uniq('blocked')}@example.com`,
      parentPhone: freshPhone(),
      studentName: 'Blocked Student',
      program: 'UCREA',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reuses the same family student on double-submit instead of creating a duplicate', async () => {
    if (!dbReachable) return;
    const batch = await createClass();
    const caller = await directorCaller(Role.giam_doc_dao_tao);
    const input = {
      facilityId: FACILITY,
      classBatchId: batch.id,
      parentName: 'Double Submit Parent',
      parentEmail: `${uniq('double')}@example.com`,
      parentPhone: freshPhone(),
      studentName: `Double Submit Student ${uniq('S')}`,
      program: 'UCREA' as const,
      sendEmail: false,
    };

    const first = await caller.teacherLite.createFamilyStudentAndEnroll(input);
    const second = await caller.teacherLite.createFamilyStudentAndEnroll(input);
    cleanup.parentIds.push(first.parentAccountId);
    cleanup.studentIds.push(first.studentId);

    expect(second.parentAccountId).toBe(first.parentAccountId);
    expect(second.studentId).toBe(first.studentId);
    expect(second.enrollmentId).toBe(first.enrollmentId);
    expect(second.createdStudent).toBe(false);

    const studentCount = await withRls(SUPER, (tx) =>
      tx.student.count({ where: { id: { in: [first.studentId, second.studentId] } } }),
    );
    expect(studentCount).toBe(1);
  });

  it('business director creates a Teacher Lite class with initial sessions', async () => {
    if (!dbReachable) return;
    const course = await createCourseWithCurriculum(4);
    const caller = await directorCaller(Role.giam_doc_kinh_doanh);
    const result = await caller.teacherLite.createClass({
      facilityId: FACILITY,
      courseId: course.id,
      startDate: '2026-08-03',
      capacity: 12,
      slot: { dayOfWeek: 1, startTime: '18:00', endTime: '19:30' },
      generateSessions: true,
    });
    cleanup.batchIds.push(result.batch.id);

    expect(result.batch.status).toBe('open');
    expect(result.sessions.created).toBe(4);

    const proof = await withRls(SUPER, async (tx) => {
      const slots = await tx.scheduleSlot.count({ where: { classBatchId: result.batch.id } });
      const sessions = await tx.classSession.count({ where: { classBatchId: result.batch.id } });
      return { slots, sessions };
    });
    expect(proof.slots).toBe(1);
    expect(proof.sessions).toBe(result.sessions.created);
  });

  it('education director cancels a Teacher Lite session without using the schedule namespace', async () => {
    if (!dbReachable) return;
    const course = await createCourseWithCurriculum(3);
    const caller = await directorCaller(Role.giam_doc_dao_tao);
    const created = await caller.teacherLite.createClass({
      facilityId: FACILITY,
      courseId: course.id,
      startDate: '2026-09-07',
      slot: { dayOfWeek: 1, startTime: '18:00', endTime: '19:30' },
      generateSessions: true,
    });
    cleanup.batchIds.push(created.batch.id);
    const session = await withRls(SUPER, (tx) =>
      tx.classSession.findFirstOrThrow({ where: { classBatchId: created.batch.id } }),
    );

    const cancelled = await caller.teacherLite.cancelSession({
      sessionId: session.id,
      reason: 'Teacher Lite test cancel',
    });
    expect(cancelled.status).toBe('cancelled');
  });

  it('business director cancels a Teacher Lite class and its future sessions', async () => {
    if (!dbReachable) return;
    const course = await createCourseWithCurriculum(3);
    const caller = await directorCaller(Role.giam_doc_kinh_doanh);
    const created = await caller.teacherLite.createClass({
      facilityId: FACILITY,
      courseId: course.id,
      startDate: '2026-10-05',
      slot: { dayOfWeek: 1, startTime: '18:00', endTime: '19:30' },
      generateSessions: true,
    });
    cleanup.batchIds.push(created.batch.id);

    const result = await caller.teacherLite.cancelClass({
      id: created.batch.id,
      reason: 'Teacher Lite test class cancel',
    });
    expect(result.batch.status).toBe('cancelled');
    expect(result.cancelledSessions).toBeGreaterThan(0);
  });
});
