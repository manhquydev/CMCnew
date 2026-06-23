import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, requireRole, lmsProcedure, Role } from '../trpc.js';
import { emitNotification } from '../events.js';

const ENTITY = 'level_progress';

export const levelProgressRouter = router({
  // Teacher proposes a level-up. fromLevel snapshots the student's current level. One open
  // proposal per student at a time (a second pending would be ambiguous for the approver).
  propose: requireRole(Role.giao_vien, Role.head_teacher, Role.quan_ly)
    .input(z.object({ studentId: z.string().uuid(), toLevel: z.string().min(1), reason: z.string().optional() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const student = await tx.student.findUniqueOrThrow({
          where: { id: input.studentId },
          select: { facilityId: true, level: true },
        });
        const open = await tx.levelProgress.findFirst({
          where: { studentId: input.studentId, status: 'pending' },
          select: { id: true },
        });
        if (open) throw new TRPCError({ code: 'CONFLICT', message: 'Đã có đề xuất đang chờ duyệt' });

        const lp = await tx.levelProgress.create({
          data: {
            facilityId: student.facilityId,
            studentId: input.studentId,
            fromLevel: student.level,
            toLevel: input.toLevel,
            reason: input.reason,
            proposedById: ctx.session.userId,
          },
          select: { id: true },
        });
        await logEvent(tx, {
          facilityId: student.facilityId,
          entityType: ENTITY,
          entityId: lp.id,
          type: 'created',
          body: `Đề xuất lên cấp độ: ${student.level ?? '—'} → ${input.toLevel}`,
          actorId: ctx.session.userId,
        });
        return { id: lp.id };
      }),
    ),

  // Approver queue: pending proposals in the head_teacher's facilities.
  listPending: requireRole(Role.head_teacher, Role.quan_ly)
    .query(({ ctx }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.levelProgress.findMany({
          where: { status: 'pending' },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            fromLevel: true,
            toLevel: true,
            reason: true,
            createdAt: true,
            student: { select: { id: true, fullName: true, studentCode: true } },
          },
        }),
      ),
    ),

  // Only head_teacher (or super) decides (charter). Approve writes Student.level in the same tx
  // and notifies the student/parent over SSE; reject just records the decision.
  decide: requireRole(Role.head_teacher)
    .input(
      z.object({
        id: z.string().uuid(),
        decision: z.enum(['approve', 'reject']),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await withRls(rlsContextOf(ctx.session), async (tx) => {
        const lp = await tx.levelProgress.findUniqueOrThrow({
          where: { id: input.id },
          select: { id: true, status: true, studentId: true, facilityId: true, toLevel: true, fromLevel: true },
        });
        if (lp.status !== 'pending') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Đề xuất đã được xử lý' });
        }
        const approved = input.decision === 'approve';
        await tx.levelProgress.update({
          where: { id: lp.id },
          data: {
            status: approved ? 'approved' : 'rejected',
            reviewedById: ctx.session.userId,
            reviewedAt: new Date(),
            reason: input.reason ?? undefined,
          },
        });

        let notif: { id: string; type: string; createdAt: Date } | null = null;
        let payload: object | null = null;
        if (approved) {
          const student = await tx.student.update({ where: { id: lp.studentId }, data: { level: lp.toLevel } });
          // Completing a level auto-issues its certificate (idempotent per student+level), so the
          // head_teacher's single approval both promotes and certifies — no separate manual step.
          const already = await tx.certificate.findFirst({
            where: { studentId: lp.studentId, level: lp.toLevel, archivedAt: null },
            select: { id: true },
          });
          if (!already) {
            const cert = await tx.certificate.create({
              data: {
                facilityId: lp.facilityId,
                studentId: lp.studentId,
                program: student.program,
                level: lp.toLevel,
                title: `Hoàn thành cấp độ ${lp.toLevel}`,
                issuedById: ctx.session.userId,
              },
            });
            await logEvent(tx, {
              facilityId: lp.facilityId,
              entityType: 'certificate',
              entityId: cert.id,
              type: 'created',
              body: `Tự cấp chứng chỉ "Hoàn thành cấp độ ${lp.toLevel}" cho ${student.fullName}`,
              actorId: ctx.session.userId,
            });
          }
          payload = { fromLevel: lp.fromLevel, toLevel: lp.toLevel };
          notif = await tx.notification.create({
            data: {
              facilityId: lp.facilityId,
              recipientType: 'student',
              recipientId: lp.studentId,
              type: 'level_up',
              payload,
            },
            select: { id: true, type: true, createdAt: true },
          });
        }
        await logEvent(tx, {
          facilityId: lp.facilityId,
          entityType: ENTITY,
          entityId: lp.id,
          type: 'status_changed',
          body: approved
            ? `Duyệt lên cấp độ → ${lp.toLevel}`
            : `Từ chối đề xuất lên cấp độ${input.reason ? `: ${input.reason}` : ''}`,
          changes: [{ field: 'status', old: 'pending', new: approved ? 'approved' : 'rejected' }],
          actorId: ctx.session.userId,
        });
        return { studentId: lp.studentId, notif, payload };
      });

      if (result.notif && result.payload) {
        emitNotification({
          studentId: result.studentId,
          notification: {
            id: result.notif.id,
            type: result.notif.type,
            payload: result.payload,
            createdAt: result.notif.createdAt.toISOString(),
          },
        });
      }
      return { ok: true };
    }),

  // Parent/student: level-up history for one owned student (RLS rejects others).
  forStudent: lmsProcedure
    .input(z.object({ studentId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), (tx) =>
        tx.levelProgress.findMany({
          where: { studentId: input.studentId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, fromLevel: true, toLevel: true, status: true, reason: true, reviewedAt: true, createdAt: true },
        }),
      ),
    ),
});
