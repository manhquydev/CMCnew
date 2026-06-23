import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, hashPassword, GuardianRelation } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, requireRole, Role } from '../trpc.js';

// Parent/student accounts are SYSTEM-WIDE identities (no facility_id) — facilities are linked
// branches, not silos (docs/specs/facility-model-decision.md). Leadership (bgd/quan_ly, super)
// manages them at the system level; RLS now allows any staff to read these identity rows, while
// linking a guardian to a student still respects that student's facility (operational scoping).
const LEAD_ROLES = [Role.bgd, Role.quan_ly] as const;

export const guardianRouter = router({
  parentList: requireRole(...LEAD_ROLES).query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.parentAccount.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, email: true, phone: true, displayName: true, isActive: true, createdAt: true },
      }),
    ),
  ),

  parentCreate: requireRole(...LEAD_ROLES)
    .input(
      z
        .object({
          displayName: z.string().min(1),
          email: z.string().email().optional(),
          phone: z.string().min(6).optional(),
          password: z.string().min(6),
        })
        .refine((v) => v.email || v.phone, { message: 'Cần email hoặc số điện thoại' }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const parent = await tx.parentAccount.create({
          data: {
            displayName: input.displayName,
            email: input.email,
            phone: input.phone,
            passwordHash: await hashPassword(input.password),
          },
          select: { id: true, email: true, phone: true, displayName: true },
        });
        return parent;
      }),
    ),

  // Guardians of a student, with the parent's identity.
  listForStudent: requireRole(...LEAD_ROLES)
    .input(z.object({ studentId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.guardian.findMany({
          where: { studentId: input.studentId },
          include: { parent: { select: { id: true, displayName: true, email: true, phone: true } } },
        }),
      ),
    ),

  // Link a parent to a student (facility inherited from the student). Idempotent on the unique.
  link: requireRole(...LEAD_ROLES)
    .input(
      z.object({
        parentAccountId: z.string().uuid(),
        studentId: z.string().uuid(),
        relation: z.nativeEnum(GuardianRelation).default(GuardianRelation.guardian),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const student = await tx.student.findUniqueOrThrow({ where: { id: input.studentId } });
        const guardian = await tx.guardian.upsert({
          where: { parentAccountId_studentId: { parentAccountId: input.parentAccountId, studentId: input.studentId } },
          update: { relation: input.relation },
          create: {
            facilityId: student.facilityId,
            parentAccountId: input.parentAccountId,
            studentId: input.studentId,
            relation: input.relation,
          },
        });
        await logEvent(tx, {
          facilityId: guardian.facilityId,
          entityType: 'guardian',
          entityId: guardian.id,
          type: 'created',
          body: `Liên kết phụ huynh ↔ ${student.fullName} (${input.relation})`,
          actorId: ctx.session.userId,
        });
        return guardian;
      }),
    ),

  unlink: requireRole(...LEAD_ROLES)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const g = await tx.guardian.findUniqueOrThrow({ where: { id: input.id } });
        await tx.guardian.delete({ where: { id: input.id } });
        await logEvent(tx, {
          facilityId: g.facilityId,
          entityType: 'guardian',
          entityId: g.id,
          type: 'archived',
          body: 'Gỡ liên kết phụ huynh',
          actorId: ctx.session.userId,
        });
        return { ok: true };
      }),
    ),
});
