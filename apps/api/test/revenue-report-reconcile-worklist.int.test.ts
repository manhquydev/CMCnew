import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/db';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

// Plan: plans/260702-1109-finance-ops/phase-03-revenue-reconcile.md
//
// Revenue report (gross/refunds/net by month|facility|course) + CSV export + the
// "chưa đối soát kỳ này" worklist. Read-only aggregation over Receipt + RefundRecord — no
// schema, no new money mutation (worklist reuses the EXISTING finance.receiptReconcile flip).
//
// Period key = Receipt.approvedAt. Every fixture below approves via the real receiptCreate/
// receiptApprove flow (so netAmount/discount math is never hand-duplicated) then overrides
// approvedAt/createdAt with a SUPER write to place it in a controlled, far-future bucket month —
// this keeps the test deterministic and isolated from any other data live in the shared dev DB.
describe('revenueReport / revenueReportCsv / reconcileWorklist', () => {
  let facilityA = 0;
  let facilityB = 0;
  let facilityInjection = 0;
  let courseX = { id: '', code: '' };
  let courseY = { id: '', code: '' };
  let studentA = '';
  let studentB = '';
  let studentInjection = '';

  const created = {
    facilityIds: [] as number[],
    courseIds: [] as string[],
    studentIds: [] as string[],
    receiptIds: [] as string[],
  };

  async function approvedReceipt(opts: {
    facilityId: number;
    studentId: string;
    courseId: string;
    approvedAt: string; // ISO date
  }) {
    const caller = await staffCaller();
    const draft = await caller.finance.receiptCreate({
      facilityId: opts.facilityId,
      studentId: opts.studentId,
      courseId: opts.courseId,
      yearsPrepaid: 1,
    });
    const approved = await caller.finance.receiptApprove({ id: draft.id });
    created.receiptIds.push(approved.id);
    await withRls(SUPER, (tx) =>
      tx.receipt.update({ where: { id: approved.id }, data: { approvedAt: new Date(opts.approvedAt) } }),
    );
    return { id: approved.id, netAmount: approved.netAmount };
  }

  beforeAll(async () => {
    await superAdminUserId();
    const courseXCode = uniq('CRSX');
    const courseYCode = uniq('CRSY');

    await withRls(SUPER, async (tx) => {
      const [a, b, inj] = await Promise.all([
        tx.facility.create({ data: { code: uniq('P3A').slice(0, 24), name: 'P3 Revenue A' } }),
        tx.facility.create({ data: { code: uniq('P3B').slice(0, 24), name: 'P3 Revenue B' } }),
        // Deliberately malicious label — proves the CSV formula-injection guard on a real,
        // grouped text field (facility name), not a synthetic string.
        tx.facility.create({ data: { code: uniq('P3I').slice(0, 24), name: '=1+1+cmd|calc' } }),
      ]);
      facilityA = a.id;
      facilityB = b.id;
      facilityInjection = inj.id;
      created.facilityIds.push(a.id, b.id, inj.id);

      const [cx, cy] = await Promise.all([
        tx.course.create({ data: { code: courseXCode, name: 'P3 Course X', program: 'UCREA' } }),
        tx.course.create({ data: { code: courseYCode, name: 'P3 Course Y', program: 'UCREA' } }),
      ]);
      courseX = cx;
      courseY = cy;
      created.courseIds.push(cx.id, cy.id);

      await tx.coursePrice.createMany({
        data: [
          { facilityId: facilityA, courseId: cx.id, amount: 10_000_000, effectiveFrom: new Date('2020-01-01') },
          { facilityId: facilityA, courseId: cy.id, amount: 20_000_000, effectiveFrom: new Date('2020-01-01') },
          { facilityId: facilityB, courseId: cx.id, amount: 10_000_000, effectiveFrom: new Date('2020-01-01') },
          { facilityId: facilityInjection, courseId: cx.id, amount: 10_000_000, effectiveFrom: new Date('2020-01-01') },
        ],
      });

      const [sa, sb, si] = await Promise.all([
        tx.student.create({
          data: { facilityId: facilityA, studentCode: uniq('HSA'), fullName: 'P3 Student A', program: 'UCREA' },
        }),
        tx.student.create({
          data: { facilityId: facilityB, studentCode: uniq('HSB'), fullName: 'P3 Student B', program: 'UCREA' },
        }),
        tx.student.create({
          data: { facilityId: facilityInjection, studentCode: uniq('HSI'), fullName: 'P3 Student Inj', program: 'UCREA' },
        }),
      ]);
      studentA = sa.id;
      studentB = sb.id;
      studentInjection = si.id;
      created.studentIds.push(sa.id, sb.id, si.id);
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.refundRecord.deleteMany({ where: { receiptId: { in: created.receiptIds } } });
      await tx.receipt.deleteMany({ where: { id: { in: created.receiptIds } } });
      await tx.student.deleteMany({ where: { id: { in: created.studentIds } } });
      await tx.coursePrice.deleteMany({ where: { courseId: { in: created.courseIds } } });
      await tx.course.deleteMany({ where: { id: { in: created.courseIds } } });
      await tx.facility.deleteMany({ where: { id: { in: created.facilityIds } } });
    });
  });

  it('gross by month/facility/course matches a hand-computed sum of seeded qualifying receipts', async () => {
    const caller = await staffCaller();

    const r1 = await approvedReceipt({ facilityId: facilityA, studentId: studentA, courseId: courseX.id, approvedAt: '2031-03-10' });
    const r2 = await approvedReceipt({ facilityId: facilityA, studentId: studentA, courseId: courseY.id, approvedAt: '2031-03-15' });
    const r3 = await approvedReceipt({ facilityId: facilityB, studentId: studentB, courseId: courseX.id, approvedAt: '2031-04-05' });

    const byMonth = await caller.finance.revenueReport({ from: '2031-03-01', to: '2031-05-01', groupBy: 'month' });
    const march = byMonth.find((b) => b.key === '2031-03');
    const april = byMonth.find((b) => b.key === '2031-04');
    expect(march?.gross).toBe(r1.netAmount + r2.netAmount);
    expect(march?.count).toBe(2);
    expect(april?.gross).toBe(r3.netAmount);
    expect(april?.count).toBe(1);

    const byFacility = await caller.finance.revenueReport({ from: '2031-03-01', to: '2031-05-01', groupBy: 'facility' });
    const facA = byFacility.find((b) => b.key === String(facilityA));
    const facB = byFacility.find((b) => b.key === String(facilityB));
    expect(facA?.gross).toBe(r1.netAmount + r2.netAmount);
    expect(facB?.gross).toBe(r3.netAmount);

    const byCourse = await caller.finance.revenueReport({ from: '2031-03-01', to: '2031-05-01', groupBy: 'course' });
    const cx = byCourse.find((b) => b.key === courseX.id);
    const cy = byCourse.find((b) => b.key === courseY.id);
    expect(cx?.gross).toBe(r1.netAmount + r3.netAmount);
    expect(cy?.gross).toBe(r2.netAmount);
  });

  it('net = gross − refunds, verified against a seeded refund from the real refundCreate flow', async () => {
    const caller = await staffCaller();

    const r4 = await approvedReceipt({ facilityId: facilityA, studentId: studentA, courseId: courseX.id, approvedAt: '2031-06-10' });
    const r5 = await approvedReceipt({ facilityId: facilityA, studentId: studentA, courseId: courseX.id, approvedAt: '2031-06-12' });

    // Cancel r5 (was approved → refund is eligible) then record a partial refund via the real
    // guarded mutation from Phase 1 — never hand-insert a RefundRecord row.
    await caller.finance.receiptCancel({ id: r5.id, reason: 'P3 revenue-report refund fixture' });
    const refund = await caller.finance.refundCreate({ receiptId: r5.id, amount: 2_000_000, reason: 'P3 test refund' });
    // Bucket the refund into the same month as the fixture (refund createdAt, not the receipt's
    // approvedAt) — mirrors the real-world case of a same-month refund.
    await withRls(SUPER, (tx) =>
      tx.refundRecord.update({ where: { id: refund.id }, data: { createdAt: new Date('2031-06-15') } }),
    );

    const byMonth = await caller.finance.revenueReport({ from: '2031-06-01', to: '2031-07-01', groupBy: 'month' });
    const june = byMonth.find((b) => b.key === '2031-06');
    // r5 is cancelled → excluded from gross; only r4 contributes.
    expect(june?.gross).toBe(r4.netAmount);
    expect(june?.refunds).toBe(2_000_000);
    expect(june?.net).toBe(r4.netAmount - 2_000_000);
  });

  it('refund bucketed by its OWN createdAt month, distinct from the receipt\'s approvedAt month', async () => {
    const caller = await staffCaller();

    // Approved in 2032-01; cancelled+refunded with the refund's createdAt forced into 2032-02 —
    // a regression that bucketed refunds by receipt.approvedAt instead of RefundRecord.createdAt
    // would put this refund in the 2032-01 bucket instead, and this test would fail. Uses a
    // fresh year (unused by any other test in this file) to avoid cross-test bucket collisions
    // in the shared dev DB.
    const r7 = await approvedReceipt({ facilityId: facilityA, studentId: studentA, courseId: courseX.id, approvedAt: '2032-01-10' });
    await caller.finance.receiptCancel({ id: r7.id, reason: 'P3 cross-month refund fixture' });
    const refund = await caller.finance.refundCreate({ receiptId: r7.id, amount: 1_500_000, reason: 'P3 cross-month refund' });
    await withRls(SUPER, (tx) =>
      tx.refundRecord.update({ where: { id: refund.id }, data: { createdAt: new Date('2032-02-20') } }),
    );

    const jan = await caller.finance.revenueReport({ from: '2032-01-01', to: '2032-02-01', groupBy: 'month' });
    const janBucket = jan.find((b) => b.key === '2032-01');
    expect(janBucket?.refunds ?? 0).toBe(0);

    const feb = await caller.finance.revenueReport({ from: '2032-02-01', to: '2032-03-01', groupBy: 'month' });
    const febBucket = feb.find((b) => b.key === '2032-02');
    expect(febBucket?.refunds).toBe(1_500_000);
  });

  it('a receipt cancelled after its approval month drops from that month\'s gross on re-run (live-ledger, not a snapshot)', async () => {
    const caller = await staffCaller();

    const r6 = await approvedReceipt({ facilityId: facilityA, studentId: studentA, courseId: courseX.id, approvedAt: '2031-07-01' });

    const before = await caller.finance.revenueReport({ from: '2031-07-01', to: '2031-08-01', groupBy: 'month' });
    const julyBefore = before.find((b) => b.key === '2031-07');
    expect(julyBefore?.gross).toBe(r6.netAmount);
    expect(julyBefore?.count).toBe(1);

    await caller.finance.receiptCancel({ id: r6.id, reason: 'P3 retroactive-cancel fixture' });

    const after = await caller.finance.revenueReport({ from: '2031-07-01', to: '2031-08-01', groupBy: 'month' });
    const julyAfter = after.find((b) => b.key === '2031-07');
    // Expected (not a bug): the bucket either disappears (0 qualifying rows) or reports 0 gross.
    expect(julyAfter === undefined || julyAfter.gross === 0).toBe(true);
  });

  it('revenueReportCsv: BOM present, correct column order, and a malicious facility name never reaches cell position 0', async () => {
    const caller = await staffCaller();

    const r7 = await approvedReceipt({ facilityId: facilityInjection, studentId: studentInjection, courseId: courseX.id, approvedAt: '2031-08-01' });

    const { csv, rowCount } = await caller.finance.revenueReportCsv({ from: '2031-08-01', to: '2031-09-01', groupBy: 'facility' });
    expect(rowCount).toBeGreaterThan(0);
    expect(csv.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM
    const header = csv.slice(1).split('\r\n')[0];
    expect(header).toBe('key,label,gross,refunds,net,count');
    // The malicious facility name ("=1+1+cmd|calc") IS present in the label, and it is NOT at
    // cell position 0 here only because it happens to follow the facility's code — csvText's own
    // guard (not label formatting) is the real boundary; see the malicious-CODE case below for
    // proof the guard holds even at cell position 0.
    expect(csv).toContain('=1+1+cmd|calc');
    expect(csv).not.toMatch(/(^|[,\r\n])=1\+1\+cmd\|calc/);
    expect(csv).toContain(`,${r7.netAmount},0,${r7.netAmount},1`);
  });

  it('revenueReportCsv: a malicious COURSE CODE (staff-entered, not system-assigned) at cell position 0 is still guarded', async () => {
    const caller = await staffCaller();

    const maliciousCourse = await withRls(SUPER, (tx) =>
      tx.course.create({ data: { code: '=1+1+cmd|calc', name: uniq('P3_INJECT_COURSE'), program: 'UCREA' } }),
    );
    created.courseIds.push(maliciousCourse.id);
    await withRls(SUPER, (tx) =>
      tx.coursePrice.create({
        data: { facilityId: facilityA, courseId: maliciousCourse.id, amount: 5_000_000, effectiveFrom: new Date('2020-01-01') },
      }),
    );
    await approvedReceipt({ facilityId: facilityA, studentId: studentA, courseId: maliciousCourse.id, approvedAt: '2031-08-15' });

    const { csv } = await caller.finance.revenueReportCsv({ from: '2031-08-01', to: '2031-09-01', groupBy: 'course' });
    // The label is "CODE — name", so the malicious code IS at cell position 0 (unlike the
    // facility-name case above) — this is the scenario the guard must actually defend.
    expect(csv).not.toMatch(/(^|[,\r\n])=1\+1\+cmd\|calc/);
    expect(csv).toContain(`'=1+1+cmd|calc`);
  });

  it('reconcileWorklist lists exactly approved/sent receipts in a period; reconciling one removes it', async () => {
    const caller = await staffCaller();

    const r8 = await approvedReceipt({ facilityId: facilityA, studentId: studentA, courseId: courseX.id, approvedAt: '2031-09-05' });
    const r9 = await approvedReceipt({ facilityId: facilityA, studentId: studentA, courseId: courseX.id, approvedAt: '2031-09-06' });
    await caller.finance.receiptMarkSent({ id: r9.id });
    const r10 = await approvedReceipt({ facilityId: facilityA, studentId: studentA, courseId: courseX.id, approvedAt: '2031-09-07' });
    await caller.finance.receiptCancel({ id: r10.id, reason: 'P3 worklist exclusion fixture' });
    const r11 = await approvedReceipt({ facilityId: facilityA, studentId: studentA, courseId: courseX.id, approvedAt: '2031-09-08' });
    await caller.finance.receiptReconcile({ id: r11.id });

    const before = await caller.finance.reconcileWorklist({ from: '2031-09-01', to: '2031-10-01', facilityId: facilityA });
    const beforeIds = before.map((r) => r.id);
    expect(beforeIds).toContain(r8.id);
    expect(beforeIds).toContain(r9.id);
    expect(beforeIds).not.toContain(r10.id); // cancelled
    expect(beforeIds).not.toContain(r11.id); // already reconciled

    await caller.finance.receiptReconcile({ id: r8.id });

    const after = await caller.finance.reconcileWorklist({ from: '2031-09-01', to: '2031-10-01', facilityId: facilityA });
    const afterIds = after.map((r) => r.id);
    expect(afterIds).not.toContain(r8.id);
    expect(afterIds).toContain(r9.id);
  });

  it('RLS: a facility-B-scoped caller\'s report excludes facility-A figures', async () => {
    await approvedReceipt({ facilityId: facilityA, studentId: studentA, courseId: courseX.id, approvedAt: '2031-10-01' });
    await approvedReceipt({ facilityId: facilityB, studentId: studentB, courseId: courseX.id, approvedAt: '2031-10-02' });

    const userId = await superAdminUserId();
    const scopedCaller = await staffCaller({
      userId,
      roles: [Role.ke_toan],
      primaryRole: Role.ke_toan,
      isSuperAdmin: false,
      facilityIds: [facilityB],
    });

    const byFacility = await scopedCaller.finance.revenueReport({ from: '2031-10-01', to: '2031-11-01', groupBy: 'facility' });
    expect(byFacility.some((b) => b.key === String(facilityB))).toBe(true);
    expect(byFacility.some((b) => b.key === String(facilityA))).toBe(false);
  });
});
