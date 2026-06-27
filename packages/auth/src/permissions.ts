/**
 * Centralized permission registry — the single source of truth for which roles may call
 * which tRPC procedure. No role inheritance; no wildcard rules; super_admin always bypasses
 * at the middleware layer before this registry is consulted.
 *
 * Shape: PERMISSIONS[routerMountKey][procedureName] = string[]
 *
 * NOTE: No Prisma / @cmc/db runtime import here. Role values are plain string literals so
 * this module can be safely bundled for the browser via the @cmc/auth/permissions subpath.
 * The parity test (apps/api/test/permission-parity.test.ts) catches any value-level drift.
 */

export const PERMISSIONS: Record<string, Record<string, string[]>> = {
  assessment: {
    template: ['giao_vien', 'head_teacher', 'quan_ly', 'giam_doc_dao_tao'],
    termList: ['giao_vien', 'head_teacher', 'quan_ly', 'giam_doc_dao_tao'],
    termCreate: ['head_teacher', 'quan_ly', 'giam_doc_dao_tao'],
    termUpdate: ['head_teacher', 'quan_ly', 'giam_doc_dao_tao'],
    termLock: ['head_teacher', 'quan_ly', 'giam_doc_dao_tao'],
    termUnlock: ['head_teacher', 'quan_ly', 'giam_doc_dao_tao'],
    upsertQualitative: ['giao_vien', 'head_teacher', 'quan_ly', 'giam_doc_dao_tao'],
    computeFinalGrade: ['giao_vien', 'head_teacher', 'quan_ly', 'giam_doc_dao_tao'],
  },

  // Business Director oversees CSKH team; write access (create/transition/assign) lets
  // them step in or reassign cases. setStudentLifecycle remains quan_ly-only (financial impact).
  afterSale: {
    list: ['cskh', 'quan_ly', 'giam_doc_kinh_doanh'],
    create: ['cskh', 'quan_ly', 'giam_doc_kinh_doanh'],
    transition: ['cskh', 'quan_ly', 'giam_doc_kinh_doanh'],
    assign: ['cskh', 'quan_ly', 'giam_doc_kinh_doanh'],
    setStudentLifecycle: ['quan_ly'],
  },

  attendance: {
    mark: ['giao_vien', 'quan_ly', 'giam_doc_dao_tao'],
  },

  // Education Director owns curriculum; course.create/archive moved off quan_ly-only.
  course: {
    create: ['quan_ly', 'giam_doc_dao_tao'],
    archive: ['quan_ly', 'giam_doc_dao_tao'],
  },

  badge: {
    list: ['quan_ly', 'head_teacher', 'giao_vien'],
    create: ['quan_ly'],
    archive: ['quan_ly'],
    grant: ['giao_vien', 'head_teacher', 'quan_ly'],
  },

  // Education Director can open/close classes and manage their lifecycle.
  classBatch: {
    create: ['quan_ly', 'head_teacher', 'giam_doc_dao_tao'],
    setStatus: ['quan_ly', 'giam_doc_dao_tao'],
    cancel: ['quan_ly', 'giam_doc_dao_tao'],
    reopen: ['quan_ly', 'giam_doc_dao_tao'],
  },

  dashboard: {
    summary: ['bgd', 'quan_ly', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  },

  exercise: {
    create: ['giao_vien', 'quan_ly'],
    publish: ['giao_vien', 'quan_ly'],
  },

  // compensation.list / defaults / create are super_admin-only (enforced via superAdminProcedure,
  // not requirePermission). They appear here for a complete audit map.
  compensation: {
    list: ['super_admin'],
    effective: ['hr', 'ke_toan'],
    defaults: ['super_admin'],
    create: ['super_admin'],
  },

  // Business Director runs the KD team; full CRM access so they can work or oversee deals.
  // testGrade stays with teaching roles only (no KD director in the classroom).
  crm: {
    contactList: ['sale', 'cskh', 'quan_ly', 'giam_doc_kinh_doanh'],
    contactCreate: ['sale', 'cskh', 'quan_ly', 'giam_doc_kinh_doanh'],
    opportunityList: ['sale', 'cskh', 'quan_ly', 'ctv_mkt', 'giam_doc_kinh_doanh'],
    opportunityCreate: ['sale', 'cskh', 'quan_ly', 'ctv_mkt', 'giam_doc_kinh_doanh'],
    opportunityTransition: ['sale', 'cskh', 'quan_ly', 'giam_doc_kinh_doanh'],
    opportunityMarkLost: ['sale', 'cskh', 'quan_ly', 'giam_doc_kinh_doanh'],
    opportunityReopen: ['sale', 'cskh', 'quan_ly', 'giam_doc_kinh_doanh'],
    testList: ['sale', 'cskh', 'quan_ly', 'giam_doc_kinh_doanh'],
    testCreate: ['sale', 'cskh', 'quan_ly', 'giam_doc_kinh_doanh'],
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

  // Business Director has read access to finance (revenue visibility). Write actions
  // (create / approve / reconcile / cancel) stay with ke_toan / quan_ly.
  finance: {
    priceCreate: ['quan_ly', 'ke_toan'],
    priceList: ['quan_ly', 'ke_toan', 'giam_doc_kinh_doanh'],
    voucherCreate: ['quan_ly', 'ke_toan'],
    voucherList: ['quan_ly', 'ke_toan', 'giam_doc_kinh_doanh'],
    receiptList: ['ke_toan', 'quan_ly', 'giam_doc_kinh_doanh'],
    receiptCreate: ['ke_toan', 'quan_ly'],
    receiptApprove: ['ke_toan', 'quan_ly'],
    receiptMarkSent: ['ke_toan', 'quan_ly'],
    receiptReconcile: ['ke_toan', 'quan_ly'],
    receiptCancel: ['ke_toan', 'quan_ly'],
  },

  certificate: {
    list: ['head_teacher', 'quan_ly', 'giao_vien', 'giam_doc_dao_tao'],
    issue: ['head_teacher', 'quan_ly', 'giam_doc_dao_tao'],
  },

  grade: {
    grade: ['giao_vien', 'quan_ly', 'giam_doc_dao_tao'],
    publish: ['giao_vien', 'quan_ly', 'giam_doc_dao_tao'],
  },

  levelProgress: {
    propose: ['giao_vien', 'head_teacher', 'quan_ly', 'giam_doc_dao_tao'],
    listPending: ['head_teacher', 'quan_ly', 'giam_doc_dao_tao'],
    decide: ['head_teacher', 'giam_doc_dao_tao'],
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
    setStatus: ['giao_vien', 'head_teacher', 'quan_ly', 'giam_doc_dao_tao'],
    setSchedule: ['giao_vien', 'head_teacher', 'quan_ly', 'giam_doc_dao_tao'],
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
    giftCreate: ['quan_ly', 'giam_doc_kinh_doanh'],
    review: ['quan_ly', 'giam_doc_kinh_doanh'],
  },

  room: {
    create: ['quan_ly'],
    update: ['quan_ly'],
    archive: ['quan_ly'],
  },

  schedule: {
    addSlot: ['quan_ly', 'head_teacher', 'giam_doc_dao_tao'],
    generateSessions: ['quan_ly', 'head_teacher', 'giam_doc_dao_tao'],
  },

  student: {
    // student.create is gated to superAdminProcedure (break-glass only); not in registry.
    // Normal students are created atomically at receipt.approve.
    update: ['quan_ly', 'sale'],
    // LMS password reset: operations manager and both directors (account-level action with security impact).
    resetLmsPassword: ['quan_ly', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  },

  submission: {
    listByExercise: ['giao_vien', 'quan_ly'],
    layerForGrading: ['giao_vien', 'quan_ly'],
  },

  // user.list / create are delegated to directors as well as super_admin (delegated-create guard
  // in user.ts enforces role-scope + facility-scope at the app layer before the elevated RLS
  // write, because app_user INSERT WITH CHECK is super-admin-only at the DB layer).
  // setRoles / setFacilities / setActive remain super_admin-only for F0 (superAdminProcedure).
  user: {
    list: ['super_admin', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    listTeachers: ['quan_ly', 'giam_doc_dao_tao'],
    create: ['super_admin', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    setRoles: ['super_admin'],
    setFacilities: ['super_admin'],
    setActive: ['super_admin'],
  },
};

/**
 * Roles each director may assign when creating team members.
 * super_admin has no entry here — they bypass all scope checks.
 * A director can never appear in their own or another director's grant set, so they cannot
 * elevate an account to director or super_admin level.
 */
export const DIRECTOR_ROLE_GRANTS: Partial<Record<string, string[]>> = {
  giam_doc_kinh_doanh: ['sale', 'cskh', 'ctv_mkt'],
  giam_doc_dao_tao: ['giao_vien', 'head_teacher'],
};

/**
 * Return the set of roles the given session may assign to a new user.
 * super_admin → all roles. Director → their grant set. Others → empty.
 * Uses string[] so this is safe to call from browser bundles (no Prisma types needed).
 */
export function assignableRoles(session: { isSuperAdmin: boolean; roles: string[] }): Set<string> {
  if (session.isSuperAdmin) {
    // Collect every role mentioned in the registry; this is the widest possible set.
    const all = new Set<string>();
    for (const actions of Object.values(PERMISSIONS)) {
      for (const roles of Object.values(actions)) {
        for (const r of roles) all.add(r);
      }
    }
    // Also add the two director roles (they appear as keys but may not appear as values).
    for (const k of Object.keys(DIRECTOR_ROLE_GRANTS)) all.add(k);
    all.add('super_admin');
    return all;
  }
  const out = new Set<string>();
  for (const r of session.roles) {
    for (const g of DIRECTOR_ROLE_GRANTS[r] ?? []) out.add(g);
  }
  return out;
}

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
