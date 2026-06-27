/**
 * S2.2 done-evidence (security-class): prove RLS on the new grading tables.
 *   final_grade / qualitative_assessment : staff→facility, parent/student→own student only;
 *                                          parent/student CANNOT write (WITH CHECK staff-only).
 *   grading_template                     : staff→facility; a non-staff principal sees nothing.
 *
 * Run: pnpm --filter @cmc/db exec tsx src/verify-grading-rls.ts
 */
import { prisma, withRls } from './index.js';

const SUPER = { facilityIds: [], isSuperAdmin: true };

async function main(): Promise<void> {
  const [A, B] = await withRls(SUPER, async (tx) => {
    const a = await tx.student.findUniqueOrThrow({ where: { facilityId_studentCode: { facilityId: 1, studentCode: 'HS-RLS-A' } }, select: { id: true } });
    const b = await tx.student.findUniqueOrThrow({ where: { facilityId_studentCode: { facilityId: 1, studentCode: 'HS-RLS-B' } }, select: { id: true } });
    for (const s of [a, b]) {
      await tx.finalGrade.upsert({
        where: { studentId_program_periodKey: { studentId: s.id, program: 'UCREA', periodKey: '2026-06' } },
        update: {},
        create: { facilityId: 1, studentId: s.id, program: 'UCREA', periodKey: '2026-06', finalScore: 8, passed: true, complete: true },
      });
      await tx.qualitativeAssessment.upsert({
        where: { studentId_periodKey: { studentId: s.id, periodKey: '2026-06' } },
        update: {},
        create: { facilityId: 1, studentId: s.id, period: 'MONTHLY', periodKey: '2026-06', criteria: { focus: 8 } },
      });
    }
    return [a.id, b.id];
  });

  const ids = (rows: { studentId: string }[]) => new Set(rows.map((r) => r.studentId));

  const parentA = { facilityIds: [1], isSuperAdmin: false, principalKind: 'parent' as const, studentIds: [A] };
  const studentB = { facilityIds: [1], isSuperAdmin: false, principalKind: 'student' as const, studentIds: [B] };
  const staff = { facilityIds: [1], isSuperAdmin: false };

  // 1) READ isolation on final_grade.
  const fgParentA = ids(await withRls(parentA, (tx) => tx.finalGrade.findMany({ select: { studentId: true } })));
  const fgStudentB = ids(await withRls(studentB, (tx) => tx.finalGrade.findMany({ select: { studentId: true } })));
  const fgStaff = ids(await withRls(staff, (tx) => tx.finalGrade.findMany({ where: { studentId: { in: [A, B] } }, select: { studentId: true } })));

  // 2) READ isolation on qualitative_assessment (parent A).
  const qaParentA = ids(await withRls(parentA, (tx) => tx.qualitativeAssessment.findMany({ select: { studentId: true } })));

  // 3) Config table: staff sees templates, a parent principal sees none.
  const tplStaff = (await withRls(staff, (tx) => tx.gradingTemplate.findMany({ select: { id: true } }))).length;
  const tplParent = (await withRls(parentA, (tx) => tx.gradingTemplate.findMany({ select: { id: true } }))).length;

  // 4) WRITE guard: a parent principal must NOT be able to insert a final_grade (WITH CHECK staff-only).
  let parentWriteBlocked = false;
  try {
    await withRls(parentA, (tx) =>
      tx.finalGrade.create({
        data: { facilityId: 1, studentId: A, program: 'BRIGHT_IG', periodKey: 'hack', finalScore: 10, passed: true, complete: true },
      }),
    );
  } catch {
    parentWriteBlocked = true;
  }

  console.log('final_grade  parent(A):', [...fgParentA], '| student(B):', [...fgStudentB], '| staff:', [...fgStaff]);
  console.log('qualitative  parent(A):', [...qaParentA]);
  console.log('templates    staff sees:', tplStaff, '| parent sees:', tplParent);
  console.log('parent write blocked:', parentWriteBlocked);

  const ok =
    fgParentA.has(A) && !fgParentA.has(B) &&
    fgStudentB.has(B) && !fgStudentB.has(A) &&
    fgStaff.has(A) && fgStaff.has(B) &&
    qaParentA.has(A) && !qaParentA.has(B) &&
    tplStaff >= 1 && tplParent === 0 &&
    parentWriteBlocked;

  if (!ok) {
    console.error('✗ grading RLS FAILED');
    process.exitCode = 1;
  } else {
    console.log('✓ grading RLS verified: ownership reads isolated, config staff-only, parent writes blocked');
  }
}

main().finally(() => prisma.$disconnect());
