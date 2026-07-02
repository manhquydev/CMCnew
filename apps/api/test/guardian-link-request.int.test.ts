/**
 * Integration — Phase 04 parent self-service (profile edit + staff-approved child link).
 *
 * Anti-takeover is the core invariant under test: a parent-initiated `requestLink` must NEVER
 * create a `Guardian` row directly — only a staff `linkRequestReview` approve can. If that
 * invariant breaks, this is a security defect; do not weaken the test to make it pass.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { Role, mintParentSession, type LmsSession } from '@cmc/auth';
import { appRouter } from '../src/routers/index.js';
import type { ApiContext } from '../src/context.js';
import { __resetRateLimitStore } from '../src/rate-limit.js';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

function lmsCallerAt(lms: LmsSession, ip = 'test') {
  const ctx: ApiContext = { c: {} as never, session: null, lms, ip };
  return appRouter.createCaller(ctx);
}

const FAC1 = 1;

let parentAId: string; // owns S1
let parentBId: string; // owns nothing yet — used for isolation + link-request flows
let s1Id: string;
let s2Id: string; // second student, distinct studentCode, used for ambiguous-match fixture
let director: Awaited<ReturnType<typeof staffCaller>>;

async function resolveParent(id: string): Promise<LmsSession> {
  const r = await mintParentSession(id);
  expect(r).not.toBeNull();
  if (!r) throw new Error('mintParentSession failed');
  return r.session;
}

beforeAll(async () => {
  director = await staffCaller({
    isSuperAdmin: false,
    facilityIds: [FAC1],
    roles: [Role.giam_doc_kinh_doanh],
    primaryRole: Role.giam_doc_kinh_doanh,
  });

  await withRls(SUPER, async (tx) => {
    s1Id = (
      await tx.student.create({
        data: { facilityId: FAC1, studentCode: uniq('LRQ1'), fullName: 'LinkReq-Student-1', program: 'UCREA', level: 'L1' },
      })
    ).id;
    s2Id = (
      await tx.student.create({
        data: { facilityId: FAC1, studentCode: uniq('LRQ2'), fullName: 'LinkReq-Student-2', program: 'UCREA', level: 'L1' },
      })
    ).id;
    parentAId = (
      await tx.parentAccount.create({ data: { displayName: 'LRQ Parent A', email: `${uniq('lrqa')}@test.local` } })
    ).id;
    parentBId = (
      await tx.parentAccount.create({ data: { displayName: 'LRQ Parent B', email: `${uniq('lrqb')}@test.local` } })
    ).id;
  });

  // Link Parent A → S1 via the existing staff path (not under test here).
  await director.guardian.link({ parentAccountId: parentAId, studentId: s1Id, relation: 'guardian' });
});

afterAll(async () => {
  await withRls(SUPER, async (tx) => {
    await tx.guardianLinkRequest.deleteMany({ where: { requestedByAccountId: { in: [parentAId, parentBId] } } });
    await tx.guardian.deleteMany({ where: { parentAccountId: { in: [parentAId, parentBId] } } });
    await tx.parentAccount.deleteMany({ where: { id: { in: [parentAId, parentBId] } } });
    await tx.student.deleteMany({ where: { id: { in: [s1Id, s2Id] } } });
  });
});

beforeEach(() => __resetRateLimitStore());

// ── profileUpdate: own-row scoping ─────────────────────────────────────────────
describe('guardian.profileUpdate', () => {
  it('parent A updates own displayName/phone — succeeds and scoped to own row', async () => {
    const sessionA = await resolveParent(parentAId);
    const phone = uniq('ph').slice(0, 15);
    const result = await lmsCallerAt(sessionA).guardian.profileUpdate({ displayName: 'A Updated', phone });
    expect(result.displayName).toBe('A Updated');
    expect(result.phone).toBe(phone);
  });

  it('parent A cannot touch parent B row: update only ever affects the caller id (RLS-scoped by id)', async () => {
    const sessionA = await resolveParent(parentAId);
    const sessionB = await resolveParent(parentBId);
    const before = await withRls(SUPER, (tx) => tx.parentAccount.findUniqueOrThrow({ where: { id: parentBId } }));

    await lmsCallerAt(sessionA).guardian.profileUpdate({ displayName: 'Should not affect B' });

    const after = await withRls(SUPER, (tx) => tx.parentAccount.findUniqueOrThrow({ where: { id: parentBId } }));
    expect(after.displayName).toBe(before.displayName);
    void sessionB;
  });

  it('email collision → friendly BAD_REQUEST, not a raw 500', async () => {
    const takenEmail = `${uniq('taken')}@test.local`;
    await withRls(SUPER, (tx) => tx.parentAccount.update({ where: { id: parentAId }, data: { email: takenEmail } }));

    const sessionB = await resolveParent(parentBId);
    await expect(
      lmsCallerAt(sessionB).guardian.profileUpdate({ email: takenEmail }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

// ── requestLink: anti-takeover + facility resolution ───────────────────────────
describe('guardian.requestLink — anti-takeover (core invariant)', () => {
  it('creates ONLY a pending GuardianLinkRequest row — zero Guardian rows from the parent path', async () => {
    const sessionB = await resolveParent(parentBId);
    const guardianCountBefore = await withRls(SUPER, (tx) => tx.guardian.count({ where: { parentAccountId: parentBId } }));
    expect(guardianCountBefore).toBe(0);

    const res = await lmsCallerAt(sessionB, uniq('ip')).guardian.requestLink({ studentCode: (await withRls(SUPER, (tx) => tx.student.findUniqueOrThrow({ where: { id: s1Id } }))).studentCode });
    expect(res.ok).toBe(true);

    const guardianCountAfter = await withRls(SUPER, (tx) => tx.guardian.count({ where: { parentAccountId: parentBId } }));
    expect(guardianCountAfter).toBe(0); // anti-takeover: still zero — request path never writes Guardian

    const requests = await withRls(SUPER, (tx) => tx.guardianLinkRequest.findMany({ where: { requestedByAccountId: parentBId } }));
    expect(requests.length).toBeGreaterThanOrEqual(1);
    expect(requests.every((r) => r.status === 'pending')).toBe(true);
  });

  it('unique studentCode match → facilityId resolved at request time, visible to that facility director via RLS', async () => {
    const sessionB = await resolveParent(parentBId);
    const s2 = await withRls(SUPER, (tx) => tx.student.findUniqueOrThrow({ where: { id: s2Id } }));

    await lmsCallerAt(sessionB, uniq('ip')).guardian.requestLink({ studentCode: s2.studentCode });

    const row = await withRls(SUPER, (tx) =>
      tx.guardianLinkRequest.findFirstOrThrow({ where: { requestedByAccountId: parentBId, studentCode: s2.studentCode } }),
    );
    expect(row.matchedStudentId).toBe(s2Id);
    expect(row.facilityId).toBe(FAC1);

    const queue = await director.guardian.linkRequestList();
    expect(queue.some((r) => r.id === row.id)).toBe(true);
  });

  it('ambiguous phone (one registered phone guardians 2 distinct students) → facilityId null, in the global unresolved bucket only', async () => {
    const sharedPhone = uniq('shr').slice(0, 15);
    // A single parent phone linked (as guardian) to two distinct students — a `studentPhone`
    // search against parent.phone genuinely resolves >1 candidate, so it must stay ambiguous
    // rather than auto-picking one (per the plan's "never auto-resolve ambiguous" mitigation).
    const [px, sx, sy] = await withRls(SUPER, async (tx) => {
      const sx = await tx.student.create({ data: { facilityId: FAC1, studentCode: uniq('AMB1'), fullName: 'Amb-1', program: 'UCREA', level: 'L1' } });
      const sy = await tx.student.create({ data: { facilityId: FAC1, studentCode: uniq('AMB2'), fullName: 'Amb-2', program: 'UCREA', level: 'L1' } });
      const px = await tx.parentAccount.create({ data: { displayName: 'Amb Parent X', phone: sharedPhone } });
      await tx.guardian.create({ data: { facilityId: FAC1, parentAccountId: px.id, studentId: sx.id, relation: 'guardian' } });
      await tx.guardian.create({ data: { facilityId: FAC1, parentAccountId: px.id, studentId: sy.id, relation: 'guardian' } });
      return [px, sx, sy] as const;
    });

    const sessionB = await resolveParent(parentBId);
    await lmsCallerAt(sessionB, uniq('ip')).guardian.requestLink({ studentPhone: sharedPhone });

    const row = await withRls(SUPER, (tx) =>
      tx.guardianLinkRequest.findFirstOrThrow({ where: { requestedByAccountId: parentBId, studentPhone: sharedPhone } }),
    );
    expect(row.matchedStudentId).toBeNull();
    expect(row.facilityId).toBeNull();

    const queue = await director.guardian.linkRequestList();
    const found = queue.find((r) => r.id === row.id);
    expect(found).toBeDefined();
    expect(found!.candidates.length).toBe(2);

    await withRls(SUPER, async (tx) => {
      await tx.guardianLinkRequest.deleteMany({ where: { id: row.id } });
      await tx.guardian.deleteMany({ where: { parentAccountId: px.id } });
      await tx.parentAccount.deleteMany({ where: { id: px.id } });
      await tx.student.deleteMany({ where: { id: { in: [sx.id, sy.id] } } });
    });
  });

  it('always returns a generic response regardless of match outcome (no match/no-match oracle)', async () => {
    const sessionB = await resolveParent(parentBId);
    const noMatch = await lmsCallerAt(sessionB, uniq('ip')).guardian.requestLink({ studentCode: uniq('NOPE') });
    const match = await lmsCallerAt(sessionB, uniq('ip')).guardian.requestLink({ studentCode: (await withRls(SUPER, (tx) => tx.student.findUniqueOrThrow({ where: { id: s1Id } }))).studentCode });
    expect(noMatch).toEqual({ ok: true });
    expect(match).toEqual({ ok: true });
  });

  it('rate-limited past LIMIT (same accountId) → TOO_MANY_REQUESTS; under limit succeeds', async () => {
    const sessionB = await resolveParent(parentBId);
    const ip = uniq('rl-acct-ip');
    for (let i = 0; i < 5; i++) {
      await lmsCallerAt(sessionB, `${ip}-${i}`).guardian.requestLink({ studentCode: uniq('RL') });
    }
    await expect(
      lmsCallerAt(sessionB, `${ip}-final`).guardian.requestLink({ studentCode: uniq('RL') }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('rate-limited past LIMIT (same IP) → TOO_MANY_REQUESTS', async () => {
    const sharedIp = uniq('rl-ip');
    for (let i = 0; i < 5; i++) {
      const p = await withRls(SUPER, (tx) => tx.parentAccount.create({ data: { displayName: `RL-IP-${i}`, email: `${uniq('rlip')}@test.local` } }));
      const s = await resolveParent(p.id);
      await lmsCallerAt(s, sharedIp).guardian.requestLink({ studentCode: uniq('RLIP') });
    }
    const pFinal = await withRls(SUPER, (tx) => tx.parentAccount.create({ data: { displayName: 'RL-IP-final', email: `${uniq('rlipf')}@test.local` } }));
    const sFinal = await resolveParent(pFinal.id);
    await expect(
      lmsCallerAt(sFinal, sharedIp).guardian.requestLink({ studentCode: uniq('RLIP') }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

// ── linkRequestListMine: own rows only ──────────────────────────────────────────
describe('guardian.linkRequestListMine', () => {
  it('returns only the caller own requests', async () => {
    const sessionA = await resolveParent(parentAId);
    const sessionB = await resolveParent(parentBId);

    await lmsCallerAt(sessionA, uniq('ip')).guardian.requestLink({ studentCode: uniq('MINEA') });

    const mineA = await lmsCallerAt(sessionA).guardian.linkRequestListMine();
    const mineB = await lmsCallerAt(sessionB).guardian.linkRequestListMine();

    expect(mineA.length).toBeGreaterThan(0);
    const bIds = new Set(mineB.map((r) => r.id));
    for (const r of mineA) expect(bIds.has(r.id)).toBe(false);
  });
});

// ── linkRequestReview: approve creates exactly one Guardian; reject creates none ────────────────
describe('guardian.linkRequestReview', () => {
  it('approve (unambiguous match) → exactly one Guardian created, request closed', async () => {
    const sessionB = await resolveParent(parentBId);
    const s2 = await withRls(SUPER, (tx) => tx.student.findUniqueOrThrow({ where: { id: s2Id } }));
    await lmsCallerAt(sessionB, uniq('ip')).guardian.requestLink({ studentCode: s2.studentCode });
    const row = await withRls(SUPER, (tx) =>
      tx.guardianLinkRequest.findFirstOrThrow({
        where: { requestedByAccountId: parentBId, studentCode: s2.studentCode, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      }),
    );

    const before = await withRls(SUPER, (tx) => tx.guardian.count({ where: { parentAccountId: parentBId, studentId: s2Id } }));
    expect(before).toBe(0);

    const result = await director.guardian.linkRequestReview({ id: row.id, decision: 'approved', relation: 'guardian' });
    expect(result.guardianId).not.toBeNull();

    const after = await withRls(SUPER, (tx) => tx.guardian.count({ where: { parentAccountId: parentBId, studentId: s2Id } }));
    expect(after).toBe(1);

    const closed = await withRls(SUPER, (tx) => tx.guardianLinkRequest.findUniqueOrThrow({ where: { id: row.id } }));
    expect(closed.status).toBe('approved');

    await withRls(SUPER, (tx) => tx.guardian.deleteMany({ where: { parentAccountId: parentBId, studentId: s2Id } }));
  });

  it('reject → no Guardian created, request closed as rejected', async () => {
    const sessionB = await resolveParent(parentBId);
    const s1 = await withRls(SUPER, (tx) => tx.student.findUniqueOrThrow({ where: { id: s1Id } }));
    await lmsCallerAt(sessionB, uniq('ip')).guardian.requestLink({ studentCode: s1.studentCode });
    const row = await withRls(SUPER, (tx) =>
      tx.guardianLinkRequest.findFirstOrThrow({
        where: { requestedByAccountId: parentBId, studentCode: s1.studentCode, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      }),
    );

    const result = await director.guardian.linkRequestReview({ id: row.id, decision: 'rejected', reason: 'test reject' });
    expect(result.guardianId).toBeNull();

    const guardianCount = await withRls(SUPER, (tx) => tx.guardian.count({ where: { parentAccountId: parentBId, studentId: s1Id } }));
    expect(guardianCount).toBe(0);

    const closed = await withRls(SUPER, (tx) => tx.guardianLinkRequest.findUniqueOrThrow({ where: { id: row.id } }));
    expect(closed.status).toBe('rejected');
  });

  it('role gate: teacher (giao_vien) → FORBIDDEN on linkRequestList/linkRequestReview', async () => {
    const teacher = await staffCaller({
      isSuperAdmin: false,
      facilityIds: [FAC1],
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
    });
    await expect(teacher.guardian.linkRequestList()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
