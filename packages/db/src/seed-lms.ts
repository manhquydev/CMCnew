import { PrismaClient, Program, Role } from '@prisma/client';
import { hashPassword } from './password.js';

// LMS verification seed: the accounts + graded data needed to walk the S2 (học bạ) slice
// live — teacher writes qualitative + computes FinalGrade, parent reads it, and RLS isolates
// across facilities. Idempotent; runs as owner (DIRECT_URL) so it bypasses RLS.
// Run after `seed` + `seed:demo`.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const TEACHER_PW = 'Teacher!123';
const PARENT_PW = 'Parent!123';

async function ensureTeacher(email: string, displayName: string, facilityId: number) {
  const existing = await prisma.appUser.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.appUser.create({
    data: {
      email,
      displayName,
      passwordHash: await hashPassword(TEACHER_PW),
      roles: [Role.giao_vien, Role.head_teacher],
      primaryRole: Role.head_teacher,
      facilities: { create: { facilityId } },
    },
  });
}

async function ensureLeader(email: string, displayName: string, facilityId: number) {
  const existing = await prisma.appUser.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.appUser.create({
    data: {
      email,
      displayName,
      passwordHash: await hashPassword(TEACHER_PW),
      roles: [Role.quan_ly],
      primaryRole: Role.quan_ly,
      facilities: { create: { facilityId } },
    },
  });
}

async function ensureStudent(
  facilityId: number,
  studentCode: string,
  fullName: string,
  program: Program,
) {
  return prisma.student.upsert({
    where: { studentCode },
    update: {},
    create: { facilityId, studentCode, fullName, program, lifecycle: 'active' },
  });
}

async function ensureParent(email: string, displayName: string) {
  const existing = await prisma.parentAccount.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.parentAccount.create({
    data: { email, displayName, passwordHash: await hashPassword(PARENT_PW) },
  });
}

async function linkGuardian(facilityId: number, parentAccountId: string, studentId: string) {
  await prisma.guardian.upsert({
    where: { parentAccountId_studentId: { parentAccountId, studentId } },
    update: {},
    create: { facilityId, parentAccountId, studentId, relation: 'guardian' },
  });
}

