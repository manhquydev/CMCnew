import { z } from 'zod';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { earnEntry } from '@cmc/domain-rewards';
import { router, requireRole, Role } from '../trpc.js';

const ENTITY = 'grade';

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
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const grade = await tx.grade.update({
          where: { submissionId: input.submissionId },
          data: { isPublished: true },
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

        await tx.notification.create({
          data: {
            facilityId: sub.facilityId,
            recipientType: 'student',
            recipientId: sub.studentId,
            type: 'grade_published',
            payload: { submissionId: sub.id, score: grade.score, exercise: sub.exercise.title, starsEarned },
          },
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
        return { grade, starsEarned };
      }),
    ),
});
