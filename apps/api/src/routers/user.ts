import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { router, superAdminProcedure } from '../trpc.js';

export const userRouter = router({
  list: superAdminProcedure.query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.appUser.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          email: true,
          displayName: true,
          roles: true,
          primaryRole: true,
          isActive: true,
        },
      }),
    ),
  ),
});
