import { router, publicProcedure } from '../trpc.js';
import { authRouter } from './auth.js';
import { facilityRouter } from './facility.js';
import { userRouter } from './user.js';
import { courseRouter } from './course.js';
import { curriculumRouter } from './curriculum.js';
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
import { crmRouter } from './crm.js';
import { guardianRouter } from './guardian.js';
import { dashboardRouter } from './dashboard.js';
import { afterSaleRouter } from './aftersale.js';
import { certificateRouter } from './certificate.js';
import { payrollRouter } from './payroll.js';
import { parentMeetingRouter } from './parent-meeting.js';
import { compensationRouter } from './compensation.js';
import { staffNotifRouter } from './staff-notif.js';
import { sessionEvidenceRouter } from './session-evidence.js';
import { shiftConfigRouter } from './shift-config.js';
import { shiftRegistrationRouter } from './shift-registration.js';
import { checkInOutRouter } from './check-in-out.js';
import { facilityNetworkRouter } from './facility-ip.js';
import { emailRouter } from './email.js';

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, ts: new Date().toISOString() })),
  auth: authRouter,
  lmsAuth: lmsAuthRouter,
  facility: facilityRouter,
  user: userRouter,
  course: courseRouter,
  curriculum: curriculumRouter,
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
  crm: crmRouter,
  guardian: guardianRouter,
  dashboard: dashboardRouter,
  afterSale: afterSaleRouter,
  certificate: certificateRouter,
  payroll: payrollRouter,
  parentMeeting: parentMeetingRouter,
  compensation: compensationRouter,
  staffNotif: staffNotifRouter,
  sessionEvidence: sessionEvidenceRouter,
  shiftConfig: shiftConfigRouter,
  shiftRegistration: shiftRegistrationRouter,
  checkInOut: checkInOutRouter,
  facilityNetwork: facilityNetworkRouter,
  email: emailRouter,
});

export type AppRouter = typeof appRouter;
