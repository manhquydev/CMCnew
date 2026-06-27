/**
 * Phase 2 (S1.6) done-evidence: prove the notification policy is principal-aware, not
 * facility-wide. Before the fix, any parent/student in a center matched the facility clause
 * and could read every child's grade alert. Now a parent sees only their own child's rows.
 *
 * Run: pnpm --filter @cmc/db exec tsx src/verify-notification-rls.ts
 */
import { prisma, withRls } from './index.js';

const SUPER = { facilityIds: [], isSuperAdmin: true };

async function main(): Promise<void> {
  // Two students in the SAME facility (#1) → the exact case the old facility-only policy leaked.
  const [studentA, studentB] = await withRls(SUPER, async (tx) => {
    const a = await tx.student.upsert({
      where: { facilityId_studentCode: { facilityId: 1, studentCode: 'HS-RLS-A' } },
      update: {},
      create: { facilityId: 1, studentCode: 'HS-RLS-A', fullName: 'RLS Test A', program: 'UCREA' },
      select: { id: true },
    });
    const b = await tx.student.upsert({
      where: { facilityId_studentCode: { facilityId: 1, studentCode: 'HS-RLS-B' } },
      update: {},
      create: { facilityId: 1, studentCode: 'HS-RLS-B', fullName: 'RLS Test B', program: 'UCREA' },
      select: { id: true },
    });
    // One addressed notification per student.
    for (const s of [a, b]) {
      const existing = await tx.notification.findFirst({
        where: { recipientId: s.id, type: 'grade_published' },
      });
      if (!existing) {
        await tx.notification.create({
          data: {
            facilityId: 1,
            recipientType: 'student',
            recipientId: s.id,
            type: 'grade_published',
            payload: { score: 9 },
          },
        });
      }
    }
    return [a.id, b.id];
  });

  const recipientsOf = (rows: { recipientId: string }[]) => new Set(rows.map((r) => r.recipientId));

  // Parent principal owning ONLY student A.
  const asParentA = await withRls(
    { facilityIds: [1], isSuperAdmin: false, principalKind: 'parent', studentIds: [studentA] },
    (tx) => tx.notification.findMany({ select: { recipientId: true } }),
  );
  // Student principal = self (B).
  const asStudentB = await withRls(
    { facilityIds: [1], isSuperAdmin: false, principalKind: 'student', studentIds: [studentB] },
    (tx) => tx.notification.findMany({ select: { recipientId: true } }),
  );
  // Staff in facility 1 still sees the whole center (management view).
  const asStaff = await withRls(
    { facilityIds: [1], isSuperAdmin: false },
    (tx) => tx.notification.findMany({ where: { recipientId: { in: [studentA, studentB] } }, select: { recipientId: true } }),
  );

  const pa = recipientsOf(asParentA);
  const sb = recipientsOf(asStudentB);
  const st = recipientsOf(asStaff);

  console.log('parent(A) sees recipients :', [...pa]);
  console.log('student(B) sees recipients:', [...sb]);
  console.log('staff(fac1) sees recipients:', [...st]);

  const ok =
    pa.has(studentA) && !pa.has(studentB) && // parent A: own child only, NOT child B
    sb.has(studentB) && !sb.has(studentA) && // student B: self only
    st.has(studentA) && st.has(studentB); // staff: both

  if (!ok) {
    console.error('✗ notification RLS FAILED — a principal saw a notification it does not own');
    process.exitCode = 1;
  } else {
    console.log('✓ notification RLS verified: parent/student see only their own; staff sees the facility');
  }
}

main().finally(() => prisma.$disconnect());
