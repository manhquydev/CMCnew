import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/db';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

describe('role-flows CRM hygiene — sale afterSale scope', () => {
  let facilityA = 0;
  let facilityB = 0;
  let saleUserId = '';
  let assigneeUserId = '';
  let studentAId = '';
  let studentBId = '';
  let caseAId = '';
  let caseBId = '';
  const userIds: string[] = [];
  const facilityIds: number[] = [];
  const studentIds: string[] = [];
  const caseIds: string[] = [];

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      const [a, b] = await Promise.all([
        tx.facility.create({ data: { code: uniq('P5A').slice(0, 24), name: 'P5 CRM Hygiene A' } }),
        tx.facility.create({ data: { code: uniq('P5B').slice(0, 24), name: 'P5 CRM Hygiene B' } }),
      ]);
      facilityA = a.id;
      facilityB = b.id;
      facilityIds.push(a.id, b.id);

      const [sale, assignee] = await Promise.all([
        tx.appUser.create({
          data: {
            email: `${uniq('sale_after_sale')}@cmc.test`,
            displayName: 'Sale AfterSale Scope',
            passwordHash: 'x',
            roles: [Role.sale],
            primaryRole: Role.sale,
            facilities: { create: [{ facilityId: facilityA }] },
          },
          select: { id: true },
        }),
        tx.appUser.create({
          data: {
            email: `${uniq('assignee_after_sale')}@cmc.test`,
            displayName: 'Assignable AfterSale Scope',
            passwordHash: 'x',
            roles: [Role.sale],
            primaryRole: Role.sale,
            facilities: { create: [{ facilityId: facilityA }] },
          },
          select: { id: true },
        }),
      ]);
      saleUserId = sale.id;
      assigneeUserId = assignee.id;
      userIds.push(sale.id, assignee.id);

      const [studentA, studentB] = await Promise.all([
        tx.student.create({
          data: {
            facilityId: facilityA,
            studentCode: uniq('P5SA'),
            fullName: 'P5 Student A',
            program: 'UCREA',
            lifecycle: 'active',
          },
          select: { id: true },
        }),
        tx.student.create({
          data: {
            facilityId: facilityB,
            studentCode: uniq('P5SB'),
            fullName: 'P5 Student B',
            program: 'UCREA',
            lifecycle: 'active',
          },
          select: { id: true },
        }),
      ]);
      studentAId = studentA.id;
      studentBId = studentB.id;
      studentIds.push(studentA.id, studentB.id);

      const otherFacilityCase = await tx.afterSaleCase.create({
        data: {
          facilityId: facilityB,
          studentId: studentB.id,
          subject: 'Other facility case',
          createdById: sale.id,
        },
        select: { id: true },
      });
      caseBId = otherFacilityCase.id;
      caseIds.push(otherFacilityCase.id);
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.recordEvent.deleteMany({
        where: {
          OR: [
            { entityType: 'after_sale_case', entityId: { in: caseIds } },
            { entityType: 'student', entityId: { in: studentIds } },
          ],
        },
      });
      await tx.afterSaleCase.deleteMany({ where: { id: { in: caseIds } } });
      await tx.student.deleteMany({ where: { id: { in: studentIds } } });
      await tx.userFacility.deleteMany({ where: { userId: { in: userIds } } });
      await tx.appUser.deleteMany({ where: { id: { in: userIds } } });
      await tx.facility.deleteMany({ where: { id: { in: facilityIds } } });
    });
  });

  async function saleCaller() {
    return staffCaller({
      userId: saleUserId,
      roles: [Role.sale],
      primaryRole: Role.sale,
      isSuperAdmin: false,
      facilityIds: [facilityA],
    });
  }

  it('sale can create, list, transition, and assign afterSale cases in own facility', async () => {
    const caller = await saleCaller();

    const created = await caller.afterSale.create({
      facilityId: facilityA,
      subject: 'Sale-owned afterSale case',
      studentId: studentAId,
    });
    caseAId = created.id;
    caseIds.push(created.id);

    const listed = await caller.afterSale.list({ facilityId: facilityA });
    expect(listed.map((c) => c.id)).toContain(created.id);

    const transitioned = await caller.afterSale.transition({ id: created.id, status: 'in_progress' });
    expect(transitioned.status).toBe('in_progress');

    const assigned = await caller.afterSale.assign({ id: created.id, assignedToId: assigneeUserId });
    expect(assigned.assignedToId).toBe(assigneeUserId);
  });

  it('sale cannot set student lifecycle', async () => {
    const caller = await saleCaller();
    await expect(
      caller.afterSale.setStudentLifecycle({
        studentId: studentAId,
        lifecycle: 'on_hold',
        caseId: caseAId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('sale cannot act on another facility afterSale cases', async () => {
    const caller = await saleCaller();

    await expect(
      caller.afterSale.create({
        facilityId: facilityB,
        subject: 'Cross-facility create should fail',
        studentId: studentBId,
      }),
    ).rejects.toBeTruthy();

    const otherFacilityList = await caller.afterSale.list({ facilityId: facilityB });
    expect(otherFacilityList.map((c) => c.id)).not.toContain(caseBId);

    await expect(caller.afterSale.transition({ id: caseBId, status: 'in_progress' })).rejects.toBeTruthy();
    await expect(caller.afterSale.assign({ id: caseBId, assignedToId: assigneeUserId })).rejects.toBeTruthy();
  });
});
