import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

const FACILITY_ID = 1;

describe('shift registration delegated approver', () => {
  let directorId: string;
  let saleManagerId: string;
  let saleId: string;
  let groupId: string;
  const registrationIds: string[] = [];

  beforeAll(async () => {
    const setup = await withRls(SUPER, async (tx) => {
      const director = await tx.appUser.create({
        data: {
          email: uniq('delegated-director@cmc.test'),
          displayName: 'Delegated Director',
          passwordHash: 'test',
          primaryRole: Role.giam_doc_kinh_doanh,
          roles: [Role.giam_doc_kinh_doanh],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY_ID }] },
        },
      });
      const saleManager = await tx.appUser.create({
        data: {
          email: uniq('delegated-sale-manager@cmc.test'),
          displayName: 'Delegated Sale Manager',
          passwordHash: 'test',
          primaryRole: Role.sale,
          roles: [Role.sale],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY_ID }] },
        },
      });
      const sale = await tx.appUser.create({
        data: {
          email: uniq('delegated-sale@cmc.test'),
          displayName: 'Delegated Sale',
          passwordHash: 'test',
          primaryRole: Role.sale,
          roles: [Role.sale],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY_ID }] },
        },
      });
      await tx.employmentProfile.create({
        data: { facilityId: FACILITY_ID, userId: director.id, position: Role.giam_doc_kinh_doanh },
      });
      await tx.employmentProfile.create({
        data: { facilityId: FACILITY_ID, userId: saleManager.id, position: Role.sale, managerId: director.id },
      });
      await tx.employmentProfile.create({
        data: { facilityId: FACILITY_ID, userId: sale.id, position: Role.sale, managerId: saleManager.id },
      });
      const group = await tx.shiftGroup.upsert({
        where: { facilityId_code: { facilityId: FACILITY_ID, code: 'KINH_DOANH' } },
        update: { name: 'Kinh doanh', selectionMode: 'SINGLE' },
        create: { facilityId: FACILITY_ID, code: 'KINH_DOANH', name: 'Kinh doanh', selectionMode: 'SINGLE' },
      });
      return { director, saleManager, sale, group };
    });
    directorId = setup.director.id;
    saleManagerId = setup.saleManager.id;
    saleId = setup.sale.id;
    groupId = setup.group.id;
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.shiftRegistration.deleteMany({ where: { id: { in: registrationIds } } }).catch(() => {});
      await tx.employmentProfile.deleteMany({ where: { userId: { in: [directorId, saleManagerId, saleId] } } }).catch(() => {});
      await tx.appUser.deleteMany({ where: { id: { in: [directorId, saleManagerId, saleId] } } }).catch(() => {});
    });
  });

  function caller(userId: string, role: Role) {
    return staffCaller({
      userId,
      roles: [role],
      primaryRole: role,
      isSuperAdmin: false,
      facilityIds: [FACILITY_ID],
    });
  }

  async function submittedRegistration(managerId: string | null, nextManagerId: string | null = null) {
    const reg = await withRls(SUPER, (tx) =>
      tx.shiftRegistration.create({
        data: {
          facilityId: FACILITY_ID,
          userId: saleId,
          fromDate: new Date('2099-02-01'),
          toDate: new Date('2099-02-01'),
          status: 'submitted',
          shiftGroupId: groupId,
          managerId,
          nextManagerId,
          submittedAt: new Date(),
          submittedById: saleId,
        },
      }),
    );
    registrationIds.push(reg.id);
    return reg;
  }

  it('allows assigned sale manager to approve but still blocks self-approval', async () => {
    const reg = await submittedRegistration(saleManagerId, directorId);
    const manager = await caller(saleManagerId, Role.sale);
    const approved = await manager.shiftRegistration.approve({ id: reg.id });
    expect(approved.approvedById).toBe(saleManagerId);

    const selfReg = await submittedRegistration(saleId, directorId);
    const self = await caller(saleId, Role.sale);
    await expect(self.shiftRegistration.approve({ id: selfReg.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets director see all submitted packets in list and dashboard inbox', async () => {
    const reg = await submittedRegistration(saleManagerId, null);
    const director = await caller(directorId, Role.giam_doc_kinh_doanh);

    expect((await director.shiftRegistration.list({ facilityId: FACILITY_ID, status: 'submitted' })).some((r) => r.id === reg.id)).toBe(true);
    expect((await director.dashboard.myApprovals({ facilityId: FACILITY_ID })).some((r) => r.domain === 'shiftRegistration' && r.id === reg.id)).toBe(true);
  });

  it('lets director approve unresolved-manager packet after anti-self check', async () => {
    const reg = await submittedRegistration(null, null);
    const director = await caller(directorId, Role.giam_doc_kinh_doanh);
    const approved = await director.shiftRegistration.approve({ id: reg.id });
    expect(approved.approvedById).toBe(directorId);
  });
});
