/**
 * Integration test — submission.layerForGuardian
 *
 * Invariants under test:
 *   - A guardian sees their own child's student annotation layer.
 *   - Pre-publish: teacher layer is null (redaction invariant — mirrors myLayer).
 *   - Post-publish: teacher layer appears.
 *   - A studentId NOT among the guardian's own children (per Guardian rows) → FORBIDDEN,
 *     never another family's data (studentId is validated against ctx.lms.studentIds
 *     before RLS is even consulted).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GuardianRelation } from '@cmc/db';
import { mintParentSession, type LmsSession } from '@cmc/auth';
import { staffCaller, lmsCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

const FACILITY = 1;

let parentId: string; // owns childId
let otherParentId: string; // owns otherChildId (isolation target)
let childId: string;
let otherChildId: string;
let unitId: string;
let exerciseId: string;
let dbReachable = false;

const STUDENT_LAYER = { v: 1 as const, items: [{ type: 'ink' as const, page: 0, color: '#000', width: 2, points: [{ x: 0.1, y: 0.1 }] }] };
const TEACHER_LAYER = { v: 1 as const, items: [{ type: 'ink' as const, page: 0, color: '#f00', width: 2, points: [{ x: 0.2, y: 0.2 }] }] };

async function resolveParentSession(accountId: string): Promise<LmsSession> {
  const result = await mintParentSession(accountId);
  expect(result).not.toBeNull();
  if (!result) throw new Error('mintParentSession failed');
  return result.session;
}

beforeAll(async () => {
  try {
    await superAdminUserId();
    dbReachable = true;
  } catch {
    console.warn('DB not reachable - submission guardian layer tests skipped');
    return;
  }

  const admin = await staffCaller();

  await withRls(SUPER, async (tx) => {
    const student = await tx.student.create({
      data: { facilityId: FACILITY, studentCode: uniq('GLS'), fullName: 'Guardian-Layer-Student', program: 'UCREA', level: 'L1' },
    });
    childId = student.id;

    const otherStudent = await tx.student.create({
      data: { facilityId: FACILITY, studentCode: uniq('GLO'), fullName: 'Guardian-Layer-Other', program: 'UCREA', level: 'L1' },
    });
    otherChildId = otherStudent.id;

    const parent = await tx.parentAccount.create({
      data: { displayName: 'Guardian-Layer-Parent', email: `${uniq('glp')}@test.local` },
    });
    parentId = parent.id;

    const otherParent = await tx.parentAccount.create({
      data: { displayName: 'Guardian-Layer-Other-Parent', email: `${uniq('glop')}@test.local` },
    });
    otherParentId = otherParent.id;

    const course = await tx.course.create({
      data: { code: uniq('GL-C'), name: 'Guardian-Layer-Course', program: 'UCREA' },
    });
    const unit = await tx.curriculumUnit.create({
      data: {
        courseId: course.id,
        unitCode: uniq('GL-U'),
        orderGlobal: 1,
        unitType: 'LESSON',
        theme: 'Guardian layer fixture',
        seqInLevel: 1,
        sessions: 1,
      },
    });
    unitId = unit.id;

    const exercise = await tx.exercise.create({
      data: {
        curriculumUnitId: unit.id,
        title: 'Guardian-Layer-Exercise',
        type: 'homework',
        status: 'published',
        maxScore: 10,
        basePdfRef: 'test/guardian-layer.pdf',
      },
    });
    exerciseId = exercise.id;

    const submission = await tx.submission.create({
      data: {
        facilityId: FACILITY,
        exerciseId: exercise.id,
        studentId: childId,
        status: 'submitted',
        annotationLayer: STUDENT_LAYER,
      },
    });

    await tx.grade.create({
      data: {
        facilityId: FACILITY,
        submissionId: submission.id,
        score: 8,
        maxScore: 10,
        feedback: 'Tốt lắm',
        isPublished: false,
        annotationLayer: TEACHER_LAYER,
      },
    });
  });

  await admin.guardian.link({ parentAccountId: parentId, studentId: childId, relation: GuardianRelation.guardian });
  await admin.guardian.link({ parentAccountId: otherParentId, studentId: otherChildId, relation: GuardianRelation.guardian });
});

afterAll(async () => {
  if (!dbReachable) return;
  await withRls(SUPER, async (tx) => {
    await tx.grade.deleteMany({ where: { submission: { exerciseId } } });
    await tx.submission.deleteMany({ where: { exerciseId } });
    await tx.exercise.deleteMany({ where: { id: exerciseId } });
    await tx.curriculumUnit.deleteMany({ where: { id: unitId } });
    await tx.guardian.deleteMany({ where: { parentAccountId: { in: [parentId, otherParentId] } } });
    await tx.parentAccount.deleteMany({ where: { id: { in: [parentId, otherParentId] } } });
    await tx.student.deleteMany({ where: { id: { in: [childId, otherChildId] } } });
  });
});

describe('submission.layerForGuardian', () => {
  it('(a) guardian sees own child student-layer strokes', async () => {
    if (!dbReachable) return;
    const session = await resolveParentSession(parentId);
    const result = await lmsCaller(session).submission.layerForGuardian({ exerciseId, studentId: childId });
    expect(result.student).not.toBeNull();
    expect(result.student?.items).toHaveLength(1);
    expect(result.student?.items[0]).toMatchObject({ type: 'ink' });
  });

  it('(b) pre-publish: teacher layer is null despite a grade with an annotation layer existing', async () => {
    if (!dbReachable) return;
    const session = await resolveParentSession(parentId);
    const result = await lmsCaller(session).submission.layerForGuardian({ exerciseId, studentId: childId });
    expect(result.teacher).toBeNull();
  });

  it('(c) post-publish: teacher layer appears', async () => {
    if (!dbReachable) return;
    await withRls(SUPER, (tx) =>
      tx.grade.updateMany({ where: { submission: { exerciseId, studentId: childId } }, data: { isPublished: true } }),
    );
    const session = await resolveParentSession(parentId);
    const result = await lmsCaller(session).submission.layerForGuardian({ exerciseId, studentId: childId });
    expect(result.teacher).not.toBeNull();
    expect(result.teacher?.items).toHaveLength(1);
    expect(result.teacher?.items[0]).toMatchObject({ type: 'ink', color: '#f00' });
  });

  it('(d) a studentId not among the guardian own children → FORBIDDEN (not another family data)', async () => {
    if (!dbReachable) return;
    const session = await resolveParentSession(otherParentId);
    await expect(
      lmsCaller(session).submission.layerForGuardian({ exerciseId, studentId: childId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
