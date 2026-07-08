import { TRPCError } from '@trpc/server';
import { logEvent } from '@cmc/audit';
import { type RequestSession } from '@cmc/auth';
import { withRls } from '@cmc/db';
import { z } from 'zod';

// Teacher-lite CRUD bypass: giám đốc quản lý HS gọn. Bypass rào workflow ERP (receipt/lifecycle) nhưng
// GIỮ RLS (facilityId từ chính record) + audit. Xem plan 260708-0910 §Nguyên tắc API bypass.

function assertFacilityAccess(session: RequestSession, facilityId: number) {
  if (!session.isSuperAdmin && !session.facilityIds.includes(facilityId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Không có quyền trên cơ sở này' });
  }
}

export const teacherLiteOverviewStatsInput = z.object({ facilityId: z.number().int().positive() });
export type TeacherLiteOverviewStatsInput = z.infer<typeof teacherLiteOverviewStatsInput>;

/**
 * Đếm cho stat card trang Hôm nay của giáo viên:
 * - pendingGrading: bài HS đã nộp (status='submitted') của CHÍNH học sinh trong các lớp giáo viên dạy
 *   (scope theo studentId để tránh over-count vì Exercise là global dùng chung nhiều lớp).
 * - pendingEvidence: buổi giáo viên dạy đã diễn ra (sessionDate <= hôm nay, chưa hủy) mà nhật ký chưa publish.
 */
export async function teacherLiteOverviewStats(
  session: RequestSession,
  input: TeacherLiteOverviewStatsInput,
) {
  assertFacilityAccess(session, input.facilityId);
  return withRls(
    { facilityIds: session.facilityIds, isSuperAdmin: session.isSuperAdmin },
    async (tx) => {
      const sessions = await tx.classSession.findMany({
        where: { teacherId: session.userId, facilityId: input.facilityId, status: { not: 'cancelled' } },
        select: { classBatchId: true, sessionDate: true, evidence: { select: { status: true } } },
      });
      const batchIds = [...new Set(sessions.map((s) => s.classBatchId))];
      let pendingGrading = 0;
      if (batchIds.length > 0) {
        const enrollments = await tx.enrollment.findMany({
          where: { classBatchId: { in: batchIds }, status: 'active', archivedAt: null },
          select: { studentId: true },
        });
        const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
        if (studentIds.length > 0) {
          pendingGrading = await tx.submission.count({
            where: { studentId: { in: studentIds }, status: 'submitted', archivedAt: null },
          });
        }
      }
      const now = new Date();
      const pendingEvidence = sessions.filter(
        (s) => s.sessionDate <= now && (!s.evidence || s.evidence.status !== 'published'),
      ).length;
      return { pendingGrading, pendingEvidence };
    },
  );
}

export const teacherLiteStudentArchiveInput = z.object({ id: z.string().uuid() });
export type TeacherLiteStudentArchiveInput = z.infer<typeof teacherLiteStudentArchiveInput>;

/** Soft-archive học sinh (set archivedAt). Không hard-delete — student.list đã lọc archivedAt:null. */
export async function teacherLiteStudentArchive(
  session: RequestSession,
  input: TeacherLiteStudentArchiveInput,
) {
  return withRls(
    { facilityIds: session.facilityIds, isSuperAdmin: session.isSuperAdmin },
    async (tx) => {
      const student = await tx.student.findUnique({
        where: { id: input.id },
        select: { id: true, facilityId: true, archivedAt: true, fullName: true },
      });
      if (!student) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy học sinh (hoặc ngoài phạm vi cơ sở)' });
      }
      assertFacilityAccess(session, student.facilityId);
      if (student.archivedAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Học sinh đã được lưu trữ' });
      }
      const updated = await tx.student.update({
        where: { id: student.id },
        data: { archivedAt: new Date() },
      });
      await logEvent(tx, {
        facilityId: student.facilityId,
        entityType: 'student',
        entityId: student.id,
        type: 'archived',
        body: `Lưu trữ học sinh ${student.fullName}`,
        actorId: session.userId,
      });
      return updated;
    },
  );
}
