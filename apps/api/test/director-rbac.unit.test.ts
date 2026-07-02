/**
 * Unit tests for director RBAC helpers (no DB, no tRPC stack).
 * Covers: assignableRoles grant logic, scope invariants, super_admin bypass.
 */
import { describe, it, expect } from 'vitest';
import { assignableRoles, DIRECTOR_ROLE_GRANTS } from '@cmc/auth';

const bizDir = { isSuperAdmin: false, roles: ['giam_doc_kinh_doanh'] };
const eduDir = { isSuperAdmin: false, roles: ['giam_doc_dao_tao'] };
const superAdmin = { isSuperAdmin: true, roles: ['super_admin'] };
const plainSale = { isSuperAdmin: false, roles: ['sale'] };

describe('DIRECTOR_ROLE_GRANTS', () => {
  it('Business Director grant set contains sale, cskh, ctv_mkt, ke_toan, hr', () => {
    expect(DIRECTOR_ROLE_GRANTS['giam_doc_kinh_doanh']).toEqual(
      expect.arrayContaining(['sale', 'cskh', 'ctv_mkt', 'ke_toan', 'hr']),
    );
    expect(DIRECTOR_ROLE_GRANTS['giam_doc_kinh_doanh']!.length).toBe(5);
  });

  it('Education Director grant set contains giao_vien only (head_teacher retired, no replacement grant)', () => {
    expect(DIRECTOR_ROLE_GRANTS['giam_doc_dao_tao']).toEqual(
      expect.arrayContaining(['giao_vien']),
    );
    expect(DIRECTOR_ROLE_GRANTS['giam_doc_dao_tao']!.length).toBe(1);
  });

  it('neither director can grant super_admin or another director role', () => {
    for (const grants of Object.values(DIRECTOR_ROLE_GRANTS)) {
      expect(grants).not.toContain('super_admin');
      expect(grants).not.toContain('giam_doc_kinh_doanh');
      expect(grants).not.toContain('giam_doc_dao_tao');
    }
  });
});

describe('assignableRoles — Business Director', () => {
  it('may assign sale, cskh, ctv_mkt, ke_toan, hr', () => {
    const set = assignableRoles(bizDir);
    expect(set.has('sale')).toBe(true);
    expect(set.has('cskh')).toBe(true);
    expect(set.has('ctv_mkt')).toBe(true);
    expect(set.has('ke_toan')).toBe(true);
    expect(set.has('hr')).toBe(true);
  });

  it('may NOT assign giao_vien (education role)', () => {
    const set = assignableRoles(bizDir);
    expect(set.has('giao_vien')).toBe(false);
  });

  it('may NOT assign super_admin (elevation)', () => {
    const set = assignableRoles(bizDir);
    expect(set.has('super_admin')).toBe(false);
  });

  it('may NOT elevate another director', () => {
    const set = assignableRoles(bizDir);
    expect(set.has('giam_doc_kinh_doanh')).toBe(false);
    expect(set.has('giam_doc_dao_tao')).toBe(false);
  });
});

describe('assignableRoles — Education Director', () => {
  it('may assign giao_vien', () => {
    const set = assignableRoles(eduDir);
    expect(set.has('giao_vien')).toBe(true);
  });

  it('may NOT assign sale, cskh, or ctv_mkt (business roles)', () => {
    const set = assignableRoles(eduDir);
    expect(set.has('sale')).toBe(false);
    expect(set.has('cskh')).toBe(false);
    expect(set.has('ctv_mkt')).toBe(false);
  });

  it('may NOT elevate to director or super_admin', () => {
    const set = assignableRoles(eduDir);
    expect(set.has('giam_doc_kinh_doanh')).toBe(false);
    expect(set.has('giam_doc_dao_tao')).toBe(false);
    expect(set.has('super_admin')).toBe(false);
  });
});

describe('assignableRoles — super_admin', () => {
  it('returns a non-empty set (all roles available)', () => {
    const set = assignableRoles(superAdmin);
    // super_admin can assign anything — spot-check common roles
    for (const r of ['sale', 'cskh', 'giao_vien', 'ke_toan', 'hr',
      'giam_doc_kinh_doanh', 'giam_doc_dao_tao', 'super_admin']) {
      expect(set.has(r), `super_admin must be able to assign ${r}`).toBe(true);
    }
  });
});

describe('assignableRoles — non-director staff', () => {
  it('returns empty set for a plain role with no grant entry', () => {
    expect(assignableRoles(plainSale).size).toBe(0);
  });

  it('returns empty set for a user with no roles', () => {
    expect(assignableRoles({ isSuperAdmin: false, roles: [] }).size).toBe(0);
  });
});
