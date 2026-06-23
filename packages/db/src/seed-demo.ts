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
      where: { studentCode: s.studentCode },
      update: {},
      create: { facilityId: hq.id, lifecycle: 'admitted', ...s },
    });
  }

  console.log(`✓ Demo seed: ${courses.length} khóa, 2 phòng, ${students.length} học sinh @ ${hq.code}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
