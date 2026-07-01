import { randomBytes } from 'node:crypto';
import { PrismaClient, Role } from '@prisma/client';
import { hashPassword } from './password.js';

// Seed runs as the owner role (DIRECT_URL) so it bypasses RLS.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

// ── Bootstrap seed ─────────────────────────────────────────────────────────
// When SEED_MODE=bootstrap: seeds ONLY one Facility (HQ) + one super_admin
// (the IT head). No staff, no demo students/parents. Idempotent.
// Used by the prod docker-compose api-seed service for a clean first-account
// system that the product owner then populates via the UI.
async function seedBootstrap(email: string, password: string): Promise<void> {
  const hq = await prisma.facility.upsert({
    where: { code: 'HQ' },
    update: {},
    create: { code: 'HQ', name: 'CMC Trụ sở chính' },
  });
  console.log(`✓ Facility: ${hq.code} (#${hq.id})`);

  const existing = await prisma.appUser.findUnique({ where: { email } });
  if (!existing) {
    await prisma.appUser.create({
      data: {
        email,
        displayName: 'IT Head (Super Admin)',
        passwordHash: await hashPassword(password),
        roles: [Role.super_admin],
        primaryRole: Role.super_admin,
        facilities: { create: { facilityId: hq.id } },
      },
    });
    console.log(`✓ Seeded super_admin (IT head) <${email}>`);
  } else {
    console.log(`• super_admin <${email}> already exists — skipped`);
  }

  // ── Executive board ("Ba trụ cột"): the two directors of the 3-heads org. ──────────
  // Seeded in prod so the org is operational on day one without UI account creation.
  // Staff (incl. directors) authenticate via Microsoft Entra SSO only — no password is
  // set; the hash is random + unusable so password login is impossible for these accounts.
  const DIRECTORS: Array<{ email: string; name: string; role: Role }> = [
    { email: 'nhungdt@cmcvn.edu.vn', name: 'Giám đốc Kinh doanh', role: Role.giam_doc_kinh_doanh },
    { email: 'hongltn@cmcvn.edu.vn', name: 'Giám đốc Đào tạo', role: Role.giam_doc_dao_tao },
  ];
  for (const d of DIRECTORS) {
    if (await prisma.appUser.findUnique({ where: { email: d.email } })) {
      console.log(`• ${d.role} <${d.email}> already exists — skipped`);
      continue;
    }
    await prisma.appUser.create({
      data: {
        email: d.email,
        displayName: d.name,
        passwordHash: await hashPassword(randomBytes(32).toString('base64url')),
        roles: [d.role],
        primaryRole: d.role,
        facilities: { create: { facilityId: hq.id } },
      },
    });
    console.log(`✓ Seeded ${d.role} <${d.email}> (SSO-only)`);
  }

  // ── Work shift defaults ──────────────────────────────────────────────
  await seedWorkShift(hq.id, hq.code);

  console.log('');
  console.log('Bootstrap complete. Log in as the IT head to create other accounts.');
  console.log(`  Email:    ${email}`);
  console.log(`  Password: (SEED_SUPERADMIN_PASSWORD)`);
}

// ── Full demo seed ─────────────────────────────────────────────────────────
// Default behavior when SEED_MODE is unset. Keeps all dev demo accounts so
// local development stays fully seeded. Do NOT change this without updating
// local dev documentation.
async function seedFull(email: string, password: string): Promise<void> {
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
    { email: 'quanly@cmc.local', name: 'Quản Lý Cơ Sở', role: Role.giam_doc_kinh_doanh },
    { email: 'bgd@cmc.local', name: 'Ban Giám Đốc', role: Role.giam_doc_kinh_doanh },
    { email: 'headteacher@cmc.local', name: 'Trưởng Bộ Môn', role: Role.giam_doc_dao_tao },
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
    where: { facilityId_studentCode: { facilityId: hq.id, studentCode: 'TEST-001' } },
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
  // ── Work shift defaults ──────────────────────────────────────────────
  await seedWorkShift(hq.id, hq.code);
  await seedWorkShift(branch.id, branch.code);

  console.log('');
  console.log('LMS Login credentials:');
  console.log(`  Student  — loginCode: TEST-001     password: (= SEED_SUPERADMIN_PASSWORD)`);
  console.log(`  Parent   — email: parent@cmc.local password: (= SEED_SUPERADMIN_PASSWORD)`);
}

