/**
 * Permission parity test.
 *
 * Invariants enforced:
 *   1. Every snapshot entry (pre-refactor baseline) has a matching registry entry.
 *   2. For non-diff procedures, registry roles === snapshot roles (sorted).
 *   3. For the 2 intentional diffs, registry has exactly the new expanded role list.
 *   4. Registry has no entries absent from the snapshot (prevents silent additions).
 *
 * If any of these fail the registry has drifted from the codebase — fix the registry or update the snapshot.
 */

import { describe, it, expect } from 'vitest';
import { PERMISSIONS } from '@cmc/auth';
import snapshot from './fixtures/permission-snapshot.json' with { type: 'json' };

type SnapshotMap = Record<string, string[]>;
const SNAP = snapshot as SnapshotMap;

/**
 * The two intentional diffs. Keys match "routerMount.procedureName" from the snapshot.
 * Values are the EXPECTED NEW role lists (post-refactor). Any other key must match snapshot exactly.
 */
const INTENDED_DIFFS: SnapshotMap = {
  // Diff 1: head_teacher added to class/schedule write actions.
  'classBatch.create': ['quan_ly', 'head_teacher'],
  'schedule.addSlot': ['quan_ly', 'head_teacher'],
  'schedule.generateSessions': ['quan_ly', 'head_teacher'],
  // Diff 2: ctv_mkt gains O1 read + create in CRM.
  'crm.opportunityList': ['sale', 'cskh', 'quan_ly', 'ctv_mkt'],
  'crm.opportunityCreate': ['sale', 'cskh', 'quan_ly', 'ctv_mkt'],
};

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

  it('non-diff procedures match snapshot role lists exactly', () => {
    const drift: string[] = [];
    for (const [key, snapshotRoles] of Object.entries(SNAP)) {
      if (INTENDED_DIFFS[key]) continue; // skip known diffs
      const [module, action] = key.split('.');
      const registryRoles = PERMISSIONS[module!]?.[action!];
      if (!registryRoles) { drift.push(`${key}: missing from registry`); continue; }
      const reg = sorted(registryRoles as string[]);
      const snap = sorted(snapshotRoles);
      if (JSON.stringify(reg) !== JSON.stringify(snap)) {
        drift.push(`${key}: registry=${JSON.stringify(reg)} snapshot=${JSON.stringify(snap)}`);
      }
    }
    expect(drift, `Unintended permission drift detected:\n${drift.join('\n')}`).toHaveLength(0);
  });

  it('intentional diff: head_teacher added to class/schedule create actions', () => {
    expect(sorted(PERMISSIONS['classBatch']!['create'] as string[])).toEqual(sorted(['quan_ly', 'head_teacher']));
    expect(sorted(PERMISSIONS['schedule']!['addSlot'] as string[])).toEqual(sorted(['quan_ly', 'head_teacher']));
    expect(sorted(PERMISSIONS['schedule']!['generateSessions'] as string[])).toEqual(sorted(['quan_ly', 'head_teacher']));
    // Negative: no unintended spread — classBatch write-only actions still quan_ly only.
    expect(PERMISSIONS['classBatch']!['setStatus']).not.toContain('head_teacher');
    expect(PERMISSIONS['classBatch']!['cancel']).not.toContain('head_teacher');
    expect(PERMISSIONS['classBatch']!['reopen']).not.toContain('head_teacher');
  });

  it('intentional diff: ctv_mkt on CRM lead O1 read+create only', () => {
    expect(PERMISSIONS['crm']!['opportunityList']).toContain('ctv_mkt');
    expect(PERMISSIONS['crm']!['opportunityCreate']).toContain('ctv_mkt');
    // Negative: ctv_mkt must NOT appear on any other CRM action.
    const crmActions = Object.keys(PERMISSIONS['crm'] ?? {});
    const crmLeakage = crmActions.filter(
      (a) => a !== 'opportunityList' && a !== 'opportunityCreate' &&
              (PERMISSIONS['crm']![a] as string[]).includes('ctv_mkt'),
    );
    expect(crmLeakage, `ctv_mkt leaked onto CRM actions: ${crmLeakage.join(', ')}`).toHaveLength(0);
    // Also must not appear on any non-CRM module.
    const globalLeakage: string[] = [];
    for (const [mod, actions] of Object.entries(PERMISSIONS)) {
      if (mod === 'crm') continue;
      for (const [action, roles] of Object.entries(actions)) {
        if ((roles as string[]).includes('ctv_mkt')) {
          globalLeakage.push(`${mod}.${action}`);
        }
      }
    }
    expect(globalLeakage, `ctv_mkt appeared outside CRM: ${globalLeakage.join(', ')}`).toHaveLength(0);
  });

  it('intended diff entries match their new expected role lists', () => {
    for (const [key, expectedRoles] of Object.entries(INTENDED_DIFFS)) {
      const [module, action] = key.split('.');
      const registryRoles = PERMISSIONS[module!]?.[action!];
      expect(
        sorted(registryRoles as string[]),
        `${key}: expected ${JSON.stringify(sorted(expectedRoles))}`,
      ).toEqual(sorted(expectedRoles));
    }
  });
});
