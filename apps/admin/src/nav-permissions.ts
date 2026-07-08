/**
 * Maps every nav section to the PERMISSIONS registry gate that controls visibility.
 * The nav layer derives `visible` directly from this map via can() — no hardcoded role
 * arrays anywhere in the nav. Adding/removing roles from the backend registry automatically
 * propagates to the sidebar without touching this file.
 *
 * Gate kinds:
 *   'open'       — any authenticated staff may see the panel (protectedProcedure load query,
 *                  no specific capability required)
 *   'superAdmin' — only isSuperAdmin=true; panel's primary query is superAdminProcedure
 *   'permission' — can(roles, isSuperAdmin, module, action) must return true
 *
 * For 'permission' gates, the chosen (module, action) is the panel's PRIMARY work action —
 * i.e., what the user is expected to DO in that panel, not just read. This prevents a role
 * from seeing a panel where every meaningful action returns FORBIDDEN.
 */

import type { SectionKey } from './shell.js';

export type NavGate =
  | { kind: 'open' }
  | { kind: 'superAdmin' }
  | { kind: 'permission'; module: string; action: string };

export const NAV_GATES: Record<SectionKey, NavGate> = {
  // ── Open to all authenticated staff ─────────────────────────────────────
  // schedule: mySessions/listSessions are protectedProcedure; any staff can view their schedule
  schedule:       { kind: 'open' },
  // classes: class list/detail are protectedProcedure; any staff can browse classes
  classes:        { kind: 'open' },
  // overview: the panel's ONLY load query is dashboard.summary (restricted to the two
  //   directors), so it must be gated to that action — otherwise teachers etc. see "Tổng quan"
  //   and every open returns FORBIDDEN ("Không tải được tổng quan").
  overview:       { kind: 'permission', module: 'dashboard', action: 'summary' },
  // courses: course.list is protectedProcedure; any staff can view the course catalogue
  courses:        { kind: 'open' },
  // my-payslips: payroll.myPayslips is protectedProcedure; every staff member owns their payslips
  'my-payslips':  { kind: 'open' },

  // ── Super-admin + directors ───────────────────────────────────────────────
  // org: user.create is the primary work action — super_admin has full roster + all mutations;
  //      directors see only their facility's staff (RLS on user.list) and create within their
  //      role-scope. Remaining mutations (setRoles/setActive/setFacilities) reject directors.
  org:            { kind: 'permission', module: 'user', action: 'create' },
  // compensation: compensation.list/create are superAdminProcedure
  compensation:   { kind: 'superAdmin' },

  // ── Gated by PERMISSIONS registry entry ─────────────────────────────────
  // attendance: primary action is attendance.mark = [giao_vien, giam_doc_dao_tao].
  //   Gate to mark so only roles that can act see the panel.
  attendance:   { kind: 'permission', module: 'attendance', action: 'mark' },

  // attendance-report: attendance.report = [giao_vien, giam_doc_dao_tao] — read-only summary,
  // gate to the same 'report' action the router itself checks.
  'attendance-report': { kind: 'permission', module: 'attendance', action: 'report' },

  // grading: grade.grade = [giao_vien, giam_doc_dao_tao]
  grading:      { kind: 'permission', module: 'grade', action: 'grade' },

  // assessment: assessment.termList = [giao_vien, giam_doc_dao_tao]
  //   termList is the panel's primary load query and is permission-gated.
  assessment:   { kind: 'permission', module: 'assessment', action: 'termList' },

  // meetings: parentMeeting.setStatus = [giao_vien, giam_doc_dao_tao]
  meetings:     { kind: 'permission', module: 'parentMeeting', action: 'setStatus' },

  // levelup: levelProgress.listPending = [giam_doc_dao_tao]
  //   Panel's purpose is reviewing pending proposals — gated to the list query.
  levelup:      { kind: 'permission', module: 'levelProgress', action: 'listPending' },

  // certificate: certificate.list = [giao_vien, giam_doc_dao_tao]
  certificate:  { kind: 'permission', module: 'certificate', action: 'list' },

  // students: student.update = [sale, giam_doc_kinh_doanh] — panel's primary work action.
  //   student.list is protectedProcedure (any staff can read), but management operations
  //   require update permission; gate to the work action per spec.
  students:     { kind: 'permission', module: 'student', action: 'update' },

  // guardians: guardian.parentList = [giam_doc_kinh_doanh, giam_doc_dao_tao] — panel's first load query.
  guardians:    { kind: 'permission', module: 'guardian', action: 'parentList' },

  // finance: finance.receiptList = [ke_toan, giam_doc_kinh_doanh]
  finance:      { kind: 'permission', module: 'finance', action: 'receiptList' },
  // family-intake is the teacher-domain direct LMS setup flow. It bypasses receipt/finance/CRM
  // and calls teacherLite.createFamilyStudentAndEnroll.
  'family-intake': { kind: 'permission', module: 'teacherLite', action: 'createFamilyStudentAndEnroll' },

  // email-outbox: email.outboxList = [giam_doc_kinh_doanh] only (v1, YAGNI)
  'email-outbox': { kind: 'permission', module: 'email', action: 'outboxList' },

  // revenue-report: finance.revenueReport = [ke_toan, giam_doc_kinh_doanh]
  'revenue-report': { kind: 'permission', module: 'finance', action: 'revenueReport' },

  // reconcile-worklist: finance.reconcileWorklist = [ke_toan, giam_doc_kinh_doanh]
  'reconcile-worklist': { kind: 'permission', module: 'finance', action: 'reconcileWorklist' },

  // crm: crm.opportunityList = [sale, cskh, ctv_mkt, giam_doc_kinh_doanh]
  //   All CRM-role staff can at minimum read opportunities.
  crm:          { kind: 'permission', module: 'crm', action: 'opportunityList' },

  // cskh: afterSale.list = [sale, cskh, giam_doc_kinh_doanh]
  cskh:         { kind: 'permission', module: 'afterSale', action: 'list' },

  // rewards: rewards.giftCreate = [giam_doc_kinh_doanh] only.
  rewards:      { kind: 'permission', module: 'rewards', action: 'giftCreate' },

  // badges: badge.list = [giao_vien, giam_doc_dao_tao] — panel's primary load query.
  badges:       { kind: 'permission', module: 'badge', action: 'list' },

  // hr: payroll.roster = [giam_doc_kinh_doanh, giam_doc_dao_tao]
  hr:           { kind: 'permission', module: 'payroll', action: 'roster' },

  // kpi: payroll.kpiList = [giam_doc_kinh_doanh, giam_doc_dao_tao] — panel's primary load query.
  kpi:          { kind: 'permission', module: 'payroll', action: 'kpiList' },

  // ── Work Shift & Attendance ────────────────────────────────────────────
  checkin:              { kind: 'permission', module: 'checkInOut', action: 'punch' },
  'shift-registration': { kind: 'permission', module: 'shiftRegistration', action: 'list' },
  'facility-network':  { kind: 'permission', module: 'facilityNetwork', action: 'list' },
  'shift-config':      { kind: 'superAdmin' },

  // ── Teacher nav consolidation (Lịch 360) ────────────────────────────────
  // These two are aggregate screens visible ONLY to giao_vien-only accounts. The real
  // visibility decision lives in buildNavGroups() (shell.tsx), not here — the gate below is a
  // placeholder so NAV_GATES stays a complete Record<SectionKey, NavGate> for the type checker.
  'student-mgmt':     { kind: 'open' },
  'payroll-checkin':  { kind: 'open' },
  // Teacher-lite staff roster: gate 'open' placeholder; real visibility (director-only on teacher
  // surface) lives in buildNavGroups (shell.tsx). Server user.listTeachers is the true gate.
  'staff-lite':       { kind: 'open' },

  // ── Executive Cockpit (Phase 3) ─────────────────────────────────────────
  // Aggregate screen visible ONLY to giam_doc_kinh_doanh-only accounts (replaces 'overview').
  // Same placeholder pattern as student-mgmt/payroll-checkin above — real visibility lives in
  // buildNavGroups() (shell.tsx, isBizDirectorOnly), not here.
  'biz-director-cockpit': { kind: 'open' },

  // ── Executive Cockpit (Phase 4) ─────────────────────────────────────────
  // Aggregate screen visible ONLY to giam_doc_dao_tao-only accounts (replaces 'overview').
  // Same placeholder pattern as biz-director-cockpit above — real visibility lives in
  // buildNavGroups() (shell.tsx, isEduDirectorOnly), not here.
  'edu-director-cockpit': { kind: 'open' },

  // ── Profile/settings ─────────────────────────────────────────────────────
  // Reachable via the avatar dropdown menu (shell.tsx), not the sidebar — every authenticated
  // staff member views/manages their own account, so this is unconditionally open.
  profile: { kind: 'open' },
};
