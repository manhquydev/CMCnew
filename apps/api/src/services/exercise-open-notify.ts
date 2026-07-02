import { withRls } from '@cmc/db';
import type { Prisma } from '@cmc/db';
import { openStudentIdsForUnit, sessionEndUtc } from '../lib/exercise-open.js';
import { emitNotification } from '../events.js';

// System context: both triggers run outside the director's request-scoped RLS transaction
// (Trigger A after commit, Trigger B on a cron tick with no session). super bypass.
const SYSTEM_CTX = { facilityIds: [] as number[], isSuperAdmin: true };

const NOTIF_TYPE = 'new_exercise_open';

interface Candidate {
  studentId: string;
  exerciseId: string;
  curriculumUnitId: string;
}

interface CreatedNotif {
  id: string;
  studentId: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}

/**
 * Shared dedup+insert core for both triggers. Idempotency key is (studentId, exerciseId),
 * read back from existing notification rows (type + recipientId), not a scan-window or
 * sessionId — a student is notified exactly once per exercise becoming visible to them,
 * however many times either trigger re-evaluates the pair.
 */
async function dedupAndCreate(tx: Prisma.TransactionClient, candidates: Candidate[]): Promise<CreatedNotif[]> {
  if (candidates.length === 0) return [];

  const studentIds = [...new Set(candidates.map((c) => c.studentId))];
  // Serialize per-student against a concurrent Trigger A/B (or overlapping cron tick) so the
  // dedup read-then-insert below can't race itself into a duplicate notification — there is no
  // DB-level unique constraint on (recipientId, type, exerciseId) to backstop it otherwise (no
  // schema change per plan). Namespaced distinctly from rewards.ts's redeem lock, which also
  // hashes on studentId for an unrelated purpose.
  for (const studentId of studentIds) {
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext('exercise-notify:' || $1)::bigint)",
      studentId,
    );
  }
  const existing = await tx.notification.findMany({
    where: { type: NOTIF_TYPE, recipientType: 'student', recipientId: { in: studentIds } },
    select: { recipientId: true, payload: true },
  });
  const alreadyNotified = new Set<string>();
  for (const n of existing) {
    const exerciseId = (n.payload as Record<string, unknown> | null)?.exerciseId;
    if (typeof exerciseId === 'string') alreadyNotified.add(`${n.recipientId}:${exerciseId}`);
  }

  const seen = new Set<string>();
  const toCreate = candidates.filter((c) => {
    const key = `${c.studentId}:${c.exerciseId}`;
    if (alreadyNotified.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (toCreate.length === 0) return [];

  const students = await tx.student.findMany({
    where: { id: { in: [...new Set(toCreate.map((c) => c.studentId))] } },
    select: { id: true, facilityId: true },
  });
  const facilityByStudent = new Map(students.map((s) => [s.id, s.facilityId]));

  const created: CreatedNotif[] = [];
  for (const c of toCreate) {
    const notif = await tx.notification.create({
      data: {
        facilityId: facilityByStudent.get(c.studentId) ?? null,
        recipientType: 'student',
        recipientId: c.studentId,
        type: NOTIF_TYPE,
        payload: { exerciseId: c.exerciseId, curriculumUnitId: c.curriculumUnitId },
      },
      select: { id: true, type: true, payload: true, createdAt: true },
    });
    created.push({ id: notif.id, studentId: c.studentId, type: notif.type, payload: notif.payload, createdAt: notif.createdAt });
  }
  return created;
}

function emitCreated(created: CreatedNotif[]): void {
  for (const n of created) {
    emitNotification({
      studentId: n.studentId,
      notification: { id: n.id, type: n.type, payload: n.payload, createdAt: n.createdAt.toISOString() },
    });
  }
}

export interface NotifyForExerciseResult {
  notificationsCreated: number;
}

/**
 * Trigger A — fires after exercise.upsert commits a published exercise. Resolves every
 * student for whom the unit is already open (inverse of openedUnitIdsFor, no time window)
 * and notifies once per (student, exercise) pair. Runs in its own SYSTEM_CTX pass, never
 * inside the director's RLS transaction.
 */
export async function notifyForExercise(exerciseId: string, now: Date = new Date()): Promise<NotifyForExerciseResult> {
  const created = await withRls(SYSTEM_CTX, async (tx) => {
    const exercise = await tx.exercise.findUnique({
      where: { id: exerciseId },
      select: { id: true, status: true, archivedAt: true, curriculumUnitId: true },
    });
    if (!exercise || exercise.status !== 'published' || exercise.archivedAt || !exercise.curriculumUnitId) return [];

    const studentIds = await openStudentIdsForUnit(tx, exercise.curriculumUnitId, now);
    if (studentIds.length === 0) return [];

    const curriculumUnitId = exercise.curriculumUnitId;
    const candidates: Candidate[] = studentIds.map((studentId) => ({ studentId, exerciseId: exercise.id, curriculumUnitId }));
    return dedupAndCreate(tx, candidates);
  });

  emitCreated(created);
  return { notificationsCreated: created.length };
}

export interface RunExerciseOpenNotificationsResult {
  sessionsScanned: number;
  notificationsCreated: number;
}

/**
 * Trigger B — cron scan of sessions whose end time falls in the lookback window (catches the
 * reverse ordering: exercise already existed, session just ended). 24h lookback with per-pair
 * dedup means overlap across ticks is free of duplicates, so a missed tick self-heals on the
 * next one. Query is bounded by sessionDate >= now-2d to stay cheap.
 */
export async function runExerciseOpenNotifications(now: Date = new Date()): Promise<RunExerciseOpenNotificationsResult> {
  const lookbackStart = new Date(now.getTime() - 24 * 3_600_000);
  const dateFloor = new Date(now.getTime() - 2 * 24 * 3_600_000);

  const { created, sessionsScanned } = await withRls(SYSTEM_CTX, async (tx) => {
    const sessions = await tx.classSession.findMany({
      where: {
        status: { not: 'cancelled' },
        curriculumUnitId: { not: null },
        sessionDate: { gte: dateFloor },
      },
      select: { curriculumUnitId: true, sessionDate: true, endTime: true },
    });

    let scanned = 0;
    const endedUnitIds = new Set<string>();
    for (const s of sessions) {
      if (!s.curriculumUnitId) continue;
      const endUtc = sessionEndUtc(s.sessionDate, s.endTime).getTime();
      if (endUtc >= lookbackStart.getTime() && endUtc <= now.getTime()) {
        scanned++;
        endedUnitIds.add(s.curriculumUnitId);
      }
    }
    if (endedUnitIds.size === 0) return { created: [] as CreatedNotif[], sessionsScanned: scanned };

    const exercises = await tx.exercise.findMany({
      where: { curriculumUnitId: { in: [...endedUnitIds] }, status: 'published', archivedAt: null },
      select: { id: true, curriculumUnitId: true },
    });
    if (exercises.length === 0) return { created: [] as CreatedNotif[], sessionsScanned: scanned };

    const candidates: Candidate[] = [];
    for (const ex of exercises) {
      if (!ex.curriculumUnitId) continue;
      const studentIds = await openStudentIdsForUnit(tx, ex.curriculumUnitId, now);
      for (const studentId of studentIds) {
        candidates.push({ studentId, exerciseId: ex.id, curriculumUnitId: ex.curriculumUnitId });
      }
    }
    if (candidates.length === 0) return { created: [] as CreatedNotif[], sessionsScanned: scanned };

    const created = await dedupAndCreate(tx, candidates);
    return { created, sessionsScanned: scanned };
  });

  emitCreated(created);
  return { sessionsScanned, notificationsCreated: created.length };
}
