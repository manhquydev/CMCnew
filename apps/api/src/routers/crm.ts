import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, Program, OpportunityStage, type RlsContext } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, publicProcedure, requireRole, Role } from '../trpc.js';

const CRM_ROLES = [Role.sale, Role.cskh, Role.quan_ly] as const;

/** Normalise a VN phone to +84 so dedup (1 opportunity = 1 SĐT) is format-agnostic. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) return digits;
  if (digits.startsWith('84')) return '+' + digits;
  if (digits.startsWith('0')) return '+84' + digits.slice(1);
  return digits;
}

/** Find-or-create a contact by (facility, normalised phone) inside the given tx. */
async function upsertContact(
  tx: Parameters<Parameters<typeof withRls>[1]>[0],
  input: { facilityId: number; fullName: string; phone: string; email?: string; source?: string; note?: string },
) {
  const phone = normalizePhone(input.phone);
  const existing = await tx.contact.findFirst({ where: { facilityId: input.facilityId, phone } });
  if (existing) return existing;
  return tx.contact.create({
    data: {
      facilityId: input.facilityId,
      fullName: input.fullName,
      phone,
      email: input.email,
      source: input.source,
      note: input.note,
    },
  });
}

export const crmRouter = router({
  contactList: requireRole(...CRM_ROLES)
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.contact.findMany({
          where: { facilityId: input.facilityId, archivedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
      ),
    ),

  contactCreate: requireRole(...CRM_ROLES)
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        fullName: z.string().min(1),
        phone: z.string().min(6),
        email: z.string().email().optional(),
        source: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const contact = await upsertContact(tx, input);
        await logEvent(tx, {
          facilityId: contact.facilityId,
          entityType: 'contact',
          entityId: contact.id,
          type: 'created',
          body: `Liên hệ: ${contact.fullName} (${contact.phone})`,
          actorId: ctx.session.userId,
        });
        return contact;
      }),
    ),

  // Opportunities (with their contact) for a facility's pipeline board.
  opportunityList: requireRole(...CRM_ROLES)
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.opportunity.findMany({
          where: { facilityId: input.facilityId, archivedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: { contact: { select: { fullName: true, phone: true } } },
        }),
      ),
    ),

  opportunityCreate: requireRole(...CRM_ROLES)
    .input(
      z.object({
        contactId: z.string().uuid(),
        studentName: z.string().optional(),
        program: z.nativeEnum(Program).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const contact = await tx.contact.findUniqueOrThrow({ where: { id: input.contactId } });
        const opp = await tx.opportunity.create({
          data: {
            facilityId: contact.facilityId,
            contactId: contact.id,
            studentName: input.studentName,
            program: input.program,
          },
        });
        await logEvent(tx, {
          facilityId: opp.facilityId,
          entityType: 'opportunity',
          entityId: opp.id,
          type: 'created',
          body: `Cơ hội mới: ${input.studentName ?? contact.fullName} (O1)`,
          actorId: ctx.session.userId,
        });
        return opp;
      }),
    ),

  // Manual stage move (forward or back). Reaching O5 closes the opportunity (won).
  opportunityTransition: requireRole(...CRM_ROLES)
    .input(
      z.object({
        id: z.string().uuid(),
        stage: z.nativeEnum(OpportunityStage),
        reason: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.opportunity.findUniqueOrThrow({ where: { id: input.id } });
        const opp = await tx.opportunity.update({
          where: { id: input.id },
          data: {
            stage: input.stage,
            closedAt: input.stage === 'O5_ENROLLED' ? new Date() : null,
            lostReason: null,
          },
        });
        await logEvent(tx, {
          facilityId: opp.facilityId,
          entityType: 'opportunity',
          entityId: opp.id,
          type: 'status_changed',
          body: input.reason ? `Chuyển bước: ${input.reason}` : `Chuyển bước ${before.stage} → ${input.stage}`,
          changes: [{ field: 'stage', old: before.stage, new: input.stage }],
          actorId: ctx.session.userId,
        });
        return opp;
      }),
    ),

  opportunityMarkLost: requireRole(...CRM_ROLES)
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.opportunity.findUniqueOrThrow({ where: { id: input.id } });
        if (before.closedAt && before.lostReason) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cơ hội đã đóng (mất)' });
        }
        const opp = await tx.opportunity.update({
          where: { id: input.id },
          data: { closedAt: new Date(), lostReason: input.reason },
        });
        await logEvent(tx, {
          facilityId: opp.facilityId,
          entityType: 'opportunity',
          entityId: opp.id,
          type: 'status_changed',
          body: `Đóng (mất): ${input.reason}`,
          changes: [{ field: 'lostReason', old: null, new: input.reason }],
          actorId: ctx.session.userId,
        });
        return opp;
      }),
    ),

  // Re-open a closed (lost) opportunity back into the pipeline.
  opportunityReopen: requireRole(...CRM_ROLES)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const opp = await tx.opportunity.update({
          where: { id: input.id },
          data: { closedAt: null, lostReason: null },
        });
        await logEvent(tx, {
          facilityId: opp.facilityId,
          entityType: 'opportunity',
          entityId: opp.id,
          type: 'status_changed',
          body: 'Mở lại cơ hội',
          actorId: ctx.session.userId,
        });
        return opp;
      }),
    ),

  // Lead-ingest seam for the website (later). Token-gated; writes scoped to the named facility
  // via a staff RLS context. Phase 3 ships the seam; real website integration comes later.
  leadIngest: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        facilityId: z.number().int().positive(),
        fullName: z.string().min(1),
        phone: z.string().min(6),
        email: z.string().email().optional(),
        source: z.string().optional(),
        studentName: z.string().optional(),
        program: z.nativeEnum(Program).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const expected = process.env.CRM_LEAD_TOKEN;
      if (!expected || input.token !== expected) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Lead token không hợp lệ' });
      }
      const sys: RlsContext = { facilityIds: [input.facilityId], isSuperAdmin: false, principalKind: 'staff' };
      return withRls(sys, async (tx) => {
        const contact = await upsertContact(tx, { ...input, source: input.source ?? 'web' });
        const opp = await tx.opportunity.create({
          data: {
            facilityId: contact.facilityId,
            contactId: contact.id,
            studentName: input.studentName,
            program: input.program,
          },
        });
        await logEvent(tx, {
          facilityId: opp.facilityId,
          entityType: 'opportunity',
          entityId: opp.id,
          type: 'created',
          body: `Lead từ web: ${input.studentName ?? contact.fullName} (${contact.phone})`,
        });
        return { contactId: contact.id, opportunityId: opp.id };
      });
    }),
});
