import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

/**
 * Sales-ops invariants (B1 assignment log, B2 channel attribution).
 * - opportunityCreate writes the first assignment (from=null → owner).
 * - opportunityReassign (manager-only) updates owner + appends a log row; history is append-only desc.
 * - non-manager reassign is FORBIDDEN by the permission registry.
 * - contactCreate persists structured attribution (medium/campaign).
 */
describe('CRM sales-ops — assignment log + attribution', () => {
  const FACILITY = 1;
  const made = { contactIds: [] as string[], oppIds: [] as string[], userIds: [] as string[] };

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.opportunityAssignment.deleteMany({ where: { opportunityId: { in: made.oppIds } } });
      await tx.opportunity.deleteMany({ where: { id: { in: made.oppIds } } });
      await tx.contact.deleteMany({ where: { id: { in: made.contactIds } } });
      // user_facility cascades on app_user delete.
      await tx.appUser.deleteMany({ where: { id: { in: made.userIds } } });
    });
  });

  /** Create an active staff user with access to FACILITY (a valid reassign target). */
  async function makeStaff(): Promise<string> {
    const u = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: `${uniq('staff')}@cmc.local`,
          displayName: 'Reassign target',
          passwordHash: 'x',
          roles: ['sale'],
          primaryRole: 'sale',
          facilities: { create: [{ facilityId: FACILITY }] },
        },
        select: { id: true },
      }),
    );
    made.userIds.push(u.id);
    return u.id;
  }

  async function newContact(caller: Awaited<ReturnType<typeof staffCaller>>, extra?: { medium?: string; campaign?: string }) {
    const contact = await caller.crm.contactCreate({
      facilityId: FACILITY,
      fullName: `Lead ${uniq('sops')}`,
      phone: uniq('09'),
      source: 'web',
      ...extra,
    });
    made.contactIds.push(contact.id);
    return contact;
  }

  const managerCaller = () =>
    staffCaller({
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });
  const saleCaller = () =>
    staffCaller({ roles: [Role.sale], primaryRole: Role.sale, isSuperAdmin: false, facilityIds: [FACILITY] });

  it('opportunityCreate logs the first assignment (from=null → owner)', async () => {
    const owner = await superAdminUserId();
    const caller = await staffCaller(); // super, owner defaults to self
    const contact = await newContact(caller);
    const opp = await caller.crm.opportunityCreate({ contactId: contact.id, studentName: 'A' });
    made.oppIds.push(opp.id);

    const history = await caller.crm.assignmentHistory({ opportunityId: opp.id });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromOwnerId: null, toOwnerId: owner });
  });

  it('opportunityReassign (manager) updates owner + appends a log row; history desc', async () => {
    const caller = await staffCaller();
    const contact = await newContact(caller);
    const opp = await caller.crm.opportunityCreate({ contactId: contact.id, studentName: 'B' });
    made.oppIds.push(opp.id);

    const newOwner = await makeStaff(); // valid active staff in FACILITY
    const mgr = await managerCaller();
    const updated = await mgr.crm.opportunityReassign({ id: opp.id, toOwnerId: newOwner, reason: 'Chia lại vùng' });
    expect(updated.ownerId).toBe(newOwner);

    const history = await mgr.crm.assignmentHistory({ opportunityId: opp.id });
    expect(history).toHaveLength(2);
    // newest first
    expect(history[0]).toMatchObject({ toOwnerId: newOwner, reason: 'Chia lại vùng' });
    expect(history[1]).toMatchObject({ fromOwnerId: null });
  });

  it('reassign to a non-staff UUID → BAD_REQUEST (owner must be facility staff)', async () => {
    const caller = await staffCaller();
    const contact = await newContact(caller);
    const opp = await caller.crm.opportunityCreate({ contactId: contact.id, studentName: 'B2' });
    made.oppIds.push(opp.id);

    const mgr = await managerCaller();
    await expect(mgr.crm.opportunityReassign({ id: opp.id, toOwnerId: randomUUID() })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('reassign to the current owner → BAD_REQUEST', async () => {
    const owner = await superAdminUserId();
    const caller = await staffCaller();
    const contact = await newContact(caller);
    const opp = await caller.crm.opportunityCreate({ contactId: contact.id, studentName: 'C' });
    made.oppIds.push(opp.id);

    const mgr = await managerCaller();
    await expect(mgr.crm.opportunityReassign({ id: opp.id, toOwnerId: owner })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('non-manager (sale) reassign is FORBIDDEN', async () => {
    const caller = await staffCaller();
    const contact = await newContact(caller);
    const opp = await caller.crm.opportunityCreate({ contactId: contact.id, studentName: 'D' });
    made.oppIds.push(opp.id);

    const sale = await saleCaller();
    await expect(sale.crm.opportunityReassign({ id: opp.id, toOwnerId: randomUUID() })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('contactCreate persists structured attribution (medium/campaign)', async () => {
    const caller = await staffCaller();
    const contact = await newContact(caller, { medium: 'cpc', campaign: 'he-2026' });
    const fromDb = await withRls(SUPER, (tx) =>
      tx.contact.findUniqueOrThrow({ where: { id: contact.id }, select: { medium: true, campaign: true } }),
    );
    expect(fromDb).toMatchObject({ medium: 'cpc', campaign: 'he-2026' });
  });
});
