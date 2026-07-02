/**
 * Integration tests for user.listAssignableForAfterSale.
 *
 * Invariants:
 *   - Only users with roles sale, cskh, or giam_doc_kinh_doanh are returned (case-owner eligible roles).
 *   - RLS (app_user_facility_roster) scopes results to the caller's facility.
 *   - sale, cskh, and giam_doc_kinh_doanh callers can call the endpoint; unrelated roles are rejected.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role, hashPassword } from '@cmc/db';
import { withRls, SUPER, staffCaller, uniq, prisma } from './helpers.js';

let facilityId: number;
let saleUserId: string;
let cskhUserId: string;
let bizDirUserId: string;
let giaovienUserId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`; // fail fast if DB unavailable

  const fac = await withRls(SUPER, (tx) =>
    tx.facility.findFirst({ select: { id: true } }),
  );
  if (!fac) throw new Error('Need at least 1 facility — run pnpm db:seed');
  facilityId = fac.id;

  const pw = await hashPassword('TestPass!123');

  const [sale, cskh, bizDir, gv] = await withRls(SUPER, async (tx) => {
    const s = await tx.appUser.create({
      data: {
        email: `${uniq('sale_asgn')}@cmc.test`,
        displayName: 'Sale Assignable Test',
        passwordHash: pw,
        roles: [Role.sale],
        primaryRole: Role.sale,
        facilities: { create: [{ facilityId }] },
      },
      select: { id: true },
    });
    const c = await tx.appUser.create({
      data: {
        email: `${uniq('cskh_asgn')}@cmc.test`,
        displayName: 'CSKH Assignable Test',
        passwordHash: pw,
        roles: [Role.cskh],
        primaryRole: Role.cskh,
        facilities: { create: [{ facilityId }] },
      },
      select: { id: true },
    });
    const q = await tx.appUser.create({
      data: {
        email: `${uniq('bizdir_asgn')}@cmc.test`,
        displayName: 'BizDir Assignable Test',
        passwordHash: pw,
        roles: [Role.giam_doc_kinh_doanh],
        primaryRole: Role.giam_doc_kinh_doanh,
        facilities: { create: [{ facilityId }] },
      },
      select: { id: true },
    });
    const g = await tx.appUser.create({
      data: {
        email: `${uniq('gv_asgn')}@cmc.test`,
        displayName: 'GiaoVien Assignable Test',
        passwordHash: pw,
        roles: [Role.giao_vien],
        primaryRole: Role.giao_vien,
        facilities: { create: [{ facilityId }] },
      },
      select: { id: true },
    });
    return [s, c, q, g];
  });

  saleUserId = sale.id;
  cskhUserId = cskh.id;
  bizDirUserId = bizDir.id;
  giaovienUserId = gv.id;
});

afterAll(async () => {
  const ids = [saleUserId, cskhUserId, bizDirUserId, giaovienUserId].filter(Boolean);
  await withRls(SUPER, async (tx) => {
    await tx.userFacility.deleteMany({ where: { userId: { in: ids } } });
    await tx.appUser.deleteMany({ where: { id: { in: ids } } });
  });
});

describe('user.listAssignableForAfterSale', () => {
  it('cskh caller receives sale, cskh, and giam_doc_kinh_doanh staff — not giao_vien', async () => {
    const caller = await staffCaller({
      userId: cskhUserId,
      roles: [Role.cskh],
      primaryRole: Role.cskh,
      isSuperAdmin: false,
      facilityIds: [facilityId],
    });
    const result = await caller.user.listAssignableForAfterSale();
    const ids = result.map((u) => u.id);
    expect(ids).toContain(saleUserId);
    expect(ids).toContain(cskhUserId);
    expect(ids).toContain(bizDirUserId);
    // giao_vien is not an eligible case-owner role
    expect(ids).not.toContain(giaovienUserId);
    // Shape: only id and displayName
    for (const u of result) {
      expect(u).toHaveProperty('id');
      expect(u).toHaveProperty('displayName');
    }
  });

  it('sale caller can call the endpoint and gets eligible staff', async () => {
    const caller = await staffCaller({
      userId: saleUserId,
      roles: [Role.sale],
      primaryRole: Role.sale,
      isSuperAdmin: false,
      facilityIds: [facilityId],
    });
    const result = await caller.user.listAssignableForAfterSale();
    const ids = result.map((u) => u.id);
    expect(ids).toContain(saleUserId);
    expect(ids).toContain(cskhUserId);
    expect(ids).toContain(bizDirUserId);
    expect(ids).not.toContain(giaovienUserId);
  });

  it('giam_doc_kinh_doanh caller can call the endpoint and gets results', async () => {
    const caller = await staffCaller({
      userId: bizDirUserId,
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [facilityId],
    });
    const result = await caller.user.listAssignableForAfterSale();
    expect(Array.isArray(result)).toBe(true);
    expect(result.map((u) => u.id)).toContain(bizDirUserId);
  });

  it('giao_vien caller is rejected with FORBIDDEN', async () => {
    const caller = await staffCaller({
      userId: giaovienUserId,
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [facilityId],
    });
    await expect(caller.user.listAssignableForAfterSale()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
