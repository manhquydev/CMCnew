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
        select: { id: true, code: true, name: true, isActive: true },
      }),
    ),
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
