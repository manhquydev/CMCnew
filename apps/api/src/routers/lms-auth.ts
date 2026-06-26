import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { setCookie, deleteCookie } from 'hono/cookie';
import { loginParent, loginStudent, type LmsSession } from '@cmc/auth';
import { router, publicProcedure, lmsProcedure } from '../trpc.js';
import { LMS_COOKIE_NAME } from '../context.js';
import { checkLoginLimit, clearLoginLimit, recordLoginFailure } from '../rate-limit.js';

function publicLms(s: LmsSession) {
  return {
    kind: s.kind,
    accountId: s.accountId,
    displayName: s.displayName,
    students: s.students,
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
    // Default secure everywhere; opt out only in local dev over HTTP via COOKIE_SECURE=false.
    secure: process.env.COOKIE_SECURE !== 'false',
  });
}

// LMS sign-in for parents and students (separate identity domain from staff AppUser).
export const lmsAuthRouter = router({
  loginParent: publicProcedure
    .input(z.object({ emailOrPhone: z.string().min(1), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      checkLoginLimit(ctx.ip, input.emailOrPhone);
      const result = await loginParent(input.emailOrPhone, input.password);
      if (!result) {
        recordLoginFailure(ctx.ip, input.emailOrPhone);
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sai tài khoản hoặc mật khẩu' });
      }
      clearLoginLimit(ctx.ip, input.emailOrPhone);
      setLmsCookie(ctx.c, result.token);
      return { principal: publicLms(result.session) };
    }),

  loginStudent: publicProcedure
    .input(z.object({ loginCode: z.string().min(1), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      checkLoginLimit(ctx.ip, input.loginCode);
      const result = await loginStudent(input.loginCode, input.password);
      if (!result) {
        recordLoginFailure(ctx.ip, input.loginCode);
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sai mã hoặc mật khẩu' });
      }
      clearLoginLimit(ctx.ip, input.loginCode);
      setLmsCookie(ctx.c, result.token);
      return { principal: publicLms(result.session) };
    }),

  me: publicProcedure.query(({ ctx }) => (ctx.lms ? publicLms(ctx.lms) : null)),

  logout: lmsProcedure.mutation(({ ctx }) => {
    deleteCookie(ctx.c, LMS_COOKIE_NAME, { path: '/' });
    return { ok: true };
  }),
});
