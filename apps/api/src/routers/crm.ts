import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, Program, OpportunityStage, LostReason, TestType, type RlsContext } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, publicProcedure, requirePermission, Role } from '../trpc.js';
import { throttle } from '../rate-limit.js';

/** Nhãn tiếng Việt cho lý do mất — dùng trong chatter/log. */
const LOST_REASON_LABEL: Record<LostReason, string> = {
  price: 'Giá',
  schedule: 'Lịch học',
  distance: 'Khoảng cách',
  competitor: 'Đối thủ',
  no_response: 'Không phản hồi',
  not_ready: 'Chưa sẵn sàng',
  other: 'Khác',
};

// Public lead-ingest throttle: a generous per-IP cap (a real tuition centre never submits anywhere
// near this in 15 min) that still stops scripted spam if the shared token leaks. Env-tunable.
const LEAD_RATE_IP_LIMIT = Number(process.env.LEAD_RATE_IP_LIMIT ?? 100);

/** Length-checked constant-time token comparison (timingSafeEqual throws on length mismatch). */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Roles permitted to assign an opportunity to a user other than themselves.
 * A non-manager (sale/cskh/ctv_mkt) creating an opportunity may only credit ownerId = self.
 */
const CRM_MANAGER_ROLES: Role[] = [Role.quan_ly, Role.giam_doc_kinh_doanh, Role.bgd, Role.super_admin];

/**
 * Roles that may own an opportunity (carry commission attribution). Drives the
 * "Đổi người phụ trách" picker so a manager chooses a name instead of pasting a UUID.
 */
const CRM_OWNER_ROLES: Role[] = [
  Role.sale,
  Role.cskh,
  Role.ctv_mkt,
  Role.quan_ly,
  Role.giam_doc_kinh_doanh,
];

const STAGE_ORDER: OpportunityStage[] = [
  OpportunityStage.O1_LEAD,
  OpportunityStage.O2_CONTACTED,
  OpportunityStage.O3_TEST_SCHEDULED,
  OpportunityStage.O4_TESTED,
  OpportunityStage.O5_ENROLLED,
];
/** Only ever move an opportunity forward (auto-hooks never regress a manually-advanced opp). */
function advanceTo(current: OpportunityStage, target: OpportunityStage): OpportunityStage {
  return STAGE_ORDER.indexOf(target) > STAGE_ORDER.indexOf(current) ? target : current;
}

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
  input: {
    facilityId: number;
    fullName: string;
    phone: string;
    email?: string;
    source?: string;
    medium?: string;
    campaign?: string;
    note?: string;
  },
) {
  const phone = normalizePhone(input.phone);
  const existing = await tx.contact.findFirst({ where: { facilityId: input.facilityId, phone } });
  // Quy nguồn (source/medium/campaign) thuộc về lần chạm ĐẦU — không ghi đè khi liên hệ đã tồn tại.
  if (existing) return existing;
  return tx.contact.create({
    data: {
      facilityId: input.facilityId,
      fullName: input.fullName,
      phone,
      email: input.email,
      source: input.source,
      medium: input.medium,
      campaign: input.campaign,
      note: input.note,
    },
  });
}

/**
 * Owner cơ hội chảy vào hoa hồng (Receipt.soldById tại approve) → phải là nhân viên đang hoạt động
 * và thuộc cơ sở của cơ hội. Bỏ qua khi caller là super (system/admin tin cậy).
 */
async function assertValidOwner(
  tx: Parameters<Parameters<typeof withRls>[1]>[0],
  facilityId: number,
  ownerId: string,
) {
  const u = await tx.appUser.findFirst({
    where: { id: ownerId, isActive: true, facilities: { some: { facilityId } } },
    select: { id: true },
  });
  if (!u) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Người phụ trách phải là nhân viên đang hoạt động của cơ sở',
    });
  }
}

/**
 * Ghi một dòng vào sổ phân bổ cơ hội (append-only) + chatter. Gọi mỗi khi owner được set/đổi.
 * fromOwnerId null = lần gán đầu (lúc tạo cơ hội).
 */
