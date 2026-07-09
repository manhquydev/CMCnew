import { TRPCError } from '@trpc/server';
import { logEvent } from '@cmc/audit';
import { type RequestSession } from '@cmc/auth';
import { Prisma, withRls } from '@cmc/db';
import { z } from 'zod';

const UUID = z.string().uuid();

export const enrollExistingStudentInput = z.object({
  facilityId: z.number().int().positive(),
  classBatchId: UUID,
  studentId: UUID,
});

export type TeacherLiteEnrollExistingInput = z.infer<typeof enrollExistingStudentInput>;

function isPrismaUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function assertFacilityAccess(session: RequestSession, facilityId: number) {
  if (!session.isSuperAdmin && !session.facilityIds.includes(facilityId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Không có quyền trên cơ sở này' });
  }
}

/**
 * Teacher Lite bypass (decision 0040): pick an existing student and enroll directly into a
 * class — no receipt/CRM workflow, no email. Mirrors enrollment.enroll's row shape and
 * capacity/lifecycle/audit behavior, but scoped to the teacherLite permission namespace so
 * `giam_doc_dao_tao` (not part of enrollment.enroll's role list) can use it too.
 */
export async function teacherLiteEnrollExistingStudent(
  session: RequestSession,
  input: TeacherLiteEnrollExistingInput,
) {
  assertFacilityAccess(session, input.facilityId);

  try {
    return await withRls(
      { facilityIds: session.facilityIds, isSuperAdmin: session.isSuperAdmin },
      async (tx) => {
        const batch = await tx.classBatch.findUnique({
          where: { id: input.classBatchId },
          select: { id: true, facilityId: true, code: true, capacity: true, archivedAt: true },
        });
        if (!batch || batch.archivedAt) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy lớp học' });
        }
        if (batch.facilityId !== input.facilityId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Lớp học không thuộc cơ sở đã chọn' });
        }

        const student = await tx.student.findUnique({
          where: { id: input.studentId },
          select: { id: true, facilityId: true, fullName: true, studentCode: true, lifecycle: true },
        });
        if (!student) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy học sinh' });
        }
        if (student.facilityId !== input.facilityId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Học sinh không thuộc cơ sở đã chọn' });
        }

        // Unique key is (classBatchId, studentId) with NO archivedAt discriminator (schema.prisma:396),
        // so a soft-archived prior enrollment still occupies the key. A soft-archived hit is a clean
        // CONFLICT (row is gone from the roster but the unique still blocks a fresh `create`). A
        // surviving withdrawn/transferred/completed row (archivedAt still null) is reactivated
        // instead — the student left the class and is coming back, not a duplicate enrollment.
        // Only an already-active/reserved row is a genuine duplicate.
        const dup = await tx.enrollment.findUnique({
          where: { classBatchId_studentId: { classBatchId: input.classBatchId, studentId: input.studentId } },
          select: { id: true, status: true, archivedAt: true },
        });
        if (dup?.archivedAt || (dup && (dup.status === 'active' || dup.status === 'reserved'))) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Học sinh đã được ghi danh vào lớp này' });
        }

        const activeCount = await tx.enrollment.count({
          where: { classBatchId: input.classBatchId, status: 'active', archivedAt: null },
        });

        let enrollment;
        if (dup) {
          enrollment = await tx.enrollment.update({
            where: { id: dup.id },
            data: { status: 'active' },
          });
          await logEvent(tx, {
            facilityId: input.facilityId,
            entityType: 'enrollment',
            entityId: enrollment.id,
            type: 'status_changed',
            body: `teacher_lite: kích hoạt lại ghi danh vào lớp ${batch.code} (trạng thái trước: ${dup.status})`,
            changes: [{ field: 'status', old: dup.status, new: 'active' }],
            actorId: session.userId,
          });
        } else {
          enrollment = await tx.enrollment.create({
            data: {
              facilityId: input.facilityId,
              classBatchId: input.classBatchId,
              studentId: input.studentId,
              status: 'active',
            },
          });
          await logEvent(tx, {
            facilityId: input.facilityId,
            entityType: 'enrollment',
            entityId: enrollment.id,
            type: 'created',
            body: `teacher_lite: ghi danh học sinh có sẵn vào lớp ${batch.code}`,
            actorId: session.userId,
          });
        }

        if (student.lifecycle !== 'active') {
          await tx.student.update({ where: { id: input.studentId }, data: { lifecycle: 'active' } });
          await logEvent(tx, {
            facilityId: input.facilityId,
            entityType: 'student',
            entityId: input.studentId,
            type: 'status_changed',
            body: `Lifecycle: ${student.lifecycle}→active (ghi danh - Teacher Lite)`,
            changes: [{ field: 'lifecycle', old: student.lifecycle, new: 'active' }],
            actorId: session.userId,
          });
        }

        // Capacity = cảnh báo mềm (không chặn), same convention as enrollment.enroll.
        const enrolledCount = activeCount + 1;
        const overCapacity = batch.capacity != null && enrolledCount > batch.capacity;

        return { enrollment, overCapacity, capacity: batch.capacity, enrolledCount };
      },
    );
  } catch (error) {
    if (isPrismaUniqueConflict(error)) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Học sinh đã được ghi danh vào lớp này' });
    }
    throw error;
  }
}
