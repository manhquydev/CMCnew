import { z } from 'zod';
import { withRls, Program } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, requireRole, Role } from '../trpc.js';

const ISSUE_ROLES = [Role.head_teacher, Role.quan_ly] as const;

export const certificateRouter = router({
  list: requireRole(Role.head_teacher, Role.quan_ly, Role.giao_vien)
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

  issue: requireRole(...ISSUE_ROLES)
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
