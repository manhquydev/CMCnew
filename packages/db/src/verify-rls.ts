/**
 * Phase 0 done-evidence: prove RLS isolates facilities for the runtime role (cmc_app).
 * Run: pnpm --filter @cmc/db exec tsx src/verify-rls.ts
 */
import { prisma, withRls } from './index.js';

async function main(): Promise<void> {
  const scopedTo1 = await withRls({ facilityIds: [1], isSuperAdmin: false }, (tx) =>
    tx.facility.findMany({ select: { code: true } }),
  );
  const scopedTo2 = await withRls({ facilityIds: [2], isSuperAdmin: false }, (tx) =>
    tx.facility.findMany({ select: { code: true } }),
  );
  const asSuperAdmin = await withRls({ facilityIds: [], isSuperAdmin: true }, (tx) =>
    tx.facility.findMany({ select: { code: true } }),
  );

  const codes = (rows: { code: string }[]) => rows.map((r) => r.code).sort();
  const r1 = codes(scopedTo1);
  const r2 = codes(scopedTo2);
  const rAll = codes(asSuperAdmin);

  console.log('facility_ids=[1]      →', r1);
  console.log('facility_ids=[2]      →', r2);
  console.log('super_admin           →', rAll);

  const ok =
    JSON.stringify(r1) === JSON.stringify(['HQ']) &&
    JSON.stringify(r2) === JSON.stringify(['CS2']) &&
    JSON.stringify(rAll) === JSON.stringify(['CS2', 'HQ']);

  if (!ok) {
    console.error('✗ RLS isolation FAILED');
    process.exitCode = 1;
  } else {
    console.log('✓ RLS isolation verified: each scope sees only its facility; super_admin sees all');
  }
}

main().finally(() => prisma.$disconnect());
