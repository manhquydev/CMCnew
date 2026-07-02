/**
 * Permission parity test.
 *
 * Invariants enforced:
 *   1. Every snapshot entry has a matching registry entry.
 *   2. Registry has no entries absent from snapshot (prevents silent additions).
 *   3. Every registry entry matches the snapshot role list exactly (sorted).
 *
 * The snapshot is the canonical baseline for the current registry state. To make an
 * intentional permission change: update permissions.ts AND update the snapshot to match,
 * then add a named test below documenting the invariant you intend to hold.
 */

import { describe, it, expect } from 'vitest';
import { PERMISSIONS } from '@cmc/auth';
import snapshot from './fixtures/permission-snapshot.json' with { type: 'json' };

type SnapshotMap = Record<string, string[]>;
const SNAP = snapshot as SnapshotMap;

function sorted(roles: string[]): string[] {
  return [...roles].sort();
}

describe('permission registry parity', () => {
  it('every snapshot entry has a registry entry', () => {
    const missing: string[] = [];
    for (const key of Object.keys(SNAP)) {
      const [module, action] = key.split('.');
      if (!module || !action) { missing.push(`malformed key: ${key}`); continue; }
      if (!PERMISSIONS[module] || !Object.prototype.hasOwnProperty.call(PERMISSIONS[module], action)) {
        missing.push(key);
      }
    }
    expect(missing, `Registry is missing these snapshot entries:\n${missing.join('\n')}`).toHaveLength(0);
  });

  it('registry has no entries absent from snapshot (no silent additions)', () => {
    const extra: string[] = [];
    for (const [module, actions] of Object.entries(PERMISSIONS)) {
      for (const action of Object.keys(actions)) {
        const key = `${module}.${action}`;
        if (!Object.prototype.hasOwnProperty.call(SNAP, key)) {
          extra.push(key);
        }
      }
    }
    expect(extra, `Registry has entries not in snapshot:\n${extra.join('\n')}`).toHaveLength(0);
  });

  it('all registry entries match snapshot role lists exactly', () => {
    const drift: string[] = [];
    for (const [key, snapshotRoles] of Object.entries(SNAP)) {
      const [module, action] = key.split('.');
      const registryRoles = PERMISSIONS[module!]?.[action!];
      if (!registryRoles) { drift.push(`${key}: missing from registry`); continue; }
      const reg = sorted(registryRoles as string[]);
      const snap = sorted(snapshotRoles);
      if (JSON.stringify(reg) !== JSON.stringify(snap)) {
        drift.push(`${key}: registry=${JSON.stringify(reg)} snapshot=${JSON.stringify(snap)}`);
      }
    }
    expect(drift, `Permission drift detected:\n${drift.join('\n')}`).toHaveLength(0);
  });

  it('quan_ly/head_teacher/bgd never appear in any registry entry (retired roles)', () => {
    const leakage: string[] = [];
    for (const [mod, actions] of Object.entries(PERMISSIONS)) {
      for (const [action, roles] of Object.entries(actions)) {
        for (const retired of ['quan_ly', 'head_teacher', 'bgd']) {
          if ((roles as string[]).includes(retired)) leakage.push(`${mod}.${action} still has ${retired}`);
        }
      }
    }
    expect(leakage, `Retired role leaked into registry:\n${leakage.join('\n')}`).toHaveLength(0);
  });
});

// ── Named invariant tests (document intentional design decisions) ──────────────────────────────

describe('ctv_mkt CRM access (O1 only)', () => {
  it('ctv_mkt may read/create opportunities and resolve owner context only', () => {
    const allowed = ['opportunityList', 'opportunityGet', 'opportunityCreate', 'assignableOwners', 'assignmentHistory'];
    for (const action of allowed) {
      expect(PERMISSIONS['crm']![action], `ctv_mkt must have crm.${action}`).toContain('ctv_mkt');
    }
  });

  it('ctv_mkt cannot transition, mark lost, reopen, or manage tests/contacts', () => {
    const restricted = ['opportunityTransition', 'opportunityMarkLost', 'opportunityReopen',
      'testList', 'testCreate', 'testGrade', 'contactList', 'contactCreate'];
    for (const action of restricted) {
      expect(PERMISSIONS['crm']![action], `ctv_mkt must not have crm.${action}`).not.toContain('ctv_mkt');
    }
  });

  it('ctv_mkt does not appear on any non-CRM module', () => {
    const leakage: string[] = [];
    for (const [mod, actions] of Object.entries(PERMISSIONS)) {
      if (mod === 'crm') continue;
      for (const [action, roles] of Object.entries(actions)) {
        if ((roles as string[]).includes('ctv_mkt')) leakage.push(`${mod}.${action}`);
      }
    }
    expect(leakage, `ctv_mkt leaked outside CRM: ${leakage.join(', ')}`).toHaveLength(0);
  });
});

