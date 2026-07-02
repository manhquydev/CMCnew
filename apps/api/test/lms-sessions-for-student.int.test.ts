import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { LmsSession } from '@cmc/auth';
import { seedCurriculum, courseCode, defaultCsvPath } from '@cmc/db';
import { lmsCaller, staffCaller, withRls, SUPER, uniq, prisma } from './helpers.js';

/**
 * LMS session list for a student/parent principal:
 *  - returns only sessions of classes the owned student is enrolled in (RLS ownership);
 *  - joins curriculumUnit content (theme/content/thinkingGoal/assessment) per session;
 *  - a session with curriculumUnitId=null is null-safe (still listed, no curriculum block);
 *  - a non-owned student's sessions are never visible.
 */
describe('schedule.sessionsForStudent (LMS)', () => {
  const FAC = 1;
  let courseId: string; // UCREA-L1 (has curriculum)
  let unit1Id: string;
  let batchId: string;
  let studentId: string; // owned by the principal
  let otherStudentId: string; // NOT owned
  let mappedSessionId: string;
  let unmappedSessionId: string;

  function principal(sid: string, name: string): LmsSession {
    return {
      kind: 'parent',
      accountId: randomUUID(),
      displayName: `Parent ${name}`,
      students: [{ id: sid, fullName: name }],
      studentIds: [sid],
      facilityIds: [FAC],
    };
  }

  beforeAll(async () => {
    await seedCurriculum(prisma, readFileSync(defaultCsvPath(), 'utf8'));
    const course = await withRls(SUPER, (tx) =>
      tx.course.findUniqueOrThrow({ where: { code: courseCode('UCREA', 'L1') } }),
    );
    courseId = course.id;
    const unit1 = await withRls(SUPER, (tx) =>
      tx.curriculumUnit.findFirstOrThrow({ where: { courseId }, orderBy: { orderGlobal: 'asc' } }),
    );
    unit1Id = unit1.id;

    await withRls(SUPER, async (tx) => {
      const batch = await tx.classBatch.create({
        data: { facilityId: FAC, courseId, code: uniq('LMSS'), name: 'LMS Sessions Batch', status: 'running' },
      });
      batchId = batch.id;

      const student = await tx.student.create({
        data: { facilityId: FAC, studentCode: uniq('LMSS-A'), fullName: 'LMS Student A', program: 'UCREA', level: 'L1' },
      });
      studentId = student.id;
      const other = await tx.student.create({
        data: { facilityId: FAC, studentCode: uniq('LMSS-B'), fullName: 'LMS Student B', program: 'UCREA', level: 'L1' },
      });
      otherStudentId = other.id;

      await tx.enrollment.create({ data: { facilityId: FAC, classBatchId: batch.id, studentId: student.id, status: 'active' } });

      // One session mapped to unit1, one intentionally left unmapped (curriculumUnitId=null).
      const mapped = await tx.classSession.create({
        data: {
          facilityId: FAC,
          classBatchId: batch.id,
          sessionDate: new Date('2096-01-03'),
          startTime: '18:00',
          endTime: '19:00',
          status: 'planned',
          curriculumUnitId: unit1Id,
        },
      });
      mappedSessionId = mapped.id;
      const unmapped = await tx.classSession.create({
        data: {
          facilityId: FAC,
          classBatchId: batch.id,
          sessionDate: new Date('2096-01-10'),
          startTime: '18:00',
          endTime: '19:00',
          status: 'planned',
          curriculumUnitId: null,
        },
      });
      unmappedSessionId = unmapped.id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.classSession.deleteMany({ where: { classBatchId: batchId } });
      await tx.enrollment.deleteMany({ where: { classBatchId: batchId } });
      await tx.classBatch.delete({ where: { id: batchId } }).catch(() => {});
      await tx.student.deleteMany({ where: { id: { in: [studentId, otherStudentId] } } }).catch(() => {});
    });
  });

  it('lists the owned student sessions with joined curriculum content, null-safe for unmapped', async () => {
    const caller = lmsCaller(principal(studentId, 'LMS Student A'));
    const rows = await caller.schedule.sessionsForStudent();

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(mappedSessionId);
    expect(ids).toContain(unmappedSessionId);

    const mapped = rows.find((r) => r.id === mappedSessionId)!;
    expect(mapped.curriculumUnit).not.toBeNull();
    expect(mapped.curriculumUnit!.theme).toBeTruthy();
    expect(mapped.curriculumUnit!.unitCode).toBe('UC-L1-01');

    const unmapped = rows.find((r) => r.id === unmappedSessionId)!;
    expect(unmapped.curriculumUnit).toBeNull(); // does not throw / crash
  });

  it('never returns sessions of a student the principal does not own', async () => {
    // Principal owns otherStudentId (not enrolled anywhere) → sees no sessions of the batch above.
    const caller = lmsCaller(principal(otherStudentId, 'LMS Student B'));
    const rows = await caller.schedule.sessionsForStudent();
    expect(rows.map((r) => r.id)).not.toContain(mappedSessionId);
  });

  it('rejects an explicit studentId the principal does not own (FORBIDDEN)', async () => {
    const caller = lmsCaller(principal(otherStudentId, 'LMS Student B'));
    await expect(caller.schedule.sessionsForStudent({ studentId })).rejects.toThrow();
  });

  it('is not reachable by staff (LMS-only procedure)', async () => {
    const staff = await staffCaller();
    // @ts-expect-error sessionsForStudent is an lmsProcedure — no staff-session path
    await expect(staff.schedule.sessionsForStudent()).rejects.toThrow();
  });
});
