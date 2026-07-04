import { randomBytes } from 'node:crypto';
import { PrismaClient, Role } from '@prisma/client';
import { hashPassword } from './password.js';

// Seed runs as the owner role (DIRECT_URL) so it bypasses RLS.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

// Human-readable Vietnamese job title per role, used for the seeded EmploymentProfile.position.
// Wording mirrors ROLE_LABELS in apps/api/src/routers/user.ts (kept in sync manually — cross-package
// import would invert the apps/api → packages/db dependency direction).
const POSITION_LABELS: Partial<Record<Role, string>> = {
  [Role.giam_doc_kinh_doanh]: 'Giám đốc Kinh doanh',
  [Role.giam_doc_dao_tao]: 'Giám đốc Đào tạo',
  [Role.giao_vien]: 'Giáo viên',
  [Role.ke_toan]: 'Kế toán',
  [Role.hr]: 'Nhân sự',
  [Role.sale]: 'Tư vấn tuyển sinh',
  [Role.cskh]: 'Chăm sóc khách hàng',
  [Role.ctv_mkt]: 'Cộng tác viên Marketing',
};

/** Local copy of apps/api/src/services/employee-code.ts's nextEmployeeCode. Duplicated rather
 * than imported: packages/db must not depend on apps/api (wrong direction across the package
 * boundary). Uses the plain PrismaClient (no tx) — seed runs single-threaded, so the extra
 * atomicity a transaction buys the live app isn't needed here. Same shared DB counter, so codes
 * never collide with ones assigned later through the real UI. */
async function nextEmployeeCodeSeed(): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ next: number }[]>(
    `INSERT INTO employee_code_counter (id, last_seq) VALUES (1, 1)
     ON CONFLICT (id) DO UPDATE SET last_seq = employee_code_counter.last_seq + 1
     RETURNING last_seq AS next`,
  );
  return `CMC${String(rows[0]?.next ?? 1).padStart(4, '0')}`;
}

/** Plausible, distinct 12-digit CCCD-style national ID per seed index — not a real government ID,
 * just realistic-looking and never a "TEST"/all-same-digit placeholder. Deterministic → idempotent. */
function seedNationalId(idx: number): string {
  const province = '001'; // CCCD province-code prefix (Hà Nội)
  const genderCentury = '0'; // nam, sinh thế kỷ 20/21 per CCCD encoding
  const birthYear = String(85 + ((idx * 3) % 15)).padStart(2, '0'); // spreads across 1985–1999
  const seq = String(100000 + idx * 913).slice(-6);
  return `${province}${genderCentury}${birthYear}${seq}`;
}

/** Plausible startedAt spread across the last 1–3 years, so seeded staff tenure looks realistic
 * instead of every account starting "today". Deterministic per index → idempotent. */
