import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { DISCOUNT_CAP_PERCENT } from '@cmc/domain-finance';
import { staffCaller, withRls, SUPER, uniq, assertSuccess } from './helpers.js';

// Discount-tier config UI (plans/260702-1109-finance-ops/phase-04-discount-tier-ui.md).
// discountTier rows are read at pricing time (finance.ts tiersFor) but were previously
// unmanageable — this suite proves the CRUD is correct, capped, upserts on the archived-row
// collision instead of inserting a duplicate, and actually reprices the next receipt.
//
// NOTE on ordering: tiersFor() is all-or-nothing per facility — once ANY active row exists for
// a facility, pricing reads ONLY that facility's rows (never merged with DEFAULT_DISCOUNT_TIERS
// per-year). So the "0 rows → still on defaults" assertion can only be made once, before any
// other test in this file writes a row for FACILITY_A. Each subsequent test therefore uses a
// distinct `years` value so it never collides with a row an earlier test left behind.
describe('finance.discountTier* — per-facility config CRUD', () => {
  const FACILITY_A = 1; // HQ (seeded)
  const FACILITY_B = 2; // CS2 (seeded)
  let courseId: string;
  let gdkdId: string;
  let gdkdOtherFacilityId: string;
  const created = {
    courseIds: [] as string[],
    studentIds: [] as string[],
    receiptIds: [] as string[],
    userIds: [] as string[],
  };

  const gdkdCaller = () =>
    staffCaller({
      userId: gdkdId,
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [FACILITY_A],
    });
  const gdkdOtherFacilityCaller = () =>
    staffCaller({
      userId: gdkdOtherFacilityId,
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [FACILITY_B],
    });

  beforeAll(async () => {
    // Defensive: a prior interrupted run's afterAll is one atomic transaction — if any statement
    // in it fails, the whole cleanup rolls back and leaves fixed-facility rows behind. Since this
    // suite depends on FACILITY_A/B starting with 0 discountTier rows, clear them first.
    await withRls(SUPER, (tx) =>
      tx.discountTier.deleteMany({ where: { facilityId: { in: [FACILITY_A, FACILITY_B] } } }),
    );
    const courseCode = uniq('CRS');
    await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({
        data: { code: courseCode, name: 'Discount tier test course', program: 'UCREA' },
      });
      courseId = course.id;
      created.courseIds.push(course.id);
      for (const facilityId of [FACILITY_A, FACILITY_B]) {
        await tx.coursePrice.create({
          data: {
            facilityId,
            courseId: course.id,
            amount: 10_000_000,
            effectiveFrom: new Date('2020-01-01'),
          },
        });
      }

      const gdkd = await tx.appUser.create({
        data: {
          email: uniq('gdkd-discount-tier@cmc.test'),
          displayName: 'GDKD discount tier test',
          passwordHash: 'test',
          primaryRole: Role.giam_doc_kinh_doanh,
          roles: [Role.giam_doc_kinh_doanh],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY_A }] },
        },
      });
      gdkdId = gdkd.id;
      created.userIds.push(gdkd.id);

      const gdkdOther = await tx.appUser.create({
        data: {
          email: uniq('gdkd-discount-tier-b@cmc.test'),
          displayName: 'GDKD discount tier test (facility B)',
          passwordHash: 'test',
          primaryRole: Role.giam_doc_kinh_doanh,
          roles: [Role.giam_doc_kinh_doanh],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY_B }] },
        },
      });
      gdkdOtherFacilityId = gdkdOther.id;
      created.userIds.push(gdkdOther.id);
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.discountTier.deleteMany({ where: { facilityId: { in: [FACILITY_A, FACILITY_B] } } });
      await tx.receipt.deleteMany({ where: { id: { in: created.receiptIds } } });
      await tx.student.deleteMany({ where: { id: { in: created.studentIds } } });
      await tx.coursePrice.deleteMany({ where: { courseId: { in: created.courseIds } } });
      await tx.course.deleteMany({ where: { id: { in: created.courseIds } } });
      await tx.employmentProfile.deleteMany({ where: { userId: { in: created.userIds } } });
      await tx.userFacility.deleteMany({ where: { userId: { in: created.userIds } } });
      // receiptCreate notifies ke_toan facility users — our gdkd fixtures aren't ke_toan, but
      // clear defensively before deleting the users (FK on staff_notification.recipient_id).
      await tx.staffNotification.deleteMany({ where: { recipientId: { in: created.userIds } } });
      await tx.appUser.deleteMany({ where: { id: { in: created.userIds } } });
    });
  });

  // Runs FIRST and exclusively covers years=2 — the only test allowed to observe FACILITY_A at
  // 0 active rows (every later test writes a different `years` value on the same facility).
  it('(a)+(d) 0 rows → defaults; upserting flips the defaults-flag and reprices the next receipt', async () => {
    const caller = await gdkdCaller();

    const before = await caller.finance.discountTierList({ facilityId: FACILITY_A });
    expect(before.usingDefaults).toBe(true);
    expect(before.tiers).toHaveLength(0);

    const student = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: {
          facilityId: FACILITY_A,
          studentCode: uniq('HS'),
          fullName: 'Discount tier repricing HS',
          program: 'UCREA',
        },
      }),
    );
    created.studentIds.push(student.id);

    const draftOnDefault = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY_A,
      studentId: student.id,
      courseId,
      yearsPrepaid: 2,
    }));
    created.receiptIds.push(draftOnDefault.id);
    expect(draftOnDefault.tierPercent).toBe(20); // DEFAULT_DISCOUNT_TIERS 2y=20

    const tier = await caller.finance.discountTierUpsert({
      facilityId: FACILITY_A,
      years: 2,
      percent: 12,
    });
    expect(tier.percent).toBe(12);
    expect(tier.archivedAt).toBeNull();

    const after = await caller.finance.discountTierList({ facilityId: FACILITY_A });
    expect(after.usingDefaults).toBe(false);
    expect(after.tiers.map((t) => t.years)).toContain(2);

    const draftOnConfigured = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY_A,
      studentId: student.id,
      courseId,
      yearsPrepaid: 2,
    }));
    created.receiptIds.push(draftOnConfigured.id);
    expect(draftOnConfigured.tierPercent).toBe(12);
    expect(draftOnConfigured.effectiveDiscountPercent).toBe(12);
  });

  it('(b) percent above the domain cap is rejected server-side', async () => {
    const caller = await gdkdCaller();
    await expect(
      caller.finance.discountTierUpsert({
        facilityId: FACILITY_A,
        years: 99, // dedicated, unused elsewhere in this suite — rejected before any write anyway
        percent: DISCOUNT_CAP_PERCENT + 1,
      }),
    ).rejects.toThrow();
  });

  it('(c) archiving then re-adding the SAME years clears archivedAt and updates percent on the SAME row', async () => {
    const caller = await gdkdCaller();
    const tier = await caller.finance.discountTierUpsert({
      facilityId: FACILITY_A,
      years: 3,
      percent: 25,
    });

    await caller.finance.discountTierArchive({ id: tier.id });
    const archived = await withRls(SUPER, (tx) =>
      tx.discountTier.findUniqueOrThrow({ where: { id: tier.id } }),
    );
    expect(archived.archivedAt).not.toBeNull();

    const readded = await caller.finance.discountTierUpsert({
      facilityId: FACILITY_A,
      years: 3,
      percent: 30,
    });
    expect(readded.id).toBe(tier.id); // same row, not a new insert
    expect(readded.archivedAt).toBeNull();
    expect(readded.percent).toBe(30);

    const rows = await withRls(SUPER, (tx) =>
      tx.discountTier.findMany({ where: { facilityId: FACILITY_A, years: 3 } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(tier.id);
  });

  it('(e) a facility-B caller cannot list or edit facility-A tiers (RLS)', async () => {
    const aCaller = await gdkdCaller();
    const seedTier = await aCaller.finance.discountTierUpsert({
      facilityId: FACILITY_A,
      years: 1,
      percent: 19,
    });

    const bCaller = await gdkdOtherFacilityCaller();
    const leaked = await bCaller.finance.discountTierList({ facilityId: FACILITY_A });
    expect(leaked.tiers).toHaveLength(0);

    await expect(
      bCaller.finance.discountTierUpsert({ facilityId: FACILITY_A, years: 1, percent: 5 }),
    ).rejects.toThrow();

    await expect(bCaller.finance.discountTierArchive({ id: seedTier.id })).rejects.toThrow();

    // The row must be untouched by the rejected cross-facility writes.
    const stillThere = await withRls(SUPER, (tx) =>
      tx.discountTier.findUniqueOrThrow({ where: { id: seedTier.id } }),
    );
    expect(stillThere.percent).toBe(19);
    expect(stillThere.archivedAt).toBeNull();
  });
});
