import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, hashPassword, Role } from '@cmc/db';
import { rlsContextOf, assignableRoles } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, superAdminProcedure, requirePermission } from '../trpc.js';
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

// Elevated RLS context for writes that must bypass app_user's super-admin-only INSERT policy.
// Used for director-delegated user creation after all app-layer scope checks have passed.
const SYSTEM_CTX = { facilityIds: [] as number[], isSuperAdmin: true };

export const userRouter = router({
  // Directors see only co-facility staff (app_user_facility_roster RLS policy filters
  // automatically when isSuperAdmin=false). super_admin sees everyone.
  list: requirePermission('user', 'list').query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.appUser.findMany({ orderBy: { createdAt: 'asc' }, select: userSelect }),
    ),
  ),

  // Assignee picker for the CSKH assign workflow. Returns active staff whose primary role is
  // cskh or quan_ly — the only roles eligible to own an after-sale case — within the caller's
  // facility. RLS (app_user_facility_roster) enforces the facility boundary automatically;
  // the roles filter here prevents directors from appearing in the dropdown as case owners.
  listAssignableForAfterSale: requirePermission('user', 'listAssignableForAfterSale').query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.appUser.findMany({
        where: {
          isActive: true,
          roles: { hasSome: [Role.cskh, Role.quan_ly] },
        },
        orderBy: { displayName: 'asc' },
        select: { id: true, displayName: true },
      }),
    ),
  ),

  // Teacher picker for scheduling. RLS (app_user_facility_roster) scopes this to staff
  // sharing a facility with the caller — a quan_ly cannot enumerate teachers elsewhere.
  listTeachers: requirePermission('user', 'listTeachers')
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

  // Delegated user.create: super_admin may create any user; directors may create users whose
  // roles fall within their grant set AND whose facilities are a subset of their own facilities.
  //
  // The insert runs under an elevated RLS context (SYSTEM_CTX) because app_user INSERT has
  // WITH CHECK (app_is_super_admin()) — a director session would be rejected at the DB layer.
  // The app-layer checks above (role scope + facility subset) are the load-bearing constraint;
  // SYSTEM_CTX is the bypass that makes the DB write succeed after those checks pass.
  create: requirePermission('user', 'create')
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
    .mutation(async ({ ctx, input }) => {
      const allowed = assignableRoles(ctx.session);

      // 1. Role scope: every requested role must be within this caller's grant set.
      const badRoles = input.roles.filter((r) => !allowed.has(r));
      if (badRoles.length) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `Bạn không có quyền cấp vai trò: ${badRoles.join(', ')}`,
        });
      }

      // 2. Facility scope: directors may only place users in their own facilities.
      if (!ctx.session.isSuperAdmin) {
        const own = new Set(ctx.session.facilityIds);
        const outside = input.facilityIds.filter((f) => !own.has(f));
        if (outside.length) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `Ngoài phạm vi cơ sở của bạn: ${outside.join(', ')}`,
          });
        }
        if (input.facilityIds.length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Phải chọn ít nhất một cơ sở',
          });
        }
      }

      // 3. Write under elevated context so the super-admin-only INSERT policy passes.
      //    All scope constraints have been enforced above; SYSTEM_CTX is only safe here.
      const actorId = ctx.session.userId;
      return withRls(SYSTEM_CTX, async (tx) => {
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
          actorId,
        });
        return user;
      });
    }),

  // setRoles / setActive / setFacilities remain super_admin-only for F0. Directors build
  // their team via create; role reassignment and deactivation stay with IT (super_admin).
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
