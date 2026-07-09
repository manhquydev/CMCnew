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

/** Principal (parent/student LMS) field allowlist — explicit `select`, never `include`, on
 * SessionEvidence so a new/renamed scalar (e.g. `internalNote`, the teacher's private note)
 * never leaks to the family by default. Any field the LMS should show must be added here
 * deliberately. */
const PRINCIPAL_EVIDENCE_SELECT = {
  id: true,
  summary: true,
  status: true,
  publishedAt: true,
  photos: {
    select: { id: true, photoRef: true, sortOrder: true },
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
  },
  classSession: {
    select: {
      id: true,
      sessionDate: true,
      startTime: true,
      endTime: true,
      batch: { select: { id: true, code: true, name: true, course: { select: { program: true, name: true } } } },
    },
  },
};

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
        // A comment is only meaningful for a student who actually attended (present/late).
        // Attendance can be corrected AFTER a comment was written (e.g. present -> absent),
        // which would otherwise leave an orphaned comment the UI has no input to clear (it only
        // renders inputs for present/late students) and every subsequent save would 400 forever.
        // So: silently DROP comments for non-attended students here instead of rejecting the
        // whole save — the intent (no comments for absent students) is preserved, but a stale
        // comment can never brick saving the rest of the draft.
        const presentOrLate = await tx.attendance.findMany({
          where: { classSessionId: input.classSessionId, status: { in: ['present', 'late'] } },
          select: { enrollment: { select: { studentId: true } } },
        });
        const attended = new Set(presentOrLate.map((a) => a.enrollment.studentId));
        const validComments = input.comments.filter((c) => attended.has(c.studentId));
        // A photoRef only passing the hex-shape regex doesn't mean the file is still on disk
        // (fabricated ref, or the store was wiped by a redeploy) — drop dead refs instead of
        // blocking the whole save (comments/summary are unrelated to a stale photo), and tell
        // the teacher which ones were dropped so they can re-upload.
        const photoChecks = await Promise.all(input.photos.map((p) => sessionPhotoExists(p.ref)));
        const livePhotos = input.photos.filter((_, i) => photoChecks[i]);
        const droppedCount = input.photos.length - livePhotos.length;

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
          // NOTE: status/publishedAt/publishedById are deliberately NOT set here. Editing an
          // already-published evidence (typo fix, swap a photo, tweak a comment) must not
          // silently un-publish it — that would drop it from the parent LMS (which filters
          // status='published') with no notice, while the admin UI's "Đã đăng" badge still
          // claims it's live. Publish/unpublish is an explicit action (see `publish` below),
          // not a side effect of a draft save.
          update: {
            summary: input.summary || null,
            internalNote: input.internalNote || null,
          },
        });

        await tx.sessionEvidencePhoto.deleteMany({ where: { sessionEvidenceId: evidence.id } });
        if (livePhotos.length > 0) {
          await tx.sessionEvidencePhoto.createMany({
            data: livePhotos.map((p, i) => ({
              sessionEvidenceId: evidence.id,
              photoRef: p.ref,
              sortOrder: p.sortOrder ?? i,
            })),
          });
        }

        await tx.sessionStudentComment.deleteMany({ where: { sessionEvidenceId: evidence.id } });
        if (validComments.length > 0) {
          await tx.sessionStudentComment.createMany({
            data: validComments.map((c) => ({
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

        const saved = await tx.sessionEvidence.findUniqueOrThrow({
          where: { id: evidence.id },
          include: {
            photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
            comments: true,
          },
        });
        return { ...saved, droppedPhotoCount: droppedCount };
      }),
    ),

  publish: requirePermission('sessionEvidence', 'publish')
    .input(z.object({ classSessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const evidence = await tx.sessionEvidence.findUnique({
          where: { classSessionId: input.classSessionId },
          include: {
            photos: true,
            comments: true,
            classSession: { select: { facilityId: true, teacherId: true, batch: { select: { status: true } } } },
          },
        });
        if (!evidence) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chưa có nháp buổi học' });
        assertTeachingSessionMutationAllowed(ctx.session, evidence.classSession);
        if (evidence.classSession.batch.status === 'cancelled') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Lớp đã hủy, không thể publish bằng chứng buổi học lên LMS' });
        }
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
          select: {
            ...PRINCIPAL_EVIDENCE_SELECT,
            comments: {
              where: { studentId: { in: studentIds } },
              select: {
                id: true,
                studentId: true,
                participation: true,
                strength: true,
                needsImprovement: true,
                teacherNote: true,
                student: { select: { id: true, fullName: true } },
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
          select: {
            ...PRINCIPAL_EVIDENCE_SELECT,
            comments: {
              where: { studentId: input.studentId },
              select: {
                id: true,
                studentId: true,
                participation: true,
                strength: true,
                needsImprovement: true,
                teacherNote: true,
                student: { select: { id: true, fullName: true } },
              },
            },
          },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        return row;
      }),
    ),
});
