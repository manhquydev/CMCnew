import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, requireRole, lmsProcedure, Role } from '../trpc.js';
import { emitNotification } from '../events.js';

// Supported unlock criteria — kept in lockstep with @cmc/domain-rewards parseCriteria.
const criteriaSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stars_total'), gte: z.number().int().positive() }),
  z.object({ kind: z.literal('homework_count'), gte: z.number().int().positive() }),
]);

export const badgeRouter = router({
  // Parent/student: badges earned by one owned student (RLS rejects any other studentId).
  myBadges: lmsProcedure
    .input(z.object({ studentId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), (tx) =>
        tx.studentBadge.findMany({
          where: { studentId: input.studentId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            source: true,
            createdAt: true,
            badge: { select: { id: true, name: true, description: true, iconUrl: true } },
          },
        }),
      ),
    ),

  // Staff catalog (admin). Includes archived so the manager can see the full set.
  list: requireRole(Role.quan_ly, Role.head_teacher, Role.giao_vien)
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.badge.findMany({
          where: { facilityId: input.facilityId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            code: true,
            name: true,
            description: true,
            iconUrl: true,
            unlockCriteria: true,
            isActive: true,
            archivedAt: true,
          },
        }),
      ),
    ),

  create: requireRole(Role.quan_ly)
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        code: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        iconUrl: z.string().optional(),
        unlockCriteria: criteriaSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const badge = await tx.badge.create({
          data: {
            facilityId: input.facilityId,
            code: input.code,
            name: input.name,
            description: input.description,
            iconUrl: input.iconUrl,
            unlockCriteria: input.unlockCriteria,
          },
          select: { id: true },
        });
        await logEvent(tx, {
          facilityId: input.facilityId,
          entityType: 'badge',
          entityId: badge.id,
          type: 'created',
          body: `Tạo huy hiệu: ${input.name}`,
          actorId: ctx.session.userId,
        });
        return badge;
      }),
    ),

  archive: requireRole(Role.quan_ly)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        await tx.badge.update({
          where: { id: input.id },
          data: { isActive: false, archivedAt: new Date() },
        });
        return { ok: true };
      }),
    ),

  // Teacher manually grants a badge (source=manual) — bypasses criteria. Idempotent on the unique;
  // a re-grant of an owned badge is a no-op (no duplicate row, no second notification).
  grant: requireRole(Role.giao_vien, Role.head_teacher, Role.quan_ly)
    .input(z.object({ studentId: z.string().uuid(), badgeId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await withRls(rlsContextOf(ctx.session), async (tx) => {
        const student = await tx.student.findUniqueOrThrow({
          where: { id: input.studentId },
          select: { facilityId: true },
        });
        const badge = await tx.badge.findUniqueOrThrow({
          where: { id: input.badgeId },
          select: { id: true, name: true, facilityId: true },
        });
        if (badge.facilityId !== student.facilityId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Huy hiệu khác cơ sở với học sinh' });
        }
        const res = await tx.studentBadge.createMany({
          data: [{ facilityId: student.facilityId, studentId: input.studentId, badgeId: badge.id, source: 'manual', awardedById: ctx.session.userId }],
          skipDuplicates: true,
        });
        if (res.count === 0) return null; // already owned
        const payload = { badgeId: badge.id, badge: badge.name };
        const notif = await tx.notification.create({
          data: {
            facilityId: student.facilityId,
            recipientType: 'student',
            recipientId: input.studentId,
            type: 'badge_awarded',
            payload,
          },
          select: { id: true, type: true, createdAt: true },
        });
        await logEvent(tx, {
          facilityId: student.facilityId,
          entityType: 'student_badge',
          entityId: badge.id,
          type: 'created',
          body: `GV cấp huy hiệu: ${badge.name}`,
          actorId: ctx.session.userId,
        });
        return { studentId: input.studentId, notif, payload };
      });

      if (result) {
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
      return { awarded: result != null };
    }),
});
