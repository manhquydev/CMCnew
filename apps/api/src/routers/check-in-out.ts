import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, protectedProcedure, requirePermission } from '../trpc.js';
import { emitStaffNotif } from '../lib/emit-staff-notif.js';
import {
  earlyLeaveMinutes,
  ictDateKey,
  ictDateRange,
  ictDayRangeFor,
  ictPeriodRange,
  lateMinutes,
  summarizeAttendance,
} from '../lib/attendance-penalty.js';

export { earlyLeaveMinutes, lateMinutes };

/// CIDR matching — check if an IP falls within a CIDR range.
function ipMatchesCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) return ip === cidr;
  const [range, bits = '32'] = cidr.split('/');
  const mask = ~(2 ** (32 - Number(bits)) - 1);
  const ipNum = ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
  const rangeNum = (range ?? '').split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

function hasAnyRole(roles: readonly string[], candidates: string[]): boolean {
  return candidates.some((role) => roles.includes(role));
}

function canViewStaffPunch(
  session: { userId: string; roles: readonly string[]; isSuperAdmin: boolean },
  target: { userId: string; managerId: string | null },
): boolean {
  if (session.isSuperAdmin || hasAnyRole(session.roles, ['hr'])) return true;
  return target.userId === session.userId || target.managerId === session.userId;
}

// Shared guard for approve + reject — same rule for both, mirrors the pre-ticket assertCanApprovePunch.
function assertCanHandleTicket(
  session: { userId: string; isSuperAdmin: boolean },
  target: { userId: string; managerId: string | null },
) {
  if (target.userId === session.userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Không tự duyệt/từ chối chấm công của mình' });
  }
  if (session.isSuperAdmin) return;
  if (!target.managerId || target.managerId !== session.userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Chỉ manager trực tiếp mới duyệt/từ chối chấm công thủ công' });
  }
}

