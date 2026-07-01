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
    template: ['giao_vien', 'giam_doc_dao_tao'],
    termList: ['giao_vien', 'giam_doc_dao_tao'],
    termCreate: ['giam_doc_dao_tao'],
    termUpdate: ['giam_doc_dao_tao'],
    termLock: ['giam_doc_dao_tao'],
    termUnlock: ['giam_doc_dao_tao'],
    upsertQualitative: ['giao_vien', 'giam_doc_dao_tao'],
    computeFinalGrade: ['giao_vien', 'giam_doc_dao_tao'],
  },

  // Business Director oversees CSKH team; write access (create/transition/assign) lets
  // them step in or reassign cases. setStudentLifecycle moves to giam_doc_kinh_doanh
  // (quan_ly removed — this is the sole financial-lifecycle owner now).
  afterSale: {
    list: ['cskh', 'giam_doc_kinh_doanh'],
    create: ['cskh', 'giam_doc_kinh_doanh'],
    transition: ['cskh', 'giam_doc_kinh_doanh'],
    assign: ['cskh', 'giam_doc_kinh_doanh'],
    setStudentLifecycle: ['giam_doc_kinh_doanh'],
  },

  attendance: {
    mark: ['giao_vien', 'giam_doc_dao_tao'],
  },

  // Education Director owns curriculum; course.create/archive moved off quan_ly-only.
  course: {
    create: ['giam_doc_dao_tao'],
    archive: ['giam_doc_dao_tao'],
  },

  badge: {
    list: ['giao_vien', 'giam_doc_dao_tao'],
    create: ['giam_doc_dao_tao'],
    archive: ['giam_doc_dao_tao'],
    grant: ['giao_vien', 'giam_doc_dao_tao'],
  },

  // Education Director can open/close classes and manage their lifecycle.
  classBatch: {
    create: ['giam_doc_dao_tao'],
    setStatus: ['giam_doc_dao_tao'],
    cancel: ['giam_doc_dao_tao'],
    reopen: ['giam_doc_dao_tao'],
  },

  dashboard: {
    summary: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  },

  exercise: {
    create: ['giao_vien', 'giam_doc_dao_tao'],
    publish: ['giao_vien', 'giam_doc_dao_tao'],
  },

  sessionEvidence: {
    commentTemplate: ['giao_vien', 'giam_doc_dao_tao'],
    listByClass: ['giao_vien', 'giam_doc_dao_tao'],
    detailForStaff: ['giao_vien', 'giam_doc_dao_tao'],
    upsertDraft: ['giao_vien', 'giam_doc_dao_tao'],
    publish: ['giao_vien', 'giam_doc_dao_tao'],
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
  // testGrade moves to teaching-only + giam_doc_dao_tao oversight (no KD director in the classroom).
  crm: {
    contactList: ['sale', 'cskh', 'giam_doc_kinh_doanh'],
    contactCreate: ['sale', 'cskh', 'giam_doc_kinh_doanh'],
    opportunityList: ['sale', 'cskh', 'ctv_mkt', 'giam_doc_kinh_doanh'],
    opportunityGet: ['sale', 'cskh', 'ctv_mkt', 'giam_doc_kinh_doanh'],
    // Owner picker / name resolution: anyone who can view the pipeline can read the staff list.
    assignableOwners: ['sale', 'cskh', 'ctv_mkt', 'giam_doc_kinh_doanh'],
    opportunityCreate: ['sale', 'cskh', 'ctv_mkt', 'giam_doc_kinh_doanh'],
    opportunityTransition: ['sale', 'cskh', 'giam_doc_kinh_doanh'],
    opportunityMarkLost: ['sale', 'cskh', 'giam_doc_kinh_doanh'],
    opportunityReopen: ['sale', 'cskh', 'giam_doc_kinh_doanh'],
    // Đổi người phụ trách là hành vi quản lý → giám đốc KD (quan_ly removed).
    opportunityReassign: ['giam_doc_kinh_doanh'],
    assignmentHistory: ['sale', 'cskh', 'ctv_mkt', 'giam_doc_kinh_doanh'],
    testList: ['sale', 'cskh', 'giam_doc_kinh_doanh'],
    testCreate: ['sale', 'cskh', 'giam_doc_kinh_doanh'],
    testGrade: ['giao_vien', 'giam_doc_dao_tao'],
  },

  enrollment: {
    enroll: ['sale', 'giam_doc_kinh_doanh'],
    complete: ['giam_doc_dao_tao'],
  },

  // facility.update / facility.create are super_admin-only (enforced via superAdminProcedure).
  facility: {
    update: ['super_admin'],
    create: ['super_admin'],
  },

  // Business Director now also holds write access on pricing/vouchers/receipts (quan_ly removed —
  // KD director is the compensating oversight for finance write actions previously dual-owned by
  // quan_ly + ke_toan). Accepted trade-off at <10-person scale (see plan brainstorm report).
  finance: {
    priceCreate: ['ke_toan', 'giam_doc_kinh_doanh'],
    priceList: ['ke_toan', 'giam_doc_kinh_doanh'],
    voucherCreate: ['ke_toan', 'giam_doc_kinh_doanh'],
    voucherList: ['ke_toan', 'giam_doc_kinh_doanh'],
    receiptList: ['ke_toan', 'giam_doc_kinh_doanh'],
    receiptCreate: ['ke_toan', 'giam_doc_kinh_doanh'],
    receiptApprove: ['ke_toan', 'giam_doc_kinh_doanh'],
    receiptMarkSent: ['ke_toan', 'giam_doc_kinh_doanh'],
    receiptReconcile: ['ke_toan', 'giam_doc_kinh_doanh'],
    receiptCancel: ['ke_toan', 'giam_doc_kinh_doanh'],
  },

  certificate: {
    list: ['giao_vien', 'giam_doc_dao_tao'],
    issue: ['giam_doc_dao_tao'],
  },

  grade: {
    grade: ['giao_vien', 'giam_doc_dao_tao'],
    publish: ['giao_vien', 'giam_doc_dao_tao'],
  },

  levelProgress: {
    propose: ['giao_vien', 'giam_doc_dao_tao'],
    listPending: ['giam_doc_dao_tao'],
    decide: ['giam_doc_dao_tao'],
  },

  // Guardian/parent management moves to both directors (bgd + quan_ly removed).
  guardian: {
    parentList: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    parentCreate: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    listForStudent: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    link: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    unlink: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  },

  // parentMeeting.runReminders / runCadence are super_admin-only (superAdminProcedure).
  parentMeeting: {
    setStatus: ['giao_vien', 'giam_doc_dao_tao'],
    setSchedule: ['giao_vien', 'giam_doc_dao_tao'],
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
    // KPI authority in the 3-heads org: the two directors are the executive board. They confirm
    // and approve KPI (legacy 'bgd'/'quan_ly' removed — the two directors are the only confirm/
    // approve authority now), and can load the KPI panel (kpiList/kpiEvalGet). Separation of
    // duties still holds — kpiEvalApprove blocks the person who confirmed, so a director cannot
    // both confirm and approve the same sheet. Data prep (start/autoPrefill/setAuto) stays with
    // hr/ke_toan.
    kpiEvalStart: ['hr', 'ke_toan'],
    kpiEvalConfirm: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    kpiEvalApprove: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    kpiEvalGet: ['hr', 'ke_toan', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    kpiList: ['hr', 'ke_toan', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    kpiAutoPrefill: ['hr', 'ke_toan'],
    kpiSetAuto: ['hr', 'ke_toan'],
    syncCallMetrics: ['hr', 'ke_toan'],
  },

  rewards: {
    giftCreate: ['giam_doc_kinh_doanh'],
    review: ['giam_doc_kinh_doanh'],
  },

  room: {
    create: ['giam_doc_dao_tao'],
    update: ['giam_doc_dao_tao'],
    archive: ['giam_doc_dao_tao'],
  },

  schedule: {
    addSlot: ['giam_doc_dao_tao'],
    generateSessions: ['giam_doc_dao_tao'],
  },

  student: {
    // student.create is gated to superAdminProcedure (break-glass only); not in registry.
    // Normal students are created atomically at receipt.approve.
    update: ['sale', 'giam_doc_kinh_doanh'],
    // LMS password reset: both directors (account-level action with security impact).
    resetLmsPassword: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  },

  submission: {
    listByExercise: ['giao_vien', 'giam_doc_dao_tao'],
    layerForGrading: ['giao_vien', 'giam_doc_dao_tao'],
  },

  // user.list / create are delegated to directors as well as super_admin (delegated-create guard
  // in user.ts enforces role-scope + facility-scope at the app layer before the elevated RLS
  // write, because app_user INSERT WITH CHECK is super-admin-only at the DB layer).
  // setRoles / setFacilities / setActive remain super_admin-only for F0 (superAdminProcedure).
  user: {
    list: ['super_admin', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    listTeachers: ['giam_doc_dao_tao'],
    // Narrowly-scoped picker for the CSKH assign dropdown: returns only active cskh staff
    // within the caller's facility. Gated to roles that can also call afterSale.assign
    // so the dropdown never appears for roles that cannot perform the assignment.
    listAssignableForAfterSale: ['cskh', 'giam_doc_kinh_doanh'],
    create: ['super_admin', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    setRoles: ['super_admin'],
    setFacilities: ['super_admin'],
    setActive: ['super_admin'],
    // Read a staff member's audit activity (role/facility/status history). super_admin bypasses.
    // HR + the two directors may view; the endpoint additionally requires the caller to share a
    // facility with the target (record_event for `user` is facility_id NULL, so RLS can't scope it).
    viewActivity: ['hr', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  },

  // ── Work Shift & Attendance ──────────────────────────────────────────────
  shiftRegistration: {
    list: ['giao_vien', 'sale', 'cskh', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao', 'hr'],
    get: ['giao_vien', 'sale', 'cskh', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao', 'hr'],
    create: ['giao_vien', 'sale', 'cskh'],
    updateEntry: ['giao_vien', 'sale', 'cskh'],
    submit: ['giao_vien', 'sale', 'cskh'],
    withdraw: ['giao_vien', 'sale', 'cskh'],
    approve: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    reject: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    registeredInMonth: ['giao_vien', 'sale', 'cskh', 'hr'],
  },

  shiftConfig: {
    list: ['giao_vien', 'sale', 'cskh', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    create: ['super_admin'],
    update: ['super_admin'],
    archive: ['super_admin'],
    createTemplate: ['super_admin'],
  },

  checkInOut: {
    punch: ['giao_vien', 'sale', 'cskh'],
    todayStatus: ['giao_vien', 'sale', 'cskh'],
    history: ['giao_vien', 'sale', 'cskh', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao', 'hr'],
    monthlyReport: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao', 'hr', 'ke_toan'],
    pendingManual: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    approveManual: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  },

  facilityNetwork: {
    list: ['super_admin', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    create: ['super_admin', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    delete: ['super_admin', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  },
};

/**
 * Roles each director may assign when creating team members.
 * super_admin has no entry here — they bypass all scope checks.
 * A director can never appear in their own or another director's grant set, so they cannot
 * elevate an account to director or super_admin level.
 */
export const DIRECTOR_ROLE_GRANTS: Partial<Record<string, string[]>> = {
  giam_doc_kinh_doanh: ['sale', 'cskh', 'ctv_mkt', 'ke_toan', 'hr'],
  giam_doc_dao_tao: ['giao_vien'],
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
