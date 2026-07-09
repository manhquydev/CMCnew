/**
 * Integration test — P5 lifecycle enforcement (plan 260702-1109-academic-ops/phase-05-lifecycle.md)
 *
 * Invariants under test:
 *   (a) A withdrawn/on_hold/transferred student cannot log in (loginStudent → null), and an
 *       already-active session dies on the next resolveLmsSession re-check once set to blocked.
 *   (b) A `completed` student CAN still log in and read data (transcript/certificate access —
 *       this is the case that would catch a mis-scoped blocked set).
 *   (c) attendance.markAll skips a student whose lifecycle is blocked, even if their enrollment
 *       status hasn't been separately updated. attendance.mark rejects marking such a student.
 *   (d) Parent session: one blocked child among several → session STILL resolves, blocked child
 *       is dropped from studentIds/students/facilityIds, sibling child stays fully accessible.
 *   (e) Parent session: ALL children blocked → session resolves with zero accessible children
 *       (does not reject/crash).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role, loginStudent, mintParentSession, resolveLmsSession } from '@cmc/auth';
import { hashPassword } from '@cmc/db';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

const FACILITY = 1;

// UTC-midnight of "today" in ICT (matches how ClassSession.sessionDate is stored). The
// markAll-skips-blocked/mark-rejects-blocked tests below go through the real router, so their
// session must land inside the attendance window gate (phase-02-attendance-gate-and-comment-
// lock.md) — startTime/endTime span the whole day so the window is open no matter when this
// suite runs.
function ictTodayUtcMidnight(): Date {
  const ict = new Date(Date.now() + 7 * 3600_000);
  return new Date(Date.UTC(ict.getUTCFullYear(), ict.getUTCMonth(), ict.getUTCDate()));
}

let courseId: string;
let batchId: string;
let teacherId: string;

describe('LMS lifecycle enforcement', () => {
  describe('student session gating (login + live re-check)', () => {
    const cases: Array<{ lifecycle: 'on_hold' | 'withdrawn' | 'transferred'; label: string }> = [
      { lifecycle: 'on_hold', label: 'on_hold' },
      { lifecycle: 'withdrawn', label: 'withdrawn' },
      { lifecycle: 'transferred', label: 'transferred' },
    ];

    for (const { lifecycle, label } of cases) {
      it(`[block-${label}] student with lifecycle=${label} cannot log in`, async () => {
        const password = 'p5-lifecycle-test-pw';
        const passwordHash = await hashPassword(password);
        const loginCode = uniq(`P5LC-${label}`);
        let studentId = '';
        try {
          await withRls(SUPER, async (tx) => {
            const student = await tx.student.create({
              data: {
                facilityId: FACILITY,
                studentCode: uniq(`P5LC-S-${label}`),
                fullName: `P5 Lifecycle ${label}`,
                program: 'UCREA',
                lifecycle,
              },
            });
            studentId = student.id;
            await tx.studentAccount.create({
              data: { studentId: student.id, loginCode, passwordHash },
            });
          });

          const result = await loginStudent(loginCode, password);
          expect(result).toBeNull();
        } finally {
          if (studentId) {
            await withRls(SUPER, async (tx) => {
              await tx.studentAccount.deleteMany({ where: { studentId } });
              await tx.student.deleteMany({ where: { id: studentId } });
            });
          }
        }
      });
    }

    it('[revoke-on-set] an active session dies on next resolveLmsSession call after lifecycle is set to blocked', async () => {
      const password = 'p5-lifecycle-revoke-pw';
      const passwordHash = await hashPassword(password);
      const loginCode = uniq('P5LC-revoke');
      let studentId = '';
      let accountId = '';
      try {
        await withRls(SUPER, async (tx) => {
          const student = await tx.student.create({
            data: {
              facilityId: FACILITY,
              studentCode: uniq('P5LC-S-revoke'),
              fullName: 'P5 Lifecycle Revoke',
              program: 'UCREA',
              lifecycle: 'active',
            },
          });
          studentId = student.id;
          const acc = await tx.studentAccount.create({
            data: { studentId: student.id, loginCode, passwordHash },
          });
          accountId = acc.id;
        });

        // Login while active: succeeds and mints a real token.
        const login = await loginStudent(loginCode, password);
        expect(login).not.toBeNull();
        const token = login!.token;

        // Session is live before the lifecycle change.
        const beforeResolve = await resolveLmsSession(token);
        expect(beforeResolve).not.toBeNull();

        // Operator sets the student to withdrawn.
        await withRls(SUPER, (tx) =>
          tx.student.update({ where: { id: studentId }, data: { lifecycle: 'withdrawn' } }),
        );

        // The very next per-request re-check must reject — no new login needed to observe this.
        const afterResolve = await resolveLmsSession(token);
        expect(afterResolve).toBeNull();
      } finally {
        if (accountId || studentId) {
          await withRls(SUPER, async (tx) => {
            if (studentId) await tx.studentAccount.deleteMany({ where: { studentId } });
            if (studentId) await tx.student.deleteMany({ where: { id: studentId } });
          });
        }
      }
    });

    it('[completed-still-works] a completed student CAN still log in (transcript/certificate access preserved)', async () => {
      const password = 'p5-lifecycle-completed-pw';
      const passwordHash = await hashPassword(password);
      const loginCode = uniq('P5LC-completed');
      let studentId = '';
      try {
        await withRls(SUPER, async (tx) => {
          const student = await tx.student.create({
            data: {
              facilityId: FACILITY,
              studentCode: uniq('P5LC-S-completed'),
              fullName: 'P5 Lifecycle Completed',
              program: 'UCREA',
              lifecycle: 'completed',
            },
          });
          studentId = student.id;
          await tx.studentAccount.create({
            data: { studentId: student.id, loginCode, passwordHash },
          });
        });

        const result = await loginStudent(loginCode, password);
        expect(result).not.toBeNull();
        expect(result!.session.studentIds).toEqual([studentId]);
      } finally {
        if (studentId) {
          await withRls(SUPER, async (tx) => {
            await tx.studentAccount.deleteMany({ where: { studentId } });
            await tx.student.deleteMany({ where: { id: studentId } });
          });
        }
      }
    });

    it('[active-unaffected] an active student login is unaffected', async () => {
      const password = 'p5-lifecycle-active-pw';
      const passwordHash = await hashPassword(password);
      const loginCode = uniq('P5LC-active');
      let studentId = '';
      try {
        await withRls(SUPER, async (tx) => {
          const student = await tx.student.create({
            data: {
              facilityId: FACILITY,
              studentCode: uniq('P5LC-S-active'),
              fullName: 'P5 Lifecycle Active',
              program: 'UCREA',
              lifecycle: 'active',
            },
          });
          studentId = student.id;
          await tx.studentAccount.create({
            data: { studentId: student.id, loginCode, passwordHash },
          });
        });

        const result = await loginStudent(loginCode, password);
        expect(result).not.toBeNull();
      } finally {
        if (studentId) {
          await withRls(SUPER, async (tx) => {
            await tx.studentAccount.deleteMany({ where: { studentId } });
            await tx.student.deleteMany({ where: { id: studentId } });
          });
        }
      }
    });
  });

  describe('parent session per-child filter (C4)', () => {
    let parentId: string;
    let activeChildId: string;
    let withdrawnChildId: string;

    beforeAll(async () => {
      await withRls(SUPER, async (tx) => {
        const active = await tx.student.create({
          data: {
            facilityId: FACILITY,
            studentCode: uniq('P5LC-PA'),
            fullName: 'P5 Parent Active Child',
            program: 'UCREA',
            lifecycle: 'active',
          },
        });
        activeChildId = active.id;

        const withdrawn = await tx.student.create({
          data: {
            facilityId: FACILITY,
            studentCode: uniq('P5LC-PW'),
            fullName: 'P5 Parent Withdrawn Child',
            program: 'UCREA',
            lifecycle: 'withdrawn',
          },
        });
        withdrawnChildId = withdrawn.id;

        const parent = await tx.parentAccount.create({
          data: { displayName: 'P5 Lifecycle Parent', email: `${uniq('p5lc-parent')}@test.local` },
        });
        parentId = parent.id;

        await tx.guardian.create({
          data: { facilityId: FACILITY, parentAccountId: parentId, studentId: activeChildId, relation: 'guardian' },
        });
        await tx.guardian.create({
          data: { facilityId: FACILITY, parentAccountId: parentId, studentId: withdrawnChildId, relation: 'guardian' },
        });
      });
    });

    afterAll(async () => {
      await withRls(SUPER, async (tx) => {
        await tx.guardian.deleteMany({ where: { parentAccountId: parentId } });
        await tx.parentAccount.deleteMany({ where: { id: parentId } });
        await tx.student.deleteMany({ where: { id: { in: [activeChildId, withdrawnChildId] } } });
      });
    });

    it('[one-blocked] parent session STILL resolves; withdrawn child dropped, active child fully accessible', async () => {
      const result = await mintParentSession(parentId);
      expect(result).not.toBeNull();
      const session = result!.session;

      expect(session.studentIds).toContain(activeChildId);
      expect(session.studentIds).not.toContain(withdrawnChildId);
      expect(session.studentIds).toHaveLength(1);
      expect(session.students.map((s) => s.id)).toEqual([activeChildId]);
      expect(session.facilityIds).toEqual([FACILITY]);
    });

    it('[all-blocked] parent with every child blocked → session resolves with zero accessible children (no crash)', async () => {
      await withRls(SUPER, (tx) =>
        tx.student.update({ where: { id: activeChildId }, data: { lifecycle: 'on_hold' } }),
      );
      try {
        const result = await mintParentSession(parentId);
        expect(result).not.toBeNull();
        expect(result!.session.studentIds).toHaveLength(0);
        expect(result!.session.students).toHaveLength(0);
        expect(result!.session.facilityIds).toHaveLength(0);
      } finally {
        await withRls(SUPER, (tx) =>
          tx.student.update({ where: { id: activeChildId }, data: { lifecycle: 'active' } }),
        );
      }
    });
  });

  describe('attendance guard by lifecycle', () => {
    let studentActiveId: string;
    let studentBlockedId: string;
    let enrollmentActiveId: string;
    let enrollmentBlockedId: string;
    let sessionId: string;

    beforeAll(async () => {
      await withRls(SUPER, async (tx) => {
        const teacher = await tx.appUser.create({
          data: {
            email: uniq('p5lc-teacher@cmc.test'),
            displayName: 'P5LC Teacher',
            passwordHash: 'test',
            primaryRole: Role.giao_vien,
            roles: [Role.giao_vien],
            isActive: true,
            facilities: { create: [{ facilityId: FACILITY }] },
          },
        });
        teacherId = teacher.id;

        const course = await tx.course.create({
          data: { code: uniq('P5LC_C'), name: 'P5LC Course', program: 'UCREA' },
        });
        courseId = course.id;

        const batch = await tx.classBatch.create({
          data: { facilityId: FACILITY, code: uniq('P5LC_B'), courseId, name: 'P5LC Batch', status: 'open' },
        });
        batchId = batch.id;

        const studentActive = await tx.student.create({
          data: { facilityId: FACILITY, studentCode: uniq('P5LC_ATT_A'), fullName: 'Attendance Active', program: 'UCREA', lifecycle: 'active' },
        });
        studentActiveId = studentActive.id;

        // Lifecycle blocked but enrollment.status still 'active' — the scenario the guard must
        // catch independently of the existing enrollment.status check.
        const studentBlocked = await tx.student.create({
          data: { facilityId: FACILITY, studentCode: uniq('P5LC_ATT_B'), fullName: 'Attendance Blocked', program: 'UCREA', lifecycle: 'on_hold' },
        });
        studentBlockedId = studentBlocked.id;

        const enrollmentActive = await tx.enrollment.create({
          data: { facilityId: FACILITY, classBatchId: batchId, studentId: studentActiveId, status: 'active' },
        });
        enrollmentActiveId = enrollmentActive.id;

        const enrollmentBlocked = await tx.enrollment.create({
          data: { facilityId: FACILITY, classBatchId: batchId, studentId: studentBlockedId, status: 'active' },
        });
        enrollmentBlockedId = enrollmentBlocked.id;

        const session = await tx.classSession.create({
          data: {
            facilityId: FACILITY, classBatchId: batchId, sessionDate: ictTodayUtcMidnight(),
            startTime: '00:00', endTime: '23:59', status: 'confirmed', teacherId,
          },
        });
        sessionId = session.id;
      });
    });

    afterAll(async () => {
      await withRls(SUPER, async (tx) => {
        await tx.attendance.deleteMany({ where: { classSessionId: sessionId } });
        await tx.classSession.deleteMany({ where: { id: sessionId } });
        await tx.enrollment.deleteMany({ where: { classBatchId: batchId } });
        await tx.classBatch.deleteMany({ where: { id: batchId } });
        await tx.coursePrice.deleteMany({ where: { courseId } });
        await tx.course.deleteMany({ where: { id: courseId } });
        await tx.student.deleteMany({ where: { id: { in: [studentActiveId, studentBlockedId] } } });
        await tx.employmentProfile.deleteMany({ where: { userId: teacherId } });
        await tx.appUser.deleteMany({ where: { id: teacherId } });
      });
    });

    it('[markAll-skips-blocked] markAll writes for the active student, skips the lifecycle-blocked one', async () => {
      const teacher = await staffCaller({
        userId: teacherId,
        roles: [Role.giao_vien],
        primaryRole: Role.giao_vien,
        isSuperAdmin: false,
        facilityIds: [FACILITY],
      });

      await teacher.attendance.markAll({
        classSessionId: sessionId,
        defaultStatus: 'present',
        overrides: [],
      });

      const rows = await withRls(SUPER, (tx) =>
        tx.attendance.findMany({ where: { classSessionId: sessionId } }),
      );
      const byEnrollment = new Map(rows.map((r) => [r.enrollmentId, r]));
      expect(byEnrollment.has(enrollmentActiveId)).toBe(true);
      expect(byEnrollment.has(enrollmentBlockedId)).toBe(false);
    });

    it('[mark-rejects-blocked] mark on the lifecycle-blocked student throws BAD_REQUEST', async () => {
      const teacher = await staffCaller({
        userId: teacherId,
        roles: [Role.giao_vien],
        primaryRole: Role.giao_vien,
        isSuperAdmin: false,
        facilityIds: [FACILITY],
      });

      await expect(
        teacher.attendance.mark({ classSessionId: sessionId, enrollmentId: enrollmentBlockedId, status: 'present' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });
});