export const checkInOutRouter = router({
  // Check if current IP is in facility's allowed networks.
  checkIP: protectedProcedure
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const clientIP = ctx.ip ?? 'unknown';
        const networks = await tx.facilityNetwork.findMany({
          where: { facilityId: input.facilityId, isActive: true, archivedAt: null },
        });
        const allowed = networks.some((n) => ipMatchesCidr(clientIP, n.ipAddress));
        return { allowed, ip: clientIP, matchedNetwork: networks.find((n) => ipMatchesCidr(clientIP, n.ipAddress))?.label ?? null };
      }),
    ),

  // Record a punch (check-in or check-out — system derives which is which).
  // Outside WiFi: first punch of the ICT day requires a reason (creates a daily ticket);
  // later punches attach to it silently. A rejected ticket can be reopened with a NEW reason.
  punch: requirePermission('checkInOut', 'punch')
    .input(z.object({ reason: z.string().trim().min(3).max(500).optional() }).optional())
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Serialize concurrent punch calls for this user — without this, two
        // near-simultaneous requests both read "no punch yet" and both create a
        // row, turning into a false check-in+check-out pair a few ms apart.
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', ctx.session.userId);
        const lastPunch = await tx.timePunch.findFirst({
          where: { userId: ctx.session.userId },
          orderBy: { timestamp: 'desc' },
          select: { timestamp: true },
        });
        const PUNCH_DEBOUNCE_MS = 5_000;
        if (lastPunch && Date.now() - lastPunch.timestamp.getTime() < PUNCH_DEBOUNCE_MS) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Vừa chấm công, vui lòng đợi giây lát trước khi chấm lại' });
        }
        const clientIP = ctx.ip ?? 'unknown';
        // EmploymentProfile is set up manually by HR (payroll.upsertEmploymentProfile), not
        // auto-created at account creation — a staff account that has checkInOut.punch permission
        // but was never onboarded through HR would otherwise crash here with a raw Prisma error.
        const profile = await tx.employmentProfile.findUnique({
          where: { userId: ctx.session.userId },
          select: { facilityId: true, managerId: true },
        });
        if (!profile) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Tài khoản chưa được thiết lập hồ sơ nhân sự — liên hệ HR để được thiết lập trước khi chấm công',
          });
        }
        const networks = await tx.facilityNetwork.findMany({
          where: { facilityId: profile.facilityId, isActive: true, archivedAt: null },
        });
        const ipAllowed = networks.some((n) => ipMatchesCidr(clientIP, n.ipAddress));

        // Outside WiFi: resolve/create the daily ticket BEFORE writing any punch row —
        // requiresReason must return with no side effects (H2: kept out of the post-commit .then).
        let ticket: { id: string; status: string; approvedById: string | null; approvedAt: Date | null } | null = null;
        let notifyKind: 'new' | 'resubmit' | null = null;
        if (!ipAllowed) {
          const dateKey = ictDateKey(new Date());
          const existing = await tx.manualAttendanceTicket.findUnique({
            where: { userId_dateKey: { userId: ctx.session.userId, dateKey } },
          });
          if (!existing) {
            if (!input?.reason) {
              return { requiresReason: true as const };
            }
            ticket = await tx.manualAttendanceTicket.create({
              data: { facilityId: profile.facilityId, userId: ctx.session.userId, dateKey, reason: input.reason },
            });
            notifyKind = 'new';
          } else if (existing.status === 'rejected') {
            if (!input?.reason) {
              return { requiresReason: true as const, resubmit: true as const };
            }
            ticket = await tx.manualAttendanceTicket.update({
              where: { id: existing.id },
              data: { reason: input.reason, status: 'pending', approvedById: null, approvedAt: null },
            });
            notifyKind = 'resubmit';
            await logEvent(tx, {
              facilityId: profile.facilityId,
              entityType: 'manual_attendance_ticket',
              entityId: ticket.id,
              type: 'status_changed',
              body: 'Nộp lại phiếu chấm công ngoài WiFi sau khi bị từ chối',
              actorId: ctx.session.userId,
            });
          } else {
            ticket = existing; // pending/approved — attach silently, no reason prompt
          }
        }

        // Link punch to today's approved shift entry (if any)
        const { start: today, end: tomorrow } = ictDayRangeFor();
        const shiftEntry = await tx.shiftRegistrationEntry.findFirst({
          where: {
            registration: { userId: ctx.session.userId, status: 'approved', archivedAt: null },
            date: { gte: today, lt: tomorrow },
          },
          select: { shiftTemplateId: true },
        });
        const punch = await tx.timePunch.create({
          data: {
            facilityId: profile.facilityId,
            userId: ctx.session.userId,
            ipAddress: clientIP,
            method: ipAllowed ? 'ip' : 'manual',
            shiftTemplateId: shiftEntry?.shiftTemplateId ?? null,
            // Ticket already approved (e.g. manager approved earlier, employee punches again
            // later same day) → new punch auto-inherits approval, no separate re-approval needed.
            approvedById: ticket?.status === 'approved' ? ticket.approvedById : null,
            approvedAt: ticket?.status === 'approved' ? ticket.approvedAt : null,
          },
        });
        // Persist notification inside tx; push fn captured to call AFTER commit
        let pushFn: (() => void) | null = null;
        if (notifyKind && profile.managerId) {
          pushFn = await emitStaffNotif(tx, {
            recipientIds: [profile.managerId],
            event: notifyKind === 'resubmit' ? 'manual_punch_resubmitted' : 'manual_punch_pending',
            title: notifyKind === 'resubmit' ? 'Chấm công thủ công nộp lại chờ duyệt' : 'Chấm công thủ công chờ duyệt',
            body: `${ctx.session.displayName} chấm công ngoài WiFi — cần duyệt`,
            facilityId: profile.facilityId,
          });
        }
        await logEvent(tx, {
          facilityId: profile.facilityId,
          entityType: 'time_punch',
          entityId: punch.id,
          type: 'created',
          body: `Chấm công: ${punch.method} (IP: ${clientIP})`,
          actorId: ctx.session.userId,
        });
        return { punch, ipAllowed, pushFn };
      }).then((result) => {
        if ('requiresReason' in result) return result;
        const { punch, ipAllowed, pushFn } = result;
        if (pushFn) pushFn(); // SSE after tx commit
        return { ...punch, ipAllowed };
      }),
    ),

  // Today's punch status for the current user.
  todayStatus: requirePermission('checkInOut', 'todayStatus')
    .query(({ ctx }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const { start: today, end: tomorrow, dateKey } = ictDayRangeFor();
        const punches = await tx.timePunch.findMany({
          where: {
            userId: ctx.session.userId,
            timestamp: { gte: today, lt: tomorrow },
          },
          orderBy: { timestamp: 'asc' },
        });
        if (punches.length === 0) return { status: 'not_punched' as const, manualApproval: 'none' as const, punches: [] };
        const checkIn = punches[0]!;
        const checkOut = punches.length > 1 ? punches[punches.length - 1]! : null;
        // Reflects the daily ticket's approval — so a rejected day never renders as green
        // "Hoàn thành" even though the raw punch rows (first/last) still exist.
        const hasManualPunch = punches.some((p) => p.method === 'manual');
        const ticket = hasManualPunch
          ? await tx.manualAttendanceTicket.findUnique({
              where: { userId_dateKey: { userId: ctx.session.userId, dateKey } },
              select: { status: true },
            })
          : null;
        const manualApproval: 'none' | 'pending' | 'approved' | 'rejected' =
          (ticket?.status as 'pending' | 'approved' | 'rejected' | undefined) ?? 'none';
        // Find approved shift for today
        const shiftEntry = await tx.shiftRegistrationEntry.findFirst({
          where: {
            registration: { userId: ctx.session.userId, status: 'approved', archivedAt: null },
            date: new Date(dateKey),
          },
          include: { shiftTemplate: true },
        });
        let penalty = 0;
        let lateMin = 0;
        let earlyMin = 0;
        if (shiftEntry) {
          lateMin = lateMinutes(checkIn.timestamp, shiftEntry.shiftTemplate.startTime);
          earlyMin = checkOut ? earlyLeaveMinutes(checkOut.timestamp, shiftEntry.shiftTemplate.endTime) : 0;
          penalty = lateMin * 500 + earlyMin * 1000;
        }
        return {
          status: checkOut ? 'completed' as const : 'checked_in' as const,
          manualApproval,
          checkIn: { id: checkIn.id, time: checkIn.timestamp, method: checkIn.method },
          checkOut: checkOut ? { id: checkOut.id, time: checkOut.timestamp, method: checkOut.method } : null,
          shift: shiftEntry ? { name: shiftEntry.shiftTemplate.name, startTime: shiftEntry.shiftTemplate.startTime, endTime: shiftEntry.shiftTemplate.endTime } : null,
          penalty: { lateMinutes: lateMin, earlyMinutes: earlyMin, amount: penalty },
          punches: punches.map((p) => ({ id: p.id, time: p.timestamp, method: p.method })),
        };
      }),
    ),

  // Tickets pending manager approval (one row per person+day, not per punch).
  pendingManual: requirePermission('checkInOut', 'pendingManual')
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const tickets = await tx.manualAttendanceTicket.findMany({
          where: { facilityId: input.facilityId, status: 'pending' },
          orderBy: { createdAt: 'desc' },
          take: 50,
        });
        if (tickets.length === 0) return [];

        let scoped = tickets;
        if (!ctx.session.isSuperAdmin) {
          const userIds = [...new Set(tickets.map((t) => t.userId))];
          const profiles = await tx.employmentProfile.findMany({
            where: { userId: { in: userIds } },
            select: { userId: true, managerId: true },
          });
          const managerByUser = new Map(profiles.map((p) => [p.userId, p.managerId]));
          scoped = tickets.filter((t) => managerByUser.get(t.userId) === ctx.session.userId);
        }
        if (scoped.length === 0) return [];

        // Batched punch-count + shift lookup — one query regardless of ticket count (no N+1).
        const dateKeys = [...new Set(scoped.map((t) => t.dateKey))].sort();
        const rangeStart = ictDateRange(dateKeys[0]!).start;
        const rangeEnd = ictDateRange(dateKeys[dateKeys.length - 1]!).end;
        const scopedUserIds = [...new Set(scoped.map((t) => t.userId))];
        const punches = await tx.timePunch.findMany({
          where: {
            facilityId: input.facilityId,
            userId: { in: scopedUserIds },
            method: 'manual',
            timestamp: { gte: rangeStart, lt: rangeEnd },
          },
          select: { userId: true, timestamp: true, shiftTemplateId: true },
        });
        const shiftTemplateIds = [...new Set(punches.map((p) => p.shiftTemplateId).filter((id): id is string => !!id))];
        const shiftTemplates = shiftTemplateIds.length
          ? await tx.shiftTemplate.findMany({
              where: { id: { in: shiftTemplateIds } },
              select: { id: true, name: true, startTime: true, endTime: true },
            })
          : [];
        const shiftById = new Map(shiftTemplates.map((s) => [s.id, s]));

        return scoped.map((ticket) => {
          const ticketPunches = punches.filter(
            (p) => p.userId === ticket.userId && ictDateKey(p.timestamp) === ticket.dateKey,
          );
          const shiftTemplateId = ticketPunches.find((p) => p.shiftTemplateId)?.shiftTemplateId ?? null;
          return {
            ...ticket,
            punchCount: ticketPunches.length,
            shiftTemplate: shiftTemplateId ? shiftById.get(shiftTemplateId) ?? null : null,
          };
        });
      }),
    ),

  // Approve a ticket — stamps approvedAt on the ticket AND every manual punch that day
  // (monthlyReport keeps reading punch.approvedAt, unchanged).
  approveManual: requirePermission('checkInOut', 'approveManual')
    .input(z.object({ ticketId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const ticket = await tx.manualAttendanceTicket.findUniqueOrThrow({ where: { id: input.ticketId } });
        if (ticket.status !== 'pending') throw new TRPCError({ code: 'CONFLICT', message: 'Phiếu đã được xử lý' });
        const profile = await tx.employmentProfile.findUnique({
          where: { userId: ticket.userId },
          select: { userId: true, managerId: true },
        });
        assertCanHandleTicket(ctx.session, { userId: ticket.userId, managerId: profile?.managerId ?? null });
        const { start, end } = ictDateRange(ticket.dateKey);
        const approvedAt = new Date();
        const updated = await tx.manualAttendanceTicket.update({
          where: { id: input.ticketId },
          data: { status: 'approved', approvedById: ctx.session.userId, approvedAt },
        });
        await tx.timePunch.updateMany({
          where: {
            facilityId: ticket.facilityId,
            userId: ticket.userId,
            method: 'manual',
            timestamp: { gte: start, lt: end },
          },
          data: { approvedById: ctx.session.userId, approvedAt },
        });
        await logEvent(tx, {
          facilityId: ticket.facilityId,
          entityType: 'manual_attendance_ticket', entityId: ticket.id,
          type: 'status_changed', body: 'Duyệt phiếu chấm công ngoài WiFi',
          changes: [{ field: 'status', old: 'pending', new: 'approved' }],
          actorId: ctx.session.userId,
        });
        return updated;
      }),
    ),

  // Reject a ticket. Rejecting a previously-approved ticket un-stamps its punches so they
  // fall out of payroll again (monthlyReport filters on approvedAt not null).
  rejectManual: requirePermission('checkInOut', 'rejectManual')
    .input(z.object({ ticketId: z.string().uuid(), note: z.string().trim().max(500).optional() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const ticket = await tx.manualAttendanceTicket.findUniqueOrThrow({ where: { id: input.ticketId } });
        if (ticket.status === 'rejected') throw new TRPCError({ code: 'CONFLICT', message: 'Phiếu đã bị từ chối' });
        const profile = await tx.employmentProfile.findUnique({
          where: { userId: ticket.userId },
          select: { userId: true, managerId: true },
        });
        assertCanHandleTicket(ctx.session, { userId: ticket.userId, managerId: profile?.managerId ?? null });
        const wasApproved = ticket.status === 'approved';
        const { start, end } = ictDateRange(ticket.dateKey);
        const updated = await tx.manualAttendanceTicket.update({
          where: { id: input.ticketId },
          data: { status: 'rejected', approvedById: ctx.session.userId, approvedAt: new Date() },
        });
        if (wasApproved) {
          await tx.timePunch.updateMany({
            where: {
              facilityId: ticket.facilityId,
              userId: ticket.userId,
              method: 'manual',
              timestamp: { gte: start, lt: end },
            },
            data: { approvedById: null, approvedAt: null },
          });
        }
        const pushFn = await emitStaffNotif(tx, {
          recipientIds: [ticket.userId],
          event: 'manual_punch_rejected',
          title: 'Chấm công thủ công bị từ chối',
          body: input.note ? `Lý do: ${input.note}` : 'Phiếu chấm công ngoài WiFi của bạn đã bị từ chối',
          facilityId: ticket.facilityId,
        });
        await logEvent(tx, {
          facilityId: ticket.facilityId,
          entityType: 'manual_attendance_ticket', entityId: ticket.id,
          type: 'status_changed',
          body: input.note ? `Từ chối phiếu chấm công: ${input.note}` : 'Từ chối phiếu chấm công',
          changes: [{ field: 'status', old: ticket.status, new: 'rejected' }],
          actorId: ctx.session.userId,
        });
        return { ticket: updated, pushFn };
      }).then(({ ticket, pushFn }) => {
        pushFn();
        return ticket;
      }),
    ),

  // Lịch sử chấm công (self or others for manager).
  history: requirePermission('checkInOut', 'history')
    .input(z.object({
      userId: z.string().uuid().optional(),
      fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const targetUserId = input.userId ?? ctx.session.userId;
        if (targetUserId !== ctx.session.userId) {
          const profile = await tx.employmentProfile.findUnique({
            where: { userId: targetUserId },
            select: { userId: true, managerId: true },
          });
          if (!profile || !canViewStaffPunch(ctx.session, profile)) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'Không có quyền xem lịch sử chấm công này' });
          }
        }
        // Self-view drops ipAddress — an employee viewing their own history has no use for
        // their own IP and it shouldn't leak into the network tab. Manager/other-person view
        // (targetUserId !== self, already permission-gated above) keeps it for audit.
        const isSelfView = targetUserId === ctx.session.userId;
        return tx.timePunch.findMany({
          where: {
            userId: targetUserId,
            timestamp: { gte: ictDateRange(input.fromDate).start, lt: ictDateRange(input.toDate).end },
          },
          select: isSelfView
            ? { id: true, facilityId: true, userId: true, timestamp: true, method: true, shiftTemplateId: true, approvedById: true, approvedAt: true, createdAt: true }
            : undefined,
          orderBy: { timestamp: 'desc' },
          take: 100,
        });
      }),
    ),

  monthlyReport: requirePermission('checkInOut', 'monthlyReport')
    .input(z.object({ facilityId: z.number().int().positive(), periodKey: z.string().regex(/^\d{4}-\d{2}$/) }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const [y, m] = input.periodKey.split('-').map(Number);
        const dateRange = {
          start: new Date(Date.UTC(y!, m! - 1, 1)),
          end: new Date(Date.UTC(y!, m!, 1)),
        };
        const timestampRange = ictPeriodRange(input.periodKey);
        const entries = await tx.shiftRegistrationEntry.findMany({
          where: {
            type: 'work',
            date: { gte: dateRange.start, lt: dateRange.end },
            registration: { facilityId: input.facilityId, status: 'approved', archivedAt: null },
          },
          select: {
            date: true,
            shiftTemplateId: true,
            shiftTemplate: { select: { name: true, startTime: true, endTime: true } },
            registration: { select: { userId: true } },
          },
          orderBy: [{ date: 'asc' }, { shiftTemplate: { sortOrder: 'asc' } }],
        });
        const userIds = [...new Set(entries.map((e) => e.registration.userId))];
        if (userIds.length === 0) {
          return { periodKey: input.periodKey, rows: [] };
        }
        const [punches, users] = await Promise.all([
          tx.timePunch.findMany({
            where: {
              facilityId: input.facilityId,
              userId: { in: userIds },
              timestamp: { gte: timestampRange.start, lt: timestampRange.end },
              OR: [{ method: 'ip' }, { approvedAt: { not: null } }],
            },
            select: { userId: true, timestamp: true, method: true, shiftTemplateId: true },
            orderBy: { timestamp: 'asc' },
          }),
          tx.appUser.findMany({
            where: { id: { in: userIds } },
            select: { id: true, displayName: true },
          }),
        ]);
        const nameById = new Map(users.map((u) => [u.id, u.displayName]));
        return {
          periodKey: input.periodKey,
          rows: userIds
            .map((userId) => {
              const summary = summarizeAttendance(
                entries.filter((e) => e.registration.userId === userId),
                punches.filter((p) => p.userId === userId),
              );
              return {
                userId,
                displayName: nameById.get(userId) ?? userId,
                workdays: summary.workdays,
                lateMinutes: summary.lateMinutes,
                earlyMinutes: summary.earlyMinutes,
                penaltyAmount: summary.penaltyAmount,
                days: summary.days,
              };
            })
            .sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi')),
        };
      }),
    ),
});
