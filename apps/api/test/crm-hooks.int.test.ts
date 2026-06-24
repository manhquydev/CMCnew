import { describe, it, expect, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant (spec Phase 3 §2.2/2.7): CRM pipeline auto-hooks. Scheduling an ENTRANCE test
// advances the opportunity to O3; grading it advances to O4 (forward-only). The lead-ingest
// seam is gated by a per-facility token.
describe('CRM auto-hooks + lead-ingest token', () => {
  const FACILITY = 1;
  const made = { contactIds: [] as string[], oppIds: [] as string[], apptIds: [] as string[] };

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.testAppointment.deleteMany({ where: { id: { in: made.apptIds } } });
      await tx.opportunity.deleteMany({ where: { id: { in: made.oppIds } } });
      await tx.contact.deleteMany({ where: { id: { in: made.contactIds } } });
    });
  });

  it('entrance test scheduled → O3; graded → O4 (forward only)', async () => {
    const caller = await staffCaller();
    const contact = await caller.crm.contactCreate({ facilityId: FACILITY, fullName: 'Lead A', phone: uniq('09') });
    made.contactIds.push(contact.id);
    const opp = await caller.crm.opportunityCreate({ contactId: contact.id, studentName: 'Bé A' });
    made.oppIds.push(opp.id);
    expect(opp.stage).toBe('O1_LEAD');

    const appt = await caller.crm.testCreate({
      facilityId: FACILITY, opportunityId: opp.id, type: 'entrance', scheduledAt: '2099-01-15T03:00:00.000Z',
    });
    made.apptIds.push(appt.id);

    let cur = await withRls(SUPER, (tx) => tx.opportunity.findUniqueOrThrow({ where: { id: opp.id } }));
    expect(cur.stage).toBe('O3_TEST_SCHEDULED');

    await caller.crm.testGrade({ id: appt.id, score: 8 });
    cur = await withRls(SUPER, (tx) => tx.opportunity.findUniqueOrThrow({ where: { id: opp.id } }));
    expect(cur.stage).toBe('O4_TESTED');
  });

  it('lead-ingest rejects a bad token and accepts the configured one', async () => {
    const caller = await staffCaller();
    await expect(
      caller.crm.leadIngest({ token: 'wrong-token', facilityId: FACILITY, fullName: 'Web Lead', phone: uniq('08') }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    const token = process.env.CRM_LEAD_TOKEN;
    if (token) {
      const phone = uniq('08');
      const res = await caller.crm.leadIngest({ token, facilityId: FACILITY, fullName: 'Web Lead', phone });
      // Track for cleanup whatever ids the seam returns (contact + opportunity).
      const opp = await withRls(SUPER, (tx) => tx.opportunity.findFirst({ where: { facilityId: FACILITY, stage: 'O1_LEAD' }, orderBy: { createdAt: 'desc' } }));
      if (opp) { made.oppIds.push(opp.id); made.contactIds.push(opp.contactId); }
      expect(res).toBeDefined();
    }
  });
});
