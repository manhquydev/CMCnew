import { z } from 'zod';
import { withRls, hashPassword, Role } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, superAdminProcedure, requireRole } from '../trpc.js';
import { enqueueEmail } from '../services/email-outbox.js';

const role = z.nativeEnum(Role);

const userSelect = {
  id: true,
  email: true,
  displayName: true,
  roles: true,
  primaryRole: true,
  isActive: true,
  facilities: { select: { facilityId: true } },
} as const;

// User accounts span facilities → managed by super_admin only (matches `list`).
// Audit events carry facilityId: null (a user is not a single-facility record).
export const userRouter = router({
  list: superAdminProcedure.query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.appUser.findMany({ orderBy: { createdAt: 'asc' }, select: userSelect }),
    ),
  ),

  // Teacher picker for scheduling. RLS (app_user_facility_roster) scopes this to staff
  // sharing a facility with the caller — a quan_ly cannot enumerate teachers elsewhere.
  listTeachers: requireRole(Role.quan_ly)
    .input(z.object({ facilityId: z.number().int().positive().optional() }).optional())
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.appUser.findMany({
          where: {
            isActive: true,
            roles: { has: Role.giao_vien },
            ...(input?.facilityId ? { facilities: { some: { facilityId: input.facilityId } } } : {}),
          },
          orderBy: { displayName: 'asc' },
          select: { id: true, displayName: true },
        }),
      ),
    ),

  create: superAdminProcedure
    .input(
      z
        .object({
          email: z.string().email(),
          displayName: z.string().min(1),
          password: z.string().min(8),
          roles: z.array(role).min(1),
          primaryRole: role,
          facilityIds: z.array(z.number().int().positive()),
        })
        .refine((v) => v.roles.includes(v.primaryRole), {
          message: 'primaryRole phải nằm trong roles',
          path: ['primaryRole'],
        }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const user = await tx.appUser.create({
          data: {
            email: input.email,
            displayName: input.displayName,
            passwordHash: await hashPassword(input.password),
            roles: input.roles,
            primaryRole: input.primaryRole,
            facilities: { create: input.facilityIds.map((facilityId) => ({ facilityId })) },
          },
          select: userSelect,
        });
        await logEvent(tx, {
          entityType: 'user',
          entityId: user.id,
          type: 'created',
          actorId: ctx.session.userId,
        });
        // Staff onboarding is via Microsoft SSO (no activation email / no password to deliver).
        return user;
      }),
    ),

  setRoles: superAdminProcedure
    .input(
      z
        .object({
          id: z.string().uuid(),
          roles: z.array(role).min(1),
          primaryRole: role,
        })
        .refine((v) => v.roles.includes(v.primaryRole), {
          message: 'primaryRole phải nằm trong roles',
          path: ['primaryRole'],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.appUser.findUniqueOrThrow({
          where: { id: input.id },
          select: { roles: true, primaryRole: true },
        });
        // Bump tokenVersion so the user's outstanding JWTs are invalidated.
        const user = await tx.appUser.update({
          where: { id: input.id },
          data: {
            roles: input.roles,
            primaryRole: input.primaryRole,
            tokenVersion: { increment: 1 },
          },
          select: userSelect,
        });
        await logEvent(tx, {
          entityType: 'user',
          entityId: user.id,
          type: 'updated',
          actorId: ctx.session.userId,
          changes: [
            { field: 'roles', old: before.roles, new: input.roles },
            { field: 'primaryRole', old: before.primaryRole, new: input.primaryRole },
          ],
        });
        return user;
      });
      await emailSecurityAlert(user.id, user.email, 'Cập nhật vai trò tài khoản');
      return user;
    }),

  setFacilities: superAdminProcedure
    .input(z.object({ id: z.string().uuid(), facilityIds: z.array(z.number().int().positive()) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.userFacility.findMany({
          where: { userId: input.id },
          select: { facilityId: true },
        });
        await tx.userFacility.deleteMany({ where: { userId: input.id } });
        const user = await tx.appUser.update({
          where: { id: input.id },
          data: {
            facilities: { create: input.facilityIds.map((facilityId) => ({ facilityId })) },
            tokenVersion: { increment: 1 },
          },
          select: userSelect,
        });
        await logEvent(tx, {
          entityType: 'user',
          entityId: user.id,
          type: 'updated',
          actorId: ctx.session.userId,
          changes: [
            {
              field: 'facilities',
              old: before.map((f) => f.facilityId),
              new: input.facilityIds,
            },
          ],
        });
        return user;
      }),
    ),

  setActive: superAdminProcedure
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const user = await withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.appUser.findUniqueOrThrow({
          where: { id: input.id },
          select: { isActive: true },
        });
        const user = await tx.appUser.update({
          where: { id: input.id },
          data: { isActive: input.isActive, tokenVersion: { increment: 1 } },
          select: userSelect,
        });
        await logEvent(tx, {
          entityType: 'user',
          entityId: user.id,
          type: 'status_changed',
          actorId: ctx.session.userId,
          changes: [{ field: 'isActive', old: before.isActive, new: input.isActive }],
        });
        return user;
      });
      await emailSecurityAlert(
        user.id,
        user.email,
        input.isActive ? 'Kích hoạt lại tài khoản' : 'Vô hiệu hóa tài khoản',
      );
      return user;
    }),
});

// Post-commit, best-effort security-alert email on a sensitive account change. Runs in its OWN
// super-scoped tx with a try/catch so a mail-queue failure never rolls back the deactivation /
// role change. Not idempotent by design (dedupKey carries a timestamp): every change should alert.
const SYSTEM_CTX = { facilityIds: [] as number[], isSuperAdmin: true };
async function emailSecurityAlert(userId: string, email: string, action: string): Promise<void> {
  try {
    await withRls(SYSTEM_CTX, (tx) =>
      enqueueEmail(tx, {
        dedupKey: `security_alert:${userId}:${Date.now()}`,
        to: email,
        mailbox: 'notify',
        kind: 'account_security_alert',
        data: { action, at: new Date().toISOString().slice(0, 19).replace('T', ' ') },
      }),
    );
  } catch (e) {
    console.error('security alert email enqueue failed', e);
  }
}