// A graded class for one student: batch + enrollment + 2 sessions w/ attendance + a homework and
// a periodic-test exercise, each submitted and published — the quant inputs FinalGrade needs.
async function seedGradedClass(opts: {
  facilityId: number;
  courseCode: string;
  batchCode: string;
  batchName: string;
  studentId: string;
  teacherId: string;
  homeworkScore: number;
  testScore: number;
}) {
  const course = await prisma.course.findUniqueOrThrow({ where: { code: opts.courseCode } });
  const batch = await prisma.classBatch.upsert({
    where: { code: opts.batchCode },
    update: {},
    create: {
      facilityId: opts.facilityId,
      code: opts.batchCode,
      courseId: course.id,
      name: opts.batchName,
      status: 'running',
    },
  });
  const enrollment = await prisma.enrollment.upsert({
    where: { classBatchId_studentId: { classBatchId: batch.id, studentId: opts.studentId } },
    update: {},
    create: { facilityId: opts.facilityId, classBatchId: batch.id, studentId: opts.studentId },
  });

  // Two sessions: present + late → attendanceRate 1.0 (both count as attended).
  const sessions = [
    { sessionDate: new Date('2026-06-01'), startTime: '18:00', endTime: '19:30', status: 'present' as const },
    { sessionDate: new Date('2026-06-03'), startTime: '18:00', endTime: '19:30', status: 'late' as const },
  ];
  for (const s of sessions) {
    const session = await prisma.classSession.upsert({
      where: {
        classBatchId_sessionDate_startTime: {
          classBatchId: batch.id,
          sessionDate: s.sessionDate,
          startTime: s.startTime,
        },
      },
      update: {},
      create: {
        facilityId: opts.facilityId,
        classBatchId: batch.id,
        sessionDate: s.sessionDate,
        startTime: s.startTime,
        endTime: s.endTime,
        teacherId: opts.teacherId,
        status: 'confirmed',
      },
    });
    await prisma.attendance.upsert({
      where: {
        classSessionId_enrollmentId: { classSessionId: session.id, enrollmentId: enrollment.id },
      },
      update: {},
      create: {
        facilityId: opts.facilityId,
        classSessionId: session.id,
        enrollmentId: enrollment.id,
        status: s.status,
        markedById: opts.teacherId,
        markedAt: new Date(),
      },
    });
  }

  // A homework + a periodic test, each with a published grade.
  const exercises = [
    { title: `${opts.batchName} — Bài tập về nhà`, type: 'homework' as const, score: opts.homeworkScore },
    { title: `${opts.batchName} — Kiểm tra định kỳ`, type: 'test_periodic' as const, score: opts.testScore },
  ];
  for (const ex of exercises) {
    let exercise = await prisma.exercise.findFirst({
      where: { classBatchId: batch.id, title: ex.title },
    });
    if (!exercise) {
      exercise = await prisma.exercise.create({
        data: {
          facilityId: opts.facilityId,
          classBatchId: batch.id,
          title: ex.title,
          type: ex.type,
          status: 'published',
          maxScore: 10,
          createdById: opts.teacherId,
        },
      });
    }
    const submission = await prisma.submission.upsert({
      where: { exerciseId_studentId: { exerciseId: exercise.id, studentId: opts.studentId } },
      update: {},
      create: {
        facilityId: opts.facilityId,
        exerciseId: exercise.id,
        studentId: opts.studentId,
        status: 'graded',
        submittedAt: new Date('2026-06-05'),
      },
    });
    await prisma.grade.upsert({
      where: { submissionId: submission.id },
      update: { score: ex.score, isPublished: true },
      create: {
        facilityId: opts.facilityId,
        submissionId: submission.id,
        score: ex.score,
        maxScore: 10,
        isPublished: true,
        gradedById: opts.teacherId,
      },
    });
  }
}

// Badge catalog per facility (S3). Minimal taxonomy: stars_total + homework_count thresholds.
const BADGES = [
  { code: 'HW_1', name: 'Khởi động', description: 'Hoàn thành bài tập đầu tiên', criteria: { kind: 'homework_count', gte: 1 } },
  { code: 'HW_5', name: 'Chăm chỉ', description: 'Hoàn thành 5 bài tập', criteria: { kind: 'homework_count', gte: 5 } },
  { code: 'STAR_10', name: 'Ngôi sao đầu tiên', description: 'Đạt 10 sao', criteria: { kind: 'stars_total', gte: 10 } },
  { code: 'STAR_100', name: 'Siêu sao', description: 'Đạt 100 sao', criteria: { kind: 'stars_total', gte: 100 } },
];

async function seedBadges(facilityId: number) {
  for (const b of BADGES) {
    await prisma.badge.upsert({
      where: { facilityId_code: { facilityId, code: b.code } },
      update: { name: b.name, description: b.description, unlockCriteria: b.criteria },
      create: { facilityId, code: b.code, name: b.name, description: b.description, unlockCriteria: b.criteria },
    });
  }
}

// Add a classmate to an existing batch with a fixed star bonus — gives the leaderboard a
// non-trivial ranking to verify (anonymized-except-self). Idempotent: enrollment unique +
// star_transaction @@unique(type, reference).
async function seedClassmate(opts: {
  facilityId: number;
  studentCode: string;
  fullName: string;
  program: Program;
  batchCode: string;
  stars: number;
}) {
  const student = await ensureStudent(opts.facilityId, opts.studentCode, opts.fullName, opts.program);
  const batch = await prisma.classBatch.findUniqueOrThrow({ where: { code: opts.batchCode } });
  await prisma.enrollment.upsert({
    where: { classBatchId_studentId: { classBatchId: batch.id, studentId: student.id } },
    update: {},
    create: { facilityId: opts.facilityId, classBatchId: batch.id, studentId: student.id },
  });
  await prisma.starTransaction.createMany({
    data: [{ facilityId: opts.facilityId, studentId: student.id, amount: opts.stars, type: 'manual', reference: `seed-bonus-${student.id}` }],
    skipDuplicates: true,
  });
  return student;
}

