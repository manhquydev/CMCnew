import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { lmsCaller, staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

const FACILITY = 1;

let dbReachable = false;

const cleanup = {
  courseIds: [] as string[],
  unitIds: [] as string[],
  lessonIds: [] as string[],
  batchIds: [] as string[],
  studentIds: [] as string[],
  enrollmentIds: [] as string[],
  sessionIds: [] as string[],
  exerciseIds: [] as string[],
  submissionIds: [] as string[],
};

function pastDate(daysAgo: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function futureDate(daysAhead: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

beforeAll(async () => {
  try {
    await superAdminUserId();
    dbReachable = true;
  } catch {
    console.warn('DB not reachable - session-level exercise tests skipped');
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  await withRls(SUPER, async (tx) => {
    if (cleanup.studentIds.length) {
      await tx.notification.deleteMany({ where: { recipientType: 'student', recipientId: { in: cleanup.studentIds } } });
    }
    if (cleanup.submissionIds.length) await tx.submission.deleteMany({ where: { id: { in: cleanup.submissionIds } } });
    if (cleanup.exerciseIds.length) await tx.exercise.deleteMany({ where: { id: { in: cleanup.exerciseIds } } });
    if (cleanup.sessionIds.length) await tx.classSession.deleteMany({ where: { id: { in: cleanup.sessionIds } } });
    if (cleanup.enrollmentIds.length) await tx.enrollment.deleteMany({ where: { id: { in: cleanup.enrollmentIds } } });
    if (cleanup.studentIds.length) await tx.student.deleteMany({ where: { id: { in: cleanup.studentIds } } });
    if (cleanup.batchIds.length) await tx.classBatch.deleteMany({ where: { id: { in: cleanup.batchIds } } });
    if (cleanup.lessonIds.length) await tx.curriculumLesson.deleteMany({ where: { id: { in: cleanup.lessonIds } } });
    if (cleanup.unitIds.length) await tx.curriculumUnit.deleteMany({ where: { id: { in: cleanup.unitIds } } });
    if (cleanup.courseIds.length) await tx.course.deleteMany({ where: { id: { in: cleanup.courseIds } } });
  });
});

describe('session-level exercises', () => {
  it('allows separate homework uploads per lesson inside one unit and opens them by ended session', async () => {
    if (!dbReachable) return;

    const fixture = await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({
        data: { code: uniq('SLE_C'), name: 'Session-level exercise course', program: 'UCREA' },
      });
      cleanup.courseIds.push(course.id);

      const unit = await tx.curriculumUnit.create({
        data: {
          courseId: course.id,
          unitCode: uniq('SLE_U'),
          seqInLevel: 1,
          orderGlobal: 1,
          unitType: 'LESSON',
          theme: 'One unit, two lessons',
          sessions: 2,
        },
      });
      cleanup.unitIds.push(unit.id);

      const lesson1 = await tx.curriculumLesson.create({
        data: {
          courseId: course.id,
          curriculumUnitId: unit.id,
          lessonCode: `${unit.unitCode}-S01`,
          seqInUnit: 1,
          orderGlobal: 101,
        },
      });
      const lesson2 = await tx.curriculumLesson.create({
        data: {
          courseId: course.id,
          curriculumUnitId: unit.id,
          lessonCode: `${unit.unitCode}-S02`,
          seqInUnit: 2,
          orderGlobal: 102,
        },
      });
      cleanup.lessonIds.push(lesson1.id, lesson2.id);

      const batch = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('SLE_B'), courseId: course.id, name: 'Session-level batch', status: 'running' },
      });
      cleanup.batchIds.push(batch.id);

      const student = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('SLE_S'), fullName: 'Session Level Student', program: 'UCREA' },
      });
      cleanup.studentIds.push(student.id);

      const enrollment = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId: batch.id, studentId: student.id, status: 'active' },
      });
      cleanup.enrollmentIds.push(enrollment.id);

      const endedSession = await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId: batch.id,
          sessionDate: pastDate(1),
          startTime: '08:00',
          endTime: '09:00',
          status: 'confirmed',
          curriculumUnitId: unit.id,
          curriculumLessonId: lesson1.id,
        },
      });
      const futureSession = await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId: batch.id,
          sessionDate: futureDate(7),
          startTime: '08:00',
          endTime: '09:00',
          status: 'confirmed',
          curriculumUnitId: unit.id,
          curriculumLessonId: lesson2.id,
        },
      });
      cleanup.sessionIds.push(endedSession.id, futureSession.id);

      return { unit, lesson1, lesson2, student, futureSession };
    });

    const staff = await staffCaller();
    const exercise1 = await staff.exercise.upsert({
      curriculumLessonId: fixture.lesson1.id,
      type: 'homework',
      title: 'Homework for session 1',
      maxScore: 10,
      status: 'published',
    });
    const exercise2 = await staff.exercise.upsert({
      curriculumLessonId: fixture.lesson2.id,
      type: 'homework',
      title: 'Homework for session 2',
      maxScore: 10,
      status: 'published',
    });
    cleanup.exerciseIds.push(exercise1.id, exercise2.id);

    expect(exercise1.id).not.toBe(exercise2.id);
    expect(exercise1.curriculumUnitId).toBe(fixture.unit.id);
    expect(exercise2.curriculumUnitId).toBe(fixture.unit.id);
    expect(exercise1.curriculumLessonId).toBe(fixture.lesson1.id);
    expect(exercise2.curriculumLessonId).toBe(fixture.lesson2.id);

    const unitExercises = await staff.exercise.listByUnit({ curriculumUnitId: fixture.unit.id });
    expect(unitExercises.map((exercise) => exercise.id).sort()).toEqual([exercise1.id, exercise2.id].sort());
    expect(await staff.exercise.listByLesson({ curriculumLessonId: fixture.lesson1.id })).toHaveLength(1);
    expect(await staff.exercise.listByLesson({ curriculumLessonId: fixture.lesson2.id })).toHaveLength(1);

    const lms = lmsCaller({
      kind: 'student',
      accountId: fixture.student.id,
      displayName: fixture.student.fullName,
      students: [{ id: fixture.student.id, fullName: fixture.student.fullName }],
      studentIds: [fixture.student.id],
      facilityIds: [FACILITY],
    });

    const initiallyOpen = await lms.exercise.listForPrincipal();
    expect(initiallyOpen.map((exercise) => exercise.id)).toContain(exercise1.id);
    expect(initiallyOpen.map((exercise) => exercise.id)).not.toContain(exercise2.id);

    const saved = await lms.submission.save({ exerciseId: exercise1.id, answerText: 'session 1 answer' });
    cleanup.submissionIds.push(saved.id);
    await expect(lms.submission.save({ exerciseId: exercise2.id, answerText: 'too early' })).rejects.toThrow(
      /chưa mở/i,
    );

    await withRls(SUPER, (tx) =>
      tx.classSession.update({
        where: { id: fixture.futureSession.id },
        data: { sessionDate: pastDate(1), startTime: '10:00', endTime: '11:00' },
      }),
    );

    const openAfterSecondSession = await lms.exercise.listForPrincipal();
    expect(openAfterSecondSession.map((exercise) => exercise.id)).toContain(exercise2.id);
  });
});
