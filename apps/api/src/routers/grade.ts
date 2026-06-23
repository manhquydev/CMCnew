import { z } from 'zod';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { earnEntry } from '@cmc/domain-rewards';
import { router, requireRole, Role } from '../trpc.js';
import { emitNotification } from '../events.js';

const ENTITY = 'grade';

// Scalar fields only — never select the Json columns (rubric/annotationLayer) into a
// client-facing shape (recursive JsonValue blows tRPC's TS instantiation depth).
const gradeSelect = {
  id: true,
  facilityId: true,
  score: true,
  maxScore: true,
  feedback: true,
  isPublished: true,
} as const;

export const gradeRouter = router({
  // Teacher grades a submission (creates/updates the grade, marks submission graded).
  grade: requireRole(Role.giao_vien, Role.quan_ly)
    .input(
      z.object({
        submissionId: z.string().uuid(),
        score: z.number().min(0),
        feedback: z.string().optional(),
        rubric: z.unknown().optional(),
        annotationLayer: z.unknown().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const sub = await tx.submission.findUniqueOrThrow({
          where: { id: input.submissionId },
          include: { exercise: { select: { maxScore: true } } },
        });
        const grade = await tx.grade.upsert({
          where: { submissionId: input.submissionId },
          update: {
            score: input.score,
            feedback: input.feedback,
            rubric: (input.rubric ?? undefined) as object | undefined,
            annotationLayer: (input.annotationLayer ?? undefined) as object | undefined,
            gradedById: ctx.session.userId,
            gradedAt: new Date(),
          },
          create: {
            facilityId: sub.facilityId,
            submissionId: input.submissionId,
            score: input.score,
            maxScore: sub.exercise.maxScore,
            feedback: input.feedback,
            rubric: (input.rubric ?? undefined) as object | undefined,
            annotationLayer: (input.annotationLayer ?? undefined) as object | undefined,
            gradedById: ctx.session.userId,
          },
          select: gradeSelect,
        });
        await tx.submission.update({ where: { id: input.submissionId }, data: { status: 'graded' } });
        await logEvent(tx, {
          facilityId: grade.facilityId,
          entityType: ENTITY,
          entityId: grade.id,
          type: 'created',
          body: `Chấm điểm: ${input.score}`,
          actorId: ctx.session.userId,
        });
        return grade;
      }),
    ),

  // Publish the grade → student/parent can see it + earn stars (idempotent) + notify.
  publish: requireRole(Role.giao_vien, Role.quan_ly)
    .input(z.object({ submissionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await withRls(rlsContextOf(ctx.session), async (tx) => {
        const grade = await tx.grade.update({
          where: { submissionId: input.submissionId },
          data: { isPublished: true },
          select: gradeSelect,
        });
        const sub = await tx.submission.findUniqueOrThrow({
          where: { id: input.submissionId },
          include: { exercise: { select: { starReward: true, title: true } } },
        });

        // Earn stars — idempotent via @@unique(type, reference): re-publishing never double-credits.
        let starsEarned = 0;
        if (sub.exercise.starReward > 0) {
          const entry = earnEntry(sub.exercise.starReward, sub.id);
          const res = await tx.starTransaction.createMany({
            data: [{ facilityId: sub.facilityId, studentId: sub.studentId, ...entry }],
            skipDuplicates: true,
          });
          starsEarned = res.count > 0 ? sub.exercise.starReward : 0;
        }

        const payload = { submissionId: sub.id, score: grade.score, exercise: sub.exercise.title, starsEarned };
        const notif = await tx.notification.create({
          data: {
            facilityId: sub.facilityId,
            recipientType: 'student',
            recipientId: sub.studentId,
            type: 'grade_published',
            payload,
          },
          select: { id: true, type: true, createdAt: true },
        });
        await logEvent(tx, {
          facilityId: grade.facilityId,
          entityType: ENTITY,
          entityId: grade.id,
          type: 'status_changed',
          body: `Công bố điểm${starsEarned ? ` (+${starsEarned} sao)` : ''}`,
          changes: [{ field: 'isPublished', old: false, new: true }],
          actorId: ctx.session.userId,
        });
        return { grade, starsEarned, studentId: sub.studentId, notif, payload };
      });

      // Fan out to live SSE subscribers AFTER commit (never push a row that rolled back).
      emitNotification({
        studentId: result.studentId,
        notification: {
          id: result.notif.id,
          type: result.notif.type,
          payload: result.payload,
          createdAt: result.notif.createdAt.toISOString(),
        },
      });
      return { grade: result.grade, starsEarned: result.starsEarned };
    }),
});
