import { describe, expect, it } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

const FACILITY = 1;
const PASSWORD = 'TeacherBridge!123';

describe('teacher bridge staff setup', () => {
  it('education director creates a teacher staff account that can use staff APIs', async () => {
    const director = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: `${uniq('tb-dir')}@cmc.test`,
          displayName: 'Teacher Bridge Education Director',
          passwordHash: 'test',
          primaryRole: Role.giam_doc_dao_tao,
          roles: [Role.giam_doc_dao_tao],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
        select: { id: true },
      }),
    );

    const caller = await staffCaller({
      userId: director.id,
      roles: [Role.giam_doc_dao_tao],
      primaryRole: Role.giam_doc_dao_tao,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

    const email = `${uniq('tb-gv')}@cmc.test`;
    const teacher = await caller.user.create({
      email,
      displayName: 'Teacher Bridge Teacher',
      password: PASSWORD,
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      facilityIds: [FACILITY],
      nationalId: uniq('001'),
      startedAt: '2026-07-06',
      position: 'Giáo viên',
      phone: `09${uniq('tbp').replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`,
      personalEmail: `${uniq('tb-personal')}@cmc.test`,
    });
    expect(teacher.roles).toContain(Role.giao_vien);

    const stored = await withRls(SUPER, (tx) =>
      tx.appUser.findUniqueOrThrow({
        where: { id: teacher.id },
        include: { facilities: true },
      }),
    );
    expect(stored.primaryRole).toBe(Role.giao_vien);
    expect(stored.facilities.map((f) => f.facilityId)).toContain(FACILITY);

    const teacherCaller = await staffCaller({
      userId: teacher.id,
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });
    await expect(
      teacherCaller.schedule.mySessions({ facilityId: FACILITY, from: '2026-07-01', to: '2026-07-31' }),
    ).resolves.toEqual(expect.any(Array));
  });

  it('business director cannot create a teacher role', async () => {
    const director = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: `${uniq('tb-kd')}@cmc.test`,
          displayName: 'Teacher Bridge Business Director',
          passwordHash: 'test',
          primaryRole: Role.giam_doc_kinh_doanh,
          roles: [Role.giam_doc_kinh_doanh],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
        select: { id: true },
      }),
    );

    const caller = await staffCaller({
      userId: director.id,
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

    await expect(
      caller.user.create({
        email: `${uniq('tb-forbidden-gv')}@cmc.test`,
        displayName: 'Forbidden Teacher',
        password: PASSWORD,
        roles: [Role.giao_vien],
        primaryRole: Role.giao_vien,
        facilityIds: [FACILITY],
        nationalId: uniq('002'),
        startedAt: '2026-07-06',
        position: 'Giáo viên',
        phone: `09${uniq('tbf').replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`,
        personalEmail: `${uniq('tb-forbidden-personal')}@cmc.test`,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
