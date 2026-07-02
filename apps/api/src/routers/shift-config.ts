import { z } from 'zod';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, requirePermission, superAdminProcedure } from '../trpc.js';

export const shiftConfigRouter = router({
  list: requirePermission('shiftConfig', 'list')
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.shiftGroup.findMany({
          where: { facilityId: input.facilityId, archivedAt: null },
          include: {
            templates: {
              where: { archivedAt: null },
              orderBy: { sortOrder: 'asc' },
            },
          },
          orderBy: { sortOrder: 'asc' },
        }),
      ),
    ),

  create: superAdminProcedure
    .input(z.object({
      facilityId: z.number().int().positive(),
      code: z.string().min(1),
      name: z.string().min(1),
      selectionMode: z.enum(['SINGLE', 'MULTIPLE']),
      description: z.string().optional(),
      sortOrder: z.number().int().default(0),
    }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const group = await tx.shiftGroup.create({
          data: {
            facilityId: input.facilityId,
            code: input.code,
            name: input.name,
            selectionMode: input.selectionMode,
            description: input.description,
            sortOrder: input.sortOrder,
          },
        });
        await logEvent(tx, {
          facilityId: group.facilityId,
          entityType: 'shift_group',
          entityId: group.id,
          type: 'created',
          body: `Nhóm ca: ${input.name} (${input.code})`,
          actorId: ctx.session.userId,
        });
        return group;
      }),
    ),

  createTemplate: superAdminProcedure
    .input(z.object({
      shiftGroupId: z.string().uuid(),
      facilityId: z.number().int().positive(),
      code: z.string().min(1),
      name: z.string().min(1),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      hours: z.number().positive(),
      color: z.string().optional(),
      sortOrder: z.number().int().default(0),
    }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const tmpl = await tx.shiftTemplate.create({
          data: {
            facilityId: input.facilityId,
            shiftGroupId: input.shiftGroupId,
            code: input.code,
            name: input.name,
            startTime: input.startTime,
            endTime: input.endTime,
            hours: input.hours,
            color: input.color,
            sortOrder: input.sortOrder,
          },
        });
        await logEvent(tx, {
          facilityId: tmpl.facilityId,
          entityType: 'shift_template',
          entityId: tmpl.id,
          type: 'created',
          body: `Mẫu ca: ${input.name} (${input.startTime}-${input.endTime})`,
          actorId: ctx.session.userId,
        });
                return tmpl;
      }),
    ),

  update: superAdminProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      sortOrder: z.number().int().optional(),
    }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const group = await tx.shiftGroup.update({
          where: { id: input.id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          },
        });
        await logEvent(tx, {
          facilityId: group.facilityId,
          entityType: 'shift_group',
          entityId: group.id,
          type: 'status_changed',
          body: `Sửa nhóm ca: ${group.name}`,
          actorId: ctx.session.userId,
        });
        return group;
      }),
    ),

  archive: superAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const group = await tx.shiftGroup.findUniqueOrThrow({ where: { id: input.id } });
        await tx.shiftGroup.update({
          where: { id: input.id },
          data: { archivedAt: new Date() },
        });
        await logEvent(tx, {
          facilityId: group.facilityId,
          entityType: 'shift_group',
          entityId: group.id,
          type: 'archived',
          body: `Lưu trữ nhóm ca: ${group.name}`,
          actorId: ctx.session.userId,
        });
        return { ok: true };
      }),
    ),
});
