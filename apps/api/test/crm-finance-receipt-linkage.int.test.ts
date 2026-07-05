/**
 * Integration tests for decision 0037 (CRM ↔ finance receipt linkage):
 *   Phase 1 — crm.opportunityLookupByPhone: narrow existence-check query + permission boundary
 *   Phase 2 — finance.receiptCreate soft duplicate-opportunity warning + confirmDuplicate bypass
 *
 * Requires Postgres and seeded super_admin user.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { TRPCError } from '@trpc/server';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId, assertSuccess } from './helpers.js';

const FACILITY = 1;
const OTHER_FACILITY = 2;

describe('CRM ↔ finance receipt linkage (decision 0037)', () => {
  let dbReachable = false;
  let courseId: string;
  const cleanup = {
    userIds: [] as string[],
    contactIds: [] as string[],
    opportunityIds: [] as string[],
    receiptIds: [] as string[],
    studentIds: [] as string[],
    courseIds: [] as string[],
  };

  async function staffOf(role: Role, facilityId = FACILITY) {
    const user = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq(`${role}-crm-finance-link@cmc.test`),
          displayName: `${role} crm-finance-link test`,
          passwordHash: 'test',
          primaryRole: role,
          roles: [role],
          isActive: true,
          facilities: { create: [{ facilityId }] },
        },
      }),
    );
    cleanup.userIds.push(user.id);
    return staffCaller({
      userId: user.id,
      roles: [role],
      primaryRole: role,
      isSuperAdmin: false,
      facilityIds: [facilityId],
    });
  }

  async function makeOpenOpportunity(phone: string, studentName: string, facilityId = FACILITY) {
    const admin = await staffCaller();
    const contact = await admin.crm.contactCreate({
      facilityId,
      fullName: `PH của ${studentName}`,
      phone,
    });
    cleanup.contactIds.push(contact.id);
    const opp = await admin.crm.opportunityCreate({ contactId: contact.id, studentName });
    cleanup.opportunityIds.push(opp.id);
    return opp;
  }

  beforeAll(async () => {
    try {
      await superAdminUserId();
      dbReachable = true;
    } catch {
      console.warn('⚠ DB not reachable — crm-finance-receipt-linkage tests skipped');
      return;
    }
    const code = uniq('CRS-LINK');
    await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({ data: { code, name: `Link Course ${code}`, program: 'UCREA' } });
      courseId = course.id;
      cleanup.courseIds.push(course.id);
      await tx.coursePrice.create({
        data: { facilityId: FACILITY, courseId, amount: 10_000_000, effectiveFrom: new Date('2020-01-01') },
      });
    });
  });

  afterAll(async () => {
    if (!dbReachable) return;
    await withRls(SUPER, async (tx) => {
      if (cleanup.receiptIds.length) {
        await tx.enrollment.updateMany({ where: { createdByReceiptId: { in: cleanup.receiptIds } }, data: { createdByReceiptId: null } });
        await tx.student.updateMany({ where: { createdByReceiptId: { in: cleanup.receiptIds } }, data: { createdByReceiptId: null } });
        await tx.receipt.deleteMany({ where: { id: { in: cleanup.receiptIds } } });
      }
      if (cleanup.studentIds.length) {
        await tx.guardian.deleteMany({ where: { studentId: { in: cleanup.studentIds } } });
        await tx.student.deleteMany({ where: { id: { in: cleanup.studentIds } } });
      }
      if (cleanup.opportunityIds.length) {
        await tx.opportunity.deleteMany({ where: { id: { in: cleanup.opportunityIds } } });
      }
      if (cleanup.contactIds.length) {
        await tx.contact.deleteMany({ where: { id: { in: cleanup.contactIds } } });
      }
      if (cleanup.courseIds.length) {
        await tx.coursePrice.deleteMany({ where: { courseId: { in: cleanup.courseIds } } });
        await tx.course.deleteMany({ where: { id: { in: cleanup.courseIds } } });
      }
      if (cleanup.userIds.length) {
        // receiptCreate notifies ke_toan/giam_doc_kinh_doanh facility users (receipt_pending_approval)
        // — clear those rows first or the FK on staff_notification.recipient_id blocks the delete.
        await tx.staffNotification.deleteMany({ where: { recipientId: { in: cleanup.userIds } } });
        await tx.appUser.deleteMany({ where: { id: { in: cleanup.userIds } } });
      }
    });
  });

  // ── Phase 1: opportunityLookupByPhone ──────────────────────────────────────

  it('opportunityLookupByPhone: 0 matches for a phone with no opportunity', async () => {
    if (!dbReachable) return;
    const ketoan = await staffOf(Role.ke_toan);
    const phone = `+84${uniq('1')}`.slice(0, 12);
    const matches = await ketoan.crm.opportunityLookupByPhone({ facilityId: FACILITY, phone });
    expect(matches).toHaveLength(0);
  });

  it('opportunityLookupByPhone: 1 match for a phone with exactly one open opportunity', async () => {
    if (!dbReachable) return;
    const phone = `+84${uniq('2')}`.slice(0, 12);
    const opp = await makeOpenOpportunity(phone, 'HS Lookup Single');
    const ketoan = await staffOf(Role.ke_toan);
    const matches = await ketoan.crm.opportunityLookupByPhone({ facilityId: FACILITY, phone });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe(opp.id);
    expect(matches[0]?.studentName).toBe('HS Lookup Single');
  });

  it('opportunityLookupByPhone: ≥2 matches for siblings sharing one parent phone', async () => {
    if (!dbReachable) return;
    const phone = `+84${uniq('3')}`.slice(0, 12);
    // Same contact (same facility+phone dedupes to 1 Contact), two opportunities for two children.
    const admin = await staffCaller();
    const contact = await admin.crm.contactCreate({ facilityId: FACILITY, fullName: 'PH Anh Em', phone });
    cleanup.contactIds.push(contact.id);
    const oppA = await admin.crm.opportunityCreate({ contactId: contact.id, studentName: 'HS Anh' });
    const oppB = await admin.crm.opportunityCreate({ contactId: contact.id, studentName: 'HS Em' });
    cleanup.opportunityIds.push(oppA.id, oppB.id);

    const ketoan = await staffOf(Role.ke_toan);
    const matches = await ketoan.crm.opportunityLookupByPhone({ facilityId: FACILITY, phone });
    expect(matches.length).toBeGreaterThanOrEqual(2);
    const names = matches.map((m) => m.studentName).sort();
    expect(names).toEqual(['HS Anh', 'HS Em']);
  });

  it('opportunityLookupByPhone: never returns an opportunity from a different facility', async () => {
    if (!dbReachable) return;
    const phone = `+84${uniq('4')}`.slice(0, 12);
    await makeOpenOpportunity(phone, 'HS Other Facility', OTHER_FACILITY);
    const ketoan = await staffOf(Role.ke_toan);
    const matches = await ketoan.crm.opportunityLookupByPhone({ facilityId: FACILITY, phone });
    expect(matches).toHaveLength(0);
  });

  // ── Permission boundary: the central claim of decision 0037 ────────────────

  it('ke_toan CAN call opportunityLookupByPhone but CANNOT call opportunityList (no CRM nav-tab exposure)', async () => {
    if (!dbReachable) return;
    const ketoan = await staffOf(Role.ke_toan);
    await expect(
      ketoan.crm.opportunityLookupByPhone({ facilityId: FACILITY, phone: '+84900000000' }),
    ).resolves.toBeDefined();
    await expect(ketoan.crm.opportunityList({ facilityId: FACILITY })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    } satisfies Partial<TRPCError>);
  });

  // ── Phase 2: soft duplicate-opportunity warning on receiptCreate ────────────

  it('receiptCreate: warns (does not create) when a new-student phone matches an open opportunity', async () => {
    if (!dbReachable) return;
    const phone = `+84${uniq('5')}`.slice(0, 12);
    const opp = await makeOpenOpportunity(phone, 'HS Duplicate Warn');
    const caller = await staffCaller();

    const result = await caller.finance.receiptCreate({
      facilityId: FACILITY,
      courseId,
      yearsPrepaid: 1,
      parentPhone: phone,
      studentName: 'HS Duplicate Warn Retyped',
      // no opportunityId — this is the exact "forgot to link" scenario decision 0037 defends against
    });

    expect(result.status).toBe('warning');
    if (result.status === 'warning') {
      expect(result.duplicateWarning.opportunityId).toBe(opp.id);
      expect(result.duplicateWarning.studentName).toBe('HS Duplicate Warn');
    }
    // No receipt should exist for this phone.
    const receipts = await withRls(SUPER, (tx) => tx.receipt.findMany({ where: { parentPhone: phone } }));
    expect(receipts).toHaveLength(0);
  });

  it('receiptCreate: confirmDuplicate:true bypasses the warning and creates the receipt', async () => {
    if (!dbReachable) return;
    const phone = `+84${uniq('6')}`.slice(0, 12);
    await makeOpenOpportunity(phone, 'HS Duplicate Confirm');
    const caller = await staffCaller();

    const result = await caller.finance.receiptCreate({
      facilityId: FACILITY,
      courseId,
      yearsPrepaid: 1,
      parentPhone: phone,
      studentName: 'HS Duplicate Confirm Retyped',
      confirmDuplicate: true,
    });

    const receipt = assertSuccess(result);
    cleanup.receiptIds.push(receipt.id);
    expect(receipt.parentPhone).toBe(phone);
  });

  it('receiptCreate: two siblings sharing one phone can both be created via confirmDuplicate (never hard-blocked)', async () => {
    if (!dbReachable) return;
    const phone = `+84${uniq('7')}`.slice(0, 12);
    const caller = await staffCaller();

    const first = assertSuccess(
      await caller.finance.receiptCreate({
        facilityId: FACILITY,
        courseId,
        yearsPrepaid: 1,
        parentPhone: phone,
        studentName: 'HS Sibling One',
      }),
    );
    cleanup.receiptIds.push(first.id);

    // Second child, same phone, no opportunity involved this time — no warning expected since the
    // duplicate check only looks at CRM Opportunity rows, not prior receipts.
    const second = assertSuccess(
      await caller.finance.receiptCreate({
        facilityId: FACILITY,
        courseId,
        yearsPrepaid: 1,
        parentPhone: phone,
        studentName: 'HS Sibling Two',
      }),
    );
    cleanup.receiptIds.push(second.id);
    expect(second.id).not.toBe(first.id);
  });

  it('receiptCreate: opportunityId already supplied never triggers the warning, even if phone matches', async () => {
    if (!dbReachable) return;
    const phone = `+84${uniq('8')}`.slice(0, 12);
    const opp = await makeOpenOpportunity(phone, 'HS Already Linked');
    const caller = await staffCaller();

    const result = await caller.finance.receiptCreate({
      facilityId: FACILITY,
      courseId,
      yearsPrepaid: 1,
      parentPhone: phone,
      studentName: 'HS Already Linked',
      opportunityId: opp.id,
    });

    const receipt = assertSuccess(result);
    cleanup.receiptIds.push(receipt.id);
    expect(receipt.opportunityId).toBe(opp.id);
  });

  it('receiptCreate: existing-student path (studentId set) never triggers the duplicate check', async () => {
    if (!dbReachable) return;
    const phone = `+84${uniq('9')}`.slice(0, 12);
    await makeOpenOpportunity(phone, 'HS Existing Path Unrelated');
    const student = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('HS'), fullName: 'Existing Student', program: 'UCREA' },
      }),
    );
    cleanup.studentIds.push(student.id);
    const caller = await staffCaller();

    // studentId path doesn't send parentPhone at all — the guard only triggers on the new-student
    // path (parentPhone set), so this must succeed regardless of the unrelated opportunity above.
    const result = await caller.finance.receiptCreate({
      facilityId: FACILITY,
      studentId: student.id,
      courseId,
      yearsPrepaid: 1,
    });
    const receipt = assertSuccess(result);
    cleanup.receiptIds.push(receipt.id);
    expect(receipt.studentId).toBe(student.id);
  });
});
