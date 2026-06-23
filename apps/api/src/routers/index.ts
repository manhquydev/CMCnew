import { router, publicProcedure } from '../trpc.js';
import { authRouter } from './auth.js';
import { facilityRouter } from './facility.js';
import { userRouter } from './user.js';
import { courseRouter } from './course.js';
import { roomRouter } from './room.js';
import { studentRouter } from './student.js';
import { classBatchRouter } from './class-batch.js';
import { scheduleRouter } from './schedule.js';
import { enrollmentRouter } from './enrollment.js';
import { attendanceRouter } from './attendance.js';
import { auditRouter } from './audit.js';
import { lmsAuthRouter } from './lms-auth.js';
import { exerciseRouter } from './exercise.js';
import { submissionRouter } from './submission.js';
import { gradeRouter } from './grade.js';
import { rewardsRouter } from './rewards.js';
import { notificationRouter } from './notification.js';
import { assessmentRouter } from './assessment.js';
import { badgeRouter } from './badge.js';
import { leaderboardRouter } from './leaderboard.js';
import { levelProgressRouter } from './level-progress.js';
import { financeRouter } from './finance.js';

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, ts: new Date().toISOString() })),
  auth: authRouter,
  lmsAuth: lmsAuthRouter,
  facility: facilityRouter,
  user: userRouter,
  course: courseRouter,
  room: roomRouter,
  student: studentRouter,
  classBatch: classBatchRouter,
  schedule: scheduleRouter,
  enrollment: enrollmentRouter,
  attendance: attendanceRouter,
  audit: auditRouter,
  exercise: exerciseRouter,
  submission: submissionRouter,
  grade: gradeRouter,
  rewards: rewardsRouter,
  notification: notificationRouter,
  assessment: assessmentRouter,
  badge: badgeRouter,
  leaderboard: leaderboardRouter,
  levelProgress: levelProgressRouter,
  finance: financeRouter,
});

export type AppRouter = typeof appRouter;
