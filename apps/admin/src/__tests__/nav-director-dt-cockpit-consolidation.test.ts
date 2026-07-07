/**
 * Education Director (giam_doc_dao_tao) Executive Cockpit — regression guard.
 *
 * Mirrors nav-director-kd-cockpit-consolidation.test.ts (same pattern, GDDT side). See that file
 * for the full rationale — the short version: the cockpit ONLY replaces 'overview', it does NOT
 * hide the director's other direct-access items, and the flag is a strict single-role check
 * (isEduDirectorOnly) so it must never fire for a multi-role account, including a dual-director
 * account that also holds giam_doc_kinh_doanh.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { can } from '@cmc/auth/permissions';
import { NAV_GATES } from '../nav-permissions.js';
import type { SectionKey } from '../shell.js';

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

// Sections whose visibility is governed by a flag OTHER than the plain permission/open gate:
// the two director cockpits and teacher-nav-consolidation aggregate screens are gated on
// isBizDirectorOnly/isEduDirectorOnly/isTeacherOnly, and 'certificate' is hardcoded visible:false
// regardless of its gate. 'profile' is 'open' in NAV_GATES but is never a sidebar item — it is
// reachable only via the avatar dropdown menu (shell.tsx), so it never appears in buildNavGroups()
// output for any role. 'family-intake' is a teacher-surface-only shortcut over teacherLite,
// not an ERP sidebar item. Excluded from the generic "matches registry" comparison below.
const SPECIAL_SECTIONS = new Set<SectionKey>([
  'overview', 'biz-director-cockpit', 'edu-director-cockpit',
  'student-mgmt', 'payroll-checkin', 'certificate', 'profile', 'family-intake',
]);

const OTHER_SECTIONS = (Object.keys(NAV_GATES) as SectionKey[]).filter(
  (k) => !SPECIAL_SECTIONS.has(k),
);

/** What NAV_GATES/PERMISSIONS actually grants for a section, independent of the cockpit flags. */
function grantedByRegistry(section: SectionKey, roles: string[]): boolean {
  const gate = NAV_GATES[section];
  if (gate.kind === 'open') return true;
  if (gate.kind === 'superAdmin') return false; // isSuperAdmin=false in every case below
  return can(roles, false, gate.module, gate.action);
}

describe('edu director (giam_doc_dao_tao) executive cockpit', () => {
  it('giam_doc_dao_tao (only role) sees the cockpit, not overview, and keeps its academic direct-access items', () => {
    const roles = ['giam_doc_dao_tao'];
    const keys = keysOf(roles);

    expect(keys).toContain('edu-director-cockpit');
    expect(keys).not.toContain('overview');
    expect(keys).not.toContain('biz-director-cockpit');

    for (const section of OTHER_SECTIONS) {
      expect(keys.includes(section), `${section} visibility should match the registry grant`)
        .toBe(grantedByRegistry(section, roles));
    }
  });

  it('a multi-role account (giam_doc_dao_tao + giao_vien) keeps the original, uncollapsed nav', () => {
    const roles = ['giam_doc_dao_tao', 'giao_vien'];
    const keys = keysOf(roles);

    // Must NOT collapse — a multi-role account is not giam_doc_dao_tao-only.
    expect(keys).toContain('overview');
    expect(keys).not.toContain('edu-director-cockpit');
  });

  it('a dual-director account (giam_doc_dao_tao + giam_doc_kinh_doanh) sees neither cockpit', () => {
    const roles = ['giam_doc_dao_tao', 'giam_doc_kinh_doanh'];
    const keys = keysOf(roles);

    // Both isBizDirectorOnly and isEduDirectorOnly are strict single-role checks — a dual-role
    // account satisfies neither, so it keeps the plain 'overview' entry.
    expect(keys).toContain('overview');
    expect(keys).not.toContain('biz-director-cockpit');
    expect(keys).not.toContain('edu-director-cockpit');
  });

  it.each([
    ['giam_doc_kinh_doanh'],
    ['sale'],
    ['hr'],
    ['ke_toan'],
  ])('%s does not see edu-director-cockpit', (role) => {
    const keys = keysOf([role]);
    expect(keys).not.toContain('edu-director-cockpit');
  });
});