/// Seed work shift defaults for a facility. Idempotent.
async function seedWorkShift(facilityId: number, facilityCode: string): Promise<void> {
  // ── Shift Groups ────────────────────────────────────────────────────
  const GROUPS = [
    { code: 'KINH_DOANH', name: 'Kinh doanh', selectionMode: 'SINGLE', sortOrder: 0 },
    { code: 'GIAO_VIEN', name: 'Giáo viên', selectionMode: 'MULTIPLE', sortOrder: 1 },
  ];
  const groupIds: Record<string, string> = {};
  for (const g of GROUPS) {
    const group = await prisma.shiftGroup.upsert({
      where: { facilityId_code: { facilityId, code: g.code } },
      update: { name: g.name, selectionMode: g.selectionMode },
      create: { facilityId, code: g.code, name: g.name, selectionMode: g.selectionMode, sortOrder: g.sortOrder },
    });
    groupIds[g.code] = group.id;
  }

  // ── Shift Templates ─────────────────────────────────────────────────
  const TEMPLATES: Array<{ groupCode: string; code: string; name: string; startTime: string; endTime: string; hours: number; sortOrder: number }> = [
    // Kinh doanh — 3 ca, 8h mỗi ca, SINGLE selection
    { groupCode: 'KINH_DOANH', code: 'CA1_KD', name: 'Ca 1', startTime: '08:30', endTime: '18:00', hours: 8.0, sortOrder: 0 },
    { groupCode: 'KINH_DOANH', code: 'CA2_KD', name: 'Ca 2', startTime: '10:00', endTime: '20:00', hours: 8.0, sortOrder: 1 },
    { groupCode: 'KINH_DOANH', code: 'CA3_KD', name: 'Ca 3', startTime: '13:00', endTime: '21:00', hours: 8.0, sortOrder: 2 },
    // Giáo viên — 3 ca, 4h mỗi ca, MULTIPLE selection
    { groupCode: 'GIAO_VIEN', code: 'CA1_GV', name: 'Ca 1', startTime: '08:00', endTime: '12:00', hours: 4.0, sortOrder: 0 },
    { groupCode: 'GIAO_VIEN', code: 'CA2_GV', name: 'Ca 2', startTime: '13:00', endTime: '17:00', hours: 4.0, sortOrder: 1 },
    { groupCode: 'GIAO_VIEN', code: 'CA3_GV', name: 'Ca 3', startTime: '17:00', endTime: '21:00', hours: 4.0, sortOrder: 2 },
  ];
  for (const t of TEMPLATES) {
    const gid = groupIds[t.groupCode];
    if (!gid) continue;
    await prisma.shiftTemplate.upsert({
      where: { shiftGroupId_code: { shiftGroupId: gid, code: t.code } },
      update: { name: t.name, startTime: t.startTime, endTime: t.endTime, hours: t.hours },
      create: {
        facilityId, shiftGroupId: gid, code: t.code, name: t.name,
        startTime: t.startTime, endTime: t.endTime, hours: t.hours, sortOrder: t.sortOrder,
      },
    });
  }
    // ── Facility Network (IP whitelist for check-in) ─────────────────────
  await prisma.facilityNetwork.upsert({
    where: { facilityId_ipAddress: { facilityId, ipAddress: '127.0.0.1' } },
    update: {},
    create: { facilityId, ipAddress: '127.0.0.1', label: `WiFi VP ${facilityCode} (dev)` },
  });

  console.log(`✓ Work shift defaults: ${facilityCode} (${Object.keys(groupIds).length} groups, ${TEMPLATES.length} templates, 1 IP)`);
}

async function main(): Promise<void> {
  const email = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@cmc.local';
  const password = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe!123';

  if (process.env.NODE_ENV === 'production' && password === 'ChangeMe!123') {
    throw new Error('SEED_SUPERADMIN_PASSWORD phải được đổi trong production');
  }

  const mode = process.env.SEED_MODE ?? 'full';
  console.log(`Seed mode: ${mode}`);

  if (mode === 'bootstrap') {
    await seedBootstrap(email, password);
  } else {
    await seedFull(email, password);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
