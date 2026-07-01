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
  // overview: the panel's ONLY load query is dashboard.summary (restricted to BGĐ/quản lý/
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
  // attendance: primary action is attendance.mark = [giao_vien, quan_ly].
  //   head_teacher can read session lists (protectedProcedure) but the panel's purpose is
  //   marking attendance — gate to mark so only roles that can act see the panel.
  attendance:   { kind: 'permission', module: 'attendance', action: 'mark' },

  // grading: grade.grade = [giao_vien, quan_ly]
  grading:      { kind: 'permission', module: 'grade', action: 'grade' },

  // assessment: assessment.termList = [giao_vien, head_teacher, quan_ly]
  //   termList is the panel's primary load query and is permission-gated.
  assessment:   { kind: 'permission', module: 'assessment', action: 'termList' },

  // meetings: parentMeeting.setStatus = [giao_vien, head_teacher, quan_ly]
  meetings:     { kind: 'permission', module: 'parentMeeting', action: 'setStatus' },

  // levelup: levelProgress.listPending = [head_teacher, quan_ly]
  //   Panel's purpose is reviewing pending proposals — gated to the list query.
  levelup:      { kind: 'permission', module: 'levelProgress', action: 'listPending' },

  // certificate: certificate.list = [head_teacher, quan_ly, giao_vien]
  certificate:  { kind: 'permission', module: 'certificate', action: 'list' },

  // students: student.update = [quan_ly, sale] — panel's primary work action.
  //   student.list is protectedProcedure (any staff can read), but management operations
  //   require update permission; gate to the work action per spec.
  students:     { kind: 'permission', module: 'student', action: 'update' },

  // guardians: guardian.parentList = [bgd, quan_ly] — panel's first load query.
  //   D1 fix: cskh previously appeared in the nav but cannot call guardian.* procedures.
  guardians:    { kind: 'permission', module: 'guardian', action: 'parentList' },

  // finance: finance.receiptList = [ke_toan, quan_ly]
  finance:      { kind: 'permission', module: 'finance', action: 'receiptList' },

  // crm: crm.opportunityList = [sale, cskh, quan_ly, ctv_mkt]
  //   All CRM-role staff can at minimum read opportunities.
  crm:          { kind: 'permission', module: 'crm', action: 'opportunityList' },

  // cskh: afterSale.list = [cskh, quan_ly]
  cskh:         { kind: 'permission', module: 'afterSale', action: 'list' },

  // rewards: rewards.giftCreate = [quan_ly] only.
  //   D2 fix: head_teacher and bgd previously appeared in nav but cannot create/review gifts.
  rewards:      { kind: 'permission', module: 'rewards', action: 'giftCreate' },

  // hr: payroll.payslipList = [hr, ke_toan]
  hr:           { kind: 'permission', module: 'payroll', action: 'payslipList' },

  // kpi: payroll.kpiList = [hr, ke_toan] — panel's primary load query.
  //   D3 fix: head_teacher/bgd/quan_ly previously appeared in nav but kpiList is hr/ke_toan-only;
  //   those roles can confirm/approve (kpiEvalConfirm/kpiEvalApprove) but cannot load the list rows.
  kpi:          { kind: 'permission', module: 'payroll', action: 'kpiList' },

  // ── Work Shift & Attendance ────────────────────────────────────────────
  checkin:              { kind: 'permission', module: 'checkInOut', action: 'punch' },
  'shift-registration': { kind: 'permission', module: 'shiftRegistration', action: 'list' },
  'facility-network':  { kind: 'permission', module: 'facilityNetwork', action: 'list' },
  'shift-config':      { kind: 'superAdmin' },
};
