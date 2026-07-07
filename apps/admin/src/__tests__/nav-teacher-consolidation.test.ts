/**
 * Teacher nav consolidation (Lịch 360) — regression guard.
 *
 * Unlike nav-consistency.test.ts (which only compares NAV_GATES to PERMISSIONS generically),
 * this suite calls buildNavGroups() directly to assert what a role ACTUALLY sees rendered.
 *
 * Non-teacher-only expectations are derived from NAV_GATES/can() at test time rather than
 * hardcoded role lists, so this suite stays correct regardless of how the PERMISSIONS registry
 * evolves (e.g. role consolidation elsewhere in the repo) — it only asserts the ONE invariant
 * this feature owns: isTeacherOnly must not change visibility for anyone but a giao_vien-only
 * account.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { can } from '@cmc/auth/permissions';
import { NAV_GATES } from '../nav-permissions.js';

// shell.tsx transitively imports @cmc/ui's pdf-viewer, which references the browser-only
// DOMMatrix at module-init time. This suite runs under environment: 'node' (no DOM), so stub
// it before shell.js is evaluated — must be a dynamic import since static imports are hoisted
// ahead of any top-level statement.
let buildNavGroups: (typeof import('../shell.js'))['buildNavGroups'];

beforeAll(async () => {
  (globalThis as { DOMMatrix?: unknown }).DOMMatrix ??= class DOMMatrix {};
  ({ buildNavGroups } = await import('../shell.js'));
});

function keysOf(roles: string[]): string[] {
  const groups = buildNavGroups({ roles, isSuperAdmin: false });
  return groups.flatMap((g) => g.items.filter((i) => i.visible).map((i) => i.key));
}

function teacherSurfaceGroups(roles: string[]) {
  return buildNavGroups({ roles, isSuperAdmin: false, surface: 'teacher' });
}

// The 8 standalone sections the teacher consolidation collapses for giao_vien-only accounts.
const COLLAPSED_SECTIONS = [
  'attendance', 'grading', 'assessment', 'classes', 'courses', 'meetings', 'my-payslips', 'checkin',
] as const;

/** What NAV_GATES/PERMISSIONS actually grants for a section, independent of isTeacherOnly. */
function grantedByRegistry(section: (typeof COLLAPSED_SECTIONS)[number], roles: string[]): boolean {
  const gate = NAV_GATES[section];
  if (gate.kind === 'open') return true;
  if (gate.kind === 'superAdmin') return false; // isSuperAdmin=false in every case below
  return can(roles, false, gate.module, gate.action);
}

describe('teacher nav consolidation', () => {
  it('giao_vien (only role) sees the 3 consolidated sections, not the 9 originals', () => {
    const keys = keysOf(['giao_vien']);

    expect(keys).toContain('schedule');
    expect(keys).toContain('student-mgmt');
    expect(keys).toContain('payroll-checkin');

    for (const hidden of COLLAPSED_SECTIONS) {
      expect(keys, `giao_vien should not see ${hidden}`).not.toContain(hidden);
    }
  });

  it('a multi-role account (giao_vien + giam_doc_dao_tao) keeps the original, uncollapsed nav', () => {
    const roles = ['giao_vien', 'giam_doc_dao_tao'];
    const keys = keysOf(roles);

    // Must NOT collapse — a multi-role account is not giao_vien-only.
    expect(keys).not.toContain('student-mgmt');
    expect(keys).not.toContain('payroll-checkin');
    for (const section of COLLAPSED_SECTIONS) {
      expect(keys.includes(section), `${section} visibility should match the registry grant`)
        .toBe(grantedByRegistry(section, roles));
    }
  });

  it.each([
    ['giam_doc_dao_tao'],
    ['giam_doc_kinh_doanh'],
    ['hr'],
    ['sale'],
  ])('%s nav is unchanged by the teacher consolidation', (role) => {
    const keys = keysOf([role]);

    expect(keys).not.toContain('student-mgmt');
    expect(keys).not.toContain('payroll-checkin');
    for (const section of COLLAPSED_SECTIONS) {
      expect(keys.includes(section), `${section} visibility for ${role} should match the registry grant`)
        .toBe(grantedByRegistry(section, [role]));
    }
  });

  it('teacher surface uses a focused teaching console nav instead of ERP module labels', () => {
    const groups = teacherSurfaceGroups(['giao_vien']);
    const groupLabels = groups.map((g) => g.groupLabel);
    const visibleItems = groups.flatMap((g) => g.items.filter((i) => i.visible));
    const keys = visibleItems.map((i) => i.key);

    expect(groupLabels).toContain('Lịch & buổi học');
    expect(groupLabels).toContain('Lớp & bài tập');
    expect(groupLabels).not.toContain('CRM & Kinh doanh');
    expect(groupLabels).not.toContain('Tài chính');
    expect(groupLabels).not.toContain('Công ca');
    expect(groupLabels).not.toContain('Cá nhân');
    expect(keys).toContain('schedule');
    expect(keys).toContain('student-mgmt');
    expect(keys).not.toContain('crm');
    expect(keys).not.toContain('finance');
    expect(keys).not.toContain('hr');
    expect(keys).not.toContain('payroll-checkin');
    expect(keys).not.toContain('shift-registration');
  });

  it('teacher surface exposes intake as a teacher workflow, not the finance module', () => {
    const visibleItems = teacherSurfaceGroups(['giam_doc_kinh_doanh'])
      .flatMap((g) => g.items.filter((i) => i.visible));

    expect(visibleItems.map((i) => i.key)).toContain('family-intake');
    expect(visibleItems.map((i) => i.key)).not.toContain('finance');
    expect(visibleItems.find((i) => i.key === 'family-intake')?.label).toBe('Tạo học viên LMS');
  });
});
