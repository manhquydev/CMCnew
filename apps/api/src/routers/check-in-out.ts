import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, protectedProcedure, requirePermission } from '../trpc.js';
import { emitStaffNotif } from '../lib/emit-staff-notif.js';
import {
  earlyLeaveMinutes,
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

function assertCanApprovePunch(
  session: { userId: string; isSuperAdmin: boolean },
  target: { userId: string; managerId: string | null },
) {
  if (target.userId === session.userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Không tự duyệt chấm công của mình' });
  }
  if (session.isSuperAdmin) return;
  if (!target.managerId || target.managerId !== session.userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Chỉ manager trực tiếp mới duyệt chấm công thủ công' });
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
  punch: requirePermission('checkInOut', 'punch')
    .mutation(({ ctx }) =>
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
        const PUNCH_DEBOUNCE_MS = 30_000;
        if (lastPunch && Date.now() - lastPunch.timestamp.getTime() < PUNCH_DEBOUNCE_MS) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Vừa chấm công, vui lòng đợi giây lát trước khi chấm lại' });
        }
        const clientIP = ctx.ip ?? 'unknown';
        const profile = await tx.employmentProfile.findUniqueOrThrow({
          where: { userId: ctx.session.userId },
          select: { facilityId: true, managerId: true },
        });
        const networks = await tx.facilityNetwork.findMany({
          where: { facilityId: profile.facilityId, isActive: true, archivedAt: null },
        });
        const ipAllowed = networks.some((n) => ipMatchesCidr(clientIP, n.ipAddress));
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
          },
        });
        // Persist notification inside tx; push fn captured to call AFTER commit
        let pushFn: (() => void) | null = null;
        if (!ipAllowed && profile.managerId) {
          pushFn = await emitStaffNotif(tx, {
            recipientIds: [profile.managerId],
            event: 'manual_punch_pending',
            title: 'Chấm công thủ công chờ duyệt',
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
      }).then(({ punch, ipAllowed, pushFn }) => {
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
        if (punches.length === 0) return { status: 'not_punched' as const, punches: [] };
        const checkIn = punches[0]!;
        const checkOut = punches.length > 1 ? punches[punches.length - 1]! : null;
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
          checkIn: { id: checkIn.id, time: checkIn.timestamp, method: checkIn.method },
          checkOut: checkOut ? { id: checkOut.id, time: checkOut.timestamp, method: checkOut.method } : null,
          shift: shiftEntry ? { name: shiftEntry.shiftTemplate.name, startTime: shiftEntry.shiftTemplate.startTime, endTime: shiftEntry.shiftTemplate.endTime } : null,
          penalty: { lateMinutes: lateMin, earlyMinutes: earlyMin, amount: penalty },
          punches: punches.map((p) => ({ id: p.id, time: p.timestamp, method: p.method })),
        };
      }),
    ),

  // Approve a manual punch (manager only).
  pendingManual: requirePermission('checkInOut', 'pendingManual')
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const punches = await tx.timePunch.findMany({
          where: {
            facilityId: input.facilityId,
            method: 'manual',
            approvedAt: null,
          },
          include: {
            shiftTemplate: { select: { name: true, startTime: true, endTime: true } },
          },
          orderBy: { timestamp: 'desc' },
          take: 50,
        });
        if (ctx.session.isSuperAdmin) return punches;
        const userIds = [...new Set(punches.map((p) => p.userId))];
        const profiles = await tx.employmentProfile.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, managerId: true },
        });
        const managerByUser = new Map(profiles.map((p) => [p.userId, p.managerId]));
        return punches.filter((p) => managerByUser.get(p.userId) === ctx.session.userId);
      }),
    ),

  approveManual: requirePermission('checkInOut', 'approveManual')
    .input(z.object({ punchId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const punch = await tx.timePunch.findUniqueOrThrow({ where: { id: input.punchId } });
        if (punch.method !== 'manual') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chỉ duyệt punch thủ công' });
        if (punch.approvedAt) throw new TRPCError({ code: 'CONFLICT', message: 'Punch đã được duyệt' });
        const profile = await tx.employmentProfile.findUnique({
          where: { userId: punch.userId },
          select: { userId: true, managerId: true },
        });
        assertCanApprovePunch(ctx.session, { userId: punch.userId, managerId: profile?.managerId ?? null });
        const updated = await tx.timePunch.update({
          where: { id: input.punchId },
          data: { approvedById: ctx.session.userId, approvedAt: new Date() },
        });
        await logEvent(tx, {
          facilityId: punch.facilityId,
          entityType: 'time_punch', entityId: punch.id,
          type: 'status_changed', body: 'Duyệt chấm công thủ công',
          changes: [{ field: 'approved', old: null, new: ctx.session.userId }],
          actorId: ctx.session.userId,
        });
        return updated;
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
        return tx.timePunch.findMany({
          where: {
            userId: targetUserId,
            timestamp: { gte: ictDateRange(input.fromDate).start, lt: ictDateRange(input.toDate).end },
          },
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
