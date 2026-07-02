import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, requirePermission } from '../trpc.js';
import { emitStaffNotif } from '../lib/emit-staff-notif.js';

/// Resolve shift group for a user based on their position text.
function resolveShiftGroup(position: string): string {
  if (['sale', 'cskh', 'ctv_mkt'].some((r) => position.includes(r))) return 'KINH_DOANH';
  if (['giao_vien', 'head_teacher'].some((r) => position.includes(r))) return 'GIAO_VIEN';
  // Fallback for quan_ly, bgd, etc. (free-text position, not tied to the Role enum) — business group
  return 'KINH_DOANH';
}

/// Resolve manager: if EmploymentProfile.managerId is null, default to director by role.
/// Escalation fallback ("next manager" when the chain runs out) is by shift group — the
/// KINH_DOANH group falls back to giam_doc_kinh_doanh, the GIAO_VIEN group falls back to
/// giam_doc_dao_tao. Legacy 'bgd' role is retired; there is no group-agnostic fallback anymore.
async function resolveManager(
  tx: any, userId: string, roles: string[],
): Promise<{ managerId: string | null; nextManagerId: string | null }> {
  const profile = await tx.employmentProfile.findUnique({
    where: { userId },
    select: { facilityId: true, managerId: true, position: true },
  });
  const fallbackDirectorRole = resolveShiftGroup(profile?.position ?? '') === 'GIAO_VIEN'
    ? 'giam_doc_dao_tao'
    : 'giam_doc_kinh_doanh';
  if (profile?.managerId) {
    // Chain: manager is this person, next level is manager's manager (or the group's director)
    const mgrProfile = await tx.employmentProfile.findUnique({
      where: { userId: profile.managerId },
      select: { managerId: true },
    });
    const fallbackDirector = await tx.appUser.findFirst({
      where: { isActive: true, roles: { has: fallbackDirectorRole }, facilities: { some: { facilityId: profile.facilityId } } },
      select: { id: true },
    });
    return {
      managerId: profile.managerId,
      nextManagerId: mgrProfile?.managerId ?? fallbackDirector?.id ?? null,
    };
  }
  // Auto-resolve by role
  const isSales = roles.some((r) => ['sale', 'cskh', 'ctv_mkt'].includes(r));
  const isTeacher = roles.some((r) => r === 'giao_vien');
  const directorRole = isSales ? 'giam_doc_kinh_doanh' : isTeacher ? 'giam_doc_dao_tao' : fallbackDirectorRole;
  const director = await tx.appUser.findFirst({
    where: { isActive: true, roles: { has: directorRole }, facilities: { some: { facilityId: profile?.facilityId } } },
    select: { id: true },
  });
  const fallbackDirector = await tx.appUser.findFirst({
    where: { isActive: true, roles: { has: fallbackDirectorRole }, facilities: { some: { facilityId: profile?.facilityId } } },
    select: { id: true },
  });
  return { managerId: director?.id ?? null, nextManagerId: fallbackDirector?.id ?? null };
}

function hasAnyRole(roles: readonly string[], candidates: string[]): boolean {
  return candidates.some((role) => roles.includes(role));
}

