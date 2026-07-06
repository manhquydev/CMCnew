import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { lmsRlsContextOf, rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { lmsProcedure, requirePermission, router } from '../trpc.js';
import { sessionPhotoExists } from '../services/photo-store.js';
import { assertTeachingSessionMutationAllowed } from '../lib/teaching-authz.js';

const ENTITY = 'session_evidence';

const COMMENT_TEMPLATE = {
  participation: ['Tích cực', 'Ổn định', 'Cần khuyến khích thêm'],
  strength: ['Tư duy logic', 'Sáng tạo', 'Giao tiếp', 'Tập trung', 'Hợp tác'],
  needsImprovement: ['Luyện trình bày', 'Tăng tập trung', 'Ôn kiến thức nền', 'Mạnh dạn phát biểu'],
} as const;

const participationSchema = z.enum(COMMENT_TEMPLATE.participation);
const strengthSchema = z.enum(COMMENT_TEMPLATE.strength);
const needsImprovementSchema = z.enum(COMMENT_TEMPLATE.needsImprovement);

const photoInput = z.object({
  ref: z.string().regex(/^[a-f0-9]{64}$/),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

const commentInput = z.object({
  studentId: z.string().uuid(),
  participation: participationSchema.optional(),
  strength: strengthSchema.optional(),
  needsImprovement: needsImprovementSchema.optional(),
  teacherNote: z.string().trim().max(500).optional(),
});

function assertOwnedStudent(studentIds: string[], studentId: string) {
  if (!studentIds.includes(studentId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Không có quyền xem học sinh này' });
  }
}

export const sessionEvidenceRouter = router({
  commentTemplate: requirePermission('sessionEvidence', 'commentTemplate').query(() => COMMENT_TEMPLATE),

  listByClass: requirePermission('sessionEvidence', 'listByClass')
    .input(z.object({ classBatchId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const sessions = await tx.classSession.findMany({
          where: { classBatchId: input.classBatchId, archivedAt: null },
          include: {
            evidence: {
              include: {
                photos: { select: { id: true } },
                comments: { select: { id: true } },
              },
            },
          },
          orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
        });
        return sessions.map((s) => ({
          sessionId: s.id,
          sessionDate: s.sessionDate,
          startTime: s.startTime,
          endTime: s.endTime,
          status: s.evidence?.status ?? null,
          publishedAt: s.evidence?.publishedAt ?? null,
          photoCount: s.evidence?.photos.length ?? 0,
          commentCount: s.evidence?.comments.length ?? 0,
        }));
      }),
    ),

  detailForStaff: requirePermission('sessionEvidence', 'detailForStaff')
    .input(z.object({ classSessionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const session = await tx.classSession.findUnique({
          where: { id: input.classSessionId },
          include: {
            batch: {
              select: {
                id: true,
                code: true,
                name: true,
                enrollments: {
                  where: { archivedAt: null, status: 'active' },
                  include: { student: { select: { id: true, fullName: true, studentCode: true } } },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
            evidence: {
              include: {
                photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
                comments: true,
              },
            },
          },
        });
        if (!session) throw new TRPCError({ code: 'NOT_FOUND' });
        return {
          session,
          roster: session.batch.enrollments.map((e) => e.student),
          template: COMMENT_TEMPLATE,
        };
      }),
    ),

  upsertDraft: requirePermission('sessionEvidence', 'upsertDraft')
    .input(
      z.object({
        classSessionId: z.string().uuid(),
        summary: z.string().trim().max(2000).optional(),
        internalNote: z.string().trim().max(2000).optional(),
        photos: z.array(photoInput).max(20).default([]),
        comments: z.array(commentInput).max(100).default([]),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const session = await tx.classSession.findUnique({
          where: { id: input.classSessionId },
          include: {
            batch: {
              select: {
                enrollments: {
                  where: { archivedAt: null, status: 'active' },
                  select: { studentId: true },
                },
              },
            },
          },
        });
        if (!session) throw new TRPCError({ code: 'NOT_FOUND' });
        assertTeachingSessionMutationAllowed(ctx.session, session);
        const enrolled = new Set(session.batch.enrollments.map((e) => e.studentId));
        for (const c of input.comments) {
          if (!enrolled.has(c.studentId)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nhận xét chỉ áp dụng cho học sinh đang học trong lớp' });
          }
        }
        // A photoRef only passing the hex-shape regex doesn't mean the file was
        // ever uploaded — verify it's actually on disk before linking it, so a
        // fabricated ref can't reach publish() and 404 for the parent viewing it.
        for (const p of input.photos) {
          if (!(await sessionPhotoExists(p.ref))) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ảnh không tồn tại, vui lòng tải lại' });
          }
        }

        const evidence = await tx.sessionEvidence.upsert({
          where: { classSessionId: input.classSessionId },
          create: {
            facilityId: session.facilityId,
            classSessionId: input.classSessionId,
            summary: input.summary || null,
            internalNote: input.internalNote || null,
            createdById: ctx.session.userId,
            status: 'draft',
          },
          update: {
            summary: input.summary || null,
            internalNote: input.internalNote || null,
            status: 'draft',
            publishedAt: null,
            publishedById: null,
          },
        });

        await tx.sessionEvidencePhoto.deleteMany({ where: { sessionEvidenceId: evidence.id } });
        if (input.photos.length > 0) {
          await tx.sessionEvidencePhoto.createMany({
            data: input.photos.map((p, i) => ({
              sessionEvidenceId: evidence.id,
              photoRef: p.ref,
              sortOrder: p.sortOrder ?? i,
            })),
          });
        }

        await tx.sessionStudentComment.deleteMany({ where: { sessionEvidenceId: evidence.id } });
        if (input.comments.length > 0) {
          await tx.sessionStudentComment.createMany({
            data: input.comments.map((c) => ({
              sessionEvidenceId: evidence.id,
              studentId: c.studentId,
              participation: c.participation ?? null,
              strength: c.strength ?? null,
              needsImprovement: c.needsImprovement ?? null,
              teacherNote: c.teacherNote ?? null,
            })),
          });
        }

        await logEvent(tx, {
          facilityId: session.facilityId,
          entityType: ENTITY,
          entityId: evidence.id,
          type: 'updated',
          body: 'Lưu nháp bằng chứng buổi học',
          actorId: ctx.session.userId,
        });

        return tx.sessionEvidence.findUniqueOrThrow({
          where: { id: evidence.id },
          include: {
            photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
            comments: true,
          },
        });
      }),
    ),

  publish: requirePermission('sessionEvidence', 'publish')
    .input(z.object({ classSessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const evidence = await tx.sessionEvidence.findUnique({
          where: { classSessionId: input.classSessionId },
          include: { photos: true, comments: true, classSession: { select: { teacherId: true } } },
        });
        if (!evidence) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chưa có nháp buổi học' });
        assertTeachingSessionMutationAllowed(ctx.session, evidence.classSession);
        if (!evidence.summary?.trim()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cần có tóm tắt buổi học trước khi publish' });
        }
        if (evidence.photos.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cần có ít nhất 1 ảnh buổi học trước khi publish' });
        }
        if (evidence.comments.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cần có nhận xét học sinh trước khi publish' });
        }
        const before = evidence.status;
        const published = await tx.sessionEvidence.update({
          where: { id: evidence.id },
          data: {
            status: 'published',
            publishedAt: new Date(),
            publishedById: ctx.session.userId,
          },
        });
        await logEvent(tx, {
          facilityId: published.facilityId,
          entityType: ENTITY,
          entityId: published.id,
          type: 'status_changed',
          body: 'Publish bằng chứng buổi học lên LMS',
          changes: [{ field: 'status', old: before, new: 'published' }],
          actorId: ctx.session.userId,
        });
        return published;
      }),
    ),

  listForPrincipal: lmsProcedure
    .input(z.object({ studentId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
        const studentIds = input?.studentId ? [input.studentId] : ctx.lms.studentIds;
        for (const id of studentIds) assertOwnedStudent(ctx.lms.studentIds, id);
        const rows = await tx.sessionEvidence.findMany({
          where: {
            status: 'published',
            publishedAt: { not: null },
            archivedAt: null,
            classSession: {
              batch: {
                enrollments: {
                  some: { studentId: { in: studentIds }, archivedAt: null },
                },
              },
            },
          },
          include: {
            photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
            comments: {
              where: { studentId: { in: studentIds } },
              include: { student: { select: { id: true, fullName: true } } },
            },
            classSession: {
              include: {
                batch: { select: { id: true, code: true, name: true, course: { select: { program: true, name: true } } } },
              },
            },
          },
          orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        });
        return rows;
      }),
    ),

  detailForPrincipal: lmsProcedure
    .input(z.object({ sessionEvidenceId: z.string().uuid(), studentId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
        assertOwnedStudent(ctx.lms.studentIds, input.studentId);
        const row = await tx.sessionEvidence.findFirst({
          where: {
            id: input.sessionEvidenceId,
            status: 'published',
            publishedAt: { not: null },
            archivedAt: null,
            classSession: {
              batch: {
                enrollments: {
                  some: { studentId: input.studentId, archivedAt: null },
                },
              },
            },
          },
          include: {
            photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
            comments: {
              where: { studentId: input.studentId },
              include: { student: { select: { id: true, fullName: true } } },
            },
            classSession: {
              include: {
                batch: { select: { id: true, code: true, name: true, course: { select: { program: true, name: true } } } },
              },
            },
          },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        return row;
      }),
    ),
});
