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

// Vietnamese display label per role slug — for UI surfaces that list roles to non-technical
// staff (e.g. the Cơ sở & Users table, staff-profile badges). Never display a raw role slug.
export const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Quản trị hệ thống',
  giao_vien: 'Giáo viên',
  ke_toan: 'Kế toán',
  hr: 'Nhân sự',
  sale: 'Tư vấn tuyển sinh',
  cskh: 'Chăm sóc khách hàng',
  ctv_mkt: 'Cộng tác viên Marketing',
  giam_doc_kinh_doanh: 'Giám đốc kinh doanh',
  giam_doc_dao_tao: 'Giám đốc đào tạo',
};

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
    list: ['sale', 'cskh', 'giam_doc_kinh_doanh'],
    create: ['sale', 'cskh', 'giam_doc_kinh_doanh'],
    transition: ['sale', 'cskh', 'giam_doc_kinh_doanh'],
    assign: ['sale', 'cskh', 'giam_doc_kinh_doanh'],
    setStudentLifecycle: ['giam_doc_kinh_doanh'],
  },

  attendance: {
    mark: ['giao_vien', 'giam_doc_dao_tao'],
    markAll: ['giao_vien', 'giam_doc_dao_tao'],
    report: ['giao_vien', 'giam_doc_dao_tao'],
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
    update: ['giam_doc_dao_tao'],
    setStatus: ['giam_doc_dao_tao'],
    cancel: ['giam_doc_dao_tao'],
    reopen: ['giam_doc_dao_tao'],
  },

  dashboard: {
    summary: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    // Approval-inbox aggregate — role-aware "pending my approval" list (dashboard.ts:myApprovals).
    // Same role set as summary; both directors get their own inbox contents inside the handler.
    myApprovals: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  },

  teacherLite: {
    createFamilyStudentAndEnroll: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    createClass: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    cancelClass: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    cancelSession: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    // Teacher-lite CRUD bypass (2026-07-08): soft-archive học sinh (giữ RLS + audit, không hard-delete).
    studentArchive: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    // Overview stat cards (bài chờ chấm / nhật ký chờ chốt) cho trang Hôm nay của giáo viên.
    overviewStats: ['giao_vien', 'giam_doc_dao_tao', 'giam_doc_kinh_doanh'],
  },

  exercise: {
    upsert: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
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
    // Narrow existence-check for finance-panel's new-student form (decision 0037). Mirrors
    // finance.receiptCreate's role set, NOT opportunityList's — ke_toan gets this lookup without
    // gaining the full CRM nav tab (nav-permissions.ts gates on opportunityList, not this key).
    opportunityLookup: ['ke_toan', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao', 'sale'],
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
    // Class transfer is an academic-scheduling action (moving a student between classes),
    // not a sales/enrollment action — mirrors `complete`'s education-director ownership.
    transfer: ['giam_doc_dao_tao'],
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
    // Facility-config authority: discount tiers change future receipt pricing — GĐKD-only.
    discountTierList: ['giam_doc_kinh_doanh'],
    discountTierUpsert: ['giam_doc_kinh_doanh'],
    discountTierArchive: ['giam_doc_kinh_doanh'],
    receiptList: ['ke_toan', 'giam_doc_kinh_doanh'],
    // Sale/GĐĐT create DRAFT receipts only (intake/attribution chain, decisions 0024 + 0037) —
    // receiptApprove stays ke_toan/GĐKD-only, so this is not a money-approval grant.
    receiptCreate: ['ke_toan', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao', 'sale'],
    // Narrow read: intake actors see only receipts they personally created (collectedById=self,
    // enforced server-side in finance.ts), never the full finance.receiptList/nav (decision 0024, N3).
    receiptListOwn: ['sale', 'ke_toan', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    receiptApprove: ['ke_toan', 'giam_doc_kinh_doanh'],
    receiptMarkSent: ['ke_toan', 'giam_doc_kinh_doanh'],
    receiptReconcile: ['ke_toan', 'giam_doc_kinh_doanh'],
    receiptCancel: ['ke_toan', 'giam_doc_kinh_doanh'],
    // Append-only refund ledger (decision 0028) — same write scope as receiptCancel.
    refundCreate: ['ke_toan', 'giam_doc_kinh_doanh'],
    refundList: ['ke_toan', 'giam_doc_kinh_doanh'],
    // Send an approved receipt to the payer by email — same actors who can already work the receipt.
    sendReceiptEmail: ['ke_toan', 'giam_doc_kinh_doanh'],
    // Read-only revenue report (gross/refunds/net by month/facility/course) + CSV export +
    // the "chưa đối soát kỳ này" worklist (P3) — same grantee set as the rest of finance.*.
    revenueReport: ['ke_toan', 'giam_doc_kinh_doanh'],
    reconcileWorklist: ['ke_toan', 'giam_doc_kinh_doanh'],
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
    parentUpdate: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    parentArchive: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    listForStudent: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    link: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    unlink: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    // Parent self-link request review queue (anti-takeover: approve is the only path that
    // creates a Guardian row from a parent-initiated request).
    linkRequestList: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    linkRequestReview: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    // Family-login password reset: both directors (account-level action with security impact,
    // mirrors student.resetLmsPassword).
    resetFamilyPassword: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  },

  // parentMeeting.runReminders / runCadence are super_admin-only (superAdminProcedure).
  parentMeeting: {
    setStatus: ['giao_vien', 'giam_doc_dao_tao'],
    setSchedule: ['giao_vien', 'giam_doc_dao_tao'],
    setNote: ['giao_vien', 'giam_doc_dao_tao'],
    runReminders: ['super_admin'],
    runCadence: ['super_admin'],
  },

  payroll: {
    // Payroll ownership follows the two-director org: both directors can open read surfaces, while
    // mutating procedures enforce domain-scoped targets (KD: business/support roles; DT: teachers)
    // and self-write blocks inside apps/api/src/routers/payroll.ts.
    roster: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    profileUpsert: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    profileList: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    rateCreate: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    rateList: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    commissionForSale: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    payslipCompute: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    payslipList: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    payslipFinalize: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    payslipMarkPaid: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    payslipPeriodSummary: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    payslipBulkMarkPaid: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    listByStaff: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    payslipBulkPay: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    payslipReopen: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    payslipOverrideAttendanceDeduction: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    kpiEvalStart: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    kpiEvalConfirm: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    kpiEvalApprove: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    kpiEvalGet: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    kpiList: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    kpiAutoPrefill: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    kpiSetAuto: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    syncCallMetrics: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  },

  rewards: {
    giftCreate: ['giam_doc_kinh_doanh'],
    review: ['giam_doc_kinh_doanh'],
    giftUpdate: ['giam_doc_kinh_doanh'],
    giftArchive: ['giam_doc_kinh_doanh'],
    stockAdjust: ['giam_doc_kinh_doanh'],
    starAdjust: ['giam_doc_kinh_doanh'],
    markDelivered: ['giam_doc_kinh_doanh'],
  },

  room: {
    create: ['giam_doc_dao_tao'],
    update: ['giam_doc_dao_tao'],
    archive: ['giam_doc_dao_tao'],
  },

  schedule: {
    addSlot: ['giam_doc_dao_tao'],
    generateSessions: ['giam_doc_dao_tao'],
    editSlot: ['giam_doc_dao_tao'],
    removeSlot: ['giam_doc_dao_tao'],
    createMakeupSession: ['giam_doc_dao_tao'],
  },

  student: {
    // student.create is gated to superAdminProcedure (break-glass only); not in registry.
    // Normal students are created atomically at receipt.approve.
    // giam_doc_dao_tao added (2026-07-08, user-approved) so GĐĐT can edit students on teacher-lite.
    update: ['sale', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
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
    listAssignableForAfterSale: ['sale', 'cskh', 'giam_doc_kinh_doanh'],
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
    updateDates: ['giao_vien', 'sale', 'cskh'],
    submit: ['giao_vien', 'sale', 'cskh'],
    withdraw: ['giao_vien', 'sale', 'cskh'],
    approve: ['giao_vien', 'sale', 'cskh', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    reject: ['giao_vien', 'sale', 'cskh', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
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
    rejectManual: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  },

  facilityNetwork: {
    list: ['super_admin', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    create: ['super_admin', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
    delete: ['super_admin', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  },

  // Outbox admin surface (email ops). GĐKD-only in v1 (YAGNI) — widening the read grant to
  // ke_toan would require excluding payroll/account_welcome staff-PII rows from their view.
  email: {
    outboxList: ['giam_doc_kinh_doanh'],
    outboxRetry: ['giam_doc_kinh_doanh'],
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

/**
 * Roles permitted to read unmasked HR sensitive fields (CCCD, bank account).
 * super_admin and both directors may read full values; all other roles see
 * masked values via {@link maskSensitive}. Decision 0026 — column-level
 * encryption is deferred to DEBT; this is a role-gate + mask-only control.
 */
const SENSITIVE_HR_ROLES = ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'];

/**
 * Whether the session may read unmasked HR sensitive fields (CCCD, bank account).
 * Accepts the same minimal session shape as {@link assignableRoles} so it is safe
 * to call from browser bundles (no Prisma types needed).
 */
export function canReadSensitiveHr(session: {
  isSuperAdmin: boolean;
  roles: string[];
}): boolean {
  if (session.isSuperAdmin) return true;
  return session.roles.some((r) => SENSITIVE_HR_ROLES.includes(r));
}

/**
 * Mask a sensitive value, showing only the last 4 characters prefixed with dots.
 * Returns null/undefined unchanged (the caller decides whether null means "not set"
 * vs "masked"). Short values (≤ 4 chars) are fully masked to avoid leaking length.
 *
 * Used for CCCD (national ID) and bank account numbers (decision 0026). Server-side
 * only — never rely on the client to hide; apply before data leaves the API.
 */
export function maskSensitive(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (value.length <= 4) return '••••';
  return `•••••••• ${value.slice(-4)}`;
}

/**
 * True when `value` looks like a {@link maskSensitive} placeholder (starts with the mask bullet).
 * A masked value only ever reaches the client when the reader lacks {@link canReadSensitiveHr};
 * write endpoints MUST treat a masked-looking input as "unchanged", never as the real new value —
 * otherwise a client that round-trips a read response back into a write (e.g. an edit form
 * pre-filled from a masked list) would overwrite the real CCCD/bank value with the mask string.
 * This is a server-side belt to the role-gate suspenders: it holds even if a future permission
 * change ever lets a non-canReadSensitiveHr role call the write endpoint.
 */
export function isMaskedPlaceholder(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith('•');
}