function visibleRegistrationWhere(ctx: { session: { userId: string; roles: readonly string[]; isSuperAdmin: boolean } }) {
  if (ctx.session.isSuperAdmin || hasAnyRole(ctx.session.roles, ['hr', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'])) return {};
  return {
    OR: [
      { userId: ctx.session.userId },
      { managerId: ctx.session.userId },
      { nextManagerId: ctx.session.userId },
    ],
  };
}

function assertCanAccessRegistration(ctx: { session: { userId: string; roles: readonly string[]; isSuperAdmin: boolean } }, reg: {
  userId: string;
  managerId: string | null;
  nextManagerId: string | null;
}) {
  if (ctx.session.isSuperAdmin || hasAnyRole(ctx.session.roles, ['hr'])) return;
  if (reg.userId === ctx.session.userId || reg.managerId === ctx.session.userId || reg.nextManagerId === ctx.session.userId) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Không có quyền xem phiếu này' });
}

function assertAssignedApprover(ctx: { session: { userId: string; roles: readonly string[]; isSuperAdmin: boolean } }, reg: {
  userId: string;
  managerId: string | null;
  nextManagerId: string | null;
}) {
  if (reg.userId === ctx.session.userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Không tự duyệt phiếu của mình' });
  }
  if (ctx.session.isSuperAdmin) return;
  if (hasAnyRole(ctx.session.roles, ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'])) return;
  if (!reg.managerId && !reg.nextManagerId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Phiếu chưa resolve manager để duyệt' });
  }
  if (ctx.session.userId !== reg.managerId && ctx.session.userId !== reg.nextManagerId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Chỉ manager được gán mới duyệt được phiếu này' });
  }
}

export const shiftRegistrationRouter = router({
  // ─── Queries ────────────────────────────────────────────────────────────

  list: requirePermission('shiftRegistration', 'list')
    .input(z.object({
      facilityId: z.number().int().positive(),
      status: z.enum(['draft', 'submitted', 'approved', 'cancelled']).optional(),
      userId: z.string().uuid().optional(),
    }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.shiftRegistration.findMany({
          where: {
            facilityId: input.facilityId,
            ...(input.status ? { status: input.status } : {}),
            ...(input.userId ? { userId: input.userId } : {}),
            ...visibleRegistrationWhere(ctx),
            archivedAt: null,
          },
          include: {
            shiftGroup: { select: { name: true, selectionMode: true } },
            entries: {
              include: { shiftTemplate: true },
              orderBy: [{ date: 'asc' }, { shiftTemplate: { sortOrder: 'asc' } }],
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    ),

  get: requirePermission('shiftRegistration', 'get')
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const reg = await tx.shiftRegistration.findUniqueOrThrow({
          where: { id: input.id },
          include: {
            shiftGroup: { select: { name: true, selectionMode: true } },
            entries: {
              include: { shiftTemplate: true },
              orderBy: [{ date: 'asc' }, { shiftTemplate: { sortOrder: 'asc' } }],
            },
          },
        });
        assertCanAccessRegistration(ctx, reg);
        return reg;
      }),
    ),

  registeredInMonth: requirePermission('shiftRegistration', 'registeredInMonth')
    .input(z.object({ userId: z.string().uuid(), yearMonth: z.string().regex(/^\d{4}-\d{2}$/) }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const [y, m] = input.yearMonth.split('-').map(Number);
        const start = new Date(Date.UTC(y!, m! - 1, 1));
        const end = new Date(Date.UTC(y!, m!, 1));
        const count = await tx.shiftRegistrationEntry.count({
          where: {
            ...(input.userId !== ctx.session.userId && !ctx.session.isSuperAdmin && !hasAnyRole(ctx.session.roles, ['hr'])
              ? { registration: { managerId: ctx.session.userId, userId: input.userId, status: 'approved' } }
              : { registration: { userId: input.userId, status: 'approved' } }),
            date: { gte: start, lt: end },
          },
        });
        return { yearMonth: input.yearMonth, days: count };
      }),
    ),

  // ─── Mutations ──────────────────────────────────────────────────────────

  create: requirePermission('shiftRegistration', 'create')
    .input(z.object({
      facilityId: z.number().int().positive(),
      fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        if (new Date(input.fromDate) > new Date(input.toDate)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Khoảng ngày không hợp lệ' });
        }
        // Lock: không tạo phiếu mới nếu có phiếu SUBMITTED
        const existing = await tx.shiftRegistration.findFirst({
          where: { userId: ctx.session.userId, status: 'submitted', archivedAt: null },
        });
        if (existing) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Bạn có phiếu đang chờ duyệt — không thể tạo phiếu mới' });
        }
        // Determine shift group
        const profile = await tx.employmentProfile.findUniqueOrThrow({
          where: { userId: ctx.session.userId },
          select: { position: true },
        });
        const groupCode = resolveShiftGroup(profile.position);
        const group = await tx.shiftGroup.findFirstOrThrow({
          where: { facilityId: input.facilityId, code: groupCode, archivedAt: null },
        });
        // Resolve managers
        const { managerId, nextManagerId } = await resolveManager(tx, ctx.session.userId, ctx.session.roles as string[]);
        // Create registration
        const reg = await tx.shiftRegistration.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.userId,
            fromDate: new Date(input.fromDate),
            toDate: new Date(input.toDate),
            status: 'draft',
            shiftGroupId: group.id,
            managerId,
            nextManagerId,
          },
        });
        await logEvent(tx, {
          facilityId: reg.facilityId,
          entityType: 'shift_registration',
          entityId: reg.id,
          type: 'created',
          body: `Phiếu đăng ký ca: ${input.fromDate} → ${input.toDate}`,
          actorId: ctx.session.userId,
        });
        return reg;
      }),
    ),

  updateEntry: requirePermission('shiftRegistration', 'updateEntry')
    .input(z.object({
      registrationId: z.string().uuid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      entries: z.array(z.object({
        shiftTemplateId: z.string().uuid(),
        type: z.enum(['work', 'leave']).default('work'),
            })),
    }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const reg = await tx.shiftRegistration.findUniqueOrThrow({
          where: { id: input.registrationId },
          select: {
            status: true,
            userId: true,
            facilityId: true,
            shiftGroupId: true,
            fromDate: true,
            toDate: true,
            shiftGroup: { select: { selectionMode: true } },
          },
        });
        if (reg.userId !== ctx.session.userId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Chỉ chủ phiếu mới được thao tác' });
        }
        if (reg.status !== 'draft') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Chỉ sửa được phiếu ở trạng thái nháp' });
        }
        const entryDate = new Date(input.date);
        if (entryDate < reg.fromDate || entryDate > reg.toDate) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ngày đăng ký nằm ngoài khoảng phiếu' });
        }
        // Validate selection mode
        if (reg.shiftGroup.selectionMode === 'SINGLE' && input.entries.length > 1) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mỗi ngày chỉ được chọn 1 ca' });
        }
        // Delete existing entries for this day
        await tx.shiftRegistrationEntry.deleteMany({
          where: { registrationId: input.registrationId, date: new Date(input.date) },
        });
        // Create new entries
        const templates = await tx.shiftTemplate.findMany({
          where: {
            id: { in: input.entries.map((e) => e.shiftTemplateId) },
            facilityId: reg.facilityId,
            shiftGroupId: reg.shiftGroupId,
            archivedAt: null,
          },
          select: { id: true, hours: true },
        });
        if (templates.length !== input.entries.length) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ca đăng ký không hợp lệ cho nhóm ca này' });
        }
        const hoursMap = new Map(templates.map((t) => [t.id, t.hours]));
        const created = await Promise.all(
          input.entries.map((e) =>
            tx.shiftRegistrationEntry.create({
              data: {
                registrationId: input.registrationId,
                date: new Date(input.date),
                shiftTemplateId: e.shiftTemplateId,
                type: e.type,
                hours: hoursMap.get(e.shiftTemplateId) ?? 0,
              },
            }),
          ),
        );
        return created;
      }),
    ),

  submit: requirePermission('shiftRegistration', 'submit')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const reg = await tx.shiftRegistration.findUniqueOrThrow({
          where: { id: input.id },
          include: { entries: true },
        });
        if (reg.userId !== ctx.session.userId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Chỉ chủ phiếu mới được nộp' });
        }
        if (reg.status !== 'draft') throw new TRPCError({ code: 'CONFLICT', message: 'Chỉ nộp được phiếu nháp' });
        if (reg.entries.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Phiếu chưa có ca đăng ký' });
        // Generate code: SR-YYYY-NNNN
        const year = new Date().getFullYear();
        const counter = await tx.$queryRawUnsafe<{ next: number }[]>(
          `INSERT INTO shift_code_counter (facility_id, year, last_seq) VALUES ($1, $2, 1)
           ON CONFLICT (facility_id, year) DO UPDATE SET last_seq = shift_code_counter.last_seq + 1
           RETURNING last_seq AS next`,
          reg.facilityId, year,
        );
        const code = `SR-${year}-${String(counter[0]?.next ?? 1).padStart(4, '0')}`;
        const updated = await tx.shiftRegistration.update({
          where: { id: input.id },
          data: { status: 'submitted', code, submittedAt: new Date(), submittedById: ctx.session.userId },
        });
        // Persist notification inside tx; push after commit
        let pushFn: (() => void) | null = null;
        const recipientIds = [...new Set([reg.managerId, reg.nextManagerId].filter((id): id is string => Boolean(id)))];
        if (recipientIds.length > 0) {
          pushFn = await emitStaffNotif(tx, {
            recipientIds,
            event: 'shift_reg_submitted',
            title: 'Phiếu đăng ký ca chờ duyệt',
            body: `${ctx.session.displayName} gửi phiếu ${code}`,
            facilityId: reg.facilityId,
          });
        } else {
          console.warn('shift_reg_submitted has no manager recipients', { registrationId: reg.id, userId: reg.userId });
        }
        await logEvent(tx, {
          facilityId: reg.facilityId, entityType: 'shift_registration', entityId: reg.id,
          type: 'status_changed', body: `Nộp phiếu → ${code}`,
          changes: [{ field: 'status', old: 'draft', new: 'submitted' }],
          actorId: ctx.session.userId,
        });
        return { updated, pushFn };
      }).then(({ updated, pushFn }) => {
        if (pushFn) pushFn(); // SSE after tx commit
        return updated;
      }),
    ),

  withdraw: requirePermission('shiftRegistration', 'withdraw')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const reg = await tx.shiftRegistration.findUniqueOrThrow({ where: { id: input.id } });
        if (reg.userId !== ctx.session.userId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Chỉ chủ phiếu mới được rút' });
        }
        if (reg.status !== 'submitted') throw new TRPCError({ code: 'CONFLICT', message: 'Chỉ rút được phiếu đã nộp' });
        const updated = await tx.shiftRegistration.update({
          where: { id: input.id },
          data: { status: 'draft', submittedAt: null, submittedById: null },
        });
        await logEvent(tx, {
          facilityId: reg.facilityId, entityType: 'shift_registration', entityId: reg.id,
          type: 'status_changed', body: 'Rút phiếu về nháp',
          changes: [{ field: 'status', old: 'submitted', new: 'draft' }],
          actorId: ctx.session.userId,
        });
        return updated;
      }),
    ),

  approve: requirePermission('shiftRegistration', 'approve')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const reg = await tx.shiftRegistration.findUniqueOrThrow({
          where: { id: input.id },
          include: { entries: { select: { date: true } } },
        });
        if (reg.status !== 'submitted') throw new TRPCError({ code: 'CONFLICT', message: 'Phiếu không ở trạng thái chờ duyệt' });
        assertAssignedApprover(ctx, reg);
        // Serialize concurrent approvals for the same user — without this, two
        // overlapping submitted registrations approved at nearly the same time
        // both read "no other approved overlap yet" and both end up approved.
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', reg.userId);
        await tx.shiftRegistration.updateMany({
          where: {
            userId: reg.userId,
            status: 'approved',
            id: { not: reg.id },
            archivedAt: null,
            fromDate: { lte: reg.toDate },
            toDate: { gte: reg.fromDate },
          },
          data: { status: 'cancelled', supersededById: reg.id, supersededAt: new Date() },
        });
        const updated = await tx.shiftRegistration.update({
          where: { id: input.id },
          data: { status: 'approved', approvedAt: new Date(), approvedById: ctx.session.userId },
        });
        // Persist notification inside tx; push after commit
        const approvePush = await emitStaffNotif(tx, {
          recipientIds: [reg.userId],
          event: 'shift_reg_approved',
          title: 'Phiếu đăng ký ca đã được duyệt',
          body: `Phiếu ${reg.code} đã được ${ctx.session.displayName} duyệt`,
          facilityId: reg.facilityId,
        });
        await logEvent(tx, {
          facilityId: reg.facilityId, entityType: 'shift_registration', entityId: reg.id,
          type: 'status_changed', body: `Duyệt phiếu ${reg.code}`,
          changes: [{ field: 'status', old: 'submitted', new: 'approved' }],
          actorId: ctx.session.userId,
        });
        return { updated, approvePush };
      }).then(({ updated, approvePush }) => {
        if (approvePush) approvePush(); // SSE after tx commit
        return updated;
      }),
    ),

  reject: requirePermission('shiftRegistration', 'reject')
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(10) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const reg = await tx.shiftRegistration.findUniqueOrThrow({ where: { id: input.id } });
        if (reg.status !== 'submitted') throw new TRPCError({ code: 'CONFLICT', message: 'Phiếu không ở trạng thái chờ duyệt' });
        assertAssignedApprover(ctx, reg);
        const updated = await tx.shiftRegistration.update({
          where: { id: input.id },
          data: { status: 'draft', rejectReason: input.reason, submittedAt: null, submittedById: null },
        });
        const push = await emitStaffNotif(tx, {
          recipientIds: [reg.userId],
          event: 'shift_reg_rejected',
          title: 'Phiếu đăng ký ca bị từ chối',
          body: `Lý do: ${input.reason}`,
          facilityId: reg.facilityId,
        });
        await logEvent(tx, {
          facilityId: reg.facilityId, entityType: 'shift_registration', entityId: reg.id,
          type: 'status_changed', body: `Từ chối: ${input.reason}`,
          changes: [{ field: 'status', old: 'submitted', new: 'draft' }],
          actorId: ctx.session.userId,
        });
        return { updated, push };
      }).then(({ updated, push }) => {
        if (push) push(); // SSE after tx commit
        return updated;
      }),
    ),
});
