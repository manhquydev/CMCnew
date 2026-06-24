import { describe, it, expect, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant (spec Phase 3 §2.2/2.7): CRM pipeline auto-hooks. Scheduling an ENTRANCE test
// advances O1→O3; grading → O4. Hooks are forward-only (never regress) and gated on the
// entrance type. The lead-ingest seam is gated by a per-facility token.
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

  async function newOpp(caller: Awaited<ReturnType<typeof staffCaller>>) {
    const contact = await caller.crm.contactCreate({ facilityId: FACILITY, fullName: 'Lead', phone: uniq('09') });
    made.contactIds.push(contact.id);
    const opp = await caller.crm.opportunityCreate({ contactId: contact.id, studentName: 'Bé' });
    made.oppIds.push(opp.id);
    return opp;
  }
  const stageOf = (id: string) => withRls(SUPER, (tx) => tx.opportunity.findUniqueOrThrow({ where: { id } }).then((o) => o.stage));

  it('entrance test scheduled → O3; graded → O4; and a later entrance test does NOT regress', async () => {
    const caller = await staffCaller();
    const opp = await newOpp(caller);
    expect(opp.stage).toBe('O1_LEAD');

    const a1 = await caller.crm.testCreate({ facilityId: FACILITY, opportunityId: opp.id, type: 'entrance', scheduledAt: '2099-01-15T03:00:00.000Z' });
    made.apptIds.push(a1.id);
    expect(await stageOf(opp.id)).toBe('O3_TEST_SCHEDULED');

    await caller.crm.testGrade({ id: a1.id, score: 8 });
    expect(await stageOf(opp.id)).toBe('O4_TESTED');

    // Forward-only: scheduling another entrance test on an O4 opp must NOT drag it back to O3.
    const a2 = await caller.crm.testCreate({ facilityId: FACILITY, opportunityId: opp.id, type: 'entrance', scheduledAt: '2099-02-15T03:00:00.000Z' });
    made.apptIds.push(a2.id);
    expect(await stageOf(opp.id)).toBe('O4_TESTED');
  });

  it('a non-entrance (periodic) test does NOT auto-advance the opportunity', async () => {
    const caller = await staffCaller();
    const opp = await newOpp(caller);
    const appt = await caller.crm.testCreate({ facilityId: FACILITY, opportunityId: opp.id, type: 'periodic', scheduledAt: '2099-03-15T03:00:00.000Z' });
    made.apptIds.push(appt.id);
    expect(await stageOf(opp.id)).toBe('O1_LEAD'); // unchanged — only entrance triggers O3
  });

  it('lead-ingest rejects a bad token and accepts the configured one (→ O1 opportunity)', async () => {
    const caller = await staffCaller();
    await expect(
      caller.crm.leadIngest({ token: 'wrong-token', facilityId: FACILITY, fullName: 'Web Lead', phone: uniq('08') }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    const token = process.env.CRM_LEAD_TOKEN;
    // Fail loudly rather than silently skipping the positive path (no phantom green).
    expect(token, 'CRM_LEAD_TOKEN must be set for the integration env').toBeTruthy();
    const res = await caller.crm.leadIngest({ token: token!, facilityId: FACILITY, fullName: 'Web Lead', phone: uniq('08') });
    made.oppIds.push(res.opportunityId);
    made.contactIds.push(res.contactId);
    expect(await stageOf(res.opportunityId)).toBe('O1_LEAD');
  });
});
