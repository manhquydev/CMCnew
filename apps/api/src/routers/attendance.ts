import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, AttendanceStatus } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf, BLOCKED_LMS_LIFECYCLE } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, protectedProcedure, requirePermission, lmsProcedure } from '../trpc.js';
import { sessionEndUtc } from '../lib/exercise-open.js';
import { assertTeachingSessionMutationAllowed } from '../lib/teaching-authz.js';
import { assertAttendanceWindowOpen } from '../lib/attendance-window.js';

// Same ICT offset as apps/api/src/lib/exercise-open.ts (ICT_OFFSET_HOURS). Not exported there,
// so it's duplicated here rather than modifying that file (owned by a different, already-shipped phase).
const ICT_OFFSET_HOURS = 7;

/** Calendar month (ICT) a session's real end instant falls into — reuses sessionEndUtc so a
 * session whose wall-clock ICT end crosses a UTC day boundary still buckets by its true ICT month,
 * not by the raw UTC-midnight sessionDate column. */
function ictMonthKey(sessionDate: Date, endTime: string): string {
  const endUtc = sessionEndUtc(sessionDate, endTime);
  const ict = new Date(endUtc.getTime() + ICT_OFFSET_HOURS * 3600_000);
  return `${ict.getUTCFullYear()}-${String(ict.getUTCMonth() + 1).padStart(2, '0')}`;
}

const DIRECTOR_ROLES = ['giam_doc_dao_tao', 'giam_doc_kinh_doanh'] as const;

/** super_admin and directors correct attendance outside the normal 15-min-before to
 * end-of-ICT-day window (e.g. fixing a roster the morning after a forgotten evening class) —
 * giao_vien stays gated to the window. User-approved (Q3, plan 260709-1514). */
function bypassesAttendanceWindow(session: { isSuperAdmin: boolean; roles: readonly string[] }): boolean {
  return session.isSuperAdmin || session.roles.some((r) => (DIRECTOR_ROLES as readonly string[]).includes(r));
}