describe('Business Director (giam_doc_kinh_doanh) permissions', () => {
  const KD = 'giam_doc_kinh_doanh';

  it('has full CRM access to run the KD team', () => {
    const crmActions = ['contactList', 'contactCreate', 'opportunityList', 'opportunityCreate',
      'opportunityGet', 'assignableOwners', 'opportunityTransition', 'opportunityMarkLost',
      'opportunityReopen', 'opportunityReassign', 'assignmentHistory', 'testList', 'testCreate'];
    for (const a of crmActions) {
      expect(PERMISSIONS['crm']![a], `crm.${a} must include ${KD}`).toContain(KD);
    }
  });

  it('does NOT have CRM testGrade (teaching role only)', () => {
    expect(PERMISSIONS['crm']!['testGrade']).not.toContain(KD);
  });

  it('has afterSale oversight (list/create/transition/assign)', () => {
    expect(PERMISSIONS['afterSale']!['list']).toContain(KD);
    expect(PERMISSIONS['afterSale']!['create']).toContain(KD);
    expect(PERMISSIONS['afterSale']!['transition']).toContain(KD);
    expect(PERMISSIONS['afterSale']!['assign']).toContain(KD);
    // setStudentLifecycle moves fully to KD (quan_ly retired — sole financial-lifecycle owner)
    expect(PERMISSIONS['afterSale']!['setStudentLifecycle']).toContain(KD);
  });

  it('has finance write access alongside ke_toan (quan_ly retired — KD is the compensating oversight)', () => {
    const financeActions = ['receiptList', 'priceList', 'voucherList', 'receiptCreate',
      'receiptApprove', 'receiptMarkSent', 'receiptReconcile', 'receiptCancel',
      'priceCreate', 'voucherCreate'];
    for (const a of financeActions) {
      expect(PERMISSIONS['finance']![a], `finance.${a} must include ${KD}`).toContain(KD);
    }
  });

  it('has user.create and user.list for team building', () => {
    expect(PERMISSIONS['user']!['create']).toContain(KD);
    expect(PERMISSIONS['user']!['list']).toContain(KD);
  });

  it('cannot modify roles, facilities, or active status (super_admin-only)', () => {
    expect(PERMISSIONS['user']!['setRoles']).not.toContain(KD);
    expect(PERMISSIONS['user']!['setFacilities']).not.toContain(KD);
    expect(PERMISSIONS['user']!['setActive']).not.toContain(KD);
  });

  it('does not appear in any academic/teaching module', () => {
    const teachingModules = ['assessment', 'attendance', 'grade', 'certificate',
      'levelProgress', 'classBatch', 'schedule', 'parentMeeting'];
    for (const mod of teachingModules) {
      for (const [action, roles] of Object.entries(PERMISSIONS[mod] ?? {})) {
        expect(roles as string[], `${mod}.${action} must not include ${KD}`).not.toContain(KD);
      }
    }
  });
});

