import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { Role } from '@cmc/auth';
import { starBalance } from '@cmc/domain-rewards';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Phase 02 — gift CRUD completeness, manual star adjustment, and the delivered terminal
// status. Covers: giftUpdate diffs+audits, giftArchive drops from active list, stockAdjust
// enforces out-of-stock on redeem, starAdjust writes distinct-reference manual ledger rows
// and rejects amount=0, markDelivered is a one-way approved→delivered transition, and every
// new procedure is director-gated (FORBIDDEN for non-directors).
describe('rewards gift/star/redeem admin (phase 02)', () => {
  const FACILITY = 1;
  let studentId: string;
  let giftId: string;

  function director() {
    return staffCaller({
      isSuperAdmin: false,
      facilityIds: [FACILITY],
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
    });
  }

  function nonDirector() {
    return staffCaller({
      isSuperAdmin: false,
      facilityIds: [FACILITY],
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
    });
  }

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      const s = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('HSGA'), fullName: 'HS gift-admin', program: 'UCREA' },
      });
      studentId = s.id;
      const g = await tx.gift.create({
        data: { facilityId: FACILITY, name: uniq('GIFTADMIN'), starsRequired: 5, stock: 3 },
      });
      giftId = g.id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.reward.deleteMany({ where: { studentId } });
      await tx.starTransaction.deleteMany({ where: { studentId } });
      await tx.gift.deleteMany({ where: { id: giftId } });
      await tx.student.deleteMany({ where: { id: studentId } });
    });
  });

  it('giftUpdate changes fields and writes an audit row', async () => {
    const staff = await director();
    const updated = await staff.rewards.giftUpdate({ id: giftId, name: uniq('GIFTADMIN-RENAMED'), starsRequired: 7 });
    expect(updated.starsRequired).toBe(7);

    const events = await withRls(SUPER, (tx) =>
      tx.recordEvent.findMany({ where: { entityType: 'gift', entityId: giftId, type: 'updated' } }),
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('giftArchive drops the gift from the active gifts list', async () => {
    const lms = {
      kind: 'student' as const,
      accountId: uniq('acct'),
      displayName: 'HS',
      students: [{ id: studentId, fullName: 'HS' }],
      studentIds: [studentId],
      facilityIds: [FACILITY],
    };
    const { lmsCaller } = await import('./helpers.js');
    const before = await lmsCaller(lms).rewards.gifts();
    expect(before.some((g) => g.id === giftId)).toBe(true);

    const staff = await director();
    await staff.rewards.giftArchive({ id: giftId });

    const after = await lmsCaller(lms).rewards.gifts();
    expect(after.some((g) => g.id === giftId)).toBe(false);
  });

  it('stockAdjust to 0 makes a subsequent redeem return out_of_stock', async () => {
    const staff = await director();
    // Un-archive isn't in scope — use a fresh gift for the redeem path.
    const gift = await withRls(SUPER, (tx) =>
      tx.gift.create({ data: { facilityId: FACILITY, name: uniq('GIFTSTOCK'), starsRequired: 1, stock: 5 } }),
    );
    await staff.rewards.stockAdjust({ id: gift.id, stock: 0 });

    await withRls(SUPER, (tx) =>
      tx.starTransaction.create({
        data: { facilityId: FACILITY, studentId, amount: 100, type: 'manual', reference: uniq('seed') },
      }),
    );
    const lms = {
      kind: 'student' as const,
      accountId: uniq('acct'),
      displayName: 'HS',
      students: [{ id: studentId, fullName: 'HS' }],
      studentIds: [studentId],
      facilityIds: [FACILITY],
    };
    const { lmsCaller } = await import('./helpers.js');
    await expect(lmsCaller(lms).rewards.redeem({ giftId: gift.id })).rejects.toSatisfy(
      (e: unknown) => e instanceof TRPCError && e.code === 'BAD_REQUEST' && e.message === 'out_of_stock',
    );

    await withRls(SUPER, (tx) => tx.gift.deleteMany({ where: { id: gift.id } }));
  });

  it('starAdjust +50 then -20 moves balance by net +30, each writes a distinct manual row', async () => {
    const staff = await director();
    const before = await withRls(SUPER, (tx) => tx.starTransaction.findMany({ where: { studentId } }));
    const baseline = starBalance(before);

    const up = await staff.rewards.starAdjust({ studentId, amount: 50, reason: uniq('bonus') });
    const down = await staff.rewards.starAdjust({ studentId, amount: -20, reason: uniq('correction') });

    expect(up.reference).not.toBeNull();
    expect(down.reference).not.toBeNull();
    expect(up.reference).not.toBe(down.reference);

    const after = await withRls(SUPER, (tx) => tx.starTransaction.findMany({ where: { studentId } }));
    expect(starBalance(after)).toBe(baseline + 30);

    const manualRows = after.filter((t) => t.type === 'manual');
    const refs = new Set(manualRows.map((t) => t.reference));
    expect(refs.size).toBe(manualRows.length); // every manual row has a distinct reference
  });

  it('starAdjust with amount 0 is rejected', async () => {
    const staff = await director();
    await expect(staff.rewards.starAdjust({ studentId, amount: 0, reason: 'noop' })).rejects.toBeTruthy();
  });

  it('markDelivered on approved transitions to delivered; repeat call or pending source rejected', async () => {
    const staff = await director();
    const gift = await withRls(SUPER, (tx) =>
      tx.gift.create({ data: { facilityId: FACILITY, name: uniq('GIFTDELIVER'), starsRequired: 1, stock: -1 } }),
    );
    await withRls(SUPER, (tx) =>
      tx.starTransaction.create({
        data: { facilityId: FACILITY, studentId, amount: 100, type: 'manual', reference: uniq('seed2') },
      }),
    );
    const lms = {
      kind: 'student' as const,
      accountId: uniq('acct'),
      displayName: 'HS',
      students: [{ id: studentId, fullName: 'HS' }],
      studentIds: [studentId],
      facilityIds: [FACILITY],
    };
    const { lmsCaller } = await import('./helpers.js');

    // pending reward → markDelivered rejected (must be approved first).
    const pendingReward = await lmsCaller(lms).rewards.redeem({ giftId: gift.id });
    await expect(staff.rewards.markDelivered({ id: pendingReward.id })).rejects.toSatisfy(
      (e: unknown) => e instanceof TRPCError && e.code === 'BAD_REQUEST',
    );

    await staff.rewards.review({ id: pendingReward.id, decision: 'approved' });
    const delivered = await staff.rewards.markDelivered({ id: pendingReward.id });
    expect(delivered.status).toBe('delivered');

    // Second call on an already-delivered (terminal) row is rejected.
    await expect(staff.rewards.markDelivered({ id: pendingReward.id })).rejects.toSatisfy(
      (e: unknown) => e instanceof TRPCError && e.code === 'BAD_REQUEST',
    );

    await withRls(SUPER, async (tx) => {
      await tx.reward.deleteMany({ where: { giftId: gift.id } });
      await tx.gift.deleteMany({ where: { id: gift.id } });
    });
  });

  it('non-director gets FORBIDDEN on all 5 new procedures', async () => {
    const staff = await nonDirector();
    const gift = await withRls(SUPER, (tx) =>
      tx.gift.create({ data: { facilityId: FACILITY, name: uniq('GIFTFORBID'), starsRequired: 1, stock: -1 } }),
    );

    const forbidden = async (p: Promise<unknown>) =>
      expect(p).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === 'FORBIDDEN');

    await forbidden(staff.rewards.giftUpdate({ id: gift.id, name: 'x' }));
    await forbidden(staff.rewards.giftArchive({ id: gift.id }));
    await forbidden(staff.rewards.stockAdjust({ id: gift.id, stock: 1 }));
    await forbidden(staff.rewards.starAdjust({ studentId, amount: 1, reason: 'x' }));
    await forbidden(staff.rewards.markDelivered({ id: gift.id }));

    await withRls(SUPER, (tx) => tx.gift.deleteMany({ where: { id: gift.id } }));
  });
});