async function main(): Promise<void> {
  const hq = await prisma.facility.findUniqueOrThrow({ where: { code: 'HQ' } });
  const cs2 = await prisma.facility.findUniqueOrThrow({ where: { code: 'CS2' } });

  const teacher = await ensureTeacher('gv@cmc.local', 'Cô Lan (GV)', hq.id);
  // Leadership account (quan_ly) — verifies system-wide parent/identity management without super.
  await ensureLeader('ld@cmc.local', 'Trưởng cơ sở (QL)', hq.id);
  await seedBadges(hq.id);
  await seedBadges(cs2.id);

  // One student per program at HQ so the 3 weightings (UCREA 100/0, BI 60/40, BH 30/70) are
  // all walkable. HS-0001/0003 exist from seed:demo; HS-0005 (BLACK_HOLE) is new here.
  const an = await ensureStudent(hq.id, 'HS-0001', 'Nguyễn Văn An', 'UCREA');
  const cuong = await ensureStudent(hq.id, 'HS-0003', 'Lê Hoàng Cường', 'BRIGHT_IG');
  const duc = await ensureStudent(hq.id, 'HS-0005', 'Đỗ Minh Đức', 'BLACK_HOLE');

  // CS2 student in a different facility — the RLS isolation target.
  const cs2Student = await ensureStudent(cs2.id, 'HS-CS2-01', 'Vũ Gia Hân', 'UCREA');

  // HQ parent guards all 3 HQ children; CS2 parent guards only the CS2 child.
  const parent = await ensureParent('ph@cmc.local', 'Phụ huynh HQ');
  for (const s of [an, cuong, duc]) await linkGuardian(hq.id, parent.id, s.id);
  const parent2 = await ensureParent('ph2@cmc.local', 'Phụ huynh CS2');
  await linkGuardian(cs2.id, parent2.id, cs2Student.id);

  await seedGradedClass({
    facilityId: hq.id,
    courseCode: 'UCREA-01',
    batchCode: 'B-2026-9001',
    batchName: 'UCREA lớp demo',
    studentId: an.id,
    teacherId: teacher.id,
    homeworkScore: 9,
    testScore: 8,
  });
  await seedGradedClass({
    facilityId: hq.id,
    courseCode: 'BIG-01',
    batchCode: 'B-2026-9002',
    batchName: 'Bright I.G lớp demo',
    studentId: cuong.id,
    teacherId: teacher.id,
    homeworkScore: 8,
    testScore: 7,
  });
  await seedGradedClass({
    facilityId: hq.id,
    courseCode: 'BH-01',
    batchCode: 'B-2026-9003',
    batchName: 'Black Hole lớp demo',
    studentId: duc.id,
    teacherId: teacher.id,
    homeworkScore: 7,
    testScore: 9,
  });

  // Classmates in An's UCREA batch so the in-class leaderboard has a real ranking to show.
  await seedClassmate({ facilityId: hq.id, studentCode: 'HS-0002', fullName: 'Trần Thị Bình', program: 'UCREA', batchCode: 'B-2026-9001', stars: 50 });
  await seedClassmate({ facilityId: hq.id, studentCode: 'HS-0006', fullName: 'Hoàng Văn Em', program: 'UCREA', batchCode: 'B-2026-9001', stars: 5 });

  console.log('✓ LMS verification seed:');
  console.log(`  GV  : gv@cmc.local / ${TEACHER_PW}`);
  console.log(`  PH HQ : ph@cmc.local / ${PARENT_PW}  (An·UCREA, Cường·BRIGHT_IG, Đức·BLACK_HOLE)`);
  console.log(`  PH CS2: ph2@cmc.local / ${PARENT_PW}  (Hân·UCREA @CS2 — isolation target)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
