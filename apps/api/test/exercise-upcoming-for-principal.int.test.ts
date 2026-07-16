import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { lmsCaller, staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

// Phase 6 (exercises upcoming UX): `exercise.upcomingForPrincipal` must return ONLY a count
// (never id/title/program) of published exercises whose session hasn't ended yet — proving
// out decision 0038 (exercise content only opens once a class session has ended; a bare count
// for not-yet-ended work does not leak identifying content) and red-team corrections F8
// (must cover both lesson-keyed and legacy unit-keyed exercises) and F9 (count-only, capped).
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
    console.warn('DB not reachable - exercise upcoming tests skipped');
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  await withRls(SUPER, async (tx) => {
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

async function makeFixture(lessonCount: number) {
  return withRls(SUPER, async (tx) => {
    const course = await tx.course.create({
      data: { code: uniq('UPC_C'), name: 'Upcoming exercise course', program: 'UCREA' },
    });
    cleanup.courseIds.push(course.id);

    const unit = await tx.curriculumUnit.create({
      data: {
        courseId: course.id,
        unitCode: uniq('UPC_U'),
        seqInLevel: 1,
        orderGlobal: 1,
        unitType: 'LESSON',
        theme: 'Upcoming exercise unit',
        sessions: lessonCount,
      },
    });
    cleanup.unitIds.push(unit.id);

    const batch = await tx.classBatch.create({
      data: { facilityId: FACILITY, code: uniq('UPC_B'), courseId: course.id, name: 'Upcoming batch', status: 'running' },
    });
    cleanup.batchIds.push(batch.id);

    const student = await tx.student.create({
      data: { facilityId: FACILITY, studentCode: uniq('UPC_S'), fullName: 'Upcoming Exercise Student', program: 'UCREA' },
    });
    cleanup.studentIds.push(student.id);

    const enrollment = await tx.enrollment.create({
      data: { facilityId: FACILITY, classBatchId: batch.id, studentId: student.id, status: 'active' },
    });
    cleanup.enrollmentIds.push(enrollment.id);

    return { course, unit, batch, student };
  });
}

function lmsFor(studentId: string, studentName: string) {
  return lmsCaller({
    kind: 'student',
    accountId: studentId,
    displayName: studentName,
    students: [{ id: studentId, fullName: studentName }],
    studentIds: [studentId],
    facilityIds: [FACILITY],
  });
}

describe('exercise.upcomingForPrincipal', () => {
  it('counts a lesson-keyed published exercise whose session has NOT ended, and payload is count-only', async () => {
    if (!dbReachable) return;
    const { unit, batch, student } = await makeFixture(1);

    const lesson = await withRls(SUPER, (tx) =>
      tx.curriculumLesson.create({
        data: { courseId: unit.courseId, curriculumUnitId: unit.id, lessonCode: `${unit.unitCode}-S01`, seqInUnit: 1, orderGlobal: 1 },
      }),
    );
    cleanup.lessonIds.push(lesson.id);

    const futureSession = await withRls(SUPER, (tx) =>
      tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId: batch.id,
          sessionDate: futureDate(7),
          startTime: '08:00',
          endTime: '09:00',
          status: 'confirmed',
          curriculumUnitId: unit.id,
          curriculumLessonId: lesson.id,
        },
      }),
    );
    cleanup.sessionIds.push(futureSession.id);

    const staff = await staffCaller();
    const exercise = await staff.exercise.upsert({
      curriculumLessonId: lesson.id,
      type: 'homework',
      title: 'Upcoming lesson homework',
      maxScore: 10,
      status: 'published',
    });
    cleanup.exerciseIds.push(exercise.id);

    const lms = lmsFor(student.id, student.fullName);
    const result = await lms.exercise.upcomingForPrincipal();

    expect(Object.keys(result)).toEqual(['upcomingCount']);
    expect(result.upcomingCount).toBeGreaterThanOrEqual(1);
    // The listForPrincipal payload (id/title/program) must never appear for unopened work.
    expect(JSON.stringify(result)).not.toMatch(/Upcoming lesson homework/);
  });

  it('also counts a legacy unit-keyed exercise (curriculumLessonId null) — proves unit-path coverage (F8)', async () => {
    if (!dbReachable) return;
    const { unit, batch, student } = await makeFixture(1);

    const futureSession = await withRls(SUPER, (tx) =>
      tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId: batch.id,
          sessionDate: futureDate(7),
          startTime: '08:00',
          endTime: '09:00',
          status: 'confirmed',
          curriculumUnitId: unit.id,
          curriculumLessonId: null,
        },
      }),
    );
    cleanup.sessionIds.push(futureSession.id);

    // Direct DB write (bypassing the upsert mutation, which always attaches a lessonId) to
    // simulate a pre-0038 legacy row that only carries curriculumUnitId.
    const exercise = await withRls(SUPER, (tx) =>
      tx.exercise.create({
        data: {
          curriculumUnitId: unit.id,
          curriculumLessonId: null,
          type: 'homework',
          title: 'Legacy unit-keyed homework',
          maxScore: 10,
          status: 'published',
        },
      }),
    );
    cleanup.exerciseIds.push(exercise.id);

    const lms = lmsFor(student.id, student.fullName);
    const result = await lms.exercise.upcomingForPrincipal();

    expect(result.upcomingCount).toBeGreaterThanOrEqual(1);
  });

  it('does NOT count an exercise whose session has already ended (that belongs in listForPrincipal, not upcoming)', async () => {
    if (!dbReachable) return;
    const { unit, batch, student } = await makeFixture(1);

    const lesson = await withRls(SUPER, (tx) =>
      tx.curriculumLesson.create({
        data: { courseId: unit.courseId, curriculumUnitId: unit.id, lessonCode: `${unit.unitCode}-S01`, seqInUnit: 1, orderGlobal: 1 },
      }),
    );
    cleanup.lessonIds.push(lesson.id);

    const endedSession = await withRls(SUPER, (tx) =>
      tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId: batch.id,
          sessionDate: pastDate(1),
          startTime: '08:00',
          endTime: '09:00',
          status: 'confirmed',
          curriculumUnitId: unit.id,
          curriculumLessonId: lesson.id,
        },
      }),
    );
    cleanup.sessionIds.push(endedSession.id);

    const staff = await staffCaller();
    const exercise = await staff.exercise.upsert({
      curriculumLessonId: lesson.id,
      type: 'homework',
      title: 'Already opened homework',
      maxScore: 10,
      status: 'published',
    });
    cleanup.exerciseIds.push(exercise.id);

    const lms = lmsFor(student.id, student.fullName);
    const result = await lms.exercise.upcomingForPrincipal();
    expect(result.upcomingCount).toBe(0);

    const opened = await lms.exercise.listForPrincipal();
    expect(opened.map((e) => e.id)).toContain(exercise.id);
  });

  it('caps upcomingCount at 2 even with 3+ upcoming exercises', async () => {
    if (!dbReachable) return;
    const { unit, batch, student } = await makeFixture(3);

    const staff = await staffCaller();
    for (let i = 0; i < 3; i += 1) {
      const lesson = await withRls(SUPER, (tx) =>
        tx.curriculumLesson.create({
          data: { courseId: unit.courseId, curriculumUnitId: unit.id, lessonCode: `${unit.unitCode}-S0${i + 1}`, seqInUnit: i + 1, orderGlobal: i + 1 },
        }),
      );
      cleanup.lessonIds.push(lesson.id);

      const futureSession = await withRls(SUPER, (tx) =>
        tx.classSession.create({
          data: {
            facilityId: FACILITY,
            classBatchId: batch.id,
            sessionDate: futureDate(7 + i),
            startTime: '08:00',
            endTime: '09:00',
            status: 'confirmed',
            curriculumUnitId: unit.id,
            curriculumLessonId: lesson.id,
          },
        }),
      );
      cleanup.sessionIds.push(futureSession.id);

      const exercise = await staff.exercise.upsert({
        curriculumLessonId: lesson.id,
        type: 'homework',
        title: `Upcoming homework ${i + 1}`,
        maxScore: 10,
        status: 'published',
      });
      cleanup.exerciseIds.push(exercise.id);
    }

    const lms = lmsFor(student.id, student.fullName);
    const result = await lms.exercise.upcomingForPrincipal();
    expect(result.upcomingCount).toBe(2);
  });

  it('returns 0 for a student with no enrollment', async () => {
    if (!dbReachable) return;
    const student = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('UPC_NOENR'), fullName: 'No Enrollment Student', program: 'UCREA' },
      }),
    );
    cleanup.studentIds.push(student.id);

    const lms = lmsFor(student.id, student.fullName);
    const result = await lms.exercise.upcomingForPrincipal();
    expect(result.upcomingCount).toBe(0);
  });
});
