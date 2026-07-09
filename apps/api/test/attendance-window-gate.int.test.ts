/**
 * Integration test — attendance.mark / attendance.markAll 15-minute-before to end-of-ICT-day
 * window gate (phase-02-attendance-gate-and-comment-lock.md).
 *
 * Invariants under test:
 *   (a) allowed inside window — session started (or starts within 15min) today, now before
 *       end-of-ICT-day.
 *   (b) rejected before open — session starts >15min from now (today), too early to mark.
 *   (c) rejected after close — session dated yesterday (ICT), window already closed.
 *   regression: a cancelled session is still rejected (existing guard fires regardless of window).
 *
 * Fixtures are built relative to the real `new Date()` (ICT) — NOT fixed far-future dates —
 * because this suite specifically needs "today"/"yesterday" to exercise the window boundaries.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

const FACILITY = 1;
const ICT_OFFSET_MS = 7 * 3600_000;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Wall-clock ICT "now", exposed via UTC getters (so getUTCHours() reads the ICT hour). */
function ictNow(): Date {
  return new Date(Date.now() + ICT_OFFSET_MS);
}

/** UTC-midnight of the ICT calendar date for the given ICT-shifted instant — matches how
 * ClassSession.sessionDate is stored (see attendance-window.ts). */
function ictDateOnlyUtc(ictShifted: Date): Date {
  return new Date(Date.UTC(ictShifted.getUTCFullYear(), ictShifted.getUTCMonth(), ictShifted.getUTCDate()));
}

function hhmm(ictShifted: Date): string {
  return `${pad(ictShifted.getUTCHours())}:${pad(ictShifted.getUTCMinutes())}`;
}

let teacherId: string;
let courseId: string;
let batchId: string;
let studentId: string;
let enrollmentId: string;

let sessionInsideId: string;
let sessionBeforeOpenId: string;
let sessionYesterdayId: string;
let sessionCancelledId: string;

let dbReachable = false;

beforeAll(async () => {
  try {
    await withRls(SUPER, async (tx) => {
      const teacher = await tx.appUser.create({
        data: {
          email: uniq('p2-gate-teacher@cmc.test'),
          displayName: 'P2 Gate Teacher',
          passwordHash: 'test',
          primaryRole: Role.giao_vien,
          roles: [Role.giao_vien],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      });
      teacherId = teacher.id;

      const course = await tx.course.create({
        data: { code: uniq('P2_GATE_C'), name: 'P2 Gate Course', program: 'UCREA' },
      });
      courseId = course.id;

      const batch = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('P2_GATE_B'), courseId, name: 'P2 Gate Batch', status: 'open' },
      });
      batchId = batch.id;

      const student = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('P2_GATE_S'), fullName: 'P2 Gate Student', program: 'UCREA' },
      });
      studentId = student.id;

      const enrollment = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId: batchId, studentId, status: 'active' },
      });
      enrollmentId = enrollment.id;

      const now = ictNow();
      const today = ictDateOnlyUtc(now);
      const yesterday = new Date(today.getTime() - 24 * 3600_000);

      // (a) inside window: started 5 min ago, ends in 1h — well within [start-15min, end-of-day].
      const startedRecently = new Date(now.getTime() - 5 * 60_000);
      const endsSoon = new Date(now.getTime() + 60 * 60_000);
      const sessionInside = await tx.classSession.create({
        data: {
          facilityId: FACILITY, classBatchId: batchId, sessionDate: today,
          startTime: hhmm(startedRecently), endTime: hhmm(endsSoon),
          status: 'confirmed', teacherId,
        },
      });
      sessionInsideId = sessionInside.id;

      // (b) before open: starts in 2h — now < start-15min.
      const startsLater = new Date(now.getTime() + 2 * 3600_000);
      const endsLater = new Date(now.getTime() + 3 * 3600_000);
      const sessionBeforeOpen = await tx.classSession.create({
        data: {
          facilityId: FACILITY, classBatchId: batchId, sessionDate: today,
          startTime: hhmm(startsLater), endTime: hhmm(endsLater),
          status: 'confirmed', teacherId,
        },
      });
      sessionBeforeOpenId = sessionBeforeOpen.id;

      // (c) after close: dated yesterday (ICT) — window closed at end of that ICT day.
      const sessionYesterday = await tx.classSession.create({
        data: {
          facilityId: FACILITY, classBatchId: batchId, sessionDate: yesterday,
          startTime: '10:00', endTime: '11:00',
          status: 'confirmed', teacherId,
        },
      });
      sessionYesterdayId = sessionYesterday.id;

      // regression: cancelled session, dated today inside window — must still be rejected
      // by the pre-existing cancelled-session guard, independent of the window gate. Distinct
      // startTime from sessionInside to avoid the (classBatchId, sessionDate, startTime) unique.
      const startedRecently2 = new Date(startedRecently.getTime() - 60_000);
      const sessionCancelled = await tx.classSession.create({
        data: {
          facilityId: FACILITY, classBatchId: batchId, sessionDate: today,
          startTime: hhmm(startedRecently2), endTime: hhmm(endsSoon),
          status: 'cancelled', teacherId,
        },
      });
      sessionCancelledId = sessionCancelled.id;
    });
    dbReachable = true;
  } catch {
    console.warn('⚠ DB not reachable — attendance window gate tests skipped');
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  await withRls(SUPER, async (tx) => {
    await tx.attendance.deleteMany({ where: { session: { classBatchId: batchId } } });
    await tx.classSession.deleteMany({ where: { classBatchId: batchId } });
    await tx.enrollment.deleteMany({ where: { classBatchId: batchId } });
    await tx.classBatch.deleteMany({ where: { id: batchId } });
    await tx.coursePrice.deleteMany({ where: { courseId } });
    await tx.course.deleteMany({ where: { id: courseId } });
    await tx.student.deleteMany({ where: { id: studentId } });
    await tx.employmentProfile.deleteMany({ where: { userId: teacherId } });
    await tx.appUser.deleteMany({ where: { id: teacherId } });
  });
});

