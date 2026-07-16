// Seed 21 gift-catalog entries (with real uploaded photos) into every facility — Phase 5,
// plan 260716-0856-lms-schedule-rewards-exercises. Idempotent (safe to re-run): create-if-absent
// only, never un-archives or overwrites a director's edits (see seedGiftsCore in @cmc/db).
//
// Lives in apps/api (not packages/db) because it needs BOTH direct DB access (facility
// enumeration + Gift upserts, via @cmc/db) AND the gift-photo blob store (putGiftPhoto) — and
// packages/db cannot import apps/api's services (wrong dependency direction). This mirrors the
// existing apps/api/scripts/migrate-pdf-blobs-to-s3.ts precedent for the same reason.
//
// Run from apps/api:
//   pnpm --filter @cmc/api exec tsx scripts/seed-gifts.ts
//
// PROD: requires explicit user confirmation before running against the production database —
// see phase-05-seed-gifts-all-facilities.md. Run the pre-migration duplicate check
// (GROUP BY facility_id, name HAVING count(*) > 1) against the target DB before ever applying
// the @@unique([facilityId, name]) migration there.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '../../.env') });

import { GIFT_DEFS, seedGiftsCore, createGiftSeedOwnerClient, type GiftSeedInput } from '@cmc/db/seed-gifts';
import { putGiftPhoto } from '../src/services/gift-photo-store.js';

const prisma = createGiftSeedOwnerClient();

const ASSETS_DIR = path.resolve(process.cwd(), '../../assets/gifts');

async function ingestPhotos(): Promise<Map<string, string>> {
  const refByName = new Map<string, string>();
  for (const def of GIFT_DEFS) {
    const buf = await readFile(path.join(ASSETS_DIR, def.assetFile));
    const { ref } = await putGiftPhoto(buf);
    refByName.set(def.name, ref);
  }
  return refByName;
}

async function main() {
  const facilities = await prisma.facility.findMany({ select: { id: true, code: true } });
  if (facilities.length === 0) {
    throw new Error(
      'facility.findMany() returned 0 rows — refusing to no-op silently. If this is intentional ' +
        '(fresh DB with no facilities yet), seed facilities first.',
    );
  }
  console.log(`Ingesting ${GIFT_DEFS.length} gift photo(s)...`);
  const refByName = await ingestPhotos();

  const inputs: GiftSeedInput[] = GIFT_DEFS.map((def) => {
    const ref = refByName.get(def.name);
    if (!ref) throw new Error(`missing ingested ref for gift "${def.name}"`);
    return { name: def.name, stars: def.stars, imageRef: ref };
  });

  console.log(`Seeding ${inputs.length} gift(s) × ${facilities.length} facility(ies)...`);
  await seedGiftsCore(
    prisma,
    facilities.map((f) => f.id),
    inputs,
  );

  for (const f of facilities) {
    const count = await prisma.gift.count({
      where: { facilityId: f.id, name: { in: GIFT_DEFS.map((g) => g.name) } },
    });
    console.log(`facility ${f.code} (id=${f.id}): ${count}/${GIFT_DEFS.length} gifts present`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
