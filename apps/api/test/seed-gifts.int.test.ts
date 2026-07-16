import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GIFT_DEFS, seedGiftsCore, type GiftSeedInput } from '@cmc/db/seed-gifts';
import { withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

// Phase 5 (seed gifts all facilities): the idempotent core must be safe to run twice (no
// duplicate rows via @@unique([facilityId, name])), apply the Session 2 sao=file-number×5
// mapping (baked into GIFT_DEFS), keep the two "Sticker" entries distinct, and NEVER un-archive
// or overwrite a director's prior edits on re-run (create-if-absent only, `update: {}`).
let dbReachable = false;
let facilityId: number;

beforeAll(async () => {
  try {
    await superAdminUserId();
    dbReachable = true;
    const facility = await withRls(SUPER, (tx) => tx.facility.findFirst({ select: { id: true } }));
    if (!facility) throw new Error('no seeded facility to test against');
    facilityId = facility.id;
  } catch {
    console.warn('DB not reachable - seed-gifts tests skipped');
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  await withRls(SUPER, (tx) =>
    tx.gift.deleteMany({ where: { facilityId, name: { in: GIFT_DEFS.map((g) => g.name) } } }),
  );
});

function fakeRefFor(name: string): string {
  // A fake but ref-shaped (64-hex) value — the core function only stores this string, it never
  // validates or reads the blob, so a real image/upload is unnecessary for these tests.
  return uniq(name).padEnd(64, '0').slice(0, 64).replace(/[^a-f0-9]/g, '0');
}

function testInputs(): GiftSeedInput[] {
  return GIFT_DEFS.map((g) => ({ name: g.name, stars: g.stars, imageRef: fakeRefFor(g.name) }));
}

describe('seedGiftsCore', () => {
  it('is idempotent: running twice yields exactly GIFT_DEFS.length gifts per facility, not double', async () => {
    if (!dbReachable) return;
    const inputs = testInputs();
    await withRls(SUPER, (tx) => seedGiftsCore(tx, [facilityId], inputs));
    await withRls(SUPER, (tx) => seedGiftsCore(tx, [facilityId], inputs));

    const rows = await withRls(SUPER, (tx) =>
      tx.gift.findMany({ where: { facilityId, name: { in: GIFT_DEFS.map((g) => g.name) } } }),
    );
    expect(rows).toHaveLength(GIFT_DEFS.length);
  });

  it('applies starsRequired = file-number × 5 and keeps the two Sticker entries distinct', async () => {
    if (!dbReachable) return;
    await withRls(SUPER, (tx) => seedGiftsCore(tx, [facilityId], testInputs()));

    const rabbit = await withRls(SUPER, (tx) =>
      tx.gift.findUnique({ where: { facilityId_name: { facilityId, name: 'Sticker hình thỏ' } } }),
    );
    const capybara = await withRls(SUPER, (tx) =>
      tx.gift.findUnique({ where: { facilityId_name: { facilityId, name: 'Sticker phồng Capybara' } } }),
    );
    expect(rabbit?.starsRequired).toBe(50);
    expect(capybara?.starsRequired).toBe(75);
    expect(rabbit?.id).not.toBe(capybara?.id);

    const boChun = await withRls(SUPER, (tx) =>
      tx.gift.findUnique({ where: { facilityId_name: { facilityId, name: 'Bộ chun buộc tóc' } } }),
    );
    expect(boChun?.starsRequired).toBe(450); // 90 sao in filename × 5
  });

  it('does NOT un-archive a gift that was archived before re-seeding', async () => {
    if (!dbReachable) return;
    await withRls(SUPER, (tx) => seedGiftsCore(tx, [facilityId], testInputs()));
    await withRls(SUPER, (tx) =>
      tx.gift.update({
        where: { facilityId_name: { facilityId, name: 'Con quay' } },
        data: { archivedAt: new Date(), isActive: false },
      }),
    );

    await withRls(SUPER, (tx) => seedGiftsCore(tx, [facilityId], testInputs()));

    const gift = await withRls(SUPER, (tx) =>
      tx.gift.findUnique({ where: { facilityId_name: { facilityId, name: 'Con quay' } } }),
    );
    expect(gift?.archivedAt).not.toBeNull();
    expect(gift?.isActive).toBe(false);
  });

  it('does NOT overwrite a director-edited starsRequired or imageUrl on re-seed', async () => {
    if (!dbReachable) return;
    await withRls(SUPER, (tx) => seedGiftsCore(tx, [facilityId], testInputs()));
    await withRls(SUPER, (tx) =>
      tx.gift.update({
        where: { facilityId_name: { facilityId, name: 'Hộp lego' } },
        data: { starsRequired: 999, imageUrl: 'https://example.com/custom.png' },
      }),
    );

    await withRls(SUPER, (tx) => seedGiftsCore(tx, [facilityId], testInputs()));

    const gift = await withRls(SUPER, (tx) =>
      tx.gift.findUnique({ where: { facilityId_name: { facilityId, name: 'Hộp lego' } } }),
    );
    expect(gift?.starsRequired).toBe(999);
    expect(gift?.imageUrl).toBe('https://example.com/custom.png');
  });
});
