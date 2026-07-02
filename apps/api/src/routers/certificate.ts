import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, Program, type RlsContext } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, requirePermission, lmsProcedure } from '../trpc.js';

// certificate RLS is staff-only (principal_kind='staff') — see forStudent below for the LMS
// read path, which enforces ownership in application code instead.
const SYSTEM_RLS: RlsContext = { facilityIds: [], isSuperAdmin: true };

export const certificateRouter = router({
  // LMS parent/student: certificates issued to one owned student. Ownership is checked against
  // ctx.lms.studentIds BEFORE the bypass read — never trust the input studentId alone (same
  // invariant as submission.layerForGuardian).
  forStudent: lmsProcedure
    .input(z.object({ studentId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      if (!ctx.lms.studentIds.includes(input.studentId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      return withRls(SYSTEM_RLS, (tx) =>
        tx.certificate.findMany({
          where: { studentId: input.studentId, archivedAt: null },
          orderBy: { issuedAt: 'desc' },
          select: { id: true, title: true, program: true, level: true, issuedAt: true },
        }),
      );
    }),

  list: requirePermission('certificate', 'list')
    .input(z.object({ facilityId: z.number().int().positive(), studentId: z.string().uuid().optional() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.certificate.findMany({
          where: { facilityId: input.facilityId, archivedAt: null, ...(input.studentId ? { studentId: input.studentId } : {}) },
          orderBy: { issuedAt: 'desc' },
          take: 200,
        }),
      ),
    ),

  issue: requirePermission('certificate', 'issue')
    .input(
      z.object({
        studentId: z.string().uuid(),
        program: z.nativeEnum(Program),
        level: z.string().optional(),
        title: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const student = await tx.student.findUniqueOrThrow({ where: { id: input.studentId } });
        const cert = await tx.certificate.create({
          data: {
            facilityId: student.facilityId,
            studentId: student.id,
            program: input.program,
            level: input.level,
            title: input.title,
            issuedById: ctx.session.userId,
          },
        });
        await logEvent(tx, {
          facilityId: cert.facilityId,
          entityType: 'certificate',
          entityId: cert.id,
          type: 'created',
          body: `Cấp chứng chỉ "${input.title}" cho ${student.fullName}`,
          actorId: ctx.session.userId,
        });
        return cert;
      }),
    ),
});
