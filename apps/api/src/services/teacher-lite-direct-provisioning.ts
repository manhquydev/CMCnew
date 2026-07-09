import { TRPCError } from '@trpc/server';
import { logEvent } from '@cmc/audit';
import {
  DEFAULT_STUDENT_PASSWORD,
  normalizeLoginPhone,
  type RequestSession,
} from '@cmc/auth';
import { GuardianRelation, Prisma, Program, hashPassword, withRls } from '@cmc/db';
import { z } from 'zod';
import { enqueueEmail } from './email-outbox.js';
import { nextDirectStudentCode } from './student-code.js';

const UUID = z.string().uuid();

export const createTeacherLiteDirectProvisioningInput = z.object({
  facilityId: z.number().int().positive(),
  classBatchId: UUID,
  parentName: z.string().trim().min(1),
  parentEmail: z.string().trim().email(),
  parentPhone: z.string().trim().min(8),
  studentName: z.string().trim().min(1),
  studentDob: z.coerce.date().optional(),
  program: z.nativeEnum(Program),
  level: z.string().trim().min(1).optional(),
  relation: z.nativeEnum(GuardianRelation).default(GuardianRelation.guardian),
  sendEmail: z.boolean().default(true),
});

export type TeacherLiteDirectProvisioningInput = z.infer<
  typeof createTeacherLiteDirectProvisioningInput
