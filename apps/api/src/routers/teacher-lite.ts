import { router, requirePermission } from '../trpc.js';
import {
  createTeacherLiteDirectProvisioningInput,
  createTeacherLiteFamilyStudentAndEnroll,
} from '../services/teacher-lite-direct-provisioning.js';
import {
  cancelTeacherLiteClass,
  cancelTeacherLiteClassInput,
  cancelTeacherLiteSession,
  cancelTeacherLiteSessionInput,
  createTeacherLiteClass,
  createTeacherLiteClassInput,
} from '../services/teacher-lite-class-workflows.js';
import {
  teacherLiteOverviewStats,
  teacherLiteOverviewStatsInput,
  teacherLiteStudentArchive,
  teacherLiteStudentArchiveInput,
} from '../services/teacher-lite-crud.js';
import {
  enrollExistingStudentInput,
  teacherLiteEnrollExistingStudent,
} from '../services/teacher-lite-enroll-existing.js';

export const teacherLiteRouter = router({
  createFamilyStudentAndEnroll: requirePermission('teacherLite', 'createFamilyStudentAndEnroll')
    .input(createTeacherLiteDirectProvisioningInput)
    .mutation(({ ctx, input }) => createTeacherLiteFamilyStudentAndEnroll(ctx.session, input)),
  createClass: requirePermission('teacherLite', 'createClass')
    .input(createTeacherLiteClassInput)
    .mutation(({ ctx, input }) => createTeacherLiteClass(ctx.session, input)),
  cancelClass: requirePermission('teacherLite', 'cancelClass')
    .input(cancelTeacherLiteClassInput)
    .mutation(({ ctx, input }) => cancelTeacherLiteClass(ctx.session, input)),
  cancelSession: requirePermission('teacherLite', 'cancelSession')
    .input(cancelTeacherLiteSessionInput)
    .mutation(({ ctx, input }) => cancelTeacherLiteSession(ctx.session, input)),
  studentArchive: requirePermission('teacherLite', 'studentArchive')
    .input(teacherLiteStudentArchiveInput)
    .mutation(({ ctx, input }) => teacherLiteStudentArchive(ctx.session, input)),
  overviewStats: requirePermission('teacherLite', 'overviewStats')
    .input(teacherLiteOverviewStatsInput)
    .query(({ ctx, input }) => teacherLiteOverviewStats(ctx.session, input)),
  enrollExistingStudent: requirePermission('teacherLite', 'enrollExistingStudent')
    .input(enrollExistingStudentInput)
    .mutation(({ ctx, input }) => teacherLiteEnrollExistingStudent(ctx.session, input)),
});
