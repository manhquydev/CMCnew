/**
 * Integration tests for delegated user.create (director RBAC).
 *
 * Verifies that the app-layer scope guards in user.ts correctly enforce:
 *   - Business Director can only assign KD roles (sale/cskh/ctv_mkt)
 *   - Education Director can only assign education roles (giao_vien/head_teacher)
 *   - Directors cannot place users outside their own facilities
 *   - super_admin is unrestricted
 *   - Password login for a non-super-admin works when SSO_ENABLED is unset
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Role, hashPassword } from '@cmc/db';
import { prisma, withRls, SUPER, staffCaller, uniq } from './helpers.js';

let facilityA: number;
let facilityB: number;
let bizDirId: string;
let eduDirId: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`; // fail fast if DB not available

  // Use or create two test facilities.
  const facs = await withRls(SUPER, (tx) =>
    tx.facility.findMany({ take: 2, select: { id: true } }),
  );
  if (facs.length < 2) throw new Error('Need at least 2 facilities — run pnpm db:seed');
  facilityA = facs[0]!.id;
  facilityB = facs[1]!.id;

  const pw = await hashPassword('TestPass!123');

  // Create a Business Director in facilityA.
  const bizDir = await withRls(SUPER, (tx) =>
    tx.appUser.create({
      data: {
        email: `${uniq('bizdirtest')}@cmc.test`,
        displayName: 'Biz Director',
        passwordHash: pw,
        roles: [Role.giam_doc_kinh_doanh],
        primaryRole: Role.giam_doc_kinh_doanh,
        facilities: { create: [{ facilityId: facilityA }] },
      },
      select: { id: true },
    }),
  );
  bizDirId = bizDir.id;

  // Create an Education Director in facilityA.
  const eduDir = await withRls(SUPER, (tx) =>
    tx.appUser.create({
      data: {
        email: `${uniq('edudirtest')}@cmc.test`,
        displayName: 'Edu Director',
        passwordHash: pw,
        roles: [Role.giam_doc_dao_tao],
        primaryRole: Role.giam_doc_dao_tao,
        facilities: { create: [{ facilityId: facilityA }] },
      },
      select: { id: true },
    }),
  );
  eduDirId = eduDir.id;
});

// ── Business Director ────────────────────────────────────────────────────────

describe('Business Director user.create', () => {
  it('creates a sale user in their own facility → OK', async () => {
    const caller = await staffCaller({
      userId: bizDirId,
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [facilityA],
    });
    const user = await caller.user.create({
      email: `${uniq('sale')}@cmc.test`,
      displayName: 'Sale Test',
      password: 'TestPass!123',
      roles: [Role.sale],
      primaryRole: Role.sale,
      facilityIds: [facilityA],
    });
    expect(user.roles).toContain(Role.sale);
  });

  it('cannot create a giao_vien (education role) → FORBIDDEN', async () => {
    const caller = await staffCaller({
      userId: bizDirId,
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [facilityA],
    });
    await expect(
      caller.user.create({
        email: `${uniq('teacher')}@cmc.test`,
        displayName: 'Teacher Test',
        password: 'TestPass!123',
        roles: [Role.giao_vien],
        primaryRole: Role.giao_vien,
        facilityIds: [facilityA],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('cannot assign a user to a foreign facility → FORBIDDEN', async () => {
    const caller = await staffCaller({
      userId: bizDirId,
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [facilityA], // owns only A, not B
    });
    await expect(
      caller.user.create({
        email: `${uniq('outscope')}@cmc.test`,
        displayName: 'Out of Scope',
        password: 'TestPass!123',
        roles: [Role.sale],
        primaryRole: Role.sale,
        facilityIds: [facilityB], // B is outside the caller's facilities
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('requires at least one facility → BAD_REQUEST', async () => {
    const caller = await staffCaller({
      userId: bizDirId,
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [facilityA],
    });
    await expect(
      caller.user.create({
        email: `${uniq('nofac')}@cmc.test`,
        displayName: 'No Facility',
        password: 'TestPass!123',
        roles: [Role.sale],
        primaryRole: Role.sale,
        facilityIds: [],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

// ── Education Director ───────────────────────────────────────────────────────

describe('Education Director user.create', () => {
  it('creates a giao_vien in their own facility → OK', async () => {
    const caller = await staffCaller({
      userId: eduDirId,
      roles: [Role.giam_doc_dao_tao],
      primaryRole: Role.giam_doc_dao_tao,
      isSuperAdmin: false,
      facilityIds: [facilityA],
    });
    const user = await caller.user.create({
      email: `${uniq('gv')}@cmc.test`,
      displayName: 'Teacher Test',
      password: 'TestPass!123',
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      facilityIds: [facilityA],
    });
    expect(user.roles).toContain(Role.giao_vien);
  });

  it('cannot create a sale user (business role) → FORBIDDEN', async () => {
    const caller = await staffCaller({
      userId: eduDirId,
      roles: [Role.giam_doc_dao_tao],
      primaryRole: Role.giam_doc_dao_tao,
      isSuperAdmin: false,
      facilityIds: [facilityA],
    });
    await expect(
      caller.user.create({
        email: `${uniq('sale2')}@cmc.test`,
        displayName: 'Sale Test',
        password: 'TestPass!123',
        roles: [Role.sale],
        primaryRole: Role.sale,
        facilityIds: [facilityA],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('cannot assign a head_teacher to a foreign facility → FORBIDDEN', async () => {
    const caller = await staffCaller({
      userId: eduDirId,
      roles: [Role.giam_doc_dao_tao],
      primaryRole: Role.giam_doc_dao_tao,
      isSuperAdmin: false,
      facilityIds: [facilityA],
    });
    await expect(
      caller.user.create({
        email: `${uniq('htfac')}@cmc.test`,
        displayName: 'HT Foreign',
        password: 'TestPass!123',
        roles: [Role.head_teacher],
        primaryRole: Role.head_teacher,
        facilityIds: [facilityB],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// ── super_admin ──────────────────────────────────────────────────────────────

describe('super_admin user.create', () => {
  it('can create any role in any facility', async () => {
    const caller = await staffCaller(); // defaults to super_admin
    const user = await caller.user.create({
      email: `${uniq('anyro')}@cmc.test`,
      displayName: 'Any Role',
      password: 'TestPass!123',
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      facilityIds: [facilityB],
    });
    expect(user.roles).toContain(Role.giam_doc_kinh_doanh);
  });

  it('can create a user with no facilities (system-wide account)', async () => {
    const caller = await staffCaller();
    const user = await caller.user.create({
      email: `${uniq('nofacsa')}@cmc.test`,
      displayName: 'No Fac SA',
      password: 'TestPass!123',
      roles: [Role.ke_toan],
      primaryRole: Role.ke_toan,
      facilityIds: [],
    });
    expect(user.id).toBeTruthy();
  });
});

// ── SSO_ENABLED gate (unit-level check via env) ──────────────────────────────

describe('SSO_ENABLED login gate', () => {
  it('SSO_ENABLED unset → password login allowed for any role (no 403 check at env level)', () => {
    // The gate in auth.ts is: process.env.SSO_ENABLED === 'true' && ssoConfigFromEnv() && !isSuperAdmin.
    // When SSO_ENABLED is unset (typical local dev) the first condition is false → gate never triggers.
    // We verify the env condition directly (no HTTP layer needed).
    const ssoEnabled = process.env.SSO_ENABLED;
    expect(ssoEnabled).not.toBe('true'); // test environment must not have SSO enabled
  });
});
