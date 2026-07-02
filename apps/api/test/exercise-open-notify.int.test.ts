/**
 * Integration tests: exercise-open student notification (two triggers).
 *
 * Covers:
 *   (a) Trigger A: exercise published AFTER its unit's session already ended → exactly 1 notif.
 *   (b) Trigger B: exercise exists BEFORE session end; cron tick after → exactly 1 notif;
 *       second tick → 0 (per-pair dedup).
 *   (c) Session moved to a different (still ended) date after being notified → no duplicate.
 *   (d) Both triggers firing on the same (student, exercise) pair → exactly 1 notif total.
 *   (e) Negatives: cancelled session, draft exercise, withdrawn enrollment → 0 notifs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';
import { notifyForExercise, runExerciseOpenNotifications } from '../src/services/exercise-open-notify.js';

const FACILITY = 1;

async function directorCaller() {
  return staffCaller({ roles: [Role.giam_doc_dao_tao], primaryRole: Role.giam_doc_dao_tao, isSuperAdmin: false });
}

let dbReachable = false;
let courseId: string;

const cleanup = {
  unitIds: [] as string[],
  batchIds: [] as string[],
  studentIds: [] as string[],
  enrollmentIds: [] as string[],
  sessionIds: [] as string[],
  exerciseIds: [] as string[],
};

// Trigger B's cron scan is batch-agnostic (any recently-ended session), and its class-wide
// enrollment check opens a unit for EVERY active enrollment in that unit's batch — exactly
// like production's openedUnitIdsFor. Each scenario therefore needs its own class batch, or
// scenarios would cross-open each other's units for each other's students.
async function makeBatch() {
  const batch = await withRls(SUPER, (tx) =>
    tx.classBatch.create({ data: { facilityId: FACILITY, code: uniq('EON_B'), courseId, name: 'EON Batch', status: 'open' } }),
  );
  cleanup.batchIds.push(batch.id);
  return batch.id;
}

async function makeUnit(orderGlobal: number) {
  const unit = await withRls(SUPER, (tx) =>
    tx.curriculumUnit.create({
      data: {
        courseId,
        unitCode: uniq('EON_U'),
        seqInLevel: 1,
        orderGlobal,
        unitType: 'LESSON',
        theme: 'exercise-open-notify test unit',
        sessions: 1,
      },
    }),
  );
  cleanup.unitIds.push(unit.id);
  return unit.id;
}

async function makeStudent() {
  const student = await withRls(SUPER, (tx) =>
    tx.student.create({
      data: { facilityId: FACILITY, studentCode: uniq('EON_S'), fullName: 'Notify Test Student', program: 'UCREA' },
    }),
  );
  cleanup.studentIds.push(student.id);
  return student.id;
}

async function makeEnrollment(batchId: string, studentId: string, status: 'active' | 'withdrawn' = 'active') {
  const enrollment = await withRls(SUPER, (tx) =>
    tx.enrollment.create({ data: { facilityId: FACILITY, classBatchId: batchId, studentId, status } }),
  );
  cleanup.enrollmentIds.push(enrollment.id);
  return enrollment.id;
}

// Trigger B's cron scan is bounded to a 24h lookback, so fixture sessions must have already
// ended but recently — derive (sessionDate, startTime/endTime) from a target end-UTC instant,
// mirroring sessionEndUtc's ICT math exactly, so the fixture lands inside the scan window.
function ictSlotEndingAt(hoursAgo: number): { sessionDate: Date; startTime: string; endTime: string } {
  const endUtc = new Date(Date.now() - hoursAgo * 3_600_000);
  const ict = new Date(endUtc.getTime() + 7 * 3_600_000); // ICT wall-clock for that UTC instant
  const sessionDate = new Date(Date.UTC(ict.getUTCFullYear(), ict.getUTCMonth(), ict.getUTCDate()));
  const pad = (n: number) => String(n).padStart(2, '0');
  const endTime = `${pad(ict.getUTCHours())}:${pad(ict.getUTCMinutes())}`;
  const startHour = ict.getUTCHours() > 0 ? ict.getUTCHours() - 1 : 0;
  const startTime = `${pad(startHour)}:${pad(ict.getUTCMinutes())}`;
  return { sessionDate, startTime, endTime };
}

// classSession has a (classBatchId, sessionDate, startTime) unique constraint — every fixture
// session in this suite shares one batch, so each call gets its own (recent, distinct) end time.
let sessionSeq = 0;
function nextIctSlot(): { sessionDate: Date; startTime: string; endTime: string } {
  sessionSeq += 1;
  return ictSlotEndingAt(sessionSeq); // 1h ago, 2h ago, ... — all within the 24h lookback
}

async function makeSession(batchId: string, unitId: string, opts: { hoursAgo?: number; status?: 'confirmed' | 'cancelled' } = {}) {
  const slot = opts.hoursAgo !== undefined ? ictSlotEndingAt(opts.hoursAgo) : nextIctSlot();
  const session = await withRls(SUPER, (tx) =>
    tx.classSession.create({
      data: {
        facilityId: FACILITY,
        classBatchId: batchId,
        sessionDate: slot.sessionDate,
        startTime: slot.startTime,
        endTime: slot.endTime,
        status: opts.status ?? 'confirmed',
        isMakeup: false,
        curriculumUnitId: unitId,
      },
    }),
  );
  cleanup.sessionIds.push(session.id);
  return session;
}

async function makeExercise(unitId: string, status: 'draft' | 'published' = 'published') {
  const exercise = await withRls(SUPER, (tx) =>
    tx.exercise.create({ data: { curriculumUnitId: unitId, title: uniq('EON_EX'), type: 'homework', maxScore: 10, status } }),
  );
  cleanup.exerciseIds.push(exercise.id);
  return exercise;
}

async function notifCount(studentId: string, exerciseId: string): Promise<number> {
  return withRls(SUPER, (tx) =>
    tx.notification.count({
      where: {
        type: 'new_exercise_open',
        recipientType: 'student',
        recipientId: studentId,
        payload: { path: ['exerciseId'], equals: exerciseId },
      },
    }),
  );
}

beforeAll(async () => {
  try {
    await superAdminUserId();
    dbReachable = true;
    await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({ data: { code: uniq('EON_C'), name: 'Exercise-Open-Notify Test Course', program: 'UCREA' } });
      courseId = course.id;
    });
  } catch {
    console.warn('⚠ DB not reachable — exercise-open-notify tests skipped');
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  await withRls(SUPER, async (tx) => {
    if (cleanup.studentIds.length) {
      await tx.notification.deleteMany({ where: { recipientType: 'student', recipientId: { in: cleanup.studentIds } } });
    }
    if (cleanup.exerciseIds.length) await tx.exercise.deleteMany({ where: { id: { in: cleanup.exerciseIds } } });
    if (cleanup.sessionIds.length) await tx.classSession.deleteMany({ where: { id: { in: cleanup.sessionIds } } });
    if (cleanup.enrollmentIds.length) await tx.enrollment.deleteMany({ where: { id: { in: cleanup.enrollmentIds } } });
    if (cleanup.studentIds.length) await tx.student.deleteMany({ where: { id: { in: cleanup.studentIds } } });
    if (cleanup.batchIds.length) await tx.classBatch.deleteMany({ where: { id: { in: cleanup.batchIds } } });
    if (cleanup.unitIds.length) await tx.curriculumUnit.deleteMany({ where: { id: { in: cleanup.unitIds } } });
    if (courseId) await tx.course.deleteMany({ where: { id: courseId } });
  });
});

describe('exercise-open-notify', () => {
  it('(a) Trigger A: publish AFTER session ended → exactly 1 notif', async () => {
    if (!dbReachable) return;
    const batchId = await makeBatch();
    const unitId = await makeUnit(1);
    const studentId = await makeStudent();
    await makeEnrollment(batchId, studentId);
    await makeSession(batchId, unitId);

    const director = await directorCaller();
    const exercise = await director.exercise.upsert({
      curriculumUnitId: unitId,
      type: 'homework',
      title: 'Trigger A exercise',
      maxScore: 10,
      status: 'published',
    });
    cleanup.exerciseIds.push(exercise.id);

    expect(await notifCount(studentId, exercise.id)).toBe(1);
  });

  it('(b) Trigger B: exercise exists BEFORE session end; cron tick → 1 notif, second tick → 0 new', async () => {
    if (!dbReachable) return;
    const batchId = await makeBatch();
    const unitId = await makeUnit(2);
    const studentId = await makeStudent();
    await makeEnrollment(batchId, studentId);
    await makeSession(batchId, unitId);
    const exercise = await makeExercise(unitId, 'published');

    const first = await runExerciseOpenNotifications();
    expect(first.notificationsCreated).toBeGreaterThanOrEqual(1);
    expect(await notifCount(studentId, exercise.id)).toBe(1);

    const second = await runExerciseOpenNotifications();
    expect(second.notificationsCreated).toBe(0);
    expect(await notifCount(studentId, exercise.id)).toBe(1);
  });

  it('(c) session moved to a different ended date after notify → no duplicate', async () => {
    if (!dbReachable) return;
    const batchId = await makeBatch();
    const unitId = await makeUnit(3);
    const studentId = await makeStudent();
    await makeEnrollment(batchId, studentId);
    const session = await makeSession(batchId, unitId);
    const exercise = await makeExercise(unitId, 'published');

    await runExerciseOpenNotifications();
    expect(await notifCount(studentId, exercise.id)).toBe(1);

    // Simulate an editSlot.applyToFuture move: session shifts to a different, still-ended slot.
    const moved = nextIctSlot();
    await withRls(SUPER, (tx) =>
      tx.classSession.update({ where: { id: session.id }, data: { sessionDate: moved.sessionDate, startTime: moved.startTime, endTime: moved.endTime } }),
    );
    await runExerciseOpenNotifications();
    expect(await notifCount(studentId, exercise.id)).toBe(1);
  });

  it('(d) both triggers on the same pair → exactly 1 notif total', async () => {
    if (!dbReachable) return;
    const batchId = await makeBatch();
    const unitId = await makeUnit(4);
    const studentId = await makeStudent();
    await makeEnrollment(batchId, studentId);
    await makeSession(batchId, unitId);

    // Trigger B runs first — no exercise yet, nothing to notify.
    const before = await runExerciseOpenNotifications();
    expect(before.notificationsCreated).toBe(0);

    // Trigger A: director publishes → notifies immediately.
    const director = await directorCaller();
    const exercise = await director.exercise.upsert({
      curriculumUnitId: unitId,
      type: 'homework',
      title: 'Both-triggers exercise',
      maxScore: 10,
      status: 'published',
    });
    cleanup.exerciseIds.push(exercise.id);
    expect(await notifCount(studentId, exercise.id)).toBe(1);

    // Trigger B runs again — dedup must not double-notify.
    await runExerciseOpenNotifications();
    expect(await notifCount(studentId, exercise.id)).toBe(1);
  });

  it('(d2) both triggers fired truly concurrently on the same pair → exactly 1 notif (advisory-lock guard)', async () => {
    if (!dbReachable) return;
    const batchId = await makeBatch();
    const unitId = await makeUnit(4);
    const studentId = await makeStudent();
    await makeEnrollment(batchId, studentId);
    await makeSession(batchId, unitId);

    const director = await directorCaller();
    const exercise = await director.exercise.upsert({
      curriculumUnitId: unitId,
      type: 'homework',
      title: 'Concurrent-triggers exercise',
      maxScore: 10,
      status: 'published',
    });
    cleanup.exerciseIds.push(exercise.id);
    // exercise.upsert already fires Trigger A once (post-commit). Race two MORE calls against
    // each other via Promise.all (not sequential await) so the dedup read-then-insert window in
    // dedupAndCreate is genuinely contended — this is what the per-student advisory lock guards.
    await Promise.all([notifyForExercise(exercise.id), runExerciseOpenNotifications()]);
    expect(await notifCount(studentId, exercise.id)).toBe(1);
  });

  it('(e) negatives: cancelled session / draft exercise / withdrawn enrollment → 0 notifs', async () => {
    if (!dbReachable) return;

    // cancelled session
    const batchCancelled = await makeBatch();
    const unitCancelled = await makeUnit(5);
    const studentCancelled = await makeStudent();
    await makeEnrollment(batchCancelled, studentCancelled);
    await makeSession(batchCancelled, unitCancelled, { status: 'cancelled' });
    const exCancelled = await makeExercise(unitCancelled, 'published');

    // draft exercise
    const batchDraft = await makeBatch();
    const unitDraft = await makeUnit(6);
    const studentDraft = await makeStudent();
    await makeEnrollment(batchDraft, studentDraft);
    await makeSession(batchDraft, unitDraft);
    const exDraft = await makeExercise(unitDraft, 'draft');

    // withdrawn enrollment
    const batchWithdrawn = await makeBatch();
    const unitWithdrawn = await makeUnit(7);
    const studentWithdrawn = await makeStudent();
    await makeEnrollment(batchWithdrawn, studentWithdrawn, 'withdrawn');
    await makeSession(batchWithdrawn, unitWithdrawn);
    const exWithdrawn = await makeExercise(unitWithdrawn, 'published');

    await runExerciseOpenNotifications();

    expect(await notifCount(studentCancelled, exCancelled.id)).toBe(0);
    expect(await notifCount(studentDraft, exDraft.id)).toBe(0);
    expect(await notifCount(studentWithdrawn, exWithdrawn.id)).toBe(0);

    // Trigger A path for the draft case too: publishing to draft never calls notifyForExercise.
    const result = await notifyForExercise(exDraft.id);
    expect(result.notificationsCreated).toBe(0);
  });
});
