import { z } from 'zod';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, protectedProcedure, superAdminProcedure } from '../trpc.js';

export const facilityRouter = router({
  /** Facilities visible to the caller — RLS scopes this by the session's facilities. */
  list: protectedProcedure.query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.facility.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, code: true, name: true, address: true, isActive: true },
      }),
    ),
  ),

  // Only super_admin may update facility metadata (code, name, address, isActive).
  update: superAdminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        code: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        address: z.string().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const { id, ...data } = input;
        const facility = await tx.facility.update({ where: { id }, data });
        await logEvent(tx, {
          facilityId: facility.id,
          entityType: 'facility',
          entityId: String(facility.id),
          type: 'updated',
          actorId: ctx.session.userId,
        });
        return facility;
      }),
    ),

  // A facility is the tenancy boundary itself → only super_admin may create one.
  create: superAdminProcedure
    .input(
      z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        address: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const facility = await tx.facility.create({ data: input });
        await logEvent(tx, {
          facilityId: facility.id,
          entityType: 'facility',
          entityId: String(facility.id),
          type: 'created',
          actorId: ctx.session.userId,
        });
        return facility;
      }),
    ),
});
