import { initTRPC, TRPCError } from '@trpc/server';
import { Role, type RequestSession } from '@cmc/auth';
import type { ApiContext } from './context.js';

const t = initTRPC.context<ApiContext>().create({
  // Never leak stack traces / absolute paths to clients, regardless of NODE_ENV.
  errorFormatter({ shape }) {
    const { stack: _stack, ...data } = shape.data as Record<string, unknown>;
    return { ...shape, data };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/** Requires a valid session; narrows ctx.session to non-null. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, session: ctx.session as RequestSession } });
});

/** super_admin only. */
export const superAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.session.isSuperAdmin) throw new TRPCError({ code: 'FORBIDDEN' });
  return next();
});

/** Require any of the given roles (super_admin always passes). */
export function requireRole(...roles: Role[]) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (ctx.session.isSuperAdmin) return next();
    if (!roles.some((r) => ctx.session.roles.includes(r))) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    return next();
  });
}

export { Role };
