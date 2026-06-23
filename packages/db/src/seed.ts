import { PrismaClient, Role } from '@prisma/client';
import { hashPassword } from './password.js';

// Seed runs as the owner role (DIRECT_URL) so it bypasses RLS.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

async function main(): Promise<void> {
  const email = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@cmc.local';
  const password = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe!123';

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