export const attendanceRouter = router({
  listBySession: protectedProcedure
    .input(z.object({ classSessionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.attendance.findMany({ where: { classSessionId: input.classSessionId } }),
      ),
    ),

  // Giáo viên/quản lý chấm điểm danh (upsert, idempotent).
  mark: requirePermission('attendance', 'mark')
    .input(
      z.object({
        // facilityId kept for API backward-compat but ignored — derived server-side from the session.
        facilityId: z.number().int().positive().optional(),
        classSessionId: z.string().uuid(),
        enrollmentId: z.string().uuid(),
        status: z.nativeEnum(AttendanceStatus),
        excused: z.boolean().default(false),
        note: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Validate that the enrollment and session belong to the same class batch.
        // A mismatched (enrollment, session) pair silently corrupts attendance rates
        // used by computeFinalGrade — reject it before any write.
        // facilityId is derived from the session record, not from the client, to prevent
        // a caller from injecting a foreign facilityId and writing cross-tenant rows.
        const [session, enrollment] = await Promise.all([
          tx.classSession.findUniqueOrThrow({
            where: { id: input.classSessionId },
            select: {
              classBatchId: true, facilityId: true, status: true, teacherId: true,
              sessionDate: true, startTime: true,
            },
          }),
          tx.enrollment.findUniqueOrThrow({
            where: { id: input.enrollmentId },
            select: { classBatchId: true, status: true, student: { select: { lifecycle: true } } },
          }),
        ]);
        if (enrollment.classBatchId !== session.classBatchId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Học sinh không thuộc lớp học của buổi học này',
          });
        }
        // A cancelled session has no real class — marking it would inflate/deflate the attendance rate
        // that computeFinalGrade derives.
        if (session.status === 'cancelled') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Buổi học đã hủy — không thể điểm danh' });
        }
        assertTeachingSessionMutationAllowed(ctx.session, session);
        if (!bypassesAttendanceWindow(ctx.session)) {
          assertAttendanceWindowOpen(new Date(), session.sessionDate, session.startTime);
        }
        // A student who has left the class (withdrawn/transferred) must not receive new attendance marks.
        // active / completed / reserved stay markable (final-session and trial attendance are valid).
        if (enrollment.status === 'withdrawn' || enrollment.status === 'transferred') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Học sinh đã rời lớp — không thể điểm danh' });
        }
        // Same guard by lifecycle (on_hold/withdrawn/transferred): catches a student paused/withdrawn
        // at the profile level even when this particular enrollment's status hasn't been updated yet.
        if (BLOCKED_LMS_LIFECYCLE.has(enrollment.student.lifecycle)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Học sinh đã rời lớp — không thể điểm danh' });
        }
        const facilityId = session.facilityId;
        const now = new Date();
        const attendance = await tx.attendance.upsert({
          where: {
            classSessionId_enrollmentId: {
              classSessionId: input.classSessionId,
              enrollmentId: input.enrollmentId,
            },
          },
          update: {
            status: input.status,
            excused: input.excused,
            // `?? null` (not the raw optional) so re-marking without a note explicitly clears
            // any previously stored one instead of leaving a stale mismatched note behind
            // (Prisma treats `undefined` as "leave unchanged", not "clear").
            note: input.note ?? null,
            markedById: ctx.session.userId,
            markedAt: now,
          },
          create: {
            facilityId,
            classSessionId: input.classSessionId,
            enrollmentId: input.enrollmentId,
            status: input.status,
            excused: input.excused,
            note: input.note ?? null,
            markedById: ctx.session.userId,
            markedAt: now,
          },
        });
        await logEvent(tx, {
          facilityId,
          entityType: 'class_session',
          entityId: input.classSessionId,
          type: 'updated',
          body: `Điểm danh: ${input.status}${input.excused ? ' (có phép)' : ''}`,
          actorId: ctx.session.userId,
        });
        return attendance;
      }),
    ),

  // Bulk điểm danh cả lớp trong 1 lần gọi: mọi ghi danh active nhận defaultStatus, trừ khi có
  // override riêng (theo enrollmentId). Cùng transaction với upsert của `mark` (idempotent).
  markAll: requirePermission('attendance', 'markAll')
    .input(
      z.object({
        classSessionId: z.string().uuid(),
        defaultStatus: z.nativeEnum(AttendanceStatus),
        overrides: z
          .array(
            z.object({
              enrollmentId: z.string().uuid(),
              status: z.nativeEnum(AttendanceStatus).optional(),
              excused: z.boolean().optional(),
              note: z.string().optional(),
            }),
          )
          .default([]),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const session = await tx.classSession.findUniqueOrThrow({
          where: { id: input.classSessionId },
          select: {
            classBatchId: true, facilityId: true, status: true, teacherId: true,
            sessionDate: true, startTime: true, endTime: true,
          },
        });
        if (session.status === 'cancelled') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Buổi học đã hủy — không thể điểm danh' });
        }
        assertTeachingSessionMutationAllowed(ctx.session, session);
        if (!bypassesAttendanceWindow(ctx.session)) {
          assertAttendanceWindowOpen(new Date(), session.sessionDate, session.startTime);
        }
        // Same left-class guard as `mark`: transferred/withdrawn enrollments are excluded from
        // the active set, so markAll never writes an attendance row for a student who has left.
        // Also excludes students whose lifecycle is blocked (on_hold/withdrawn/transferred) even
        // when this particular enrollment's status hasn't been updated to match yet.
        const enrollments = (
          await tx.enrollment.findMany({
            where: {
              classBatchId: session.classBatchId,
              status: { notIn: ['withdrawn', 'transferred'] },
            },
            select: { id: true, student: { select: { lifecycle: true } } },
          })
        ).filter((e) => !BLOCKED_LMS_LIFECYCLE.has(e.student.lifecycle));
        const overrideByEnrollment = new Map(input.overrides.map((o) => [o.enrollmentId, o]));
        const facilityId = session.facilityId;
        const now = new Date();

        const attendances = await Promise.all(
          enrollments.map((e) => {
            const override = overrideByEnrollment.get(e.id);
            const status = override?.status ?? input.defaultStatus;
            const excused = override?.excused ?? false;
            // `?? null` so a status change (e.g. "Có mặt tất cả") without a note override
            // clears any previously stored note instead of leaving a stale mismatched one.
            const note = override?.note ?? null;
            return tx.attendance.upsert({
              where: {
                classSessionId_enrollmentId: {
                  classSessionId: input.classSessionId,
                  enrollmentId: e.id,
                },
              },
              update: { status, excused, note, markedById: ctx.session.userId, markedAt: now },
              create: {
                facilityId,
                classSessionId: input.classSessionId,
                enrollmentId: e.id,
                status,
                excused,
                note,
                markedById: ctx.session.userId,
                markedAt: now,
              },
            });
          }),
        );

        await logEvent(tx, {
          facilityId,
          entityType: 'class_session',
          entityId: input.classSessionId,
          type: 'updated',
          body: `Điểm danh tất cả: ${input.defaultStatus} (${enrollments.length} học sinh)`,
          actorId: ctx.session.userId,
        });
        return attendances;
      }),
    ),

  // Báo cáo điểm danh theo học sinh / lớp / kỳ. Authz riêng (N4): giáo viên chỉ thấy buổi mình
  // dạy (ClassSession.teacherId); giám đốc đào tạo (và super_admin) thấy toàn cơ sở — KHÔNG kế
  // thừa ngầm định phạm vi của quyền `mark`, lọc tường minh ngay trong câu truy vấn.
  report: requirePermission('attendance', 'report')
    .input(
      z.object({
        scope: z.enum(['student', 'class', 'term', 'facility']),
        // Required for student/class/term (entity uuid); ignored for facility.
        id: z.string().uuid().optional(),
        termId: z.string().uuid().optional(),
        // Required for facility scope only — RLS still bounds this to the caller's tenant.
        facilityId: z.number().int().positive().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const isDirector =
          ctx.session.isSuperAdmin || ctx.session.roles.some((r) => r === 'giam_doc_dao_tao');
        // giao_vien (the only other role permitted through requirePermission('attendance','report'))
        // is scoped to sessions they personally taught; director/super_admin see the full facility
        // (still bounded by RLS tenant isolation on facilityId).
        const teacherFilter = isDirector ? undefined : ctx.session.userId;

        const termWindow =
          input.scope === 'term' && input.id
            ? await tx.academicTerm.findUniqueOrThrow({
                where: { id: input.id },
                select: { startDate: true, endDate: true },
              })
            : input.termId
              ? await tx.academicTerm.findUniqueOrThrow({
                  where: { id: input.termId },
                  select: { startDate: true, endDate: true },
                })
              : null;

        const sessionWhere: Record<string, unknown> = {};
        if (input.scope === 'class' && input.id) sessionWhere.classBatchId = input.id;
        if (termWindow) sessionWhere.sessionDate = { gte: termWindow.startDate, lte: termWindow.endDate };
        if (teacherFilter) sessionWhere.teacherId = teacherFilter;
        if (input.scope === 'facility') {
          if (!input.facilityId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'facilityId required for scope=facility' });
          sessionWhere.facilityId = input.facilityId;
          // Trailing 6 calendar months (ICT), matching the report's month-trend granularity.
          const sixMonthsAgo = new Date();
          sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 5, 1);
          sixMonthsAgo.setUTCHours(0, 0, 0, 0);
          sessionWhere.sessionDate = { gte: sixMonthsAgo };
        }

        const isTrend = input.scope === 'term' || input.scope === 'facility';

        const attendances = await tx.attendance.findMany({
          where: {
            ...(input.scope === 'student' && input.id ? { enrollment: { studentId: input.id } } : {}),
            session: sessionWhere,
          },
          select: {
            status: true,
            excused: true,
            session: {
              select: {
                sessionDate: true,
                endTime: true,
                ...(input.scope === 'facility' ? { classBatchId: true, batch: { select: { code: true, name: true } } } : {}),
              },
            },
          },
        });

        const counts = { present: 0, absent: 0, late: 0, excused: 0, total: attendances.length };
        // N1: makeup sessions (isMakeup=true) stay INCLUDED in the denominator by default — a
        // makeup a student actually attended counts toward their rate. This is intentionally the
        // opposite convention from exercise-open.ts's class-wide unit-open gate, which excludes
        // isMakeup — the two rules serve different purposes and must not be unified.
        const byMonth = new Map<string, { present: number; absent: number; late: number; excused: number; total: number }>();
        const byClass = new Map<string, { code: string; name: string; present: number; absent: number; late: number; excused: number; total: number }>();
        for (const a of attendances) {
          counts[a.status] += 1;
          if (a.excused) counts.excused += 1;
          if (isTrend) {
            const key = ictMonthKey(a.session.sessionDate, a.session.endTime);
            const m = byMonth.get(key) ?? { present: 0, absent: 0, late: 0, excused: 0, total: 0 };
            m[a.status] += 1;
            if (a.excused) m.excused += 1;
            m.total += 1;
            byMonth.set(key, m);
          }
          if (input.scope === 'facility' && 'classBatchId' in a.session && a.session.classBatchId) {
            const classKey = a.session.classBatchId;
            const batch = 'batch' in a.session ? a.session.batch : null;
            const c = byClass.get(classKey) ?? {
              code: batch?.code ?? classKey, name: batch?.name ?? classKey,
              present: 0, absent: 0, late: 0, excused: 0, total: 0,
            };
            c[a.status] += 1;
            if (a.excused) c.excused += 1;
            c.total += 1;
            byClass.set(classKey, c);
          }
        }
        const attended = counts.present + counts.late;
        const rate = counts.total > 0 ? attended / counts.total : null;

        return {
          scope: input.scope,
          id: input.scope === 'facility' ? String(input.facilityId) : (input.id ?? ''),
          counts,
          rate,
          ...(isTrend
            ? { byMonth: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, c]) => ({ month, ...c })) }
            : {}),
          ...(input.scope === 'facility'
            ? {
                byClass: [...byClass.values()]
                  .map((c) => ({ ...c, rate: c.total > 0 ? (c.present + c.late) / c.total : null }))
                  .sort((a, b) => a.code.localeCompare(b.code)),
              }
            : {}),
        };
      }),
    ),

  // Lịch sử điểm danh theo buổi cho phụ huynh/học sinh (LMS) — hiển thị từng buổi thay vì chỉ
  // tỷ lệ tổng hợp. Giới hạn nghiêm ngặt theo studentIds của phiên LMS đang đăng nhập.
  forStudent: lmsProcedure
    .input(z.object({ studentId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
        const studentIds = input?.studentId ? [input.studentId] : ctx.lms.studentIds;
        for (const id of studentIds) {
          if (!ctx.lms.studentIds.includes(id)) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'Không có quyền xem học sinh này' });
          }
        }
        return tx.attendance.findMany({
          where: { enrollment: { studentId: { in: studentIds } } },
          select: {
            id: true,
            status: true,
            excused: true,
            session: {
              select: {
                id: true,
                sessionDate: true,
                startTime: true,
                endTime: true,
                isMakeup: true,
                batch: { select: { name: true } },
              },
            },
          },
          orderBy: { session: { sessionDate: 'desc' } },
        });
      }),
    ),
});