function seedStartedAt(idx: number): Date {
  const daysAgo = 365 + ((idx * 97) % 730); // 1–3 years ago
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

/** Ensure a seeded staff account has the mandatory EmploymentProfile that user.create now
 * requires atomically (apps/api/src/routers/user.ts). Backfills accounts seeded before that
 * rule existed too. Idempotent: skips if a profile already exists for this user. */
async function ensureEmploymentProfile(
  facilityId: number,
  userId: string,
  role: Role,
  idx: number,
): Promise<void> {
  const existing = await prisma.employmentProfile.findUnique({ where: { userId } });
  if (existing) {
    console.log(`• EmploymentProfile for user #${userId} already exists — skipped`);
    return;
  }
  const position = POSITION_LABELS[role] ?? role;
  const employeeCode = await nextEmployeeCodeSeed();
  await prisma.employmentProfile.create({
    data: {
      facilityId,
      userId,
      position,
      startedAt: seedStartedAt(idx),
      nationalId: seedNationalId(idx),
      employeeCode,
    },
  });
  console.log(`✓ EmploymentProfile: ${position} (mã ${employeeCode})`);
}

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
  for (const [idx, d] of DIRECTORS.entries()) {
    let user = await prisma.appUser.findUnique({ where: { email: d.email } });
    if (!user) {
      user = await prisma.appUser.create({
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
    } else {
      console.log(`• ${d.role} <${d.email}> already exists — skipped`);
    }
    // Same mandatory-profile backfill as seedFull's STAFF loop, kept minimal (2 rows) so
    // bootstrap stays a lean first-account system, not a demo-data seed.
    await ensureEmploymentProfile(hq.id, user.id, d.role, idx);
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
  // RBAC consolidation (2026-07-01): quan_ly/head_teacher/bgd roles no longer exist. The two
  // director accounts below are the real "3 heads" org structure (IT = super_admin above;
  // Kinh doanh = giam_doc_kinh_doanh; Đào tạo = giam_doc_dao_tao) — exactly one account each,
  // not the 3 legacy-named duplicates this array used to carry.
  const STAFF: Array<{ email: string; name: string; role: Role }> = [
    { email: 'giamdockd@cmc.local', name: 'Giám Đốc Kinh Doanh', role: Role.giam_doc_kinh_doanh },
    { email: 'giamdocdt@cmc.local', name: 'Giám Đốc Đào Tạo', role: Role.giam_doc_dao_tao },
    { email: 'giaovien@cmc.local', name: 'Giáo Viên', role: Role.giao_vien },
    { email: 'ketoan@cmc.local', name: 'Kế Toán', role: Role.ke_toan },
    { email: 'hr@cmc.local', name: 'Nhân Sự (HR)', role: Role.hr },
    { email: 'sale@cmc.local', name: 'Tư Vấn Tuyển Sinh', role: Role.sale },
    { email: 'cskh@cmc.local', name: 'Chăm Sóc Khách Hàng', role: Role.cskh },
    { email: 'mkt@cmc.local', name: 'Cộng Tác Viên MKT', role: Role.ctv_mkt },
  ];
  for (const [idx, s] of STAFF.entries()) {
    let user = await prisma.appUser.findUnique({ where: { email: s.email } });
    if (!user) {
      user = await prisma.appUser.create({
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
    } else {
      console.log(`• ${s.role} <${s.email}> already exists — skipped`);
    }
    await ensureEmploymentProfile(hq.id, user.id, s.role, idx);
  }

  // ── LMS seed: student + parent accounts ─────────────────────────────────────
  const lmsPassword = password; // reuse SEED_SUPERADMIN_PASSWORD for simplicity

  // 1. Student record — code mirrors the real receipt-driven convention (finance.ts:
  //    studentCode = 'HS' + receiptCode.substring(2), receiptCode ~ PT-YYYY-NNNN → HS-YYYY-NNNN).
  const currentYear = new Date().getFullYear();
  const SEED_STUDENT_CODE = `HS-${currentYear}-0001`;
  const seedStudent = await prisma.student.upsert({
    where: { facilityId_studentCode: { facilityId: hq.id, studentCode: SEED_STUDENT_CODE } },
    create: {
      facilityId: hq.id,
      studentCode: SEED_STUDENT_CODE,
      fullName: 'Đặng Gia Bảo',
      dateOfBirth: new Date('2018-01-15'),
      program: 'UCREA',
    },
    update: {},
  });
  console.log(`✓ Seed student: ${seedStudent.fullName} (${seedStudent.studentCode})`);

  // Reserve seq 1 in the REAL receipt-code counter for (HQ, currentYear) so the first genuine
  // receipt.approve this year doesn't re-derive 'PT-<year>-0001' → studentCode 'HS-<year>-0001'
  // and collide with this seed student on the facility-scoped unique constraint (found via full
  // integration-suite run: student-provisioning tests failed with a unique violation on
  // tx.student.create right after a fresh seed, before any real receipt had ever been approved).
  const existingReceiptCounter = await prisma.receiptCodeCounter.findUnique({
    where: { facilityId_year: { facilityId: hq.id, year: currentYear } },
  });
  if (!existingReceiptCounter) {
    await prisma.receiptCodeCounter.create({ data: { facilityId: hq.id, year: currentYear, lastSeq: 1 } });
    console.log(`✓ Reserved receipt-code seq 1 for HQ/${currentYear} (avoids collision with seed student code)`);
  } else if (existingReceiptCounter.lastSeq < 1) {
    await prisma.receiptCodeCounter.update({
      where: { facilityId_year: { facilityId: hq.id, year: currentYear } },
      data: { lastSeq: 1 },
    });
  }

  // 2. StudentAccount for LMS login (loginCode = studentCode, password = lmsPassword)
  const existingStudentAcc = await prisma.studentAccount.findUnique({ where: { studentId: seedStudent.id } });
  if (!existingStudentAcc) {
    await prisma.studentAccount.create({
      data: {
        studentId: seedStudent.id,
        loginCode: SEED_STUDENT_CODE,
        passwordHash: await hashPassword(lmsPassword),
        isActive: true,
      },
    });
    console.log(`✓ Seed studentAccount: loginCode=${SEED_STUDENT_CODE}`);
  } else {
    console.log(`• studentAccount ${SEED_STUDENT_CODE} already exists — skipped`);
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
      displayName: 'Đặng Thị Lan Anh',
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
  console.log(`✓ Seed guardian link: parent@cmc.local ↔ ${SEED_STUDENT_CODE}`);

  // ── Priced course fixture — the CRM receipt-provision, commission-chain, refund-cancel and
  // email-outbox E2E specs (apps/e2e/tests/admin-*.spec.ts) all create a receipt via the admin
  // UI's course Select, which only lists courses with an active CoursePrice. Without this, those
  // specs fail with no priced course to select. Deliberately outside the real curriculum-level
  // family (UCREA-L1/L2/L3 from seed:curriculum) so it can't be mistaken for a real level.
  const SEED_COURSE_CODE = 'UCREA-CB';
  const seedCourse = await prisma.course.upsert({
    where: { code: SEED_COURSE_CODE },
    create: { code: SEED_COURSE_CODE, name: 'UCREA — Khóa cơ bản (giá cố định)', program: 'UCREA' },
    update: {},
  });
  const existingSeedPrice = await prisma.coursePrice.findFirst({
    where: { facilityId: hq.id, courseId: seedCourse.id },
  });
  if (!existingSeedPrice) {
    await prisma.coursePrice.create({
      data: {
        facilityId: hq.id,
        courseId: seedCourse.id,
        amount: 10_000_000,
        effectiveFrom: new Date('2020-01-01'),
      },
    });
    console.log(`✓ Seed coursePrice: ${seedCourse.code} @ HQ`);
  } else {
    console.log(`• coursePrice ${seedCourse.code} @ HQ already exists — skipped`);
  }

  // ── Work shift defaults ──────────────────────────────────────────────
  await seedWorkShift(hq.id, hq.code);
  await seedWorkShift(branch.id, branch.code);

  console.log('');
  console.log('LMS Login credentials:');
  console.log(`  Student  — loginCode: ${SEED_STUDENT_CODE} password: (= SEED_SUPERADMIN_PASSWORD)`);
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
