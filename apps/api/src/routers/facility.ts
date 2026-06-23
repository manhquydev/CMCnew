import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { router, protectedProcedure } from '../trpc.js';

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
});
