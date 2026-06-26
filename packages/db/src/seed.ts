import { PrismaClient, Role } from '@prisma/client';
import { hashPassword } from './password.js';

// Seed runs as the owner role (DIRECT_URL) so it bypasses RLS.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

async function main(): Promise<void> {
  const email = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@cmc.local';
  const password = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe!123';

  if (process.env.NODE_ENV === 'production' && password === 'ChangeMe!123') {
    throw new Error('SEED_SUPERADMIN_PASSWORD phải được đổi trong production');
  }

  const hq = await prisma.facility.upsert({
    where: { code: 'HQ' },
    update: {},
    create: { code: 'HQ', name: 'CMC Trụ sở chính' },
  });

  // Second facility — used to prove RLS isolation in Phase 0 done-evidence.
  const branch = await prisma.facility.upsert({
    where: { code: 'CS2' },
    update: {},
    create: { code: 'CS2', name: 'CMC Cơ sở 2' },
  });

  const existing = await prisma.appUser.findUnique({ where: { email } });
  if (!existing) {
    await prisma.appUser.create({
      data: {
        email,
        displayName: 'Super Admin',
        passwordHash: await hashPassword(password),
        roles: [Role.super_admin],
        primaryRole: Role.super_admin,
        facilities: { create: { facilityId: hq.id } },
      },
    });
    console.log(`✓ Seeded super_admin <${email}>`);
  } else {
    console.log(`• super_admin <${email}> already exists — skipped`);
  }
  console.log(`✓ Facilities: ${hq.code} (#${hq.id}), ${branch.code} (#${branch.id})`);

  // ── Operational staff accounts (one per role at HQ) — the first accounts needed
  // to run the business end-to-end. Idempotent. All share SEED_SUPERADMIN_PASSWORD
  // for a simple first login; change per-user in the admin app after launch. ──────
  const STAFF: Array<{ email: string; name: string; role: Role }> = [
    { email: 'quanly@cmc.local', name: 'Quản Lý Cơ Sở', role: Role.quan_ly },
    { email: 'bgd@cmc.local', name: 'Ban Giám Đốc', role: Role.bgd },
    { email: 'headteacher@cmc.local', name: 'Trưởng Bộ Môn', role: Role.head_teacher },
    { email: 'giaovien@cmc.local', name: 'Giáo Viên', role: Role.giao_vien },
    { email: 'ketoan@cmc.local', name: 'Kế Toán', role: Role.ke_toan },
    { email: 'hr@cmc.local', name: 'Nhân Sự (HR)', role: Role.hr },
    { email: 'sale@cmc.local', name: 'Tư Vấn Tuyển Sinh', role: Role.sale },
    { email: 'cskh@cmc.local', name: 'Chăm Sóc Khách Hàng', role: Role.cskh },
    { email: 'mkt@cmc.local', name: 'Cộng Tác Viên MKT', role: Role.ctv_mkt },
  ];
  for (const s of STAFF) {
    if (await prisma.appUser.findUnique({ where: { email: s.email } })) {
      console.log(`• ${s.role} <${s.email}> already exists — skipped`);
      continue;
    }
    await prisma.appUser.create({
      data: {
        email: s.email,
        displayName: s.name,
        passwordHash: await hashPassword(password),
        roles: [s.role],
        primaryRole: s.role,
        facilities: { create: { facilityId: hq.id } },
      },
    });
    console.log(`✓ Seeded ${s.role} <${s.email}>`);
  }

  // ── LMS seed: student + parent accounts ─────────────────────────────────────
  const lmsPassword = password; // reuse SEED_SUPERADMIN_PASSWORD for simplicity

  // 1. Student record
  const seedStudent = await prisma.student.upsert({
    where: { studentCode: 'TEST-001' },
    create: {
      facilityId: hq.id,
      studentCode: 'TEST-001',
      fullName: 'Nguyễn Thị Test',
      dateOfBirth: new Date('2018-01-15'),
      program: 'UCREA',
    },
    update: {},
  });
  console.log(`✓ Seed student: ${seedStudent.fullName} (${seedStudent.studentCode})`);

  // 2. StudentAccount for LMS login (loginCode = TEST-001, password = lmsPassword)
  const existingStudentAcc = await prisma.studentAccount.findUnique({ where: { studentId: seedStudent.id } });
  if (!existingStudentAcc) {
    await prisma.studentAccount.create({
      data: {
        studentId: seedStudent.id,
        loginCode: 'TEST-001',
        passwordHash: await hashPassword(lmsPassword),
        isActive: true,
      },
    });
    console.log('✓ Seed studentAccount: loginCode=TEST-001');
  } else {
    console.log('• studentAccount TEST-001 already exists — skipped');
  }

  // 3. Enroll seed student in the first available class at HQ (if any)
  const firstBatch = await prisma.classBatch.findFirst({ where: { facilityId: hq.id } });
  if (firstBatch) {
    await prisma.enrollment.upsert({
      where: { classBatchId_studentId: { classBatchId: firstBatch.id, studentId: seedStudent.id } },
      create: { facilityId: hq.id, classBatchId: firstBatch.id, studentId: seedStudent.id },
      update: {},
    });
    console.log(`✓ Seed enrollment: ${seedStudent.fullName} → ${firstBatch.code}`);
  } else {
    console.log('• No class batch found at HQ — enrollment skipped');
  }

  // 4. ParentAccount
  const seedParent = await prisma.parentAccount.upsert({
    where: { email: 'parent@cmc.local' },
    create: {
      email: 'parent@cmc.local',
      displayName: 'Phụ Huynh Test',
      passwordHash: await hashPassword(lmsPassword),
      isActive: true,
    },
    update: {},
  });
  console.log(`✓ Seed parentAccount: parent@cmc.local`);

  // 5. Guardian link: parent ↔ student
  await prisma.guardian.upsert({
    where: { parentAccountId_studentId: { parentAccountId: seedParent.id, studentId: seedStudent.id } },
    create: { facilityId: hq.id, parentAccountId: seedParent.id, studentId: seedStudent.id },
    update: {},
  });
  console.log('✓ Seed guardian link: parent@cmc.local ↔ TEST-001');
  console.log('');
  console.log('LMS Login credentials:');
  console.log(`  Student  — loginCode: TEST-001     password: (= SEED_SUPERADMIN_PASSWORD)`);
  console.log(`  Parent   — email: parent@cmc.local password: (= SEED_SUPERADMIN_PASSWORD)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
