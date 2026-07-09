/**
 * Integration tests: Plan 5 P2 — schedule.createMakeupSession + the C1 exercise-gate fix.
 *
 * Covers:
 *   (a) makeup session created with isMakeup=true, excluded from curriculum-recompute
 *       (recomputeCurriculumMapping never reassigns/nulls its curriculumUnitId).
 *   (b) room/teacher conflict is rejected (reuses detectConflicts like generateSessions).
 *   (c) attendance can be marked on a makeup session and shows up in listBySession.
 *   (d) C1 Tier-A regression: a makeup session mapped to a not-yet-reached unit does NOT
 *       open that unit's exercise for a non-attendee batchmate.
 *   (e) C1 Tier-B: a student with a present/late Attendance row on that ended makeup
 *       session DOES get individual early access to that unit's exercise.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type LmsSession } from '@cmc/auth';
import { staffCaller, lmsCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';
import { recomputeCurriculumMapping } from '../src/services/curriculum-recompute.js';

const FACILITY = 1;

let courseId: string;
let classBatchId: string;
let unit1Id: string; // reached via a regular (non-makeup) session
let unit2Id: string; // reached ONLY via the makeup session — never via a regular session
let exercise2Id: string;
let roomId: string;
let teacherId: string;
let regularSessionId: string;
let makeupSessionId: string;

let attendeeStudentId: string;
let attendeeEnrollmentId: string;
let nonAttendeeStudentId: string;
let nonAttendeeEnrollmentId: string;

let dbReachable = false;

const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
const twoDaysAgoKey = twoDaysAgo.toISOString().slice(0, 10);

function studentSession(studentId: string): LmsSession {
  return {
    kind: 'student',
    accountId: 'test-account',
    displayName: 'Makeup Test Student',
    students: [{ id: studentId, fullName: 'Makeup Test Student' }],
    studentIds: [studentId],
    facilityIds: [FACILITY],
  };
}

beforeAll(async () => {
  try {
    await superAdminUserId();
    dbReachable = true;

    await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({
        data: { code: uniq('MKP_C'), name: 'Makeup Test Course', program: 'UCREA' },
      });
      courseId = course.id;

      const unit1 = await tx.curriculumUnit.create({
        data: {
          courseId,
          unitCode: uniq('MKP_U1'),
          seqInLevel: 1,
          orderGlobal: 1,
          unitType: 'LESSON',
          theme: 'Makeup gate — reached unit',
          sessions: 1,
        },
      });
      unit1Id = unit1.id;

      const unit2 = await tx.curriculumUnit.create({
        data: {
          courseId,
          unitCode: uniq('MKP_U2'),
          seqInLevel: 1,
          orderGlobal: 2,
          unitType: 'LESSON',
          theme: 'Makeup gate — not-yet-reached unit',
          sessions: 1,
        },
      });
      unit2Id = unit2.id;

      const exercise2 = await tx.exercise.create({
        data: { curriculumUnitId: unit2Id, title: uniq('MKP_EX2'), type: 'homework', maxScore: 10, status: 'published' },
      });
      exercise2Id = exercise2.id;

      const batch = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('MKP_B'), courseId, name: 'Makeup Test Batch', status: 'open' },
      });
      classBatchId = batch.id;

      const room = await tx.room.create({
        data: { facilityId: FACILITY, code: uniq('MKP_R'), name: 'Makeup Test Room' },
      });
      roomId = room.id;

      const teacher = await tx.appUser.create({
        data: {
          email: uniq('mkp-t@cmc.test'),
          displayName: 'Makeup Test Teacher',
          passwordHash: 'dummy',
          primaryRole: 'giao_vien',
          roles: ['giao_vien'],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      });
      teacherId = teacher.id;

      // Regular (non-makeup) session, unmapped — recompute will assign it unit1 (orderGlobal:1).
      const regular = await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId,
          sessionDate: twoDaysAgo,
          startTime: '08:00',
          endTime: '09:00',
          roomId,
          teacherId,
          status: 'confirmed',
          isMakeup: false,
        },
      });
      regularSessionId = regular.id;

      const attendee = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('MKP_SA'), fullName: 'Makeup Attendee', program: 'UCREA' },
      });
      attendeeStudentId = attendee.id;
      const attendeeEnrollment = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId, studentId: attendeeStudentId, status: 'active' },
      });
      attendeeEnrollmentId = attendeeEnrollment.id;

      const nonAttendee = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('MKP_SN'), fullName: 'Makeup Non-Attendee', program: 'UCREA' },
      });
      nonAttendeeStudentId = nonAttendee.id;
      const nonAttendeeEnrollment = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId, studentId: nonAttendeeStudentId, status: 'active' },
      });
      nonAttendeeEnrollmentId = nonAttendeeEnrollment.id;
    });
  } catch {
    console.warn('⚠ DB not reachable — makeup session tests skipped');
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  await withRls(SUPER, async (tx) => {
    await tx.attendance.deleteMany({ where: { enrollmentId: { in: [attendeeEnrollmentId, nonAttendeeEnrollmentId] } } });
    await tx.grade.deleteMany({ where: { submission: { exerciseId: exercise2Id } } });
    await tx.submission.deleteMany({ where: { exerciseId: exercise2Id } });
    await tx.exercise.deleteMany({ where: { id: exercise2Id } });
    await tx.classSession.deleteMany({ where: { classBatchId } });
    await tx.enrollment.deleteMany({ where: { classBatchId } });
    await tx.classBatch.deleteMany({ where: { id: classBatchId } });
    await tx.curriculumUnit.deleteMany({ where: { courseId } });
    await tx.coursePrice.deleteMany({ where: { courseId } });
    await tx.course.deleteMany({ where: { id: courseId } });
    await tx.student.deleteMany({ where: { id: { in: [attendeeStudentId, nonAttendeeStudentId] } } });
    await tx.room.deleteMany({ where: { id: roomId } });
    await tx.appUser.deleteMany({ where: { id: teacherId } });
  });
});

describe('schedule.createMakeupSession', () => {
  it('(a) creates isMakeup=true session, excluded from curriculum-recompute mapping', async () => {
    if (!dbReachable) return;

    const staff = await staffCaller();
    const created = await staff.schedule.createMakeupSession({
      classBatchId,
      sessionDate: twoDaysAgoKey,
      startTime: '18:00',
      endTime: '19:00',
      curriculumUnitId: unit2Id,
    });
    makeupSessionId = created.id;
    expect(created.isMakeup).toBe(true);
    expect(created.status).toBe('planned');
    expect(created.curriculumUnitId).toBe(unit2Id);

    // Recompute the batch's whole curriculum mapping — must only touch the regular session
    // (isMakeup:false filter), leaving the makeup session's curriculumUnitId untouched.
    await withRls(SUPER, (tx) => recomputeCurriculumMapping(tx, classBatchId, courseId));

    const [regularAfter, makeupAfter] = await withRls(SUPER, (tx) =>
      Promise.all([
        tx.classSession.findUniqueOrThrow({ where: { id: regularSessionId }, select: { curriculumUnitId: true } }),
        tx.classSession.findUniqueOrThrow({ where: { id: makeupSessionId }, select: { curriculumUnitId: true, isMakeup: true } }),
      ]),
    );
    // The only non-makeup session in the batch gets mapped to the first curriculum unit.
    expect(regularAfter.curriculumUnitId).toBe(unit1Id);
    // The makeup session is untouched by recompute — still carries the unit it was created with.
    expect(makeupAfter.isMakeup).toBe(true);
    expect(makeupAfter.curriculumUnitId).toBe(unit2Id);
  });

  it('(b) rejects a makeup session that clashes room/teacher with an existing session', async () => {
    if (!dbReachable) return;

    const staff = await staffCaller();
    await expect(
      staff.schedule.createMakeupSession({
        classBatchId,
        sessionDate: twoDaysAgoKey,
        startTime: '08:30', // overlaps regularSession's 08:00-09:00
        endTime: '09:30',
        roomId,
        teacherId,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('(c) attendance can be marked on the makeup session and appears in listBySession', async () => {
    if (!dbReachable) return;

    const staff = await staffCaller();
    // makeupSessionId is dated twoDaysAgo (past — deliberately, so the C1 Tier-A/B tests below
    // can exercise the "session has ended" exercise-open gate) so it sits outside the attendance
    // window gate (phase-02-attendance-gate-and-comment-lock.md) — seed directly via SUPER tx
    // instead of the gated router; this test asserts the row is written and shows up in
    // listBySession, not mark's own authz.
    const marked = await withRls(SUPER, (tx) =>
      tx.attendance.create({
        data: {
          facilityId: FACILITY, classSessionId: makeupSessionId, enrollmentId: attendeeEnrollmentId,
          status: 'present', excused: false,
        },
      }),
    );
    expect(marked.status).toBe('present');
    expect(marked.classSessionId).toBe(makeupSessionId);

    const roster = await staff.attendance.listBySession({ classSessionId: makeupSessionId });
    expect(roster.some((r) => r.enrollmentId === attendeeEnrollmentId && r.status === 'present')).toBe(true);
  });
});

describe('C1 — exercise-open two-tier makeup gate', () => {
  it('(d) Tier-A: non-attendee batchmate does NOT get the makeup-mapped unit opened', async () => {
    if (!dbReachable) return;

    const lms = lmsCaller(studentSession(nonAttendeeStudentId));

    // openedUnitIdsFor path (exercise.listForPrincipal)
    const opened = await lms.exercise.listForPrincipal();
    expect(opened.some((e) => e.id === exercise2Id)).toBe(false);

    // assertExerciseOpenForStudent path (submission.save)
    await expect(
      lms.submission.save({ exerciseId: exercise2Id, answerText: 'should be forbidden' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('(e) Tier-B: a student with present/late attendance on the makeup session gets individual early access', async () => {
    if (!dbReachable) return;

    // attendeeStudentId has a 'present' Attendance row on makeupSessionId (from test c),
    // which is mapped to unit2Id — the same unit as exercise2, never opened via a regular session.
    const lms = lmsCaller(studentSession(attendeeStudentId));

    const opened = await lms.exercise.listForPrincipal();
    expect(opened.some((e) => e.id === exercise2Id)).toBe(true);

    const saved = await lms.submission.save({ exerciseId: exercise2Id, answerText: 'tier-B early access' });
    expect(saved.status).toBe('draft');
  });
});