async function logAssignment(
  tx: Parameters<Parameters<typeof withRls>[1]>[0],
  args: {
    facilityId: number;
    opportunityId: string;
    fromOwnerId: string | null;
    toOwnerId: string | null;
    assignedById: string;
    reason?: string;
  },
) {
  await tx.opportunityAssignment.create({
    data: {
      facilityId: args.facilityId,
      opportunityId: args.opportunityId,
      fromOwnerId: args.fromOwnerId,
      toOwnerId: args.toOwnerId,
      assignedById: args.assignedById,
      reason: args.reason,
    },
  });
  await logEvent(tx, {
    facilityId: args.facilityId,
    entityType: 'opportunity',
    entityId: args.opportunityId,
    type: 'status_changed',
    body: args.fromOwnerId ? `Đổi người phụ trách${args.reason ? ': ' + args.reason : ''}` : 'Gán người phụ trách',
    changes: [{ field: 'ownerId', old: args.fromOwnerId, new: args.toOwnerId }],
    actorId: args.assignedById,
  });
}

export const crmRouter = router({
  contactList: requirePermission('crm', 'contactList')
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

  contactCreate: requirePermission('crm', 'contactCreate')
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        fullName: z.string().min(1),
        phone: z.string().min(6),
        email: z.string().email().optional(),
        source: z.string().optional(),
        medium: z.string().optional(),
        campaign: z.string().optional(),
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
  opportunityList: requirePermission('crm', 'opportunityList')
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

  // One opportunity + its full contact, for the record detail page. RLS scopes it to the
  // caller's facilities, so a deep link to another facility's opp resolves to NOT_FOUND.
  opportunityGet: requirePermission('crm', 'opportunityGet')
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.opportunity.findFirstOrThrow({
          where: { id: input.id, archivedAt: null },
          include: { contact: true },
        }),
      ),
    ),

  // Active staff at a facility who may own an opportunity — feeds the reassign picker
  // and lets the UI resolve an ownerId to a display name.
  assignableOwners: requirePermission('crm', 'assignableOwners')
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.appUser.findMany({
          where: {
            isActive: true,
            facilities: { some: { facilityId: input.facilityId } },
            roles: { hasSome: CRM_OWNER_ROLES },
          },
          select: { id: true, displayName: true, primaryRole: true },
          orderBy: { displayName: 'asc' },
        }),
      ),
    ),

  opportunityCreate: requirePermission('crm', 'opportunityCreate')
    .input(
      z.object({
        contactId: z.string().uuid(),
        studentName: z.string().optional(),
        program: z.nativeEnum(Program).optional(),
        ownerId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const contact = await tx.contact.findUniqueOrThrow({ where: { id: input.contactId } });

        // A non-manager (sale/cskh/ctv_mkt) may only credit themselves as the opportunity owner.
        // Managers (quan_ly, giam_doc_kinh_doanh, bgd, super_admin) may credit any user.
        const callerIsManager =
          ctx.session.isSuperAdmin || ctx.session.roles.some((r) => CRM_MANAGER_ROLES.includes(r as Role));
        const resolvedOwnerId = input.ownerId ?? ctx.session.userId;
        if (!callerIsManager && resolvedOwnerId !== ctx.session.userId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Chỉ quản lý mới có thể gán cơ hội cho người khác',
          });
        }
        // Owner nuôi hoa hồng → chặn gán cho id không phải nhân viên cơ sở (super bỏ qua).
        if (!ctx.session.isSuperAdmin) {
          await assertValidOwner(tx, contact.facilityId, resolvedOwnerId);
        }

        const opp = await tx.opportunity.create({
          data: {
            facilityId: contact.facilityId,
            contactId: contact.id,
            studentName: input.studentName,
            program: input.program,
            // Credit the consultant who owns this opportunity — defaults to the creator (a sale).
            ownerId: resolvedOwnerId,
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
        // B1: lần gán đầu (from=null) vào sổ phân bổ để KPI/hoa hồng có dấu vết từ đầu.
        await logAssignment(tx, {
          facilityId: opp.facilityId,
          opportunityId: opp.id,
          fromOwnerId: null,
          toOwnerId: resolvedOwnerId,
          assignedById: ctx.session.userId,
        });
        return opp;
      }),
    ),

  // Đổi người phụ trách (manager-only qua registry) — ghi sổ phân bổ. KHÔNG đổi nghĩa ownerId
  // (vẫn là nguồn hoa hồng → Receipt.soldById tại approve), chỉ thêm bản ghi append-only.
  opportunityReassign: requirePermission('crm', 'opportunityReassign')
    .input(z.object({ id: z.string().uuid(), toOwnerId: z.string().uuid(), reason: z.string().optional() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.opportunity.findUniqueOrThrow({ where: { id: input.id } });
        if (before.ownerId === input.toOwnerId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cơ hội đã thuộc người này' });
        }
        if (!ctx.session.isSuperAdmin) {
          await assertValidOwner(tx, before.facilityId, input.toOwnerId);
        }
        const opp = await tx.opportunity.update({ where: { id: input.id }, data: { ownerId: input.toOwnerId } });
        await logAssignment(tx, {
          facilityId: opp.facilityId,
          opportunityId: opp.id,
          fromOwnerId: before.ownerId,
          toOwnerId: input.toOwnerId,
          assignedById: ctx.session.userId,
          reason: input.reason,
        });
        return opp;
      }),
    ),

  // Sổ phân bổ của một cơ hội (mới → cũ). Append-only, không sửa/xoá.
  assignmentHistory: requirePermission('crm', 'assignmentHistory')
    .input(z.object({ opportunityId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.opportunityAssignment.findMany({
          where: { opportunityId: input.opportunityId },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      ),
    ),

  // Manual stage move (forward or back). Reaching O5 closes the opportunity (won).
  opportunityTransition: requirePermission('crm', 'opportunityTransition')
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
        // A WON deal (O5_ENROLLED + closedAt) has frozen commission attribution and a linked
        // receipt/enrollment. Regressing it to an earlier stage would clear closedAt and silently
        // desync the won/lost split from the receipt — mirror the markLost guard and refuse.
        if (before.stage === 'O5_ENROLLED' && before.closedAt && input.stage !== 'O5_ENROLLED') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Không thể lùi bước cơ hội đã thắng (đã nhập học)' });
        }
        const opp = await tx.opportunity.update({
          where: { id: input.id },
          data: {
            stage: input.stage,
            closedAt: input.stage === 'O5_ENROLLED' ? new Date() : null,
            lostReason: null,
            lostNote: null,
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

  opportunityMarkLost: requirePermission('crm', 'opportunityMarkLost')
    .input(z.object({ id: z.string().uuid(), reason: z.nativeEnum(LostReason), note: z.string().optional() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.opportunity.findUniqueOrThrow({ where: { id: input.id } });
        // A WON deal (O5_ENROLLED + closedAt, lostReason null) has frozen commission attribution;
        // marking it lost would corrupt the won/lost split without reversing the receipt.
        if (before.stage === 'O5_ENROLLED' && before.closedAt) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Không thể đánh dấu mất cơ hội đã thắng' });
        }
        if (before.closedAt && before.lostReason) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cơ hội đã đóng (mất)' });
        }
        const opp = await tx.opportunity.update({
          where: { id: input.id },
          data: { closedAt: new Date(), lostReason: input.reason, lostNote: input.note ?? null },
        });
        const label = LOST_REASON_LABEL[input.reason];
        await logEvent(tx, {
          facilityId: opp.facilityId,
          entityType: 'opportunity',
          entityId: opp.id,
          type: 'status_changed',
          body: `Đóng (mất): ${label}${input.note ? ' — ' + input.note : ''}`,
          changes: [{ field: 'lostReason', old: null, new: input.reason }],
          actorId: ctx.session.userId,
        });
        return opp;
      }),
    ),

  // Re-open a closed (lost) opportunity back into the pipeline.
  opportunityReopen: requirePermission('crm', 'opportunityReopen')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const current = await tx.opportunity.findUniqueOrThrow({ where: { id: input.id } });
        if (current.closedAt === null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cơ hội chưa đóng, không cần mở lại' });
        }
        const opp = await tx.opportunity.update({
          where: { id: input.id },
          data: { closedAt: null, lostReason: null, lostNote: null },
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

  // ── Test appointments (S3) — entrance test auto-advances its opportunity ─────
  testList: requirePermission('crm', 'testList')
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.testAppointment.findMany({
          where: { facilityId: input.facilityId, archivedAt: null },
          orderBy: { scheduledAt: 'desc' },
          take: 200,
        }),
      ),
    ),

  // Schedule a test. An entrance test linked to an opportunity auto-advances it to O3.
  testCreate: requirePermission('crm', 'testCreate')
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        opportunityId: z.string().uuid().optional(),
        studentName: z.string().optional(),
        type: z.nativeEnum(TestType).default(TestType.entrance),
        scheduledAt: z.string().datetime(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const appt = await tx.testAppointment.create({
          data: {
            facilityId: input.facilityId,
            opportunityId: input.opportunityId,
            studentName: input.studentName,
            type: input.type,
            scheduledAt: new Date(input.scheduledAt),
          },
        });
        await logEvent(tx, {
          facilityId: appt.facilityId,
          entityType: 'test_appointment',
          entityId: appt.id,
          type: 'created',
          body: `Lịch test (${input.type}) ${input.scheduledAt}`,
          actorId: ctx.session.userId,
        });
        // Auto-hook: entrance test scheduled → opportunity to O3.
        if (input.type === TestType.entrance && input.opportunityId) {
          const opp = await tx.opportunity.findUnique({ where: { id: input.opportunityId } });
          if (opp && !opp.closedAt) {
            const next = advanceTo(opp.stage, OpportunityStage.O3_TEST_SCHEDULED);
            if (next !== opp.stage) {
              await tx.opportunity.update({ where: { id: opp.id }, data: { stage: next } });
              await logEvent(tx, {
                facilityId: opp.facilityId,
                entityType: 'opportunity',
                entityId: opp.id,
                type: 'status_changed',
                body: 'Auto: đặt lịch test → O3',
                changes: [{ field: 'stage', old: opp.stage, new: next }],
              });
            }
          }
        }
        return appt;
      }),
    ),

  // Record a result. An entrance test graded → opportunity auto-advances to O4.
  testGrade: requirePermission('crm', 'testGrade')
    .input(z.object({ id: z.string().uuid(), score: z.number(), result: z.string().optional() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const appt = await tx.testAppointment.update({
          where: { id: input.id },
          data: {
            status: 'done',
            score: input.score,
            result: input.result,
            gradedById: ctx.session.userId,
            gradedAt: new Date(),
          },
        });
        await logEvent(tx, {
          facilityId: appt.facilityId,
          entityType: 'test_appointment',
          entityId: appt.id,
          type: 'status_changed',
          body: `Chấm test: ${input.score}${input.result ? ' · ' + input.result : ''}`,
          actorId: ctx.session.userId,
        });
        if (appt.type === TestType.entrance && appt.opportunityId) {
          const opp = await tx.opportunity.findUnique({ where: { id: appt.opportunityId } });
          if (opp && !opp.closedAt) {
            const next = advanceTo(opp.stage, OpportunityStage.O4_TESTED);
            if (next !== opp.stage) {
              await tx.opportunity.update({ where: { id: opp.id }, data: { stage: next } });
              await logEvent(tx, {
                facilityId: opp.facilityId,
                entityType: 'opportunity',
                entityId: opp.id,
                type: 'status_changed',
                body: 'Auto: chấm xong test → O4',
                changes: [{ field: 'stage', old: opp.stage, new: next }],
              });
            }
          }
        }
        return appt;
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
        medium: z.string().optional(),
        campaign: z.string().optional(),
        studentName: z.string().optional(),
        program: z.nativeEnum(Program).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Per-IP throttle BEFORE the token check, so a leaked token (or token brute-forcing) cannot be
      // used to flood the CRM with junk contacts/opportunities. Every call counts.
      throttle(`lead:${ctx.ip}`, LEAD_RATE_IP_LIMIT);
      const expected = process.env.CRM_LEAD_TOKEN;
      // Constant-time compare so this public endpoint does not leak the token byte-by-byte via
      // response timing.
      if (!expected || !tokenMatches(input.token, expected)) {
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
