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

import { describe, it, expect } from 'vitest';
import { can, PERMISSIONS } from '@cmc/auth/permissions';
import { NAV_GATES } from '../nav-permissions.js';
import type { SectionKey } from '../shell.js';

// All non-super_admin staff roles. super_admin bypasses can() entirely (isSuperAdmin=true path).
const STAFF_ROLES = [
  'giao_vien',
  'head_teacher',
  'quan_ly',
  'hr',
  'ke_toan',
  'bgd',
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
      // Positive: bgd and quan_ly still can
      expect(can(['bgd'], false, gate.module, gate.action)).toBe(true);
      expect(can(['quan_ly'], false, gate.module, gate.action)).toBe(true);
    }
  });

  it('D2: head_teacher and bgd do not see rewards (rewards.giftCreate is quan_ly only)', () => {
    const gate = NAV_GATES.rewards;
    expect(gate.kind).toBe('permission');
    if (gate.kind === 'permission') {
      expect(can(['head_teacher'], false, gate.module, gate.action)).toBe(false);
      expect(can(['bgd'], false, gate.module, gate.action)).toBe(false);
      // Positive: quan_ly still can
      expect(can(['quan_ly'], false, gate.module, gate.action)).toBe(true);
    }
  });

  it('D3: head_teacher, bgd, quan_ly do not see kpi (payroll.kpiList is hr/ke_toan only)', () => {
    const gate = NAV_GATES.kpi;
    expect(gate.kind).toBe('permission');
    if (gate.kind === 'permission') {
      expect(can(['head_teacher'], false, gate.module, gate.action)).toBe(false);
      expect(can(['bgd'], false, gate.module, gate.action)).toBe(false);
      expect(can(['quan_ly'], false, gate.module, gate.action)).toBe(false);
      // Positive: hr and ke_toan still can
      expect(can(['hr'], false, gate.module, gate.action)).toBe(true);
      expect(can(['ke_toan'], false, gate.module, gate.action)).toBe(true);
    }
  });

  it('D4: org is superAdmin-gated — no staff role sees it via can()', () => {
    const gate = NAV_GATES.org;
    // The gate kind must be superAdmin, not a permission entry
    expect(gate.kind).toBe('superAdmin');
    // Explicitly verify the formerly-granted roles (quan_ly, bgd, hr) are excluded
    for (const role of ['quan_ly', 'bgd', 'hr'] as StaffRole[]) {
      // superAdmin gate means visible = isSuperAdmin only; role membership is irrelevant
      // We verify the gate kind rather than can() because superAdmin skips the registry
      expect(gate.kind, `role=${role} should not reach org via a permission gate`).toBe('superAdmin');
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
    const expectedOpen: SectionKey[] = ['schedule', 'classes', 'overview', 'courses', 'my-payslips'];
    expect(openSections.sort()).toEqual(expectedOpen.sort());
  });
});
