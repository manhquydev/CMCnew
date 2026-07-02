/**
 * Integration test — Security invariant A3: Guardian principal isolation
 *
 * Bất biến A3: phạm vi phụ huynh suy từ Guardian rows trong DB, không từ input client.
 *   - PH chỉ thấy đúng con mình (theo Guardian), không thấy con người khác.
 *   - Không xuyên facility: link nhiều cơ sở → thấy đủ con; non-child bị chặn.
 *
 * Ma trận G1–G6 (plan 260624-1746-guardian-link-verify/plan.md):
 *   G1 mintParentSession(P) trả đúng {S1,S2}, không có S3 (same resolver used after OTP)
 *   G2 lmsCaller(P) đọc dữ liệu con mình (S1) qua từng portal query → OK (có data hoặc 0 hợp lệ)
 *   G3 lmsCaller(P) đọc dữ liệu con người khác (S3) → bị chặn (rỗng theo RLS)
 *   G4 xuyên facility: P link S1@fac1 + S2@fac2 → thấy cả hai; S4 vẫn bị chặn
 *   G5 link/unlink: mintParentSession re-resolve tập con → {S1,S2,S3}→{S1,S2}
 *   G6 role-gate: giao_vien → FORBIDDEN trên guardian.parentList/link; giam_doc_kinh_doanh → được
 *
 * QUAN TRỌNG: nếu G3 không rỗng (PH đọc được dữ liệu con người khác) → đây là
 * defect bảo mật thật. Không sửa test cho pass, báo lại controller.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role, type LmsSession, mintParentSession } from '@cmc/auth';
import { GuardianRelation, StarTxnType } from '@cmc/db';
import { staffCaller, lmsCaller, withRls, SUPER, uniq } from './helpers.js';

// ── fixtures ──────────────────────────────────────────────────────────────────
const FAC1 = 1;
const FAC2 = 2; // second facility for cross-facility (G4)
let parentAId: string; // PH P: owns S1 (fac1) + S2 (fac2)
let parentBId: string; // PH Q: owns S3 (fac1) — isolation target

let s1Id: string; // child of P, fac1
let s2Id: string; // child of P, fac2
let s3Id: string; // child of Q (P must NEVER see this)
let s4Id: string; // unlinked student fac1 (G4 cross-facility non-child check)

// class batches for leaderboard/myMeetings testing
let classBatchP_S1S2: string; // class for S1, S2 (P's children)
let classBatchQ_S3: string; // class for S3 (Q's child)

async function resolveParentSession(parentAccountId: string): Promise<LmsSession> {
  const result = await mintParentSession(parentAccountId);
  expect(result).not.toBeNull();
  if (!result) throw new Error('mintParentSession failed');
  return result.session;
}

// ── setup ─────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  const admin = await staffCaller();

  await withRls(SUPER, async (tx) => {
    // Students
    s1Id = (
      await tx.student.create({
        data: { facilityId: FAC1, studentCode: uniq('GS1'), fullName: 'G-Student-1', program: 'UCREA', level: 'L1' },
      })
    ).id;

    s2Id = (
      await tx.student.create({
        data: { facilityId: FAC2, studentCode: uniq('GS2'), fullName: 'G-Student-2', program: 'UCREA', level: 'L1' },
      })
    ).id;

    s3Id = (
      await tx.student.create({
        data: { facilityId: FAC1, studentCode: uniq('GS3'), fullName: 'G-Student-3', program: 'UCREA', level: 'L1' },
      })
    ).id;

    s4Id = (
      await tx.student.create({
        data: { facilityId: FAC1, studentCode: uniq('GS4'), fullName: 'G-Student-4', program: 'UCREA', level: 'L1' },
      })
    ).id;

    // Parent accounts with email for OTP login; passwordHash intentionally null.
    parentAId = (
      await tx.parentAccount.create({
        data: { displayName: 'Parent-A', email: `${uniq('pa')}@test.local` },
      })
    ).id;

    parentBId = (
      await tx.parentAccount.create({
        data: { displayName: 'Parent-B', email: `${uniq('pb')}@test.local` },
      })
    ).id;

    // Class batches for enrollment/leaderboard/myMeetings tests
    // First create courses (required by FK)
    const courseP = await tx.course.create({
      data: { code: uniq('C-P'), name: 'Course-P', program: 'UCREA' },
    });
    const courseQ = await tx.course.create({
      data: { code: uniq('C-Q'), name: 'Course-Q', program: 'UCREA' },
    });
    const courseS4 = await tx.course.create({
      data: { code: uniq('C-S4'), name: 'Course-S4', program: 'UCREA' },
    });

    classBatchP_S1S2 = (
      await tx.classBatch.create({
        data: { facilityId: FAC1, courseId: courseP.id, code: uniq('CB-P'), name: 'Class-P' },
      })
    ).id;

    classBatchQ_S3 = (
      await tx.classBatch.create({
        data: { facilityId: FAC1, courseId: courseQ.id, code: uniq('CB-Q'), name: 'Class-Q' },
      })
    ).id;

    await tx.classBatch.create({
      data: { facilityId: FAC1, courseId: courseS4.id, code: uniq('CB-S4'), name: 'Class-S4' },
    });
  });

  // Link using guardian router (role-gate: need giam_doc_kinh_doanh/giam_doc_dao_tao/super)
  await admin.guardian.link({ parentAccountId: parentAId, studentId: s1Id, relation: GuardianRelation.guardian });
  await admin.guardian.link({ parentAccountId: parentAId, studentId: s2Id, relation: GuardianRelation.guardian });
  await admin.guardian.link({ parentAccountId: parentBId, studentId: s3Id, relation: GuardianRelation.guardian });
  // s4 intentionally left unlinked
});

// ── cleanup ───────────────────────────────────────────────────────────────────
afterAll(async () => {
  await withRls(SUPER, async (tx) => {
    // FK order: guardian → parent_account → student
    // Also remove any extra guardian rows created in G5
    await tx.guardian.deleteMany({ where: { parentAccountId: { in: [parentAId, parentBId] } } });
    await tx.parentAccount.deleteMany({ where: { id: { in: [parentAId, parentBId] } } });
    await tx.student.deleteMany({ where: { id: { in: [s1Id, s2Id, s3Id, s4Id] } } });
  });
});

// ── G1: parent session resolver scope (same resolver used after OTP) ──────────
describe('G1 — mintParentSession(parentId) returns exactly owned children, excludes others', () => {
  it('[G1-P-resolver] mintParentSession(P) → studentIds = {S1, S2}, NOT {S3,S4}', async () => {
    const session = await resolveParentSession(parentAId);
    const ids = new Set(session.studentIds);

    expect(ids.has(s1Id)).toBe(true);
    expect(ids.has(s2Id)).toBe(true);
    expect(ids.has(s3Id)).toBe(false); // isolation: Q's child must not appear
    expect(ids.has(s4Id)).toBe(false); // unlinked
    expect(session.studentIds).toHaveLength(2);
  });

  it('[G1-Q-resolver] mintParentSession(Q) → studentIds = {S3} only', async () => {
    const session = await resolveParentSession(parentBId);
    expect(session.studentIds).toEqual([s3Id]);
  });
});

// ── G2: parent reads own child data ──────────────────────────────────────────
describe('G2 — lmsCaller(P) reads own child S1 via portal queries (happy path)', () => {
  let sessionP: LmsSession;

  beforeAll(async () => {
    sessionP = await resolveParentSession(parentAId);
  });

  it('assessment.gradebook for S1 returns valid shape (empty ok, no error)', async () => {
    const result = await lmsCaller(sessionP).assessment.gradebook({ studentId: s1Id });
    expect(result).toHaveProperty('finalGrades');
    expect(result).toHaveProperty('qualitative');
    // No data seeded for S1 but shape must be valid arrays
    expect(Array.isArray(result.finalGrades)).toBe(true);
    expect(Array.isArray(result.qualitative)).toBe(true);
  });

  it('submission.forStudent for S1 returns array (no error)', async () => {
    const result = await lmsCaller(sessionP).submission.forStudent({ studentId: s1Id });
    expect(Array.isArray(result)).toBe(true);
  });

  it('rewards.balance for S1 returns numeric (0 is valid)', async () => {
    const result = await lmsCaller(sessionP).rewards.balance({ studentId: s1Id });
    expect(typeof result).toBe('number');
  });

  it('levelProgress.forStudent for S1 returns array (no error)', async () => {
    const result = await lmsCaller(sessionP).levelProgress.forStudent({ studentId: s1Id });
    expect(Array.isArray(result)).toBe(true);
  });

  it('parentMeeting.myMeetings returns array (RLS pins to P own enrollments, no error)', async () => {
    const result = await lmsCaller(sessionP).parentMeeting.myMeetings();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── G3: parent CANNOT read another child's data ───────────────────────────────
// Each assert must FAIL if the RLS filter is removed (the data would appear).
// Per plan: if any case unexpectedly returns non-empty/non-zero for foreign child → DEFECT.
describe('G3 — lmsCaller(P) with S3 (foreign child) → RLS blocks (empty results)', () => {
  let sessionP: LmsSession; // session from mintParentSession(P), scoped to {S1, S2}

  beforeAll(async () => {
    // Seed substantial data for S3 so tests have teeth:
    // if RLS were absent, these would return non-empty/non-zero results.
    const admin = await staffCaller();
    const sessionQ = await resolveParentSession(parentBId);

    await withRls(SUPER, async (tx) => {
      // Enroll S3 in its class (Q's class)
      await tx.enrollment.create({
        data: {
          facilityId: FAC1,
          classBatchId: classBatchQ_S3,
          studentId: s3Id,
          status: 'active',
        },
      });

      // Enroll S1, S2 in P's class
      await tx.enrollment.create({
        data: {
          facilityId: FAC1,
          classBatchId: classBatchP_S1S2,
          studentId: s1Id,
          status: 'active',
        },
      });
      await tx.enrollment.create({
        data: {
          facilityId: FAC2,
          classBatchId: classBatchP_S1S2,
          studentId: s2Id,
          status: 'active',
        },
      });

      // seed a finalGrade for S3
      await tx.finalGrade.upsert({
        where: { studentId_program_periodKey: { studentId: s3Id, program: 'UCREA', periodKey: 'G3-TEST' } },
        update: {},
        create: {
          facilityId: FAC1,
          studentId: s3Id,
          program: 'UCREA',
          periodKey: 'G3-TEST',
          passed: false,
          complete: false,
          computedAt: new Date(),
        },
      });

      // seed a qualitative assessment for S3
      await tx.qualitativeAssessment.upsert({
        where: { studentId_periodKey: { studentId: s3Id, periodKey: 'G3-QA' } },
        update: {},
        create: {
          facilityId: FAC1,
          studentId: s3Id,
          program: 'UCREA',
          period: 'MONTHLY',
          periodKey: 'G3-QA',
          criteria: { effort: 8 },
        },
      });

      // seed a submission for S3 (with exercise)
      const courseQ = await tx.classBatch.findUniqueOrThrow({
        where: { id: classBatchQ_S3 },
        select: { courseId: true },
      });
      const unit = await tx.curriculumUnit.create({
        data: {
          courseId: courseQ.courseId,
          unitCode: uniq('G3-U'),
          orderGlobal: 1,
          unitType: 'LESSON',
          theme: 'Isolation fixture',
          seqInLevel: 1,
          sessions: 1,
        },
      });
      const exercise = await tx.exercise.create({
        data: {
          curriculumUnitId: unit.id,
          title: 'G3-Exercise',
          type: 'homework',
          status: 'published',
          maxScore: 10,
        },
      });
      await tx.submission.create({
        data: {
          facilityId: FAC1,
          exerciseId: exercise.id,
          studentId: s3Id,
          status: 'draft',
        },
      });

      // seed a starTransaction for S3 (gives non-zero balance)
      await tx.starTransaction.create({
        data: { facilityId: FAC1, studentId: s3Id, type: StarTxnType.manual, amount: 10 },
      });

      // seed a levelProgress for S3
      await tx.levelProgress.create({
        data: { facilityId: FAC1, studentId: s3Id, fromLevel: 'L1', toLevel: 'L2', status: 'pending' },
      });

      // seed a StudentBadge for S3
      const badge = await tx.badge.create({
        data: {
          facilityId: FAC1,
          code: uniq('B3'),
          name: 'Badge-S3',
          unlockCriteria: { kind: 'stars_total', gte: 1 },
        },
      });
      await tx.studentBadge.create({
        data: { facilityId: FAC1, studentId: s3Id, badgeId: badge.id, source: 'auto' },
      });

      // seed a Notification for S3
      await tx.notification.create({
        data: {
          facilityId: FAC1,
          recipientType: 'student',
          recipientId: s3Id,
          type: 'submission_graded',
          payload: { submissionId: 'dummy' },
        },
      });

      // seed a ParentMeeting for S3's class
      await tx.parentMeeting.create({
        data: {
          facilityId: FAC1,
          classBatchId: classBatchQ_S3,
          title: 'Meeting-Q',
          scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    });

    // Resolve P's session through the same parent resolver used after OTP verification.
    sessionP = await resolveParentSession(parentAId);
    void admin; void sessionQ;
  });

  afterAll(async () => {
    // clean up G3 seeded data (FK order matters)
    await withRls(SUPER, async (tx) => {
      await tx.notification.deleteMany({ where: { recipientId: s3Id } });
      await tx.studentBadge.deleteMany({ where: { studentId: s3Id } });
      await tx.levelProgress.deleteMany({ where: { studentId: s3Id } });
      await tx.starTransaction.deleteMany({ where: { studentId: s3Id } });
      await tx.submission.deleteMany({ where: { studentId: s3Id } });
      await tx.exercise.deleteMany({ where: { title: 'G3-Exercise' } });
      await tx.curriculumUnit.deleteMany({ where: { unitCode: { contains: 'G3-U' } } });
      await tx.finalGrade.deleteMany({ where: { studentId: s3Id } });
      await tx.qualitativeAssessment.deleteMany({ where: { studentId: s3Id } });
      await tx.parentMeeting.deleteMany({ where: { classBatchId: classBatchQ_S3 } });
      await tx.enrollment.deleteMany({ where: { classBatchId: { in: [classBatchQ_S3, classBatchP_S1S2] } } });
      await tx.badge.deleteMany({ where: { facilityId: FAC1, code: { contains: 'B3' } } });
    });
  });

  it('[G3-gradebook] P requests S3 gradebook → finalGrades and qualitative BOTH empty', async () => {
    const result = await lmsCaller(sessionP).assessment.gradebook({ studentId: s3Id });
    // S3 has finalGrade seeded; if RLS were absent, result.finalGrades would contain it.
    expect(result.finalGrades).toHaveLength(0);
    // S3 has qualitative seeded; if RLS were absent, result.qualitative would contain it.
    expect(result.qualitative).toHaveLength(0);
  });

  it('[G3-submission] P requests S3 submissions → empty array', async () => {
    const result = await lmsCaller(sessionP).submission.forStudent({ studentId: s3Id });
    // S3 has 1 submission seeded; if RLS were absent, would return [submission].
    expect(result).toHaveLength(0);
  });

  it('[G3-balance] P requests S3 star balance → 0 (RLS hides star_transaction rows)', async () => {
    const result = await lmsCaller(sessionP).rewards.balance({ studentId: s3Id });
    // S3 has 10 stars seeded; if RLS were absent, result would be 10.
    expect(result).toBe(0);
  });

  it('[G3-levelProgress] P requests S3 level history → empty array', async () => {
    const result = await lmsCaller(sessionP).levelProgress.forStudent({ studentId: s3Id });
    // S3 has 1 pending LP seeded; if RLS were absent, would return [lp].
    expect(result).toHaveLength(0);
  });

  it('[G3-badge] P requests S3 badges → empty array', async () => {
    const result = await lmsCaller(sessionP).badge.myBadges({ studentId: s3Id });
    // S3 has 1 badge seeded; if RLS were absent, would return [badge].
    expect(result).toHaveLength(0);
  });

  it('[G3-notification-list] P notification.list → does NOT contain S3 notifications', async () => {
    const result = await lmsCaller(sessionP).notification.list();
    // S3 has 1 notification seeded. P should see only own notifications (P→S1,S2 → 0 seeded for them either).
    // Test checks that S3's notification doesn't leak via recipientId filter.
    const s3NotifIds = await withRls(SUPER, (tx) =>
      tx.notification.findMany({ where: { recipientId: s3Id }, select: { id: true } }),
    );
    expect(s3NotifIds).not.toHaveLength(0); // confirm S3 has notifications in DB
    const resultIds = new Set(result.map((n) => n.id));
    for (const s3Notif of s3NotifIds) {
      expect(resultIds.has(s3Notif.id)).toBe(false);
    }
  });

  it('[G3-notification-unreadCount] P unreadCount → 0 (RLS pins to own student_ids)', async () => {
    const result = await lmsCaller(sessionP).notification.unreadCount();
    // P's children (S1, S2) have no notifications seeded → count = 0 (correct).
    // S3's notification is hidden by RLS → P's count must stay 0.
    expect(result).toBe(0);
  });

  it('[G3-leaderboard] P requests S3 leaderboard → empty array (no enrollment in P classes)', async () => {
    const result = await lmsCaller(sessionP).leaderboard.forStudent({ studentId: s3Id });
    // S3 is enrolled in classBatchQ_S3 (not classBatchP_S1S2 where P's children are).
    // Leaderboard checks ownership first (via RLS on enrollment) — if not owned, returns [].
    // If RLS were absent, leaderboard would compute ranking for S3.
    expect(result).toHaveLength(0);
  });

  it('[G3-myMeetings] P myMeetings → does NOT contain meeting for S3 class', async () => {
    const result = await lmsCaller(sessionP).parentMeeting.myMeetings();
    // S3's class (classBatchQ_S3) has a meeting seeded.
    // P's children (S1, S2) are in classBatchP_S1S2 → P should see meetings for that class only.
    // myMeetings policy: enrollment.student_id = ANY(app_student_ids) where app_student_ids = [S1, S2].
    // If RLS were absent, P would see meeting for classBatchQ_S3.

    // Fetch S3's meetings separately to confirm they exist
    const s3Meetings = await withRls(SUPER, (tx) =>
      tx.parentMeeting.findMany({ where: { classBatchId: classBatchQ_S3 }, select: { id: true } }),
    );
    expect(s3Meetings).not.toHaveLength(0); // confirm meeting exists

    const resultIds = new Set(result.map((m) => m.id));
    for (const s3Meeting of s3Meetings) {
      expect(resultIds.has(s3Meeting.id)).toBe(false);
    }
  });

  // DEFER: F5 SSE `/sse/notifications` (cần vehicle test khác)
});

// ── G4: cross-facility — parent sees both own children, not non-child ─────────
describe('G4 — cross-facility: P sees S1@fac1 and S2@fac2; S4 (fac1, unlinked) still blocked', () => {
  let sessionP: LmsSession;

  beforeAll(async () => {
    // Seed levelProgress for S2 (fac2) and S4 (fac1) for test teeth
    await withRls(SUPER, async (tx) => {
      await tx.levelProgress.create({
        data: { facilityId: FAC2, studentId: s2Id, fromLevel: 'L1', toLevel: 'L2', status: 'pending' },
      });
      await tx.levelProgress.create({
        data: { facilityId: FAC1, studentId: s4Id, fromLevel: 'L1', toLevel: 'L2', status: 'pending' },
      });
    });
    sessionP = await resolveParentSession(parentAId);
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.levelProgress.deleteMany({ where: { studentId: { in: [s2Id, s4Id] } } });
    });
  });

  it('sessionP facilityIds contains both fac1 and fac2', () => {
    expect(sessionP.facilityIds).toContain(FAC1);
    expect(sessionP.facilityIds).toContain(FAC2);
  });

  it('[G4-own-cross-fac] levelProgress.forStudent for S2 (fac2) → returns data (cross-facility child OK)', async () => {
    const result = await lmsCaller(sessionP).levelProgress.forStudent({ studentId: s2Id });
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('[G4-non-child] levelProgress.forStudent for S4 (fac1, unlinked) → empty (RLS blocks)', async () => {
    const result = await lmsCaller(sessionP).levelProgress.forStudent({ studentId: s4Id });
    // S4 is in fac1 (same facility as S1) but not P's child — must be empty.
    // If RLS used facility only (not student_ids), S4 would leak here.
    expect(result).toHaveLength(0);
  });
});

// ── G5: link/unlink changes resolved child set (via parent resolver) ──────────
describe('G5 — link P→S3 then unlink: mintParentSession resolver reflects DB changes', () => {
  let extraGuardId: string;

  it('[G5-before-link] mintParentSession(P) does not contain S3 yet', async () => {
    const session = await resolveParentSession(parentAId);
    expect(session.studentIds).not.toContain(s3Id);
    expect(session.studentIds).toContain(s1Id);
    expect(session.studentIds).toContain(s2Id);
  });

  it('[G5-after-link] after linking P→S3, mintParentSession re-resolves → includes S3', async () => {
    const admin = await staffCaller();
    const g = await admin.guardian.link({
      parentAccountId: parentAId,
      studentId: s3Id,
      relation: GuardianRelation.parent,
    });
    extraGuardId = g.id;

    // Re-resolve: mintParentSession reads fresh Guardian rows from DB.
    const session = await resolveParentSession(parentAId);
    expect(session.studentIds).toContain(s3Id);
    expect(session.studentIds).toContain(s1Id);
    expect(session.studentIds).toContain(s2Id);
    expect(session.studentIds).toHaveLength(3);
  });

  it('[G5-after-unlink] after unlinking P→S3, mintParentSession re-resolves → excludes S3', async () => {
    const admin = await staffCaller();
    await admin.guardian.unlink({ id: extraGuardId });

    // Re-resolve: mintParentSession reads fresh Guardian rows from DB.
    const session = await resolveParentSession(parentAId);
    expect(session.studentIds).not.toContain(s3Id);
    expect(session.studentIds).toContain(s1Id);
    expect(session.studentIds).toContain(s2Id);
    expect(session.studentIds).toHaveLength(2);
  });
});

// ── G6: role gate ─────────────────────────────────────────────────────────────
describe('G6 — role gate: giao_vien → FORBIDDEN; giam_doc_kinh_doanh → allowed', () => {
  const teacher = () =>
    staffCaller({
      isSuperAdmin: false,
      facilityIds: [FAC1],
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
    });

  const bizDirector = () =>
    staffCaller({
      isSuperAdmin: false,
      facilityIds: [FAC1],
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
    });

  it('giao_vien guardian.parentList → FORBIDDEN', async () => {
    await expect((await teacher()).guardian.parentList()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('giao_vien guardian.link → FORBIDDEN', async () => {
    await expect(
      (await teacher()).guardian.link({
        parentAccountId: parentAId,
        studentId: s1Id,
        relation: GuardianRelation.guardian,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('giam_doc_kinh_doanh guardian.parentList → OK (returns array)', async () => {
    const result = await (await bizDirector()).guardian.parentList();
    expect(Array.isArray(result)).toBe(true);
  });

  it('giam_doc_kinh_doanh guardian.link (idempotent re-link P→S1) → OK', async () => {
    // Already linked (idempotent upsert), so this just updates relation and returns the row.
    const result = await (await bizDirector()).guardian.link({
      parentAccountId: parentAId,
      studentId: s1Id,
      relation: GuardianRelation.guardian,
    });
    expect(result).toHaveProperty('id');
  });
});
