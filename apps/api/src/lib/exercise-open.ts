import { TRPCError } from '@trpc/server';
import type { Prisma } from '@cmc/db';
import { BLOCKED_LMS_LIFECYCLE } from '@cmc/auth';

const ICT_OFFSET_HOURS = 7;

export function sessionEndUtc(sessionDate: Date, endTime: string): Date {
  const [hourRaw, minuteRaw] = endTime.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid session end time: ${endTime}`);
  }
  return new Date(Date.UTC(
    sessionDate.getUTCFullYear(),
    sessionDate.getUTCMonth(),
    sessionDate.getUTCDate(),
    hour - ICT_OFFSET_HOURS,
    minute,
    0,
    0,
  ));
}

export function sessionHasEnded(sessionDate: Date, endTime: string, now: Date = new Date()): boolean {
  return sessionEndUtc(sessionDate, endTime).getTime() <= now.getTime();
}

// Tier B: makeup sessions attended (present/late) by a specific student open that
// session's curriculumUnitId individually for them, even though Tier A (below) excludes
// isMakeup sessions from the class-wide open set. Keyed on Attendance, never class-wide —
// a makeup taught for one absent student must not open the unit for the whole batch (C1).
async function makeupOverrideUnitIdsFor(
  tx: Prisma.TransactionClient,
  studentIds: string[],
  now: Date,
): Promise<Map<string, Set<string>>> {
  const byStudent = new Map<string, Set<string>>();
  if (studentIds.length === 0) return byStudent;
  const attended = await tx.attendance.findMany({
    where: {
      status: { in: ['present', 'late'] },
      enrollment: { studentId: { in: studentIds } },
      session: {
        isMakeup: true,
        curriculumUnitId: { not: null },
        status: { not: 'cancelled' },
      },
    },
    select: {
      enrollment: { select: { studentId: true } },
      session: { select: { curriculumUnitId: true, sessionDate: true, endTime: true } },
    },
  });
  for (const a of attended) {
    const { session } = a;
    if (!session.curriculumUnitId || !sessionHasEnded(session.sessionDate, session.endTime, now)) continue;
    const studentId = a.enrollment.studentId;
    const set = byStudent.get(studentId) ?? new Set<string>();
    set.add(session.curriculumUnitId);
    byStudent.set(studentId, set);
  }
  return byStudent;
}

async function makeupOverrideLessonIdsFor(
  tx: Prisma.TransactionClient,
  studentIds: string[],
  now: Date,
): Promise<Map<string, Set<string>>> {
  const byStudent = new Map<string, Set<string>>();
  if (studentIds.length === 0) return byStudent;
  const attended = await tx.attendance.findMany({
    where: {
      status: { in: ['present', 'late'] },
      enrollment: { studentId: { in: studentIds } },
      session: {
        isMakeup: true,
        curriculumLessonId: { not: null },
        status: { not: 'cancelled' },
      },
    },
    select: {
      enrollment: { select: { studentId: true } },
      session: { select: { curriculumLessonId: true, sessionDate: true, endTime: true } },
    },
  });
  for (const a of attended) {
    const { session } = a;
    if (!session.curriculumLessonId || !sessionHasEnded(session.sessionDate, session.endTime, now)) continue;
    const studentId = a.enrollment.studentId;
    const set = byStudent.get(studentId) ?? new Set<string>();
    set.add(session.curriculumLessonId);
    byStudent.set(studentId, set);
  }
  return byStudent;
}

export async function openedLessonIdsFor(
  tx: Prisma.TransactionClient,
  studentIds: string[],
  now: Date = new Date(),
): Promise<string[]> {
  if (studentIds.length === 0) return [];
  const sessions = await tx.classSession.findMany({
    where: {
      status: { not: 'cancelled' },
      curriculumLessonId: { not: null },
      isMakeup: false,
      batch: {
        enrollments: {
          some: {
            studentId: { in: studentIds },
            // 'completed' (director marked the student's run through this class finished) must
            // still see past published exercises/grades — only 'active' would make a student's
            // whole homework history vanish from the LMS the moment their enrollment closes.
            // Actually opening NEW work still requires 'active' (assertExerciseOpenForStudent
            // below, unchanged) — this only affects what's listed/visible.
            status: { in: ['active', 'completed'] },
            archivedAt: null,
          },
        },
      },
    },
    select: { curriculumLessonId: true, sessionDate: true, endTime: true },
  });
  const opened = new Set(
    sessions
      .filter((s) => s.curriculumLessonId && sessionHasEnded(s.sessionDate, s.endTime, now))
      .map((s) => s.curriculumLessonId!),
  );

  const overrides = await makeupOverrideLessonIdsFor(tx, studentIds, now);
  for (const set of overrides.values()) {
    for (const lessonId of set) opened.add(lessonId);
  }

  return [...opened];
}

export async function openedUnitIdsFor(
  tx: Prisma.TransactionClient,
  studentIds: string[],
  now: Date = new Date(),
): Promise<string[]> {
  if (studentIds.length === 0) return [];
  const sessions = await tx.classSession.findMany({
    where: {
      status: { not: 'cancelled' },
      curriculumUnitId: { not: null },
      isMakeup: false,
      batch: {
        enrollments: {
          some: {
            studentId: { in: studentIds },
            // Same reasoning as openedLessonIdsFor above: 'completed' must keep seeing past work.
            status: { in: ['active', 'completed'] },
            archivedAt: null,
          },
        },
      },
    },
    select: { curriculumUnitId: true, sessionDate: true, endTime: true },
  });
  const opened = new Set(
    sessions
      .filter((s) => s.curriculumUnitId && sessionHasEnded(s.sessionDate, s.endTime, now))
      .map((s) => s.curriculumUnitId!),
  );

  const overrides = await makeupOverrideUnitIdsFor(tx, studentIds, now);
  for (const set of overrides.values()) {
    for (const unitId of set) opened.add(unitId);
  }

  return [...opened];
}

// Mirror of openedLessonIdsFor/openedUnitIdsFor for sessions that are SCHEDULED but have NOT
// ended yet — feeds the "upcoming (locked)" node count (Phase 6). Only 'active' enrollments
// count (unlike opened*, which also includes 'completed' for viewing PAST work) — a completed
// enrollment has no bearing on work that hasn't opened yet. Non-makeup only, matching Tier A of
// the opened-check (a not-yet-happened makeup session can't have been attended yet either).
export async function upcomingLessonIdsFor(
  tx: Prisma.TransactionClient,
  studentIds: string[],
  now: Date = new Date(),
): Promise<string[]> {
  if (studentIds.length === 0) return [];
  const sessions = await tx.classSession.findMany({
    where: {
      status: { not: 'cancelled' },
      curriculumLessonId: { not: null },
      isMakeup: false,
      batch: {
        enrollments: {
          some: { studentId: { in: studentIds }, status: 'active', archivedAt: null },
        },
      },
    },
    select: { curriculumLessonId: true, sessionDate: true, endTime: true },
  });
  const upcoming = new Set(
    sessions
      .filter((s) => s.curriculumLessonId && !sessionHasEnded(s.sessionDate, s.endTime, now))
      .map((s) => s.curriculumLessonId!),
  );
  return [...upcoming];
}

export async function upcomingUnitIdsFor(
  tx: Prisma.TransactionClient,
  studentIds: string[],
  now: Date = new Date(),
): Promise<string[]> {
  if (studentIds.length === 0) return [];
  const sessions = await tx.classSession.findMany({
    where: {
      status: { not: 'cancelled' },
      curriculumUnitId: { not: null },
      isMakeup: false,
      batch: {
        enrollments: {
          some: { studentId: { in: studentIds }, status: 'active', archivedAt: null },
        },
      },
    },
    select: { curriculumUnitId: true, sessionDate: true, endTime: true },
  });
  const upcoming = new Set(
    sessions
      .filter((s) => s.curriculumUnitId && !sessionHasEnded(s.sessionDate, s.endTime, now))
      .map((s) => s.curriculumUnitId!),
  );
  return [...upcoming];
}

export async function openStudentIdsForLesson(
  tx: Prisma.TransactionClient,
  curriculumLessonId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const studentIds = new Set<string>();
  const blockedLifecycles = [...BLOCKED_LMS_LIFECYCLE];

  const sessions = await tx.classSession.findMany({
    where: {
      status: { not: 'cancelled' },
      curriculumLessonId,
      isMakeup: false,
    },
    select: {
      sessionDate: true,
      endTime: true,
      batch: {
        select: {
          enrollments: {
            where: { status: 'active', archivedAt: null, student: { lifecycle: { notIn: blockedLifecycles } } },
            select: { studentId: true },
          },
        },
      },
    },
  });
  for (const s of sessions) {
    if (!sessionHasEnded(s.sessionDate, s.endTime, now)) continue;
    for (const e of s.batch.enrollments) studentIds.add(e.studentId);
  }

  const makeupAttended = await tx.attendance.findMany({
    where: {
      status: { in: ['present', 'late'] },
      session: {
        isMakeup: true,
        curriculumLessonId,
        status: { not: 'cancelled' },
      },
      enrollment: { student: { lifecycle: { notIn: blockedLifecycles } } },
    },
    select: {
      enrollment: { select: { studentId: true } },
      session: { select: { sessionDate: true, endTime: true } },
    },
  });
  for (const a of makeupAttended) {
    if (sessionHasEnded(a.session.sessionDate, a.session.endTime, now)) {
      studentIds.add(a.enrollment.studentId);
    }
  }

  return [...studentIds];
}

// Inverse of openedUnitIdsFor: given one curriculumUnitId, which students already have it
// open. Mirrors the exact same predicate (tier A class-wide non-makeup session end, tier B
// per-student makeup attendance) so notify == visible — see exercise-open-notify.ts.
export async function openStudentIdsForUnit(
  tx: Prisma.TransactionClient,
  curriculumUnitId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const studentIds = new Set<string>();

  // notifyForExercise/runExerciseOpenNotifications call this directly (no pre-filtered studentIds
  // list, unlike openedUnitIdsFor's callers which always pass an already lifecycle-filtered set
  // from lms.ts's session resolution) — so this function must filter lifecycle itself.
  const blockedLifecycles = [...BLOCKED_LMS_LIFECYCLE];

  const sessions = await tx.classSession.findMany({
    where: {
      status: { not: 'cancelled' },
      curriculumUnitId,
      isMakeup: false,
    },
    select: {
      sessionDate: true,
      endTime: true,
      batch: {
        select: {
          enrollments: {
            where: { status: 'active', archivedAt: null, student: { lifecycle: { notIn: blockedLifecycles } } },
            select: { studentId: true },
          },
        },
      },
    },
  });
  for (const s of sessions) {
    if (!sessionHasEnded(s.sessionDate, s.endTime, now)) continue;
    for (const e of s.batch.enrollments) studentIds.add(e.studentId);
  }

  const makeupAttended = await tx.attendance.findMany({
    where: {
      status: { in: ['present', 'late'] },
      session: {
        isMakeup: true,
        curriculumUnitId,
        status: { not: 'cancelled' },
      },
      enrollment: { student: { lifecycle: { notIn: blockedLifecycles } } },
    },
    select: {
      enrollment: { select: { studentId: true } },
      session: { select: { sessionDate: true, endTime: true } },
    },
  });
  for (const a of makeupAttended) {
    if (sessionHasEnded(a.session.sessionDate, a.session.endTime, now)) {
      studentIds.add(a.enrollment.studentId);
    }
  }

  return [...studentIds];
}

export async function assertExerciseOpenForStudent(
  tx: Prisma.TransactionClient,
  exerciseId: string,
  studentId: string,
  now: Date = new Date(),
) {
  const exercise = await tx.exercise.findUniqueOrThrow({
    where: { id: exerciseId },
    select: { id: true, status: true, curriculumUnitId: true, curriculumLessonId: true },
  });
  if (exercise.status !== 'published') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Bài tập chưa được công bố' });
  }

  const sessions = await tx.classSession.findMany({
    where: {
      status: { not: 'cancelled' },
      ...(exercise.curriculumLessonId
        ? { curriculumLessonId: exercise.curriculumLessonId }
        : { curriculumUnitId: exercise.curriculumUnitId }),
      isMakeup: false,
      batch: {
        enrollments: {
          some: {
            studentId,
            status: 'active',
            archivedAt: null,
          },
        },
      },
    },
    select: { facilityId: true, sessionDate: true, endTime: true },
  });
  const openedSession = sessions.find((s) => sessionHasEnded(s.sessionDate, s.endTime, now));
  if (openedSession) {
    return { exercise, facilityId: openedSession.facilityId };
  }

  // Tier B: this student individually attended (present/late) a makeup session mapped to
  // this exercise's lesson — grant early access even though the class-wide Tier-A check above
  // (which excludes isMakeup) found nothing.
  if (exercise.curriculumLessonId || exercise.curriculumUnitId) {
    const makeupAttendance = await tx.attendance.findFirst({
      where: {
        status: { in: ['present', 'late'] },
        enrollment: { studentId },
        session: {
          isMakeup: true,
          ...(exercise.curriculumLessonId
            ? { curriculumLessonId: exercise.curriculumLessonId }
            : { curriculumUnitId: exercise.curriculumUnitId }),
          status: { not: 'cancelled' },
        },
      },
      select: { session: { select: { facilityId: true, sessionDate: true, endTime: true } } },
    });
    if (makeupAttendance && sessionHasEnded(makeupAttendance.session.sessionDate, makeupAttendance.session.endTime, now)) {
      return { exercise, facilityId: makeupAttendance.session.facilityId };
    }
  }

  throw new TRPCError({ code: 'FORBIDDEN', message: 'Bài tập chưa mở cho học sinh này' });
}
