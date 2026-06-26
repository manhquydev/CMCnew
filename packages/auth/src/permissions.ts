/**
 * Centralized permission registry — the single source of truth for which roles may call
 * which tRPC procedure. No role inheritance; no wildcard rules; super_admin always bypasses
 * at the middleware layer before this registry is consulted.
 *
 * Shape: PERMISSIONS[routerMountKey][procedureName] = string[]
 *
 * Two intentional diffs from the pre-refactor baseline (captured in permission-snapshot.json):
 *   1. classBatch.create + schedule.addSlot + schedule.generateSessions: quan_ly-only → add head_teacher
 *   2. crm.opportunityList + crm.opportunityCreate: CRM roles → also add ctv_mkt (O1 read/create only)
 *
 * All other procedures must match the snapshot exactly; the parity test enforces this.
 *
 * NOTE: No Prisma / @cmc/db runtime import here. Role values are plain string literals so
 * this module can be safely bundled for the browser via the @cmc/auth/permissions subpath.
 * The parity test (apps/api/test/permission-parity.test.ts) catches any value-level drift.
 */

export const PERMISSIONS: Record<string, Record<string, string[]>> = {
  assessment: {
    template: ['giao_vien', 'head_teacher', 'quan_ly'],
    termList: ['giao_vien', 'head_teacher', 'quan_ly'],
    termCreate: ['head_teacher', 'quan_ly'],
    termUpdate: ['head_teacher', 'quan_ly'],
    upsertQualitative: ['giao_vien', 'head_teacher', 'quan_ly'],
    computeFinalGrade: ['giao_vien', 'head_teacher', 'quan_ly'],
  },

  afterSale: {
    list: ['cskh', 'quan_ly'],
    create: ['cskh', 'quan_ly'],
    transition: ['cskh', 'quan_ly'],
    assign: ['cskh', 'quan_ly'],
    setStudentLifecycle: ['quan_ly'],
  },

  attendance: {
    mark: ['giao_vien', 'quan_ly'],
  },

  course: {
    create: ['quan_ly'],
    archive: ['quan_ly'],
  },

  badge: {
    list: ['quan_ly', 'head_teacher', 'giao_vien'],
    create: ['quan_ly'],
    archive: ['quan_ly'],
    grant: ['giao_vien', 'head_teacher', 'quan_ly'],
  },

  // Diff 1a: head_teacher added to classBatch.create so they can open a class
  // without escalating to quan_ly. setStatus/cancel/reopen remain quan_ly-only
  // (those affect financial commitments and student enrollment records).
  classBatch: {
    create: ['quan_ly', 'head_teacher'],
    setStatus: ['quan_ly'],
    cancel: ['quan_ly'],
    reopen: ['quan_ly'],
  },

  dashboard: {
    summary: ['bgd', 'quan_ly'],
  },

  exercise: {
    create: ['giao_vien', 'quan_ly'],
    publish: ['giao_vien', 'quan_ly'],
  },

  // compensation.list / defaults / create are super_admin-only (enforced via superAdminProcedure,
  // not requirePermission). They appear here for a complete audit map; the parity test verifies them.
  compensation: {
    list: ['super_admin'],
    effective: ['hr', 'ke_toan'],
    defaults: ['super_admin'],
    create: ['super_admin'],
  },

  // Diff 2: ctv_mkt gets O1 read (opportunityList) and O1 create (opportunityCreate) only.
  // All other CRM procedures remain sale/cskh/quan_ly — ctv_mkt cannot transition, mark lost,
  // reopen, or manage tests. contactList/contactCreate stay at CRM_ROLES (no ctv_mkt there).
  crm: {
    contactList: ['sale', 'cskh', 'quan_ly'],
    contactCreate: ['sale', 'cskh', 'quan_ly'],
    opportunityList: ['sale', 'cskh', 'quan_ly', 'ctv_mkt'],
    opportunityCreate: ['sale', 'cskh', 'quan_ly', 'ctv_mkt'],
    opportunityTransition: ['sale', 'cskh', 'quan_ly'],
    opportunityMarkLost: ['sale', 'cskh', 'quan_ly'],
    opportunityReopen: ['sale', 'cskh', 'quan_ly'],
    testList: ['sale', 'cskh', 'quan_ly'],
    testCreate: ['sale', 'cskh', 'quan_ly'],
    testGrade: ['giao_vien', 'head_teacher', 'quan_ly'],
  },

  enrollment: {
    enroll: ['quan_ly', 'sale'],
    complete: ['quan_ly'],
  },

  // facility.update / facility.create are super_admin-only (enforced via superAdminProcedure).
  facility: {
    update: ['super_admin'],
    create: ['super_admin'],
  },

  finance: {
    priceCreate: ['quan_ly', 'ke_toan'],
    priceList: ['quan_ly', 'ke_toan'],
    voucherCreate: ['quan_ly', 'ke_toan'],
    voucherList: ['quan_ly', 'ke_toan'],
    receiptList: ['ke_toan', 'quan_ly'],
    receiptCreate: ['ke_toan', 'quan_ly'],
    receiptApprove: ['ke_toan', 'quan_ly'],
    receiptMarkSent: ['ke_toan', 'quan_ly'],
    receiptReconcile: ['ke_toan', 'quan_ly'],
    receiptCancel: ['ke_toan', 'quan_ly'],
  },

  certificate: {
    list: ['head_teacher', 'quan_ly', 'giao_vien'],
    issue: ['head_teacher', 'quan_ly'],
  },

  grade: {
    grade: ['giao_vien', 'quan_ly'],
    publish: ['giao_vien', 'quan_ly'],
  },

  levelProgress: {
    propose: ['giao_vien', 'head_teacher', 'quan_ly'],
    listPending: ['head_teacher', 'quan_ly'],
    decide: ['head_teacher'],
  },

  guardian: {
    parentList: ['bgd', 'quan_ly'],
    parentCreate: ['bgd', 'quan_ly'],
    listForStudent: ['bgd', 'quan_ly'],
    link: ['bgd', 'quan_ly'],
    unlink: ['bgd', 'quan_ly'],
  },

  // parentMeeting.runReminders / runCadence are super_admin-only (superAdminProcedure).
  parentMeeting: {
    setStatus: ['giao_vien', 'head_teacher', 'quan_ly'],
    setSchedule: ['giao_vien', 'head_teacher', 'quan_ly'],
    runReminders: ['super_admin'],
    runCadence: ['super_admin'],
  },

  payroll: {
    roster: ['hr', 'ke_toan'],
    profileUpsert: ['hr', 'ke_toan'],
    profileList: ['hr', 'ke_toan'],
    rateCreate: ['hr', 'ke_toan'],
    rateList: ['hr', 'ke_toan'],
    commissionForSale: ['hr', 'ke_toan'],
    payslipCompute: ['hr', 'ke_toan'],
    payslipList: ['hr', 'ke_toan'],
    payslipFinalize: ['hr', 'ke_toan'],
    payslipMarkPaid: ['hr', 'ke_toan'],
    payslipPeriodSummary: ['hr', 'ke_toan'],
    payslipBulkMarkPaid: ['hr', 'ke_toan'],
    listByStaff: ['hr', 'ke_toan'],
    payslipBulkPay: ['hr', 'ke_toan'],
    payslipReopen: ['hr', 'ke_toan'],
    kpiEvalStart: ['hr', 'ke_toan'],
    kpiEvalConfirm: ['quan_ly', 'bgd'],
    kpiEvalApprove: ['bgd'],
    kpiEvalGet: ['hr', 'ke_toan'],
    kpiList: ['hr', 'ke_toan'],
    kpiAutoPrefill: ['hr', 'ke_toan'],
    kpiSetAuto: ['hr', 'ke_toan'],
    syncCallMetrics: ['hr', 'ke_toan'],
  },

  rewards: {
    giftCreate: ['quan_ly'],
    review: ['quan_ly'],
  },

  room: {
    create: ['quan_ly'],
    update: ['quan_ly'],
    archive: ['quan_ly'],
  },

  // Diff 1b: head_teacher added to schedule write actions (addSlot + generateSessions)
  // so they can build class timetables without needing quan_ly access. listSlots / listSessions /
  // mySessions remain protectedProcedure (any staff) — no change there.
  schedule: {
    addSlot: ['quan_ly', 'head_teacher'],
    generateSessions: ['quan_ly', 'head_teacher'],
  },

  student: {
    // student.create is gated to superAdminProcedure (break-glass only); not in registry.
    // Normal students are created atomically at receipt.approve.
    update: ['quan_ly', 'sale'],
  },

  submission: {
    listByExercise: ['giao_vien', 'quan_ly'],
    layerForGrading: ['giao_vien', 'quan_ly'],
  },

  // user.list / create / setRoles / setFacilities / setActive are super_admin-only (superAdminProcedure).
  user: {
    list: ['super_admin'],
    listTeachers: ['quan_ly'],
    create: ['super_admin'],
    setRoles: ['super_admin'],
    setFacilities: ['super_admin'],
    setActive: ['super_admin'],
  },
};

/**
 * Check whether a staff member with the given roles may perform module.action.
 * super_admin bypasses all role checks — call with isSuperAdmin=true when the session has that flag.
 * Returns false for unknown module/action combinations (fail-closed).
 *
 * Accepts string[] so this function can be called from both the backend (Role[] is assignable
 * to string[] since Role is a string union) and the browser (no Prisma type needed).
 */
export function can(
  roles: string[],
  isSuperAdmin: boolean,
  module: string,
  action: string,
): boolean {
  if (isSuperAdmin) return true;
  const allowed = PERMISSIONS[module]?.[action];
  if (!allowed || allowed.length === 0) return false;
  return allowed.some((r) => roles.includes(r));
}
