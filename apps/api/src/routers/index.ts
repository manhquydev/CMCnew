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

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, ts: new Date().toISOString() })),
  auth: authRouter,
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
});

export type AppRouter = typeof appRouter;
