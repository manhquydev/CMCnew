import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { setCookie, deleteCookie } from 'hono/cookie';
import { loginParent, loginStudent, type LmsSession } from '@cmc/auth';
import { router, publicProcedure, lmsProcedure } from '../trpc.js';
import { LMS_COOKIE_NAME } from '../context.js';

function publicLms(s: LmsSession) {
  return {
    kind: s.kind,
    accountId: s.accountId,
    displayName: s.displayName,
    studentIds: s.studentIds,
    facilityIds: s.facilityIds,
  };
}

function setLmsCookie(c: Parameters<typeof setCookie>[0], token: string) {
  setCookie(c, LMS_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 12,
    secure: process.env.NODE_ENV === 'production',
  });
}

// LMS sign-in for parents and students (separate identity domain from staff AppUser).
export const lmsAuthRouter = router({
  loginParent: publicProcedure
    .input(z.object({ emailOrPhone: z.string().min(1), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await loginParent(input.emailOrPhone, input.password);
      if (!result) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sai tài khoản hoặc mật khẩu' });
      setLmsCookie(ctx.c, result.token);
      return { principal: publicLms(result.session) };
    }),

  loginStudent: publicProcedure
    .input(z.object({ loginCode: z.string().min(1), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await loginStudent(input.loginCode, input.password);
      if (!result) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sai mã hoặc mật khẩu' });
      setLmsCookie(ctx.c, result.token);
      return { principal: publicLms(result.session) };
    }),

  me: publicProcedure.query(({ ctx }) => (ctx.lms ? publicLms(ctx.lms) : null)),

  logout: lmsProcedure.mutation(({ ctx }) => {
    deleteCookie(ctx.c, LMS_COOKIE_NAME, { path: '/' });
    return { ok: true };
  }),
});
