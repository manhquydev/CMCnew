/**
 * Integration test — enrollment.enroll reactivation of a withdrawn/transferred row.
 *
 * The unique key `(classBatchId, studentId)` (schema.prisma:396) has no status/archivedAt
 * component. A cancelled receipt withdraws the enrollment (`finance.ts` cancel path sets
 * `status: 'withdrawn'`, `archivedAt` stays null). Re-enrolling the same student into the same
 * batch used to be blocked forever with a misleading "already enrolled" CONFLICT — see
 * plans/260709-1514-teacher-lite-bugfixes-and-audit/reports/audit-provisioning-enrollment-findings.md
 * Finding 4. `enroll` must reactivate the existing row instead, and keep CONFLICT only for a
 * genuinely active/reserved row.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

const FACILITY = 1;

describe('enrollment.enroll reactivates a withdrawn/transferred row instead of CONFLICT', () => {
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
      console.warn('DB not reachable - enrollment reactivate tests skipped');
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

  async function createClass() {
    return withRls(SUPER, async (tx) => {
      const code = uniq('CRS_REACT');
      const course = await tx.course.create({
        data: { code, name: `Reactivate Course ${code}`, program: 'UCREA' },
      });
      cleanup.courseIds.push(course.id);
      const batchCode = uniq('B_REACT');
      const batch = await tx.classBatch.create({
        data: {
          facilityId: FACILITY,
          code: batchCode,
          courseId: course.id,
          name: `Reactivate Batch ${batchCode}`,
          status: 'running',
          capacity: 20,
        },
      });
      cleanup.batchIds.push(batch.id);
      return batch;
    });
  }

  async function createStudent() {
    return withRls(SUPER, async (tx) => {
      const studentCode = uniq('HS_REACT');
      const student = await tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode,
          fullName: `Reactivate Student ${studentCode}`,
          program: 'UCREA',
          lifecycle: 'admitted',
        },
      });
      cleanup.studentIds.push(student.id);
      return student;
    });
  }

  async function salesCaller() {
    return staffCaller({
      roles: [Role.sale],
      primaryRole: Role.sale,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });
  }

  it('reactivates a withdrawn enrollment instead of throwing CONFLICT', async () => {
    if (!dbReachable) return;
    const batch = await createClass();
    const student = await createStudent();
    const caller = await salesCaller();

    const first = await caller.enrollment.enroll({
      facilityId: FACILITY,
      classBatchId: batch.id,
      studentId: student.id,
    });
    expect(first.enrollment.status).toBe('active');

    await withRls(SUPER, (tx) =>
      tx.enrollment.update({ where: { id: first.enrollment.id }, data: { status: 'withdrawn' } }),
    );

    const second = await caller.enrollment.enroll({
      facilityId: FACILITY,
      classBatchId: batch.id,
      studentId: student.id,
    });

    expect(second.enrollment.id).toBe(first.enrollment.id);
    expect(second.enrollment.status).toBe('active');

    const proof = await withRls(SUPER, async (tx) => {
      const enrollment = await tx.enrollment.findUniqueOrThrow({ where: { id: first.enrollment.id } });
      const events = await tx.recordEvent.findMany({
        where: { entityType: 'enrollment', entityId: first.enrollment.id },
      });
      return { enrollment, events };
    });
    expect(proof.enrollment.status).toBe('active');
    expect(proof.events.some((e) => e.type === 'status_changed')).toBe(true);
  });

  it('still rejects an already-active enrollment with CONFLICT', async () => {
    if (!dbReachable) return;
    const batch = await createClass();
    const student = await createStudent();
    const caller = await salesCaller();

    await caller.enrollment.enroll({
      facilityId: FACILITY,
      classBatchId: batch.id,
      studentId: student.id,
    });

    await expect(
      caller.enrollment.enroll({
        facilityId: FACILITY,
        classBatchId: batch.id,
        studentId: student.id,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
