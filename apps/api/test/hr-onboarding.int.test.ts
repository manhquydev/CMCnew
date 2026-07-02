/**
 * Integration tests for HR onboarding (Plan 3 P2, decision 0026/0027).
 *
 * Covers: user.create phone persist, dup-email CONFLICT, profileUpsert with
 * managerId + sensitive fields, masking for non-privileged readers,
 * managerId validation (self / A↔B mutual, M8).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

const FACILITY = 1;
const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length === 0) return;
  await withRls(SUPER, async (tx) => {
    await tx.employmentProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
    await tx.appUser.deleteMany({ where: { id: { in: createdUserIds } } });
  });
  createdUserIds.length = 0;
});

async function makeUser(email: string, roles: Role[] = [Role.sale], facilityId = FACILITY) {
  const u = await withRls(SUPER, (tx) =>
    tx.appUser.create({
      data: {
        email, displayName: 'Test ' + email.slice(0, 8),
        passwordHash: 'dummy', roles, primaryRole: roles[0]!,
        isActive: true, facilities: { create: [{ facilityId }] },
      },
      select: { id: true },
    }),
  );
  createdUserIds.push(u.id);
  return u;
}

describe('HR onboarding — user.create phone + dup-email (P2)', () => {
  it('user.create persists phone', async () => {
    const su = await staffCaller();
    const email = uniq('hr-phone') + '@cmc.test';
    const user = await su.user.create({
      email, displayName: 'Phone Test', phone: '0901234567',
      roles: [Role.sale], primaryRole: Role.sale, facilityIds: [FACILITY],
    });
    createdUserIds.push(user.id);
    expect(user.phone).toBe('0901234567');
  });

  it('duplicate email → CONFLICT', async () => {
    const su = await staffCaller();
    const email = uniq('hr-dup') + '@cmc.test';
    const u1 = await su.user.create({
      email, displayName: 'First', roles: [Role.sale], primaryRole: Role.sale, facilityIds: [FACILITY],
    });
    createdUserIds.push(u1.id);
    await expect(
      su.user.create({
        email, displayName: 'Second', roles: [Role.sale], primaryRole: Role.sale, facilityIds: [FACILITY],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('HR onboarding — profileUpsert + masking + managerId (P2)', () => {
  it('profileUpsert saves managerId + sensitive fields', async () => {
    const su = await staffCaller();
    const target = await makeUser(uniq('hr-target@cmc.test'));
    const manager = await makeUser(uniq('hr-mgr@cmc.test'), [Role.giam_doc_kinh_doanh]);
    const profile = await su.payroll.profileUpsert({
      userId: target.id, facilityId: FACILITY, position: 'sale', dependents: 0,
      managerId: manager.id,
      address: '123 Le Loi', nationalId: '012345678901',
      bankAccount: '9876543210', bankName: 'Vietcombank',
    });
    expect(profile.managerId).toBe(manager.id);
    // super_admin sees full values
    expect(profile.nationalId).toBe('012345678901');
    expect(profile.bankAccount).toBe('9876543210');
  });

  it('profileList shows full values for super_admin (masking is defense-in-depth)', async () => {
    // NOTE: profileList perm = directors only; canReadSensitiveHr = super_admin + directors.
    // So every role that can call profileList can also read sensitive — masking never fires
    // in practice. This test verifies the full-value path; the mask function itself is
    // unit-tested in hr-sensitive-helpers.test.ts.
    const target = await makeUser(uniq('hr-mask') + '@cmc.test');
    const su = await staffCaller();
    await su.payroll.profileUpsert({
      userId: target.id, facilityId: FACILITY, position: 'sale', dependents: 0,
      nationalId: '012345678901', bankAccount: '9876543210',
    });
    const list = await su.payroll.profileList({ facilityId: FACILITY });
    const prof = list.find((p) => p.userId === target.id);
    expect(prof).toBeTruthy();
    expect(prof!.nationalId).toBe('012345678901');
    expect(prof!.bankAccount).toBe('9876543210');
  });

  it('profileList shows full sensitive for director', async () => {
    const target = await makeUser(uniq('hr-dir@cmc.test'));
    const su = await staffCaller();
    await su.payroll.profileUpsert({
      userId: target.id, facilityId: FACILITY, position: 'sale', dependents: 0,
      nationalId: '012345678901', bankAccount: '9876543210',
    });
    const dirCaller = await staffCaller({
      isSuperAdmin: false, roles: [Role.giam_doc_kinh_doanh], primaryRole: Role.giam_doc_kinh_doanh,
      facilityIds: [FACILITY], userId: '00000000-0000-0000-0000-000000000000',
    });
    const list = await dirCaller.payroll.profileList({ facilityId: FACILITY });
    const prof = list.find((p) => p.userId === target.id);
    expect(prof!.nationalId).toBe('012345678901');
    expect(prof!.bankAccount).toBe('9876543210');
  });

  it('re-submitting a masked placeholder does NOT overwrite the real sensitive value (write-back guard)', async () => {
    // Simulates a UI round-trip: an edit form pre-filled from a masked read (or a bug that never
    // updated the field) submits the mask string back unmodified. profileUpsert must preserve the
    // real stored value instead of persisting the placeholder — see isMaskedPlaceholder guard.
    const su = await staffCaller();
    const target = await makeUser(uniq('hr-nowrite') + '@cmc.test');
    await su.payroll.profileUpsert({
      userId: target.id, facilityId: FACILITY, position: 'sale', dependents: 0,
      nationalId: '012345678901', bankAccount: '9876543210',
    });
    const roundTripped = await su.payroll.profileUpsert({
      userId: target.id, facilityId: FACILITY, position: 'sale', dependents: 0,
      nationalId: '•••••••• 8901', bankAccount: '•••••••• 3210', // maskSensitive() output shape
    });
    expect(roundTripped.nationalId).toBe('012345678901');
    expect(roundTripped.bankAccount).toBe('9876543210');
    const list = await su.payroll.profileList({ facilityId: FACILITY });
    const prof = list.find((p) => p.userId === target.id);
    expect(prof!.nationalId).toBe('012345678901');
    expect(prof!.bankAccount).toBe('9876543210');
  });

  it('managerId = self → BAD_REQUEST', async () => {
    const su = await staffCaller();
    const target = await makeUser(uniq('hr-self@cmc.test'));
    await expect(
      su.payroll.profileUpsert({
        userId: target.id, facilityId: FACILITY, position: 'sale', dependents: 0,
        managerId: target.id,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('managerId A↔B mutual → BAD_REQUEST', async () => {
    const su = await staffCaller();
    const a = await makeUser(uniq('hr-a@cmc.test'), [Role.sale]);
    const b = await makeUser(uniq('hr-b@cmc.test'), [Role.giam_doc_kinh_doanh]);
    // Set A.managerId = B (OK)
    await su.payroll.profileUpsert({
      userId: a.id, facilityId: FACILITY, position: 'sale', dependents: 0, managerId: b.id,
    });
    // Now try B.managerId = A → should fail (A↔B)
    await expect(
      su.payroll.profileUpsert({
        userId: b.id, facilityId: FACILITY, position: 'giam_doc', dependents: 0, managerId: a.id,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});