>;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function isPrismaUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function assertFacilityAccess(session: RequestSession, facilityId: number) {
  if (!session.isSuperAdmin && !session.facilityIds.includes(facilityId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Không có quyền trên cơ sở này' });
  }
}

export async function createTeacherLiteFamilyStudentAndEnroll(
  session: RequestSession,
  input: TeacherLiteDirectProvisioningInput,
) {
  assertFacilityAccess(session, input.facilityId);

  const loginPhone = normalizeLoginPhone(input.parentPhone);
  if (!loginPhone) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Số điện thoại PH không hợp lệ cho đăng nhập LMS',
    });
  }

  const parentEmail = normalizeEmail(input.parentEmail);

  try {
    return await withRls(
      { facilityIds: session.facilityIds, isSuperAdmin: session.isSuperAdmin },
      async (tx) => {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1), 91001)', loginPhone);

        const batch = await tx.classBatch.findUnique({
          where: { id: input.classBatchId },
          select: { id: true, facilityId: true, code: true, archivedAt: true },
        });
        if (!batch || batch.archivedAt) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy lớp học' });
        }
        if (batch.facilityId !== input.facilityId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Lớp học không thuộc cơ sở đã chọn' });
        }

        const parentByPhone = await tx.parentAccount.findUnique({ where: { phone: loginPhone } });
        const parentByEmail = await tx.parentAccount.findUnique({ where: { email: parentEmail } });
        if (parentByPhone && parentByEmail && parentByPhone.id !== parentByEmail.id) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Email và số điện thoại đang thuộc hai tài khoản PH khác nhau',
          });
        }

        let parent = parentByPhone ?? parentByEmail;
        const familyPasswordHash = await hashPassword(DEFAULT_STUDENT_PASSWORD);
        // Tracks whether THIS call is the one that actually set the family login password —
        // only then is it safe to surface/email the literal DEFAULT_STUDENT_PASSWORD. A returning
        // family's real password may differ (self-service change, decision 0033 D5 never
        // overwrites it), so claiming the default for them would hand out a dead credential.
        let familyPasswordWasSet: boolean;
        if (!parent) {
          familyPasswordWasSet = true;
          parent = await tx.parentAccount.create({
            data: {
              displayName: input.parentName,
              email: parentEmail,
              phone: loginPhone,
              passwordHash: familyPasswordHash,
            },
          });
        } else {
          if (parent.email && parent.email !== parentEmail) {
            throw new TRPCError({ code: 'CONFLICT', message: 'Số điện thoại PH đã gắn với email khác' });
          }
          if (parent.phone && parent.phone !== loginPhone) {
            throw new TRPCError({ code: 'CONFLICT', message: 'Email PH đã gắn với số điện thoại khác' });
          }
          familyPasswordWasSet = !parent.passwordHash;
          parent = await tx.parentAccount.update({
            where: { id: parent.id },
            data: {
              email: parent.email ?? parentEmail,
              phone: parent.phone ?? loginPhone,
              passwordHash: parent.passwordHash ?? familyPasswordHash,
            },
          });
        }

        const guardians = await tx.guardian.findMany({
          where: { parentAccountId: parent.id },
          include: {
            student: { select: { id: true, fullName: true, dateOfBirth: true, archivedAt: true } },
          },
        });
        // Match on normalized name AND date of birth — name alone mis-attaches same-named
        // siblings to one record (silent data loss) or duplicates a diacritic/whitespace variant
        // of the same child. When BOTH sides have a DOB it must agree (disambiguates siblings
        // sharing a name); when NEITHER side has a DOB, name alone still matches (preserves
        // idempotent double-submit reuse for the common no-DOB intake). A one-sided DOB (one
        // known, one missing) is treated as ambiguous and does NOT match — safer to create a new
        // student than silently guess.
        const matchedGuardian = guardians.find((g) => {
          if (g.student.archivedAt) return false;
          if (!sameName(g.student.fullName, input.studentName)) return false;
          const existingDob = g.student.dateOfBirth;
          const incomingDob = input.studentDob ?? null;
          if (existingDob === null && incomingDob === null) return true;
          if (existingDob === null || incomingDob === null) return false;
          return existingDob.getTime() === incomingDob.getTime();
        });

        let studentId = matchedGuardian?.student.id ?? null;
        let studentCode: string;
        let createdStudent = false;
        if (!studentId) {
          studentCode = await nextDirectStudentCode(tx, input.facilityId);
          const student = await tx.student.create({
            data: {
              facilityId: input.facilityId,
              studentCode,
              fullName: input.studentName,
              dateOfBirth: input.studentDob ?? null,
              program: input.program,
              level: input.level ?? null,
              lifecycle: 'active',
            },
          });
          studentId = student.id;
          createdStudent = true;
          await logEvent(tx, {
            facilityId: input.facilityId,
            entityType: 'student',
            entityId: student.id,
            type: 'created',
            body: 'teacher_lite_direct: tao hoc sinh truc tiep, bo qua phieu thu',
            actorId: session.userId,
          });
        } else {
          const student = await tx.student.findUniqueOrThrow({
            where: { id: studentId },
            select: { studentCode: true, lifecycle: true },
          });
          studentCode = student.studentCode;
          if (student.lifecycle !== 'active') {
            await tx.student.update({ where: { id: studentId }, data: { lifecycle: 'active' } });
            await logEvent(tx, {
              facilityId: input.facilityId,
              entityType: 'student',
              entityId: studentId,
              type: 'status_changed',
              body: `Lifecycle: ${student.lifecycle}→active (teacher_lite_direct: ghi danh)`,
              changes: [{ field: 'lifecycle', old: student.lifecycle, new: 'active' }],
              actorId: session.userId,
            });
          }
        }

        await tx.guardian.upsert({
          where: {
            parentAccountId_studentId: {
              parentAccountId: parent.id,
              studentId,
            },
          },
          create: {
            facilityId: input.facilityId,
            parentAccountId: parent.id,
            studentId,
            relation: input.relation,
          },
          update: { relation: input.relation },
        });

        const existingEnrollment = await tx.enrollment.findUnique({
          where: { classBatchId_studentId: { classBatchId: input.classBatchId, studentId } },
          select: { id: true, status: true, archivedAt: true },
        });
        let enrollmentId = existingEnrollment?.id ?? null;
        if (existingEnrollment?.archivedAt) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Học sinh đã từng được ghi danh vào lớp này' });
        }
        if (!existingEnrollment) {
          const enrollment = await tx.enrollment.create({
            data: {
              facilityId: input.facilityId,
              classBatchId: input.classBatchId,
              studentId,
              status: 'active',
            },
          });
          enrollmentId = enrollment.id;
          await logEvent(tx, {
            facilityId: input.facilityId,
            entityType: 'enrollment',
            entityId: enrollment.id,
            type: 'created',
            body: `teacher_lite_direct: ghi danh truc tiep vao lop ${batch.code}`,
            actorId: session.userId,
          });
        } else if (
          existingEnrollment.status !== 'active' &&
          existingEnrollment.status !== 'reserved'
        ) {
          // Withdrawn/transferred/completed row with archivedAt still null (schema.prisma:396's
          // unique key has no status column) — reactivate instead of silently returning a stale
          // enrollment (the student would show on the roster but exercise access scopes
          // status:'active', leaving them unable to do homework).
          await tx.enrollment.update({ where: { id: existingEnrollment.id }, data: { status: 'active' } });
          await logEvent(tx, {
            facilityId: input.facilityId,
            entityType: 'enrollment',
            entityId: existingEnrollment.id,
            type: 'status_changed',
            body: `teacher_lite_direct: kích hoạt lại ghi danh vào lớp ${batch.code} (trạng thái trước: ${existingEnrollment.status})`,
            changes: [{ field: 'status', old: existingEnrollment.status, new: 'active' }],
            actorId: session.userId,
          });
        }

        const facility = await tx.facility.findUniqueOrThrow({
          where: { id: input.facilityId },
          select: { code: true },
        });
        const loginCode = `${facility.code}-${studentCode}`;
        const existingAccount = await tx.studentAccount.findUnique({
          where: { studentId },
          select: { id: true, loginCode: true },
        });
        const passwordHash = await hashPassword(DEFAULT_STUDENT_PASSWORD);
        const studentAccountWasCreated = !existingAccount;
        const studentAccount =
          existingAccount ??
          (await tx.studentAccount.create({
            data: {
              studentId,
              loginCode,
              passwordHash,
              isActive: true,
            },
            select: { id: true, loginCode: true },
          }));

        // The credential surfaced (email + return payload) is only trustworthy when THIS call is
        // the one that actually set it: a fresh family password AND a fresh StudentAccount
        // password (the break-glass loginCode fallback shares the same displayed value). A
        // returning family/reused account may have a different real password (self-service
        // change, decision 0033 D5 never overwrites it) — claiming DEFAULT_STUDENT_PASSWORD for
        // them hands out a dead credential that fails phone-login.
        const passwordWasSet = familyPasswordWasSet && studentAccountWasCreated;
        const NOT_CHANGED_NOTICE = 'Không đổi — dùng mật khẩu gia đình hiện tại';
        const displayedPassword = passwordWasSet ? DEFAULT_STUDENT_PASSWORD : NOT_CHANGED_NOTICE;

        if (input.sendEmail) {
          await enqueueEmail(tx, {
            facilityId: input.facilityId,
            dedupKey: `teacher_lite_lms_account_ready:${studentId}`,
            to: parentEmail,
            mailbox: 'notify',
            kind: 'lms_account_ready',
            data: {
              parentName: parent.displayName,
              studentName: input.studentName,
              familyPhone: loginPhone,
              loginCode: studentAccount.loginCode,
              tempPassword: displayedPassword,
            },
          });
        }

        return {
          parentAccountId: parent.id,
          studentId,
          enrollmentId,
          createdStudent,
          lmsAccount: {
            familyPhone: loginPhone,
            loginCode: studentAccount.loginCode,
            tempPassword: displayedPassword,
            passwordWasSet,
          },
        };
      },
    );
  } catch (error) {
    if (isPrismaUniqueConflict(error)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Dữ liệu PH/học sinh/LMS đã tồn tại, vui lòng tải lại và kiểm tra trùng',
        cause: error,
      });
    }
    throw error;
  }
}