describe('attendance window gate', () => {
  it('(a) allowed inside window — mark and markAll both succeed', async () => {
    if (!dbReachable) return;
    const teacher = await staffCaller({ userId: teacherId, roles: [Role.giao_vien], primaryRole: Role.giao_vien, isSuperAdmin: false, facilityIds: [FACILITY] });

    const marked = await teacher.attendance.mark({ classSessionId: sessionInsideId, enrollmentId, status: 'present' });
    expect(marked.status).toBe('present');

    await teacher.attendance.markAll({ classSessionId: sessionInsideId, defaultStatus: 'present', overrides: [] });
    const rows = await withRls(SUPER, (tx) => tx.attendance.findMany({ where: { classSessionId: sessionInsideId } }));
    expect(rows.some((r) => r.enrollmentId === enrollmentId && r.status === 'present')).toBe(true);
  });

  it('(b) rejected before open — mark and markAll both reject with the gate message', async () => {
    if (!dbReachable) return;
    const teacher = await staffCaller({ userId: teacherId, roles: [Role.giao_vien], primaryRole: Role.giao_vien, isSuperAdmin: false, facilityIds: [FACILITY] });

    await expect(
      teacher.attendance.mark({ classSessionId: sessionBeforeOpenId, enrollmentId, status: 'present' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('Ngoài giờ điểm danh') });
    await expect(
      teacher.attendance.markAll({ classSessionId: sessionBeforeOpenId, defaultStatus: 'present', overrides: [] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('Ngoài giờ điểm danh') });
  });

  it('(c) rejected after close — session dated yesterday (ICT)', async () => {
    if (!dbReachable) return;
    const teacher = await staffCaller({ userId: teacherId, roles: [Role.giao_vien], primaryRole: Role.giao_vien, isSuperAdmin: false, facilityIds: [FACILITY] });

    await expect(
      teacher.attendance.mark({ classSessionId: sessionYesterdayId, enrollmentId, status: 'present' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('Ngoài giờ điểm danh') });
    await expect(
      teacher.attendance.markAll({ classSessionId: sessionYesterdayId, defaultStatus: 'present', overrides: [] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('Ngoài giờ điểm danh') });
  });

  it('regression: a cancelled session is still rejected regardless of window', async () => {
    if (!dbReachable) return;
    const teacher = await staffCaller({ userId: teacherId, roles: [Role.giao_vien], primaryRole: Role.giao_vien, isSuperAdmin: false, facilityIds: [FACILITY] });

    await expect(
      teacher.attendance.mark({ classSessionId: sessionCancelledId, enrollmentId, status: 'present' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('đã hủy') });
    await expect(
      teacher.attendance.markAll({ classSessionId: sessionCancelledId, defaultStatus: 'present', overrides: [] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('đã hủy') });
  });

  // Q3 (plan 260709-1514, user-approved): super_admin and directors correct rosters after the
  // ICT-day cutoff — giao_vien stays gated. Reuses sessionYesterdayId (window closed since (c)).
  it('Q3: a director (giam_doc_dao_tao) bypasses the window gate and can mark outside it', async () => {
    if (!dbReachable) return;
    const director = await staffCaller({
      userId: teacherId,
      roles: [Role.giam_doc_dao_tao],
      primaryRole: Role.giam_doc_dao_tao,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

    const marked = await director.attendance.mark({ classSessionId: sessionYesterdayId, enrollmentId, status: 'present' });
    expect(marked.status).toBe('present');
    await director.attendance.markAll({ classSessionId: sessionYesterdayId, defaultStatus: 'present', overrides: [] });
  });

  it('Q3: super_admin bypasses the window gate and can mark outside it', async () => {
    if (!dbReachable) return;
    const admin = await staffCaller({ facilityIds: [] });

    const marked = await admin.attendance.mark({ classSessionId: sessionYesterdayId, enrollmentId, status: 'present' });
    expect(marked.status).toBe('present');
    await admin.attendance.markAll({ classSessionId: sessionYesterdayId, defaultStatus: 'present', overrides: [] });
  });

  it('Q3: giao_vien (non-director) is still rejected outside the window', async () => {
    if (!dbReachable) return;
    const teacher = await staffCaller({ userId: teacherId, roles: [Role.giao_vien], primaryRole: Role.giao_vien, isSuperAdmin: false, facilityIds: [FACILITY] });

    await expect(
      teacher.attendance.mark({ classSessionId: sessionYesterdayId, enrollmentId, status: 'present' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('Ngoài giờ điểm danh') });
  });
});
