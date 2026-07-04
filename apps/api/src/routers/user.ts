import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, hashPassword, Role } from '@cmc/db';
import { rlsContextOf, assignableRoles } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, superAdminProcedure, requirePermission } from '../trpc.js';
import { enqueueEmail } from '../services/email-outbox.js';
import { nextEmployeeCode } from '../services/employee-code.js';

const role = z.nativeEnum(Role);

const userSelect = {
  id: true,
  email: true,
  phone: true,
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

  // Assignee picker for the CSKH assign workflow. Returns active sale/cskh/giam_doc_kinh_doanh
  // staff — the roles eligible to own an after-sale case — within the caller's facility. RLS
  // (app_user_facility_roster) enforces the facility boundary automatically.
  listAssignableForAfterSale: requirePermission('user', 'listAssignableForAfterSale').query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.appUser.findMany({
        where: {
          isActive: true,
          roles: { hasSome: [Role.sale, Role.cskh, Role.giam_doc_kinh_doanh] },
        },
        orderBy: { displayName: 'asc' },
        select: { id: true, displayName: true },
      }),
    ),
  ),

  // Teacher picker for scheduling. RLS (app_user_facility_roster) scopes this to staff
  // sharing a facility with the caller.
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
  // WITH CHECK (app_is_super_admin()) — a director session would be rejected at the DB layer.
  // The app-layer checks above (role scope + facility subset) are the load-bearing constraint;
  // SYSTEM_CTX is the bypass that makes the DB write succeed after those checks pass.
  create: requirePermission('user', 'create')
    .input(
      z
        .object({
          // No password input: staff authenticate exclusively via Microsoft SSO. The only account
          // with a usable break-glass password is the bootstrap super_admin (seeded, not created here).
          email: z.string().email(),
          displayName: z.string().min(1),
          phone: z.string().optional(),
          roles: z.array(role).min(1),
          primaryRole: role,
          facilityIds: z.array(z.number().int().positive()),
          // Hồ sơ nhân sự tối thiểu — bắt buộc ngay lúc tạo, không cho tạo tài khoản "mồ côi"
          // hồ sơ (xem plans/reports/audit-260705-0105-teacher-parent-student-launch-readiness-report.md).
          // Field mở rộng khác (DOB, hợp đồng, liên hệ khẩn cấp...) vẫn điền sau qua payroll.profileUpsert.
          nationalId: z.string().trim().min(1, 'CCCD/CMND bắt buộc'),
          startedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày vào làm bắt buộc (YYYY-MM-DD)'),
          position: z.string().trim().min(1, 'Vị trí công việc bắt buộc'),
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
      // Facility min(1) applies to ALL actors (including super_admin) — a 0-facility
      // account has no RLS scope and is a dead login (decision 0026 P2).
      if (input.facilityIds.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Phải chọn ít nhất một cơ sở',
        });
      }


      // Narrowed non-empty above; first facility is the EmploymentProfile's home facility.
      const primaryFacilityId = input.facilityIds[0] as number;

      // 3. Write under elevated context so the super-admin-only INSERT policy passes.
      //    All scope constraints have been enforced above; SYSTEM_CTX is only safe here.
      const actorId = ctx.session.userId;
      try {
        const user = await withRls(SYSTEM_CTX, async (tx) => {
        const created = await tx.appUser.create({
          data: {
            // Normalize to lowercase: SSO returns the Microsoft email lowercased, and the callback
            // matches AppUser by exact email. A mixed-case address here would never match — login
            // would fail with "not_provisioned" even though the M365 account is correct.
            email: input.email.trim().toLowerCase(),
            displayName: input.displayName,
            phone: input.phone?.trim() || null,
            // SSO-only account: store a hash of a high-entropy random secret that is never returned
            // or transmitted, so password login is impossible for staff (NOT NULL column satisfied).
            passwordHash: await hashPassword(randomBytes(32).toString('base64url')),
            roles: input.roles,
            primaryRole: input.primaryRole,
            facilities: { create: input.facilityIds.map((facilityId) => ({ facilityId })) },
          },
          select: userSelect,
        });
        await logEvent(tx, {
          entityType: 'user',
          entityId: created.id,
          type: 'created',
          actorId,
        });

        // Hồ sơ nhân sự tối thiểu, tạo atomic cùng tài khoản — không để lại account "mồ côi"
        // hồ sơ. facilityIds[0] = cơ sở chính (danh sách luôn có ≥1 phần tử, đã validate ở trên).
        const employeeCode = await nextEmployeeCode(tx);
        const profile = await tx.employmentProfile.create({
          data: {
            facilityId: primaryFacilityId,
            userId: created.id,
            position: input.position,
            startedAt: new Date(input.startedAt),
            nationalId: input.nationalId,
            employeeCode,
          },
        });
        await logEvent(tx, {
          facilityId: profile.facilityId,
          entityType: 'employment_profile',
          entityId: profile.id,
          type: 'created',
          body: `Hồ sơ NS: ${input.position} (mã ${employeeCode})`,
          actorId,
        });
        return created;
      });
      // Welcome email (best-effort, post-commit). SSO onboarding: no password is sent — staff sign in
      // with their Microsoft (CMC EDU) account. A mail-queue failure must never undo the create.
      await emailWelcome(user.email, user.displayName, user.primaryRole);
        return user;
      } catch (e) {
        if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Email đã tồn tại' });
        }
        throw e;
      }
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

  // Set/reset a staff account's password (decision: STAFF_PASSWORD_LOGIN runs permanently
  // alongside SSO — see docs/decisions/0031-staff-password-login-parallel-to-sso.md). Mirrors
  // student.resetLmsPassword's temp-password pattern: super_admin sets it, returns once, caller
  // relays it out-of-band. Bumps tokenVersion so any existing sessions are invalidated.
  setPassword: superAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tempPassword = randomBytes(6).toString('hex');
      const passwordHash = await hashPassword(tempPassword);
      const user = await withRls(rlsContextOf(ctx.session), async (tx) => {
        // Atomic increment (matches setRoles/setFacilities/setActive below) — a read-then-write
        // here could lose a concurrent tokenVersion bump from another admin action.
        const updated = await tx.appUser.update({
          where: { id: input.id },
          data: { passwordHash, tokenVersion: { increment: 1 } },
          select: userSelect,
        });
        await logEvent(tx, {
          entityType: 'user',
          entityId: updated.id,
          type: 'updated',
          body: 'Đặt lại mật khẩu đăng nhập',
          actorId: ctx.session.userId,
        });
        return updated;
      });
      await emailSecurityAlert(user.id, user.email, 'Đặt lại mật khẩu đăng nhập');
      // tempPassword is returned once and never stored — caller must relay it out-of-band.
      return { email: user.email, tempPassword };
    }),

  // Edit basic contact fields only (displayName, phone). email is SSO-derived and intentionally
  // NOT editable here. This is a profile-data change, not a security-session change, so it does
  // NOT bump tokenVersion (unlike setRoles/setActive/setFacilities). super_admin-only for F0;
  // director-scoped editing is a deliberate open question deferred to a later decision.
  updateProfile: superAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        displayName: z.string().min(1),
        phone: z.string().trim().max(32).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const phone = input.phone === '' ? null : (input.phone ?? null);
      return withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.appUser.findUniqueOrThrow({
          where: { id: input.id },
          select: { displayName: true, phone: true },
        });
        const user = await tx.appUser.update({
          where: { id: input.id },
          data: { displayName: input.displayName, phone },
          select: userSelect,
        });
        const changes = [];
        if (before.displayName !== input.displayName)
          changes.push({ field: 'displayName', old: before.displayName, new: input.displayName });
        if ((before.phone ?? null) !== phone)
          changes.push({ field: 'phone', old: before.phone ?? null, new: phone });
        // Skip the audit row entirely on a no-op save (no field changed) to avoid audit noise.
        if (changes.length > 0) {
          await logEvent(tx, {
            entityType: 'user',
            entityId: user.id,
            type: 'updated',
            actorId: ctx.session.userId,
            changes,
          });
        }
        return user;
      });
    }),
});

