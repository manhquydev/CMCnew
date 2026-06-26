import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, CaseStatus, CasePriority, StudentLifecycle } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, requireRole, Role } from '../trpc.js';

const CSKH_ROLES = [Role.cskh, Role.quan_ly] as const;

export const afterSaleRouter = router({
  list: requireRole(...CSKH_ROLES)
    .input(z.object({ facilityId: z.number().int().positive(), status: z.nativeEnum(CaseStatus).optional() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.afterSaleCase.findMany({
          where: { facilityId: input.facilityId, archivedAt: null, ...(input.status ? { status: input.status } : {}) },
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
      ),
    ),

  create: requireRole(...CSKH_ROLES)
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        subject: z.string().min(1),
        studentId: z.string().uuid().optional(),
        contactPhone: z.string().optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        priority: z.nativeEnum(CasePriority).default(CasePriority.normal),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const kase = await tx.afterSaleCase.create({
          data: {
            facilityId: input.facilityId,
            subject: input.subject,
            studentId: input.studentId,
            contactPhone: input.contactPhone,
            description: input.description,
            category: input.category,
            priority: input.priority,
            createdById: ctx.session.userId,
          },
        });
        await logEvent(tx, {
          facilityId: kase.facilityId,
          entityType: 'after_sale_case',
          entityId: kase.id,
          type: 'created',
          body: `Ca CSKH: ${input.subject}`,
          actorId: ctx.session.userId,
        });
        return kase;
      }),
    ),

  // Move a case along its lifecycle (open→in_progress→resolved→closed; can reopen). Audited.
  transition: requireRole(...CSKH_ROLES)
    .input(z.object({ id: z.string().uuid(), status: z.nativeEnum(CaseStatus) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.afterSaleCase.findUniqueOrThrow({ where: { id: input.id } });
        const resolved = input.status === 'resolved' || input.status === 'closed';
        const kase = await tx.afterSaleCase.update({
          where: { id: input.id },
          data: {
            status: input.status,
            resolvedAt: resolved ? (before.resolvedAt ?? new Date()) : null,
          },
        });
        await logEvent(tx, {
          facilityId: kase.facilityId,
          entityType: 'after_sale_case',
          entityId: kase.id,
          type: 'status_changed',
          body: `Trạng thái ca: ${before.status} → ${input.status}`,
          changes: [{ field: 'status', old: before.status, new: input.status }],
          actorId: ctx.session.userId,
        });
        return kase;
      }),
    ),

  assign: requireRole(...CSKH_ROLES)
    .input(z.object({ id: z.string().uuid(), assignedToId: z.string().uuid().nullable() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const existing = await tx.afterSaleCase.findUniqueOrThrow({ where: { id: input.id } });
        if (input.assignedToId !== null) {
          const member = await tx.userFacility.findFirst({
            where: { userId: input.assignedToId, facilityId: existing.facilityId },
          });
          if (!member) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Người được giao không thuộc cơ sở này' });
          }
        }
        const kase = await tx.afterSaleCase.update({
          where: { id: input.id },
          data: { assignedToId: input.assignedToId },
        });
        await logEvent(tx, {
          facilityId: kase.facilityId,
          entityType: 'after_sale_case',
          entityId: kase.id,
          type: 'updated',
          body: input.assignedToId ? 'Giao xử lý ca' : 'Bỏ giao ca',
          actorId: ctx.session.userId,
        });
        return kase;
      }),
    ),

  // A case can change a student's lifecycle (e.g. on_hold / withdrawn). quan_ly only; audited
  // on both the case and the student so the timeline links the decision to the case.
  setStudentLifecycle: requireRole(Role.quan_ly)
    .input(
      z.object({
        studentId: z.string().uuid(),
        lifecycle: z.nativeEnum(StudentLifecycle),
        caseId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.student.findUniqueOrThrow({ where: { id: input.studentId } });
        const student = await tx.student.update({
          where: { id: input.studentId },
          data: { lifecycle: input.lifecycle },
        });
        await logEvent(tx, {
          facilityId: student.facilityId,
          entityType: 'student',
          entityId: student.id,
          type: 'status_changed',
          body: `Vòng đời HS: ${before.lifecycle} → ${input.lifecycle}${input.caseId ? ' (từ ca CSKH)' : ''}`,
          changes: [{ field: 'lifecycle', old: before.lifecycle, new: input.lifecycle }],
          actorId: ctx.session.userId,
        });
        if (input.caseId) {
          await logEvent(tx, {
            facilityId: student.facilityId,
            entityType: 'after_sale_case',
            entityId: input.caseId,
            type: 'updated',
            body: `Đổi vòng đời HS → ${input.lifecycle}`,
            actorId: ctx.session.userId,
          });
        }
        return student;
      }),
    ),
});
