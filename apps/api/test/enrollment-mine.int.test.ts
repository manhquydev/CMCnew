/**
 * Integration test — enrollment.mine: student-scoped RLS isolation
 *
 * Invariants:
 *   - A student LMS principal sees only enrollments where student_id is in their own studentIds.
 *   - A different student's enrollments are never returned (RLS filters them out).
 *   - Archived enrollments (archivedAt != null) are excluded.
 *
 * RLS guard: enrollment_isolation policy — when principal_kind <> 'staff', requires
 *   student_id = ANY(app.student_ids). withRls(lmsRlsContextOf(lms)) sets that GUC.
 *   If the RLS filter were removed, cross-student data would appear — the test has real
 *   seeded data for the foreign student to ensure the assertion has teeth.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { LmsSession } from '@cmc/auth';
import { lmsCaller, withRls, SUPER, uniq } from './helpers.js';

const FACILITY = 1;

let studentAId: string; // owns enrollment in classA (active) and classC (archived)
let studentBId: string; // owns enrollment in classB (must NOT appear for studentA)
let classAId: string;
let classBId: string;
let classCId: string; // separate class for testing archived enrollment exclusion
let enrollAId: string;
let enrollBId: string;
let archivedEnrollId: string; // archived enrollment for studentA in classC — must be excluded

/** Build a minimal student LMS session pinned to one studentId. */
function studentSession(studentId: string, facilityId: number): LmsSession {
  return {
    kind: 'student',
    accountId: randomUUID(),
    displayName: 'Test Student',
    students: [{ id: studentId, fullName: 'Test Student' }],
    studentIds: [studentId],
    facilityIds: [facilityId],
  };
}

beforeAll(async () => {
  await withRls(SUPER, async (tx) => {
    // Two students at the same facility so a naive facility-only filter would leak data.
    const sA = await tx.student.create({
      data: { facilityId: FACILITY, studentCode: uniq('EMA'), fullName: 'Enrollment-A', program: 'UCREA', level: 'L1' },
    });
    studentAId = sA.id;

    const sB = await tx.student.create({
      data: { facilityId: FACILITY, studentCode: uniq('EMB'), fullName: 'Enrollment-B', program: 'UCREA', level: 'L1' },
    });
    studentBId = sB.id;

    // Courses required by FK
    const courseA = await tx.course.create({
      data: { code: uniq('CMA'), name: 'Course-Mine-A', program: 'UCREA' },
    });
    const courseB = await tx.course.create({
      data: { code: uniq('CMB'), name: 'Course-Mine-B', program: 'UCREA' },
    });
    const courseC = await tx.course.create({
      data: { code: uniq('CMC'), name: 'Course-Mine-C', program: 'UCREA' },
    });

    // Class batches in the same facility — facility-only RLS would not isolate them.
    const batchA = await tx.classBatch.create({
      data: { facilityId: FACILITY, courseId: courseA.id, code: uniq('CBA'), name: 'Class-Mine-A' },
    });
    classAId = batchA.id;

    const batchB = await tx.classBatch.create({
      data: { facilityId: FACILITY, courseId: courseB.id, code: uniq('CBB'), name: 'Class-Mine-B' },
    });
    classBId = batchB.id;

    // A third class for the archived enrollment — avoids unique(classBatchId, studentId) conflict.
    const batchC = await tx.classBatch.create({
      data: { facilityId: FACILITY, courseId: courseC.id, code: uniq('CBC'), name: 'Class-Mine-C' },
    });
    classCId = batchC.id;

    // Enroll studentA in classA (active)
    const eA = await tx.enrollment.create({
      data: { facilityId: FACILITY, classBatchId: classAId, studentId: studentAId, status: 'active' },
    });
    enrollAId = eA.id;

    // Enroll studentB in classB (active) — must NOT appear in studentA's results
    const eB = await tx.enrollment.create({
      data: { facilityId: FACILITY, classBatchId: classBId, studentId: studentBId, status: 'active' },
    });
    enrollBId = eB.id;

    // Archived enrollment for studentA in classC — must be excluded from mine (archivedAt != null)
    const eArchived = await tx.enrollment.create({
      data: {
        facilityId: FACILITY,
        classBatchId: classCId,
        studentId: studentAId,
        status: 'completed',
        archivedAt: new Date(),
      },
    });
    archivedEnrollId = eArchived.id;
  });
});

afterAll(async () => {
  await withRls(SUPER, async (tx) => {
    // FK order: enrollment → classBatch → course, student
    const enrollIds = [enrollAId, enrollBId, archivedEnrollId].filter(Boolean);
    if (enrollIds.length) {
      await tx.enrollment.deleteMany({ where: { id: { in: enrollIds } } });
    }
    const batchIds = [classAId, classBId, classCId].filter(Boolean);
    if (batchIds.length) {
      await tx.classBatch.deleteMany({ where: { id: { in: batchIds } } });
    }
    await tx.student.deleteMany({ where: { id: { in: [studentAId, studentBId].filter(Boolean) } } });
  });
});

describe("enrollment.mine — RLS scopes to caller's own studentIds", () => {
  it('student A sees their own active enrollment (classA)', async () => {
    const result = await lmsCaller(studentSession(studentAId, FACILITY)).enrollment.mine();
    const ids = result.map((e) => e.id);
    expect(ids).toContain(enrollAId);
  });

  it('student A result includes classBatch + course fields', async () => {
    const result = await lmsCaller(studentSession(studentAId, FACILITY)).enrollment.mine();
    const row = result.find((e) => e.id === enrollAId);
    expect(row).toBeDefined();
    expect(row!.status).toBe('active');
    // Prisma relation field is 'batch' (not 'classBatch') per schema definition.
    expect(row!.batch).toMatchObject({ code: expect.any(String), name: expect.any(String) });
    expect(row!.batch.course).toMatchObject({
      code: expect.any(String),
      name: expect.any(String),
      program: expect.any(String),
    });
  });

  it("student A does NOT see student B's enrollment (RLS isolation)", async () => {
    // Student B's enrollment is in the same facility — a facility-only filter would leak it.
    // If enrollment_isolation RLS were bypassed, enrollBId would appear here.
    const result = await lmsCaller(studentSession(studentAId, FACILITY)).enrollment.mine();
    const ids = result.map((e) => e.id);
    expect(ids).not.toContain(enrollBId);
  });

  it('student A does NOT see archived enrollment (archivedAt filter)', async () => {
    const result = await lmsCaller(studentSession(studentAId, FACILITY)).enrollment.mine();
    const ids = result.map((e) => e.id);
    expect(ids).not.toContain(archivedEnrollId);
  });

  it("student B sees only their own enrollment, not student A's", async () => {
    const result = await lmsCaller(studentSession(studentBId, FACILITY)).enrollment.mine();
    const ids = result.map((e) => e.id);
    expect(ids).toContain(enrollBId);
    expect(ids).not.toContain(enrollAId);
    expect(ids).not.toContain(archivedEnrollId);
  });
});
