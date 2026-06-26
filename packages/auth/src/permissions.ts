/**
 * Centralized permission registry — the single source of truth for which roles may call
 * which tRPC procedure. No role inheritance; no wildcard rules; super_admin always bypasses
 * at the middleware layer before this registry is consulted.
 *
 * Shape: PERMISSIONS[routerMountKey][procedureName] = Role[]
 *
 * Two intentional diffs from the pre-refactor baseline (captured in permission-snapshot.json):
 *   1. classBatch.create + schedule.addSlot + schedule.generateSessions: quan_ly-only → add head_teacher
 *   2. crm.opportunityList + crm.opportunityCreate: CRM roles → also add ctv_mkt (O1 read/create only)
 *
 * All other procedures must match the snapshot exactly; the parity test enforces this.
 */

import { Role } from '@cmc/db';

export const PERMISSIONS: Record<string, Record<string, Role[]>> = {
  assessment: {
    template: [Role.giao_vien, Role.head_teacher, Role.quan_ly],
    termList: [Role.giao_vien, Role.head_teacher, Role.quan_ly],
    termCreate: [Role.head_teacher, Role.quan_ly],
    termUpdate: [Role.head_teacher, Role.quan_ly],
    upsertQualitative: [Role.giao_vien, Role.head_teacher, Role.quan_ly],
    computeFinalGrade: [Role.giao_vien, Role.head_teacher, Role.quan_ly],
  },

  afterSale: {
    list: [Role.cskh, Role.quan_ly],
    create: [Role.cskh, Role.quan_ly],
    transition: [Role.cskh, Role.quan_ly],
    assign: [Role.cskh, Role.quan_ly],
    setStudentLifecycle: [Role.quan_ly],
  },

  attendance: {
    mark: [Role.giao_vien, Role.quan_ly],
  },

  course: {
    create: [Role.quan_ly],
    archive: [Role.quan_ly],
  },

  badge: {
    list: [Role.quan_ly, Role.head_teacher, Role.giao_vien],
    create: [Role.quan_ly],
    archive: [Role.quan_ly],
    grant: [Role.giao_vien, Role.head_teacher, Role.quan_ly],
  },

  // Diff 1a: head_teacher added to classBatch.create so they can open a class
  // without escalating to quan_ly. setStatus/cancel/reopen remain quan_ly-only
  // (those affect financial commitments and student enrollment records).
  classBatch: {
    create: [Role.quan_ly, Role.head_teacher],
    setStatus: [Role.quan_ly],
    cancel: [Role.quan_ly],
    reopen: [Role.quan_ly],
  },

  dashboard: {
    summary: [Role.bgd, Role.quan_ly],
  },

  exercise: {
    create: [Role.giao_vien, Role.quan_ly],
    publish: [Role.giao_vien, Role.quan_ly],
  },

  // compensation.list / defaults / create are super_admin-only (enforced via superAdminProcedure,
  // not requirePermission). They appear here for a complete audit map; the parity test verifies them.
  compensation: {
    list: [Role.super_admin],
    effective: [Role.hr, Role.ke_toan],
    defaults: [Role.super_admin],
    create: [Role.super_admin],
  },

  // Diff 2: ctv_mkt gets O1 read (opportunityList) and O1 create (opportunityCreate) only.
  // All other CRM procedures remain sale/cskh/quan_ly — ctv_mkt cannot transition, mark lost,
  // reopen, or manage tests. contactList/contactCreate stay at CRM_ROLES (no ctv_mkt there).
  crm: {
    contactList: [Role.sale, Role.cskh, Role.quan_ly],
    contactCreate: [Role.sale, Role.cskh, Role.quan_ly],
    opportunityList: [Role.sale, Role.cskh, Role.quan_ly, Role.ctv_mkt],
    opportunityCreate: [Role.sale, Role.cskh, Role.quan_ly, Role.ctv_mkt],
    opportunityTransition: [Role.sale, Role.cskh, Role.quan_ly],
    opportunityMarkLost: [Role.sale, Role.cskh, Role.quan_ly],
    opportunityReopen: [Role.sale, Role.cskh, Role.quan_ly],
    testList: [Role.sale, Role.cskh, Role.quan_ly],
    testCreate: [Role.sale, Role.cskh, Role.quan_ly],
    testGrade: [Role.giao_vien, Role.head_teacher, Role.quan_ly],
  },

  enrollment: {
    enroll: [Role.quan_ly, Role.sale],
    complete: [Role.quan_ly],
  },

  // facility.update / facility.create are super_admin-only (enforced via superAdminProcedure).
  facility: {
    update: [Role.super_admin],
    create: [Role.super_admin],
  },

  finance: {
    priceCreate: [Role.quan_ly, Role.ke_toan],
    priceList: [Role.quan_ly, Role.ke_toan],
    voucherCreate: [Role.quan_ly, Role.ke_toan],
    voucherList: [Role.quan_ly, Role.ke_toan],
    receiptList: [Role.ke_toan, Role.quan_ly],
    receiptCreate: [Role.ke_toan, Role.quan_ly],
    receiptApprove: [Role.ke_toan, Role.quan_ly],
    receiptMarkSent: [Role.ke_toan, Role.quan_ly],
    receiptReconcile: [Role.ke_toan, Role.quan_ly],
    receiptCancel: [Role.ke_toan, Role.quan_ly],
  },

  certificate: {
    list: [Role.head_teacher, Role.quan_ly, Role.giao_vien],
    issue: [Role.head_teacher, Role.quan_ly],
  },

  grade: {
    grade: [Role.giao_vien, Role.quan_ly],
    publish: [Role.giao_vien, Role.quan_ly],
  },

  levelProgress: {
    propose: [Role.giao_vien, Role.head_teacher, Role.quan_ly],
    listPending: [Role.head_teacher, Role.quan_ly],
    decide: [Role.head_teacher],
  },

  guardian: {
    parentList: [Role.bgd, Role.quan_ly],
    parentCreate: [Role.bgd, Role.quan_ly],
    listForStudent: [Role.bgd, Role.quan_ly],
    link: [Role.bgd, Role.quan_ly],
    unlink: [Role.bgd, Role.quan_ly],
  },

  // parentMeeting.runReminders / runCadence are super_admin-only (superAdminProcedure).
  parentMeeting: {
    setStatus: [Role.giao_vien, Role.head_teacher, Role.quan_ly],
    setSchedule: [Role.giao_vien, Role.head_teacher, Role.quan_ly],
    runReminders: [Role.super_admin],
    runCadence: [Role.super_admin],
  },

  payroll: {
    roster: [Role.hr, Role.ke_toan],
    profileUpsert: [Role.hr, Role.ke_toan],
    profileList: [Role.hr, Role.ke_toan],
    rateCreate: [Role.hr, Role.ke_toan],
    rateList: [Role.hr, Role.ke_toan],
    commissionForSale: [Role.hr, Role.ke_toan],
    payslipCompute: [Role.hr, Role.ke_toan],
    payslipList: [Role.hr, Role.ke_toan],
    payslipFinalize: [Role.hr, Role.ke_toan],
    payslipMarkPaid: [Role.hr, Role.ke_toan],
    payslipPeriodSummary: [Role.hr, Role.ke_toan],
    payslipBulkMarkPaid: [Role.hr, Role.ke_toan],
    listByStaff: [Role.hr, Role.ke_toan],
    payslipBulkPay: [Role.hr, Role.ke_toan],
    payslipReopen: [Role.hr, Role.ke_toan],
    kpiEvalStart: [Role.hr, Role.ke_toan],
    kpiEvalConfirm: [Role.quan_ly, Role.bgd],
    kpiEvalApprove: [Role.bgd],
    kpiEvalGet: [Role.hr, Role.ke_toan],
    kpiList: [Role.hr, Role.ke_toan],
    kpiAutoPrefill: [Role.hr, Role.ke_toan],
    kpiSetAuto: [Role.hr, Role.ke_toan],
    syncCallMetrics: [Role.hr, Role.ke_toan],
  },

  rewards: {
    giftCreate: [Role.quan_ly],
    review: [Role.quan_ly],
  },

  room: {
    create: [Role.quan_ly],
    update: [Role.quan_ly],
    archive: [Role.quan_ly],
  },

  // Diff 1b: head_teacher added to schedule write actions (addSlot + generateSessions)
  // so they can build class timetables without needing quan_ly access. listSlots / listSessions /
  // mySessions remain protectedProcedure (any staff) — no change there.
  schedule: {
    addSlot: [Role.quan_ly, Role.head_teacher],
    generateSessions: [Role.quan_ly, Role.head_teacher],
  },

  student: {
    create: [Role.quan_ly, Role.sale],
    update: [Role.quan_ly, Role.sale],
  },

  submission: {
    listByExercise: [Role.giao_vien, Role.quan_ly],
    layerForGrading: [Role.giao_vien, Role.quan_ly],
  },

  // user.list / create / setRoles / setFacilities / setActive are super_admin-only (superAdminProcedure).
  user: {
    list: [Role.super_admin],
    listTeachers: [Role.quan_ly],
    create: [Role.super_admin],
    setRoles: [Role.super_admin],
    setFacilities: [Role.super_admin],
    setActive: [Role.super_admin],
  },
};

/**
 * Check whether a staff member with the given roles may perform module.action.
 * super_admin bypasses all role checks — call with isSuperAdmin=true when the session has that flag.
 * Returns false for unknown module/action combinations (fail-closed).
 */
export function can(
  roles: Role[],
  isSuperAdmin: boolean,
  module: string,
  action: string,
): boolean {
  if (isSuperAdmin) return true;
  const allowed = PERMISSIONS[module]?.[action];
  if (!allowed || allowed.length === 0) return false;
  return allowed.some((r) => roles.includes(r));
}
