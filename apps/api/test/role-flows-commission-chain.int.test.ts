import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

describe('role-flows P3: commission chain from opportunity to receipt', () => {
  const FACILITY = 1;

  let course: { id: string };
  let seller: { id: string };
  let otherSeller: { id: string };

  const made = {
    userIds: [] as string[],
    courseIds: [] as string[],
    studentIds: [] as string[],
    contactIds: [] as string[],
    opportunityIds: [] as string[],
    receiptIds: [] as string[],
  };

  beforeAll(async () => {
    await superAdminUserId();
    const suffix = uniq('p3');
    const rows = await withRls(SUPER, async (tx) => {
      const sellerUser = await tx.appUser.create({
        data: {
          email: `sale-${suffix}@cmc.test`,
          displayName: 'P3 Sale',
          passwordHash: 'dummy',
          primaryRole: 'sale',
          roles: ['sale'],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      });
      const other = await tx.appUser.create({
        data: {
          email: `sale-other-${suffix}@cmc.test`,
          displayName: 'P3 Other Sale',
          passwordHash: 'dummy',
          primaryRole: 'sale',
          roles: ['sale'],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      });
      const c = await tx.course.create({
        data: { code: uniq('P3CRS'), name: 'P3 Commission Chain Course', program: 'UCREA' },
      });
      await tx.coursePrice.create({
        data: {
          facilityId: FACILITY,
          courseId: c.id,
          amount: 10_000_000,
          effectiveFrom: new Date('2020-01-01'),
        },
      });
      return { sellerUser, other, c };
    });
    seller = { id: rows.sellerUser.id };
    otherSeller = { id: rows.other.id };
    course = { id: rows.c.id };
    made.userIds.push(rows.sellerUser.id, rows.other.id);
    made.courseIds.push(rows.c.id);
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.receipt.deleteMany({ where: { id: { in: made.receiptIds } } });
      await tx.opportunity.deleteMany({ where: { id: { in: made.opportunityIds } } });
      await tx.contact.deleteMany({ where: { id: { in: made.contactIds } } });
      await tx.student.deleteMany({ where: { id: { in: made.studentIds } } });
      await tx.coursePrice.deleteMany({ where: { courseId: { in: made.courseIds } } });
      await tx.course.deleteMany({ where: { id: { in: made.courseIds } } });
      await tx.appUser.deleteMany({ where: { id: { in: made.userIds } } });
    });
  });

  async function saleCaller(userId = seller.id) {
    return staffCaller({
      userId,
      roles: [Role.sale],
      primaryRole: Role.sale,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });
  }

  async function makeStudent(name = uniq('Student')) {
    const student = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode: uniq('HS'),
          fullName: name,
          program: 'UCREA',
        },
      }),
    );
    made.studentIds.push(student.id);
    return student;
  }

  async function makeOpportunity(name: string, ownerId = seller.id, stage = 'O4_TESTED') {
    const contact = await withRls(SUPER, (tx) =>
      tx.contact.create({
        data: { facilityId: FACILITY, fullName: `${name} Parent`, phone: uniq('09') },
      }),
    );
    const opp = await withRls(SUPER, (tx) =>
      tx.opportunity.create({
        data: {
          facilityId: FACILITY,
          contactId: contact.id,
          studentName: name,
          program: 'UCREA',
          stage: stage as never,
          ownerId,
        },
      }),
    );
    made.contactIds.push(contact.id);
    made.opportunityIds.push(opp.id);
    return opp;
  }

  it('sale creates draft from opportunity; approve freezes commission and auto-wins the opportunity', async () => {
    const sale = await saleCaller();
    const director = await staffCaller();
    const student = await makeStudent('Auto Win Student');
    const opp = await makeOpportunity(student.fullName);

    const draft = await sale.finance.receiptCreate({
      facilityId: FACILITY,
      studentId: student.id,
      courseId: course.id,
      yearsPrepaid: 1,
      opportunityId: opp.id,
    });
    made.receiptIds.push(draft.id);

    const ownBefore = await sale.finance.receiptListOwn({ opportunityId: opp.id });
    expect(ownBefore.map((r) => r.id)).toContain(draft.id);

    const approved = await director.finance.receiptApprove({ id: draft.id });
    expect(approved.soldById).toBe(seller.id);
    expect(approved.kind).toBe('new');

    const won = await withRls(SUPER, (tx) =>
      tx.opportunity.findUniqueOrThrow({ where: { id: opp.id } }),
    );
    expect(won.stage).toBe('O5_ENROLLED');
    expect(won.closedAt).toBeTruthy();
    expect(won.lostReason).toBeNull();

    const ownAfter = await sale.finance.receiptListOwn({ opportunityId: opp.id });
    expect(ownAfter.find((r) => r.id === draft.id)?.status).toBe('approved');
  });

  it('win-back linked opportunity still classifies as new despite prior receipt history', async () => {
    const director = await staffCaller();
    const student = await makeStudent('Win Back Student');
    const first = await director.finance.receiptCreate({
      facilityId: FACILITY,
      studentId: student.id,
      courseId: course.id,
      yearsPrepaid: 1,
    });
    const firstApproved = await director.finance.receiptApprove({ id: first.id });
    made.receiptIds.push(firstApproved.id);

    const opp = await makeOpportunity(student.fullName);
    const draft = await (
      await saleCaller()
    ).finance.receiptCreate({
      facilityId: FACILITY,
      studentId: student.id,
      courseId: course.id,
      yearsPrepaid: 1,
      opportunityId: opp.id,
    });
    made.receiptIds.push(draft.id);

    const approved = await director.finance.receiptApprove({ id: draft.id });
    expect(approved.kind).toBe('new');
    expect(approved.soldById).toBe(seller.id);
  });

  it('student-name mismatch drops attribution and does not auto-win the linked opportunity', async () => {
    const student = await makeStudent('Real Student');
    const opp = await makeOpportunity('Different Name');
    const draft = await (
      await saleCaller()
    ).finance.receiptCreate({
      facilityId: FACILITY,
      studentId: student.id,
      courseId: course.id,
      yearsPrepaid: 1,
      opportunityId: opp.id,
    });
    made.receiptIds.push(draft.id);

    const approved = await (await staffCaller()).finance.receiptApprove({ id: draft.id });
    expect(approved.soldById).toBeNull();

    const unchanged = await withRls(SUPER, (tx) =>
      tx.opportunity.findUniqueOrThrow({ where: { id: opp.id } }),
    );
    expect(unchanged.stage).toBe('O4_TESTED');
    expect(unchanged.closedAt).toBeNull();
  });

  it('lost opportunity is never auto-won by an approved receipt', async () => {
    const student = await makeStudent('Lost Student');
    const opp = await makeOpportunity(student.fullName, seller.id, 'O4_TESTED');
    await withRls(SUPER, (tx) =>
      tx.opportunity.update({
        where: { id: opp.id },
        data: { closedAt: new Date(), lostReason: 'price', lostNote: 'too expensive' },
      }),
    );
    const draft = await (
      await saleCaller()
    ).finance.receiptCreate({
      facilityId: FACILITY,
      studentId: student.id,
      courseId: course.id,
      yearsPrepaid: 1,
      opportunityId: opp.id,
    });
    made.receiptIds.push(draft.id);

    const approved = await (await staffCaller()).finance.receiptApprove({ id: draft.id });
    expect(approved.soldById).toBeNull();

    const lost = await withRls(SUPER, (tx) =>
      tx.opportunity.findUniqueOrThrow({ where: { id: opp.id } }),
    );
    expect(lost.stage).toBe('O4_TESTED');
    expect(lost.closedAt).toBeTruthy();
    expect(lost.lostReason).toBe('price');
  });

  it('cancel of the only approved linked receipt reverts the auto-won opportunity to O4', async () => {
    const student = await makeStudent('Cancel Revert Student');
    const opp = await makeOpportunity(student.fullName);
    const draft = await (
      await saleCaller()
    ).finance.receiptCreate({
      facilityId: FACILITY,
      studentId: student.id,
      courseId: course.id,
      yearsPrepaid: 1,
      opportunityId: opp.id,
    });
    const approved = await (await staffCaller()).finance.receiptApprove({ id: draft.id });
    made.receiptIds.push(approved.id);

    await (await staffCaller()).finance.receiptCancel({ id: approved.id, reason: 'test cancel' });

    const reverted = await withRls(SUPER, (tx) =>
      tx.opportunity.findUniqueOrThrow({ where: { id: opp.id } }),
    );
    expect(reverted.stage).toBe('O4_TESTED');
    expect(reverted.closedAt).toBeNull();
  });

  it('sale receiptListOwn is scoped to collectedById=self', async () => {
    const student = await makeStudent('Scoped Receipt Student');
    const ownOpp = await makeOpportunity(student.fullName, seller.id);
    const otherOpp = await makeOpportunity(student.fullName, otherSeller.id);
    const ownDraft = await (
      await saleCaller(seller.id)
    ).finance.receiptCreate({
      facilityId: FACILITY,
      studentId: student.id,
      courseId: course.id,
      yearsPrepaid: 1,
      opportunityId: ownOpp.id,
    });
    const otherDraft = await (
      await saleCaller(otherSeller.id)
    ).finance.receiptCreate({
      facilityId: FACILITY,
      studentId: student.id,
      courseId: course.id,
      yearsPrepaid: 1,
      opportunityId: otherOpp.id,
    });
    made.receiptIds.push(ownDraft.id, otherDraft.id);

    const ownList = await (await saleCaller(seller.id)).finance.receiptListOwn();
    expect(ownList.map((r) => r.id)).toContain(ownDraft.id);
    expect(ownList.map((r) => r.id)).not.toContain(otherDraft.id);
    await expect((await saleCaller(seller.id)).finance.receiptList()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
