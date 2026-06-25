import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, superAdminUserId } from './helpers.js';

// Invariant (decision 0011): changing an employment grade is a sensitive, audited action.
// A grade change MUST carry a reason and MUST leave a record_event with old→new + reason, so
// payroll changes are transparent. Creating a salary rate also leaves an audit event.
describe('salary grade change audit (decision 0011)', () => {
  const FACILITY = 1;
  let employeeId: string;

  beforeAll(async () => {
    employeeId = await superAdminUserId();
    // Start from a clean slate: other suites reuse this shared user's profile, so drop it first.
    // A fresh create (no prior profile) treats grade as initial — no reason required.
    await withRls(SUPER, async (tx) => {
      await tx.recordEvent.deleteMany({ where: { entityType: 'employment_profile' } });
      await tx.employmentProfile.deleteMany({ where: { userId: employeeId } });
    });
    const caller = await staffCaller();
    await caller.payroll.profileUpsert({ userId: employeeId, facilityId: FACILITY, position: 'teacher', grade: 'B1', dependents: 0 });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.recordEvent.deleteMany({ where: { entityType: 'employment_profile' } });
      await tx.employmentProfile.deleteMany({ where: { userId: employeeId } });
    });
  });

  const events = () =>
    withRls(SUPER, (tx) =>
      tx.recordEvent.findMany({
        where: { entityType: 'employment_profile' },
        orderBy: { createdAt: 'desc' },
      }),
    );

  it('rejects a grade change with no reason', async () => {
    const caller = await staffCaller();
    await expect(
      caller.payroll.profileUpsert({ userId: employeeId, facilityId: FACILITY, position: 'teacher', grade: 'B2', dependents: 0 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('records old→new + reason when grade changes with a reason', async () => {
    const caller = await staffCaller();
    await caller.payroll.profileUpsert({
      userId: employeeId, facilityId: FACILITY, position: 'teacher', grade: 'B2', dependents: 0,
      reason: 'Đạt chuẩn lên bậc sau đánh giá quý',
    });
    const log = (await events())[0];
    expect(log?.body).toContain('B1→B2');
    expect(log?.body).toContain('Đạt chuẩn lên bậc');
    expect(log?.actorId).toBeTruthy();
  });

  it('does not require a reason when grade is unchanged', async () => {
    const caller = await staffCaller();
    // Same grade B2, only dependents change → allowed without reason, logs a normal profile update.
    await caller.payroll.profileUpsert({ userId: employeeId, facilityId: FACILITY, position: 'teacher', grade: 'B2', dependents: 1 });
    const log = (await events())[0];
    expect(log?.body).not.toContain('Đổi bậc');
  });
});
