import { PrismaClient, Program } from '@prisma/client';

// Demo/dev data so the UI can exercise the full Phase 1 flow. Idempotent.
// Runs as the owner role (DIRECT_URL) → bypasses RLS.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

async function main(): Promise<void> {
  const hq = await prisma.facility.findUniqueOrThrow({ where: { code: 'HQ' } });

  const courses: { code: string; name: string; program: Program }[] = [
    { code: 'UCREA-01', name: 'UCREA — Khơi nguồn sáng tạo', program: 'UCREA' },
    { code: 'BIG-01', name: 'Bright I.G — Tư duy trung cấp', program: 'BRIGHT_IG' },
    { code: 'BH-01', name: 'Black Hole — Lập luận nâng cao', program: 'BLACK_HOLE' },
  ];
  for (const c of courses) {
    await prisma.course.upsert({ where: { code: c.code }, update: {}, create: c });
  }

  for (const code of ['P101', 'P102']) {
    await prisma.room.upsert({
      where: { facilityId_code: { facilityId: hq.id, code } },
      update: {},
      create: { facilityId: hq.id, code, name: `Phòng ${code}`, capacity: 25 },
    });
  }

  const students = [
    { studentCode: 'HS-0001', fullName: 'Nguyễn Văn An', program: 'UCREA' as Program },
    { studentCode: 'HS-0002', fullName: 'Trần Thị Bình', program: 'UCREA' as Program },
    { studentCode: 'HS-0003', fullName: 'Lê Hoàng Cường', program: 'BRIGHT_IG' as Program },
    { studentCode: 'HS-0004', fullName: 'Phạm Thuỳ Dung', program: 'BRIGHT_IG' as Program },
  ];
  for (const s of students) {
    await prisma.student.upsert({
      where: { facilityId_studentCode: { facilityId: hq.id, studentCode: s.studentCode } },
      update: {},
      create: { facilityId: hq.id, lifecycle: 'admitted', ...s },
    });
  }

  // Grading templates per program (facility-scoped). formula = quantitative blend weights;
  // the qual/quant program split lives in @cmc/domain-grading. Idempotent (find-then-create —
  // the (facility,program,level) unique can't dedupe on a NULL level).
  const THRESHOLDS = [
    { minPercent: 0, maxPercent: 49.999, grade: 'Cần cố gắng', result: 'fail', sequence: 0 },
    { minPercent: 50, maxPercent: 64.999, grade: 'Đạt', result: 'pass', sequence: 1 },
    { minPercent: 65, maxPercent: 79.999, grade: 'Khá', result: 'pass', sequence: 2 },
    { minPercent: 80, maxPercent: 89.999, grade: 'Giỏi', result: 'pass', sequence: 3 },
    { minPercent: 90, maxPercent: 100, grade: 'Xuất sắc', result: 'pass', sequence: 4 },
  ];
  const PILLARS: Record<Program, string[]> = {
    UCREA: ['sáng tạo', 'tập trung', 'hợp tác', 'tự tin'],
    BRIGHT_IG: ['tư duy', 'diễn đạt', 'hợp tác', 'kỷ luật'],
    BLACK_HOLE: ['lập luận', 'phản biện', 'trình bày', 'kiên trì'],
  };
  let templateCount = 0;
  for (const program of ['UCREA', 'BRIGHT_IG', 'BLACK_HOLE'] as Program[]) {
    const existing = await prisma.gradingTemplate.findFirst({
      where: { facilityId: hq.id, program, level: null },
    });
    if (existing) continue;
    await prisma.gradingTemplate.create({
      data: {
        facilityId: hq.id,
        program,
        formula: { homework: 0.5, test: 0.3, attendance: 0.2 },
        criteria: { pillars: PILLARS[program] },
        thresholds: { create: THRESHOLDS.map((t) => ({ facilityId: hq.id, ...t })) },
      },
    });
    templateCount++;
  }

  // ── Class batch + this-week sessions + enrollments ─────────────────────────
  // Needed so the schedule (Lịch dạy) has lesson rows to open the connected Session Detail.
  const ucrea = await prisma.course.findUniqueOrThrow({ where: { code: 'UCREA-01' } });
  const room = await prisma.room.findUniqueOrThrow({
    where: { facilityId_code: { facilityId: hq.id, code: 'P101' } },
  });

  const batch = await prisma.classBatch.upsert({
    where: { facilityId_code: { facilityId: hq.id, code: 'B-DEMO-001' } },
    update: {},
    create: {
      facilityId: hq.id,
      code: 'B-DEMO-001',
      courseId: ucrea.id,
      name: 'UCREA Sáng tạo — lớp demo',
      status: 'running',
    },
  });

  // One weekly slot (Thứ 4, 18:00–19:30, P101) for context in the class workspace.
  const existingSlot = await prisma.scheduleSlot.findFirst({
    where: { classBatchId: batch.id, dayOfWeek: 3, startTime: '18:00', archivedAt: null },
  });
  if (!existingSlot) {
    await prisma.scheduleSlot.create({
      data: {
        facilityId: hq.id,
        classBatchId: batch.id,
        dayOfWeek: 3,
        startTime: '18:00',
        endTime: '19:30',
        roomId: room.id,
      },
    });
  }

  // Three sessions across THIS week (Mon/Wed/Fri) so the default "Tuần này" view shows rows.
  const monday = new Date();
  const dow = monday.getDay(); // 0=Sun..6=Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  monday.setDate(monday.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sessionDates = [0, 2, 4].map((add) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + add);
    return d;
  });
  let sessionCount = 0;
  for (const d of sessionDates) {
    await prisma.classSession.upsert({
      where: {
        classBatchId_sessionDate_startTime: {
          classBatchId: batch.id,
          sessionDate: d,
          startTime: '18:00',
        },
      },
      update: {},
      create: {
        facilityId: hq.id,
        classBatchId: batch.id,
        sessionDate: d,
        startTime: '18:00',
        endTime: '19:30',
        roomId: room.id,
        status: 'planned',
      },
    });
    sessionCount++;
  }

  // Enroll the two UCREA demo students into the demo batch.
  let enrollCount = 0;
  for (const code of ['HS-0001', 'HS-0002']) {
    const stu = await prisma.student.findUniqueOrThrow({
      where: { facilityId_studentCode: { facilityId: hq.id, studentCode: code } },
    });
    await prisma.enrollment.upsert({
      where: { classBatchId_studentId: { classBatchId: batch.id, studentId: stu.id } },
      update: {},
      create: { facilityId: hq.id, classBatchId: batch.id, studentId: stu.id, status: 'active' },
    });
    enrollCount++;
  }

  console.log(
    `✓ Demo seed: ${courses.length} khóa, 2 phòng, ${students.length} học sinh, ${templateCount} grading template mới, ` +
      `1 lớp (${batch.code}), ${sessionCount} buổi học tuần này, ${enrollCount} ghi danh @ ${hq.code}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
