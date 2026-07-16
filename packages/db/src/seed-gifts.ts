import { PrismaClient } from '@prisma/client';

/** Accepts either a top-level PrismaClient (the production CLI's owner/DIRECT_URL client,
 * which bypasses RLS at the DB role level) or a `$transaction` callback's client (tests use
 * `withRls(SUPER, tx => ...)`, which bypasses RLS via the session GUC instead) — both expose
 * the same `.gift` model delegate shape. */
type GiftUpsertClient = Pick<PrismaClient, 'gift'>;

// 21 gift catalog entries seeded for every facility (Session 2 edge-case decision — sao =
// số-trong-tên-file × 5; see plan 260716-0856-lms-schedule-rewards-exercises, phase-05). Source
// images live in assets/gifts/ (ASCII-slugged filenames — the ingestion CLI, apps/api/scripts/
// seed-gifts.ts, reads them by `assetFile`). Two "Sticker" files share the generic "Sticker N
// sao" naming and are given distinct display names by direct inspection of the artwork
// (user-confirmed): the 10-sao file is a rabbit sticker strip, the 15-sao file is a puffy
// Capybara sticker. All 19 other names are the source filename with the trailing "N sao" suffix
// removed — this is an explicit list, not parsed from filenames, to avoid a parsing mistake
// silently mis-naming a gift.
export interface GiftDef {
  /** Display name — the seed's idempotency key (with facilityId). NFC-normalized at write time. */
  name: string;
  /** stars-in-filename × 5 (Session 2 decision). */
  stars: number;
  /** Filename under assets/gifts/ (ASCII slug) — read only by the ingestion CLI, not the core. */
  assetFile: string;
}

export const GIFT_DEFS: GiftDef[] = [
  { name: 'Áo đồng phục CMC', stars: 1000, assetFile: 'ao-dong-phuc-cmc.jpg' },
  { name: 'Balo CMC', stars: 1000, assetFile: 'balo-cmc.jpg' },
  { name: 'Bộ chun buộc tóc', stars: 450, assetFile: 'bo-chun-buoc-toc.png' },
  { name: 'Bộ đồ dùng học tập', stars: 300, assetFile: 'bo-do-dung-hoc-tap.png' },
  { name: 'Bút chì dễ thương', stars: 100, assetFile: 'but-chi-de-thuong.png' },
  { name: 'Con quay', stars: 150, assetFile: 'con-quay.png' },
  { name: 'Đồ chơi kéo dãn', stars: 125, assetFile: 'do-choi-keo-dan.png' },
  { name: 'Hộp lego', stars: 350, assetFile: 'hop-lego.png' },
  { name: 'Kẹp tóc dễ thương', stars: 150, assetFile: 'kep-toc-de-thuong.png' },
  { name: 'Lắp hình 3D', stars: 75, assetFile: 'lap-hinh-3d.png' },
  { name: 'Mê cung bi tròn', stars: 150, assetFile: 'me-cung-bi-tron.png' },
  { name: 'Móc khoá đáng yêu', stars: 400, assetFile: 'moc-khoa-dang-yeu.png' },
  { name: 'Móc khoá pop it', stars: 200, assetFile: 'moc-khoa-pop-it.png' },
  { name: 'Nhẫn công chúa', stars: 125, assetFile: 'nhan-cong-chua.png' },
  { name: 'Set kẹp tóc dễ thương', stars: 500, assetFile: 'set-kep-toc-de-thuong.png' },
  { name: 'Sổ mini', stars: 100, assetFile: 'so-mini.png' },
  { name: 'Sticker hình thỏ', stars: 50, assetFile: 'sticker-hinh-tho.jpg' },
  { name: 'Sticker phồng Capybara', stars: 75, assetFile: 'sticker-phong-capybara.png' },
  { name: 'Thẻ Pokemon', stars: 75, assetFile: 'the-pokemon.png' },
  { name: 'Tô tượng mini', stars: 175, assetFile: 'to-tuong-mini.png' },
  { name: 'Trò chơi 7 sắc cầu vồng', stars: 125, assetFile: 'tro-choi-7-sac-cau-vong.png' },
];

export interface GiftSeedInput {
  name: string;
  stars: number;
  imageRef: string;
}

/** Owner/DIRECT_URL client — bypasses RLS at the DB role level (matches seed-lms.ts's own
 * pattern). Exported here (not constructed directly in apps/api/scripts/seed-gifts.ts) because
 * `@prisma/client` is only a direct dependency of packages/db, not apps/api — a bare CLI script
 * has no request-scoped RLS context to set, so this is the correct way to get an
 * RLS-bypassing client outside the API request lifecycle. */
export function createGiftSeedOwnerClient(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
  });
}

/** Idempotent core, separated from image ingestion + facility enumeration so it can be
 * integration-tested without real files or a running API. Create-if-absent ONLY — an existing
 * row (including one a director has hand-edited or archived) is never touched. The
 * `@@unique([facilityId, name])` constraint makes concurrent/re-runs safe; `update: {}` is a
 * deliberate no-op so re-seeding can never un-archive a gift or overwrite a director's edits to
 * stars/photo. */
export async function seedGiftsCore(
  prisma: GiftUpsertClient,
  facilityIds: number[],
  gifts: GiftSeedInput[],
): Promise<void> {
  for (const facilityId of facilityIds) {
    for (const g of gifts) {
      const name = g.name.normalize('NFC').trim();
      await prisma.gift.upsert({
        where: { facilityId_name: { facilityId, name } },
        create: {
          facilityId,
          name,
          starsRequired: g.stars,
          imageUrl: g.imageRef,
          stock: -1,
        },
        update: {},
      });
    }
  }
}