// Human-readable Vietnamese role names for staff-facing email. Unknown roles fall back to the raw key.
const ROLE_LABELS: Partial<Record<Role, string>> = {
  [Role.super_admin]: 'Quản trị hệ thống',
  [Role.giam_doc_kinh_doanh]: 'Giám đốc Kinh doanh',
  [Role.giam_doc_dao_tao]: 'Giám đốc Đào tạo',
  [Role.giao_vien]: 'Giáo viên',
  [Role.ke_toan]: 'Kế toán',
  [Role.hr]: 'Nhân sự',
  [Role.sale]: 'Tư vấn tuyển sinh',
  [Role.cskh]: 'Chăm sóc khách hàng',
  [Role.ctv_mkt]: 'Cộng tác viên Marketing',
};

// ERP login URL for the welcome email's CTA. Mirrors the SSO route's erpOrigin() default.
function loginUrl(): string {
  return process.env.ADMIN_APP_ORIGIN ?? 'http://localhost:5173';
}

// Post-commit, best-effort welcome email on user creation. SSO onboarding: NO password is sent —
// staff log in with their Microsoft (CMC EDU) account. Own super-scoped tx + try/catch so a
// mail-queue failure never rolls back the create. dedupKey is stable per user so a re-run won't
// double-send.
async function emailWelcome(email: string, displayName: string, primaryRole: Role): Promise<void> {
  try {
    await withRls(SYSTEM_CTX, (tx) =>
      enqueueEmail(tx, {
        dedupKey: `account_welcome:${email}`,
        to: email,
        mailbox: 'notify',
        kind: 'account_welcome',
        data: { displayName, loginUrl: loginUrl(), roleLabel: ROLE_LABELS[primaryRole] ?? primaryRole },
      }),
    );
  } catch (e) {
    console.error('welcome email enqueue failed', e);
  }
}

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
