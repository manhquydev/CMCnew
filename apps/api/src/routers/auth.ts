import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { setCookie, deleteCookie } from 'hono/cookie';
import { login, type RequestSession } from '@cmc/auth';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import { COOKIE_NAME } from '../context.js';
import { checkLoginLimit, clearLoginLimit, recordLoginFailure } from '../rate-limit.js';

function publicUser(s: RequestSession) {
  return {
    userId: s.userId,
    displayName: s.displayName,
    roles: s.roles,
    primaryRole: s.primaryRole,
    isSuperAdmin: s.isSuperAdmin,
    facilityIds: s.facilityIds,
  };
}

export const authRouter = router({
  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      checkLoginLimit(ctx.ip, input.email);
      const result = await login(input.email, input.password);
      if (!result) {
        recordLoginFailure(ctx.ip, input.email);
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sai email hoặc mật khẩu' });
      }
      clearLoginLimit(ctx.ip, input.email);
      setCookie(ctx.c, COOKIE_NAME, result.token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 60 * 60 * 12,
        // Default secure everywhere; opt out only in local dev over HTTP via COOKIE_SECURE=false.
        secure: process.env.COOKIE_SECURE !== 'false',
      });
      return { user: publicUser(result.session) };
    }),

  me: publicProcedure.query(({ ctx }) => (ctx.session ? publicUser(ctx.session) : null)),

  logout: protectedProcedure.mutation(({ ctx }) => {
    deleteCookie(ctx.c, COOKIE_NAME, { path: '/' });
    return { ok: true };
  }),
});
