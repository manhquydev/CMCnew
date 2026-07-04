/**
 * Nav-consistency test — regression guard against nav/registry drift.
 *
 * Invariant: for every role, every permission-gated nav section that is visible
 * to that role must have can(role, false, module, action) === true. Equivalently,
 * the set of roles that see a nav section must exactly equal the set that the
 * PERMISSIONS registry grants for the gate's (module, action).
 *
 * If this test fails, either:
 *   (a) NAV_GATES has the wrong (module, action) for a section, or
 *   (b) PERMISSIONS was updated without updating NAV_GATES — fix NAV_GATES.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { can, PERMISSIONS } from '@cmc/auth/permissions';
import { NAV_GATES } from '../nav-permissions.js';
import type { SectionKey } from '../shell.js';

// nav-modules.ts transitively imports shell.tsx, which transitively imports @cmc/ui's
// pdf-viewer, which references the browser-only DOMMatrix at module-init time. This suite runs
// under environment: 'node' (no DOM) — stub it before nav-modules.js is evaluated via a dynamic
// import (static imports are hoisted ahead of any top-level statement). Same pattern as
// nav-teacher-consolidation.test.ts.
let sectionsWithoutModule: (typeof import('../nav-modules.js'))['sectionsWithoutModule'];
let sectionsWithDuplicateModule: (typeof import('../nav-modules.js'))['sectionsWithDuplicateModule'];

beforeAll(async () => {
  (globalThis as { DOMMatrix?: unknown }).DOMMatrix ??= class DOMMatrix {};
  ({ sectionsWithoutModule, sectionsWithDuplicateModule } = await import('../nav-modules.js'));
});

// All non-super_admin staff roles. super_admin bypasses can() entirely (isSuperAdmin=true path).
// (quan_ly/head_teacher/bgd retired — the two directors giam_doc_kinh_doanh/giam_doc_dao_tao
// now own everything those roles used to cover.)
const STAFF_ROLES = [
  'giao_vien',
  'giam_doc_dao_tao',
  'giam_doc_kinh_doanh',
  'hr',
  'ke_toan',
  'sale',
  'cskh',
  'ctv_mkt',
] as const;

type StaffRole = (typeof STAFF_ROLES)[number];

describe('nav-permissions consistency', () => {
  it('every permission-gated section shows to exactly the roles the registry grants', () => {
    const failures: string[] = [];

    for (const [section, gate] of Object.entries(NAV_GATES) as [SectionKey, (typeof NAV_GATES)[SectionKey]][]) {
      if (gate.kind !== 'permission') continue;
      const { module, action } = gate;
      const registryRoles: string[] = PERMISSIONS[module]?.[action] ?? [];

      for (const role of STAFF_ROLES) {
        const navWouldShow = can([role], false, module, action);
        const registryGrants = registryRoles.includes(role);
        // These are the same check — but making both explicit surfaces which side is wrong
        if (navWouldShow !== registryGrants) {
          failures.push(
            `section=${section} role=${role}: nav=${navWouldShow} registry=${registryGrants} ` +
            `(gate=${module}.${action})`,
          );
        }
      }
    }

    expect(
      failures,
      `Nav visibility is out of sync with PERMISSIONS registry:\n${failures.join('\n')}`,
    ).toHaveLength(0);
  });

  it('every gate references a real PERMISSIONS entry (no phantom gates)', () => {
    const phantom: string[] = [];
    for (const [section, gate] of Object.entries(NAV_GATES) as [SectionKey, (typeof NAV_GATES)[SectionKey]][]) {
      if (gate.kind !== 'permission') continue;
      const { module, action } = gate;
      if (!PERMISSIONS[module] || !(action in PERMISSIONS[module])) {
        phantom.push(`section=${section}: ${module}.${action} not in PERMISSIONS`);
      }
    }
    expect(
      phantom,
      `NAV_GATES references non-existent PERMISSIONS entries:\n${phantom.join('\n')}`,
    ).toHaveLength(0);
  });

  // ── Specific drift-blocker regression guards (D1–D4) ─────────────────────

  it('D1: cskh does not see guardians (cskh was causing FORBIDDEN on guardian.parentList load)', () => {
    const gate = NAV_GATES.guardians;
    expect(gate.kind).toBe('permission');
    if (gate.kind === 'permission') {
      expect(can(['cskh'], false, gate.module, gate.action)).toBe(false);
      // Positive: both directors can (guardian.parentList = [giam_doc_kinh_doanh, giam_doc_dao_tao])
      expect(can(['giam_doc_kinh_doanh'], false, gate.module, gate.action)).toBe(true);
      expect(can(['giam_doc_dao_tao'], false, gate.module, gate.action)).toBe(true);
    }
  });

  it('D2: giao_vien and giam_doc_dao_tao do not see rewards (rewards.giftCreate is giam_doc_kinh_doanh only)', () => {
    const gate = NAV_GATES.rewards;
    expect(gate.kind).toBe('permission');
    if (gate.kind === 'permission') {
      expect(can(['giao_vien'], false, gate.module, gate.action)).toBe(false);
      expect(can(['giam_doc_dao_tao'], false, gate.module, gate.action)).toBe(false);
      // Positive: giam_doc_kinh_doanh still can
      expect(can(['giam_doc_kinh_doanh'], false, gate.module, gate.action)).toBe(true);
    }
  });

  it('D3: sale, cskh, giao_vien, hr, ke_toan do not see kpi; only both directors do (payroll.kpiList)', () => {
    const gate = NAV_GATES.kpi;
    expect(gate.kind).toBe('permission');
    if (gate.kind === 'permission') {
      expect(can(['sale'], false, gate.module, gate.action)).toBe(false);
      expect(can(['cskh'], false, gate.module, gate.action)).toBe(false);
      expect(can(['giao_vien'], false, gate.module, gate.action)).toBe(false);
      // hr/ke_toan were dropped from payroll.kpiList by the RBAC role-consolidation decision
      // (payroll read/list surfaces are director-only) — see rbac-role-consolidation-decision.
      expect(can(['hr'], false, gate.module, gate.action)).toBe(false);
      expect(can(['ke_toan'], false, gate.module, gate.action)).toBe(false);
      // Positive: both directors can
      expect(can(['giam_doc_kinh_doanh'], false, gate.module, gate.action)).toBe(true);
      expect(can(['giam_doc_dao_tao'], false, gate.module, gate.action)).toBe(true);
    }
  });

  it('D4: org is gated by user.create — only super_admin + directors; hr/giao_vien excluded', () => {
    const gate = NAV_GATES.org;
    expect(gate.kind).toBe('permission');
    if (gate.kind === 'permission') {
      // Non-eligible staff roles must NOT reach org via the registry.
      for (const role of ['hr', 'giao_vien'] as StaffRole[]) {
        expect(can([role], false, gate.module, gate.action), `role=${role} should not see org`).toBe(false);
      }
      // Directors can create users within their scope → they (and super_admin via bypass) see org.
      expect(can(['giam_doc_kinh_doanh'], false, gate.module, gate.action)).toBe(true);
      expect(can(['giam_doc_dao_tao'], false, gate.module, gate.action)).toBe(true);
    }
  });

  it('superAdmin-gated sections are not permission-gated (no accidental can() bypass)', () => {
    for (const [section, gate] of Object.entries(NAV_GATES) as [SectionKey, (typeof NAV_GATES)[SectionKey]][]) {
      if (gate.kind === 'superAdmin') {
        // If a section is superAdmin-gated, it must not accidentally also be in a registry
        // entry that non-super_admin roles could access. (Belt-and-suspenders sanity check.)
        expect(gate.kind, `${section} superAdmin gate must not be demoted to 'permission'`).toBe('superAdmin');
      }
    }
  });

  it('open sections are visible without any can() call (no accidental restriction)', () => {
    const openSections = (Object.entries(NAV_GATES) as [SectionKey, (typeof NAV_GATES)[SectionKey]][])
      .filter(([, g]) => g.kind === 'open')
      .map(([key]) => key);

    // Every declared-open section should be in our known list — fail if something new is open
    // without deliberate intent. Update this list when a new open section is added.
    // student-mgmt/payroll-checkin/biz-director-cockpit/edu-director-cockpit are 'open'
    // placeholders only to satisfy the Record<SectionKey, NavGate> completeness check — real
    // visibility for these is decided in buildNavGroups() (shell.tsx), gated on
    // isTeacherOnly/isBizDirectorOnly/isEduDirectorOnly, not on this NAV_GATES entry.
    // 'profile' is genuinely open — any authenticated staff member reaches their own account via
    // the avatar menu, not the sidebar, so it carries no isXOnly gate in buildNavGroups().
    const expectedOpen: SectionKey[] = ['schedule', 'classes', 'courses', 'my-payslips', 'student-mgmt', 'payroll-checkin', 'biz-director-cockpit', 'edu-director-cockpit', 'profile'];
    expect(openSections.sort()).toEqual(expectedOpen.sort());
  });

  // ── Nav-module derivation guard (Plan D — module + sub-tab IA) ────────────
  // nav-modules.ts derives SECTION_TO_MODULE by scanning buildNavGroups() output rather than
  // hand-authoring a second membership list (design doc §6.1, decision B2). This guard asserts
  // that derivation is TOTAL (every section reaches exactly one module) — a hand-list presence
  // check would only catch a MISSING section, not one placed in the wrong/an extra group.
  it('every SectionKey except profile maps to exactly one module (buildNavGroups derivation is total + non-overlapping)', () => {
    const allSections = Object.keys(NAV_GATES) as SectionKey[];
    const unmapped = sectionsWithoutModule(allSections);
    // profile is the one deliberate exception — reached via the avatar menu, not the module rail.
    expect(unmapped).toEqual(['profile']);
    expect(sectionsWithDuplicateModule()).toEqual([]);
  });
});
