import { router, publicProcedure } from '../trpc.js';
import { authRouter } from './auth.js';
import { facilityRouter } from './facility.js';
import { userRouter } from './user.js';

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, ts: new Date().toISOString() })),
  auth: authRouter,
  facility: facilityRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
