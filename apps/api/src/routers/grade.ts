import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { earnEntry, evaluateBadges } from '@cmc/domain-rewards';
import { router, requirePermission } from '../trpc.js';
import { emitNotification } from '../events.js';
import { annotationDataSchema } from '../annotation.js';
import { assertTeachingOwnershipFound, canManageAllTeaching } from '../lib/teaching-authz.js';

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
  grade: requirePermission('grade', 'grade')
    .input(
      z.object({
        submissionId: z.string().uuid(),
        score: z.number().min(0),
        feedback: z.string().optional(),
        rubric: z.unknown().optional(),
        annotationLayer: annotationDataSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const sub = await tx.submission.findUniqueOrThrow({
          where: { id: input.submissionId },
          include: { exercise: { select: { maxScore: true, curriculumLessonId: true, curriculumUnitId: true } } },
        });
        if (!canManageAllTeaching(ctx.session)) {
          const ownedSession = await tx.classSession.findFirst({
            where: {
              teacherId: ctx.session.userId,
              ...(sub.exercise.curriculumLessonId
                ? { curriculumLessonId: sub.exercise.curriculumLessonId }
                : { curriculumUnitId: sub.exercise.curriculumUnitId }),
              archivedAt: null,
              status: { not: 'cancelled' },
              batch: {
                enrollments: {
                  some: {
                    studentId: sub.studentId,
                    archivedAt: null,
                    status: { notIn: ['withdrawn', 'transferred'] },
                  },
                },
              },
            },
            select: { id: true },
          });
          assertTeachingOwnershipFound(!!ownedSession);
        }
        // Score must not exceed the exercise maximum — an over-max score inflates the
        // normalised final grade (score/maxScore ratio used by computeFinalGrade).
        if (input.score > sub.exercise.maxScore) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Điểm (${input.score}) vượt quá điểm tối đa của bài tập (${sub.exercise.maxScore})`,
          });
        }
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
  publish: requirePermission('grade', 'publish')
    .input(z.object({ submissionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await withRls(rlsContextOf(ctx.session), async (tx) => {
        const sub = await tx.submission.findUniqueOrThrow({
          where: { id: input.submissionId },
          include: { exercise: { select: { starReward: true, title: true, curriculumLessonId: true, curriculumUnitId: true } } },
        });
        if (!canManageAllTeaching(ctx.session)) {
          const ownedSession = await tx.classSession.findFirst({
            where: {
              teacherId: ctx.session.userId,
              ...(sub.exercise.curriculumLessonId
                ? { curriculumLessonId: sub.exercise.curriculumLessonId }
                : { curriculumUnitId: sub.exercise.curriculumUnitId }),
              archivedAt: null,
              status: { not: 'cancelled' },
              batch: {
                enrollments: {
                  some: {
                    studentId: sub.studentId,
                    archivedAt: null,
                    status: { notIn: ['withdrawn', 'transferred'] },
                  },
                },
              },
            },
            select: { id: true },
          });
          assertTeachingOwnershipFound(!!ownedSession);
        }
        const grade = await tx.grade.update({
          where: { submissionId: input.submissionId },
          data: { isPublished: true },
          select: gradeSelect,
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

        // Auto-award badges: publishing a grade just changed the student's stats, so re-evaluate
        // the facility's active badges and award any newly-earned ones. @@unique(studentId,badgeId)
        // makes it idempotent; we diff against owned badges so each award notifies exactly once.
        const badgeNotifs: { id: string; type: string; payload: object; createdAt: Date }[] = [];
        const starAgg = await tx.starTransaction.aggregate({
          where: { studentId: sub.studentId },
          _sum: { amount: true },
        });
        const homeworkCount = await tx.submission.count({
          where: {
            studentId: sub.studentId,
            exercise: { type: 'homework' },
            grade: { isPublished: true },
          },
        });
        const badges = await tx.badge.findMany({
          where: { facilityId: sub.facilityId, isActive: true, archivedAt: null },
          select: { id: true, name: true, unlockCriteria: true },
        });
        const owned = new Set(
          (await tx.studentBadge.findMany({ where: { studentId: sub.studentId }, select: { badgeId: true } })).map(
            (o) => o.badgeId,
          ),
        );
        const wonIds = evaluateBadges(badges, {
          starsTotal: starAgg._sum.amount ?? 0,
          homeworkCount,
        }).filter((id) => !owned.has(id));
        if (wonIds.length > 0) {
          await tx.studentBadge.createMany({
            data: wonIds.map((badgeId) => ({
              facilityId: sub.facilityId,
              studentId: sub.studentId,
              badgeId,
              source: 'auto' as const,
            })),
            skipDuplicates: true,
          });
          for (const b of badges.filter((x) => wonIds.includes(x.id))) {
            const bp = { badgeId: b.id, badge: b.name };
            const bn = await tx.notification.create({
              data: {
                facilityId: sub.facilityId,
                recipientType: 'student',
                recipientId: sub.studentId,
                type: 'badge_awarded',
                payload: bp,
              },
              select: { id: true, type: true, createdAt: true },
            });
            badgeNotifs.push({ ...bn, payload: bp });
            await logEvent(tx, {
              facilityId: sub.facilityId,
              entityType: 'student_badge',
              entityId: b.id,
              type: 'created',
              body: `Đạt huy hiệu: ${b.name}`,
              actorId: ctx.session.userId,
            });
          }
        }

        return { grade, starsEarned, studentId: sub.studentId, notif, payload, badgeNotifs };
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
      for (const bn of result.badgeNotifs) {
        emitNotification({
          studentId: result.studentId,
          notification: { id: bn.id, type: bn.type, payload: bn.payload, createdAt: bn.createdAt.toISOString() },
        });
      }
      return { grade: result.grade, starsEarned: result.starsEarned, badgesAwarded: result.badgeNotifs.length };
    }),
});