describe('Education Director (giam_doc_dao_tao) permissions', () => {
  const GD = 'giam_doc_dao_tao';

  it('has full assessment access', () => {
    const actions = ['template', 'termList', 'termCreate', 'termUpdate', 'termLock',
      'termUnlock', 'upsertQualitative', 'computeFinalGrade'];
    for (const a of actions) {
      expect(PERMISSIONS['assessment']![a], `assessment.${a} must include ${GD}`).toContain(GD);
    }
  });

  it('has full classBatch lifecycle management', () => {
    expect(PERMISSIONS['classBatch']!['create']).toContain(GD);
    expect(PERMISSIONS['classBatch']!['setStatus']).toContain(GD);
    expect(PERMISSIONS['classBatch']!['cancel']).toContain(GD);
    expect(PERMISSIONS['classBatch']!['reopen']).toContain(GD);
  });

  it('has schedule building access', () => {
    expect(PERMISSIONS['schedule']!['addSlot']).toContain(GD);
    expect(PERMISSIONS['schedule']!['generateSessions']).toContain(GD);
  });

  it('has grading, certificate, and level-progress access', () => {
    expect(PERMISSIONS['grade']!['grade']).toContain(GD);
    expect(PERMISSIONS['grade']!['publish']).toContain(GD);
    expect(PERMISSIONS['certificate']!['list']).toContain(GD);
    expect(PERMISSIONS['certificate']!['issue']).toContain(GD);
    expect(PERMISSIONS['levelProgress']!['propose']).toContain(GD);
    expect(PERMISSIONS['levelProgress']!['listPending']).toContain(GD);
    expect(PERMISSIONS['levelProgress']!['decide']).toContain(GD);
  });

  it('has parentMeeting access for oversight', () => {
    expect(PERMISSIONS['parentMeeting']!['setStatus']).toContain(GD);
    expect(PERMISSIONS['parentMeeting']!['setSchedule']).toContain(GD);
  });

  it('has user.create and listTeachers for team building', () => {
    expect(PERMISSIONS['user']!['create']).toContain(GD);
    expect(PERMISSIONS['user']!['list']).toContain(GD);
    expect(PERMISSIONS['user']!['listTeachers']).toContain(GD);
  });

  it('does not appear in KD/finance/CRM modules, except crm.testGrade (teaching oversight)', () => {
    const bizModules = ['crm', 'afterSale', 'rewards'];
    for (const mod of bizModules) {
      for (const [action, roles] of Object.entries(PERMISSIONS[mod] ?? {})) {
        if (mod === 'crm' && action === 'testGrade') continue; // GD retains teaching-oversight grading
        expect(roles as string[], `${mod}.${action} must not include ${GD}`).not.toContain(GD);
      }
    }
    // Finance write actions must not include GD (read not needed either)
    for (const [action, roles] of Object.entries(PERMISSIONS['finance'] ?? {})) {
      expect(roles as string[], `finance.${action} must not include ${GD}`).not.toContain(GD);
    }
  });
});

describe('director payroll/KPI authority (3-heads executive board)', () => {
  const KD = 'giam_doc_kinh_doanh';
  const GD = 'giam_doc_dao_tao';

  it('both directors own payroll read/write gates', () => {
    const payrollActions = Object.keys(PERMISSIONS['payroll'] ?? {});
    for (const dir of [KD, GD]) {
      for (const action of payrollActions) {
        expect(PERMISSIONS['payroll']![action], `payroll.${action} must include ${dir}`).toContain(dir);
      }
    }
  });

  it('hr/ke_toan no longer own payroll gates', () => {
    for (const action of Object.keys(PERMISSIONS['payroll'] ?? {})) {
      for (const role of ['hr', 'ke_toan']) {
        expect(PERMISSIONS['payroll']![action], `payroll.${action} must not include ${role}`).not.toContain(role);
      }
    }
  });
});

describe('shift registration delegated approval', () => {
  it('staff roles can call approve/reject; router still enforces assigned approver and self-block', () => {
    for (const action of ['approve', 'reject']) {
      for (const role of ['giao_vien', 'sale', 'cskh']) {
        expect(PERMISSIONS['shiftRegistration']![action], `shiftRegistration.${action} must include ${role}`).toContain(role);
      }
    }
  });
});

describe('sale afterSale facility-scoped handling', () => {
  it('sale can operate normal afterSale case flow and assignment picker', () => {
    for (const action of ['list', 'create', 'transition', 'assign']) {
      expect(PERMISSIONS['afterSale']![action], `afterSale.${action} must include sale`).toContain('sale');
    }
    expect(PERMISSIONS['user']!['listAssignableForAfterSale']).toContain('sale');
  });

  it('sale cannot change student lifecycle from afterSale', () => {
    expect(PERMISSIONS['afterSale']!['setStudentLifecycle']).not.toContain('sale');
  });
});
