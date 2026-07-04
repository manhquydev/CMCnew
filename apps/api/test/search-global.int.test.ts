import { describe, it, expect, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { appRouter } from '../src/routers/index.js';
import type { ApiContext } from '../src/context.js';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

/** A fully unauthenticated caller (no staff session, no LMS principal). */
function anonCaller() {
  const ctx: ApiContext = { c: {} as never, session: null, lms: null, ip: 'test' };
  return appRouter.createCaller(ctx);
}

/**
 * search.global invariants:
 * 1. Queries under 2 chars return empty groups instead of throwing (autosuggest UX).
 * 2. Students match on name, studentCode, and the linked guardian's phone.
 * 3. CRM opportunities match on the linked contact's name/phone.
 * 4. Staff match on name/email; class batches match on code/name.
 * 5. Facility isolation is enforced by RLS — a facility-scoped caller never sees another
 *    facility's student/opportunity/class batch in the results.
 * 6. Unauthenticated callers are rejected (protectedProcedure).
 */
describe('search.global — cross-entity lookup with RLS scoping', () => {
  const FACILITY = 1;
  const OTHER_FACILITY = 2;
  const tag = uniq('gsearch');

  const made = {
    students: [] as string[],
    parents: [] as string[],
    courses: [] as string[],
    batches: [] as string[],
    contacts: [] as string[],
    opps: [] as string[],
    users: [] as string[],
  };

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.guardian.deleteMany({ where: { parentAccountId: { in: made.parents } } });
      await tx.parentAccount.deleteMany({ where: { id: { in: made.parents } } });
      await tx.opportunity.deleteMany({ where: { id: { in: made.opps } } });
      await tx.contact.deleteMany({ where: { id: { in: made.contacts } } });
      await tx.student.deleteMany({ where: { id: { in: made.students } } });
      await tx.classBatch.deleteMany({ where: { id: { in: made.batches } } });
      await tx.course.deleteMany({ where: { id: { in: made.courses } } });
      await tx.appUser.deleteMany({ where: { id: { in: made.users } } });
    });
  });

  it('returns empty groups (not an error) for a sub-2-char query', async () => {
    const caller = await staffCaller({ facilityIds: [FACILITY] });
    const res = await caller.search.global({ q: 'a' });
    expect(res).toEqual({ students: [], opportunities: [], staff: [], classBatches: [] });
  });

  it('finds a student by full name, studentCode, and the guardian phone', async () => {
    const phone = uniq('09');
    const parent = await withRls(SUPER, (tx) =>
      tx.parentAccount.create({ data: { displayName: 'GS Parent', phone } }),
    );
    made.parents.push(parent.id);

    const student = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode: uniq(`${tag}-code`),
          fullName: `${tag} Nguyen Van A`,
          program: 'UCREA',
          guardians: { create: [{ facilityId: FACILITY, parentAccountId: parent.id }] },
        },
      }),
    );
    made.students.push(student.id);

    const caller = await staffCaller({ facilityIds: [FACILITY] });

    const byName = await caller.search.global({ q: `${tag} nguyen` }); // case-insensitive
    expect(byName.students.map((s) => s.id)).toContain(student.id);

    const byCode = await caller.search.global({ q: student.studentCode });
    expect(byCode.students.map((s) => s.id)).toContain(student.id);

    const byPhone = await caller.search.global({ q: phone });
    expect(byPhone.students.map((s) => s.id)).toContain(student.id);
  });

  it('does not leak a cross-facility student to a facility-scoped caller (RLS)', async () => {
    const student = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: {
          facilityId: OTHER_FACILITY,
          studentCode: uniq(`${tag}-other`),
          fullName: `${tag} CrossFacility Student`,
          program: 'UCREA',
        },
      }),
    );
    made.students.push(student.id);

    const scoped = await staffCaller({
      roles: [Role.ke_toan],
      primaryRole: Role.ke_toan,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });
    const res = await scoped.search.global({ q: `${tag} CrossFacility` });
    expect(res.students.map((s) => s.id)).not.toContain(student.id);
  });

  it('finds a CRM opportunity by contact name and phone', async () => {
    const phone = uniq('09');
    const contact = await withRls(SUPER, (tx) =>
      tx.contact.create({
        data: { facilityId: FACILITY, fullName: `${tag} Le Thi B`, phone, source: 'web' },
      }),
    );
    made.contacts.push(contact.id);
    const opp = await withRls(SUPER, (tx) =>
      tx.opportunity.create({
        data: { facilityId: FACILITY, contactId: contact.id, studentName: 'B' },
      }),
    );
    made.opps.push(opp.id);

    const caller = await staffCaller({ facilityIds: [FACILITY] });
    const byName = await caller.search.global({ q: `${tag} Le` });
    expect(byName.opportunities.map((o) => o.id)).toContain(opp.id);

    const byPhone = await caller.search.global({ q: phone });
    expect(byPhone.opportunities.map((o) => o.id)).toContain(opp.id);
  });

  it('finds staff by display name and email', async () => {
    const email = `${uniq(tag)}@cmc.local`;
    const staffUser = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email,
          displayName: `${tag} Staff Member`,
          passwordHash: 'x',
          roles: [Role.sale],
          primaryRole: Role.sale,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      }),
    );
    made.users.push(staffUser.id);

    const caller = await staffCaller({ facilityIds: [FACILITY] });
    const byName = await caller.search.global({ q: `${tag} Staff` });
    expect(byName.staff.map((u) => u.id)).toContain(staffUser.id);

    const byEmail = await caller.search.global({ q: email });
    expect(byEmail.staff.map((u) => u.id)).toContain(staffUser.id);
  });

  it('does not expose staff results to a role without user:list permission (e.g. giao_vien)', async () => {
    const email = `${uniq(tag)}@cmc.local`;
    const staffUser = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email,
          displayName: `${tag} Hidden Staff`,
          passwordHash: 'x',
          roles: [Role.sale],
          primaryRole: Role.sale,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      }),
    );
    made.users.push(staffUser.id);

    const unprivileged = await staffCaller({
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });
    const res = await unprivileged.search.global({ q: `${tag} Hidden` });
    expect(res.staff).toEqual([]);
  });

  it('finds a class batch by code and name', async () => {
    const course = await withRls(SUPER, (tx) =>
      tx.course.create({ data: { code: uniq(`${tag}-course`), name: 'Search Course', program: 'UCREA' } }),
    );
    made.courses.push(course.id);
    const batch = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: {
          facilityId: FACILITY,
          courseId: course.id,
          code: uniq(`${tag}-batch`),
          name: `${tag} Lop Sang`,
        },
      }),
    );
    made.batches.push(batch.id);

    const caller = await staffCaller({ facilityIds: [FACILITY] });
    const byCode = await caller.search.global({ q: batch.code });
    expect(byCode.classBatches.map((b) => b.id)).toContain(batch.id);

    const byName = await caller.search.global({ q: `${tag} Lop` });
    expect(byName.classBatches.map((b) => b.id)).toContain(batch.id);
  });

  it('rejects unauthenticated callers', async () => {
    await expect(anonCaller().search.global({ q: 'anything' })).rejects.toThrow();
  });
});
