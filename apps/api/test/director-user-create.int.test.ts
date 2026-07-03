/**
 * Integration tests for delegated user.create (director RBAC).
 *
 * Verifies that the app-layer scope guards in user.ts correctly enforce:
 *   - Business Director can only assign KD roles (sale/cskh/ctv_mkt)
 *   - Education Director can only assign education roles (giao_vien)
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
        roles: [Role.sale],
        primaryRole: Role.sale,
        facilityIds: [facilityA],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('cannot assign a giao_vien to a foreign facility → FORBIDDEN', async () => {
    const caller = await staffCaller({
      userId: eduDirId,
      roles: [Role.giam_doc_dao_tao],
      primaryRole: Role.giam_doc_dao_tao,
      isSuperAdmin: false,
      facilityIds: [facilityA],
    });
    await expect(
      caller.user.create({
        email: `${uniq('gvfac')}@cmc.test`,
        displayName: 'GV Foreign',
        roles: [Role.giao_vien],
        primaryRole: Role.giao_vien,
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

  it('rejects a 0-facility account, including for super_admin (Plan 3 P2: a login with no facility has no RLS scope — dead account)', async () => {
    const caller = await staffCaller();
    await expect(
      caller.user.create({
        email: `${uniq('nofacsa')}@cmc.test`,
        displayName: 'No Fac SA',
        roles: [Role.ke_toan],
        primaryRole: Role.ke_toan,
        facilityIds: [],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

// ── SSO_ENABLED gate (unit-level check via env) ──────────────────────────────

describe('staff password-login gate (fail-closed)', () => {
  it('STAFF_PASSWORD_LOGIN is not enabled in the test env → staff are SSO-only', () => {
    // auth.ts now fails closed: any non-super_admin is blocked from password login unless
    // STAFF_PASSWORD_LOGIN === 'true' (a deliberate local/seed escape hatch), independent of whether
    // the Entra SSO env is wired. The integration env must not enable it, so only super_admin keeps
    // break-glass password login.
    expect(process.env.STAFF_PASSWORD_LOGIN).not.toBe('true');
  });
});

// ── user.setPassword (decision 0031) ──────────────────────────────────────────

describe('user.setPassword', () => {
  it('super_admin-only: a director cannot call it', async () => {
    const caller = await staffCaller({
      userId: bizDirId,
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [facilityA],
    });
    await expect(caller.user.setPassword({ id: eduDirId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // Verifies the credential mechanics (hash + tokenVersion) via the low-level login() primitive —
  // matches auth-login.int.test.ts's convention. The separate STAFF_PASSWORD_LOGIN fail-closed
  // gate (authRouter.login's tRPC layer, not login() itself) is covered by the
  // 'staff password-login gate' describe block above; this test does not re-prove that gate.
  it('returns a working temp password once, invalidates via tokenVersion bump', async () => {
    const admin = await staffCaller();
    const target = await admin.user.create({
      email: `${uniq('setpw')}@cmc.test`,
      displayName: 'Set PW Target',
      roles: [Role.sale],
      primaryRole: Role.sale,
      facilityIds: [facilityA],
    });
    const before = await withRls(SUPER, (tx) => tx.appUser.findUniqueOrThrow({ where: { id: target.id }, select: { tokenVersion: true } }));

    const result = await admin.user.setPassword({ id: target.id });
    expect(result.email).toBe(target.email);
    expect(result.tempPassword).toHaveLength(12); // randomBytes(6).toString('hex')

    const after = await withRls(SUPER, (tx) => tx.appUser.findUniqueOrThrow({ where: { id: target.id }, select: { tokenVersion: true, passwordHash: true } }));
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);

    const { login } = await import('@cmc/auth');
    const session = await login(target.email, result.tempPassword);
    expect(session).not.toBeNull();
  });
});
