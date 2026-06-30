import { describe, it, expect, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

/**
 * Integration tests for untested CRM opportunity lifecycle functions:
 * - opportunityMarkLost: closes an open opportunity + sets lostReason
 * - opportunityReopen: re-opens a closed (lost) opportunity
 *
 * Validates guards, state transitions, audit logs, and edge cases.
 */
describe('CRM opportunity lifecycle — markLost / reopen', () => {
  const FACILITY = 1;
  const made = { contactIds: [] as string[], oppIds: [] as string[] };

  // No beforeAll needed — tests create their own data

  afterAll(async () => {
    // Cleanup test fixtures
    await withRls(SUPER, async (tx) => {
      await tx.opportunity.deleteMany({ where: { id: { in: made.oppIds } } });
      await tx.contact.deleteMany({ where: { id: { in: made.contactIds } } });
    });
  });

  /**
   * Helper: create a new opportunity in O1_LEAD stage
   */
  async function newOpp(caller: Awaited<ReturnType<typeof staffCaller>>) {
    const contact = await caller.crm.contactCreate({
      facilityId: FACILITY,
      fullName: `Lead ${uniq('test')}`,
      phone: uniq('09'),
    });
    made.contactIds.push(contact.id);
    const opp = await caller.crm.opportunityCreate({
      contactId: contact.id,
      studentName: 'Test Student',
    });
    made.oppIds.push(opp.id);
    return opp;
  }

  /**
   * Helper: read current opportunity state from DB
   */
  const getOppState = (id: string) =>
    withRls(SUPER, (tx) =>
      tx.opportunity.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          stage: true,
          closedAt: true,
          lostReason: true,
        },
      }),
    );

  /**
   * Helper: count audit events for an opportunity
   */
  const countEvents = (oppId: string) =>
    withRls(SUPER, (tx) =>
      tx.recordEvent.count({
        where: {
          entityId: oppId,
          entityType: 'opportunity',
          type: 'status_changed',
        },
      }),
    );

  // ──────────────────────────────────────────────────────────────────────
  // Test 1: markLost on an open opportunity
  // ──────────────────────────────────────────────────────────────────────
  it('markLost on O1_LEAD: sets closedAt + lostReason, logs event', async () => {
    const caller = await staffCaller();
    const opp = await newOpp(caller);
    expect(opp.stage).toBe('O1_LEAD');
    expect(opp.closedAt).toBeNull();

    // Mark as lost (lostReason is now a structured enum, not free text)
    const reason = 'no_response' as const;
    const result = await caller.crm.opportunityMarkLost({ id: opp.id, reason, note: 'Khách không nghe máy' });

    expect(result).toMatchObject({
      id: opp.id,
      stage: 'O1_LEAD', // Stage unchanged, only closure status
      lostReason: reason,
    });
    expect(result.closedAt).toBeTruthy(); // closedAt is now set

    // Verify DB end-state
    const state = await getOppState(opp.id);
    expect(state.closedAt).toBeTruthy();
    expect(state.lostReason).toBe(reason);

    // Verify audit log created
    const eventCount = await countEvents(opp.id);
    expect(eventCount).toBeGreaterThan(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 2: markLost guard — won deal (O5_ENROLLED + closedAt) cannot be marked lost
  // ──────────────────────────────────────────────────────────────────────
  it('markLost guard: O5_ENROLLED with closedAt (won) → BAD_REQUEST', async () => {
    const caller = await staffCaller();
    const opp = await newOpp(caller);

    // Move to O5_ENROLLED (won stage)
    await caller.crm.opportunityTransition({
      id: opp.id,
      stage: 'O5_ENROLLED',
      reason: 'Test advance to won',
    });

    // Verify won state: O5_ENROLLED + closedAt set
    const wonState = await getOppState(opp.id);
    expect(wonState.stage).toBe('O5_ENROLLED');
    expect(wonState.closedAt).toBeTruthy();

    // Attempt to mark as lost — should reject
    await expect(
      caller.crm.opportunityMarkLost({
        id: opp.id,
        reason: 'other',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Không thể đánh dấu mất cơ hội đã thắng',
    });

    // Verify state unchanged
    const unchanged = await getOppState(opp.id);
    expect(unchanged.stage).toBe('O5_ENROLLED');
    expect(unchanged.closedAt).toBeTruthy(); // Still closed from win
    expect(unchanged.lostReason).toBeNull(); // lostReason NOT set
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 3: markLost guard — already lost opportunity cannot be marked lost again
  // ──────────────────────────────────────────────────────────────────────
  it('markLost guard: already lost (closedAt + lostReason) → BAD_REQUEST', async () => {
    const caller = await staffCaller();
    const opp = await newOpp(caller);

    // First markLost
    const reason1 = 'price' as const;
    await caller.crm.opportunityMarkLost({ id: opp.id, reason: reason1 });

    // Verify closed
    const closedState = await getOppState(opp.id);
    expect(closedState.closedAt).toBeTruthy();
    expect(closedState.lostReason).toBe(reason1);

    // Attempt to mark lost again
    await expect(
      caller.crm.opportunityMarkLost({
        id: opp.id,
        reason: 'other',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Cơ hội đã đóng (mất)',
    });

    // Verify state unchanged
    const unchanged = await getOppState(opp.id);
    expect(unchanged.lostReason).toBe(reason1); // Original reason preserved
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 4: reopen a lost opportunity
  // ──────────────────────────────────────────────────────────────────────
  it('reopen: lost opportunity → clears closedAt + lostReason, back in pipeline', async () => {
    const caller = await staffCaller();
    const opp = await newOpp(caller);

    // Mark as lost
    const lostReason = 'no_response' as const;
    await caller.crm.opportunityMarkLost({ id: opp.id, reason: lostReason });

    // Verify closed state
    let state = await getOppState(opp.id);
    expect(state.closedAt).toBeTruthy();
    expect(state.lostReason).toBe(lostReason);

    // Reopen
    const reopened = await caller.crm.opportunityReopen({ id: opp.id });
    expect(reopened).toMatchObject({
      id: opp.id,
      stage: 'O1_LEAD', // Stage preserved
    });
    expect(reopened.closedAt).toBeNull();
    expect(reopened.lostReason).toBeNull();

    // Verify DB end-state
    state = await getOppState(opp.id);
    expect(state.closedAt).toBeNull();
    expect(state.lostReason).toBeNull();

    // Verify audit log created for reopen
    const eventCount = await countEvents(opp.id);
    expect(eventCount).toBeGreaterThan(1); // At least markLost + reopen
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 5: reopen guard — non-closed opportunity cannot be reopened
  // ──────────────────────────────────────────────────────────────────────
  it('reopen guard: open opportunity (closedAt = null) → BAD_REQUEST', async () => {
    const caller = await staffCaller();
    const opp = await newOpp(caller);

    // Verify open (closedAt = null)
    const openState = await getOppState(opp.id);
    expect(openState.closedAt).toBeNull();

    // Attempt to reopen — should reject
    await expect(caller.crm.opportunityReopen({ id: opp.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Cơ hội chưa đóng, không cần mở lại',
    });

    // Verify state unchanged
    const unchanged = await getOppState(opp.id);
    expect(unchanged.closedAt).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 6: state cycling — markLost → reopen → markLost
  // ──────────────────────────────────────────────────────────────────────
  it('state cycling: markLost → reopen → markLost → reopen', async () => {
    const caller = await staffCaller();
    const opp = await newOpp(caller);

    const reason1 = 'price' as const;
    const reason2 = 'competitor' as const;

    // Cycle 1: mark lost
    await caller.crm.opportunityMarkLost({ id: opp.id, reason: reason1 });
    let state = await getOppState(opp.id);
    expect(state.closedAt).toBeTruthy();
    expect(state.lostReason).toBe(reason1);

    // Cycle 1: reopen
    await caller.crm.opportunityReopen({ id: opp.id });
    state = await getOppState(opp.id);
    expect(state.closedAt).toBeNull();
    expect(state.lostReason).toBeNull();

    // Cycle 2: mark lost again with different reason
    await caller.crm.opportunityMarkLost({ id: opp.id, reason: reason2 });
    state = await getOppState(opp.id);
    expect(state.closedAt).toBeTruthy();
    expect(state.lostReason).toBe(reason2); // Updated reason

    // Cycle 2: reopen
    const final = await caller.crm.opportunityReopen({ id: opp.id });
    expect(final.closedAt).toBeNull();
    expect(final.lostReason).toBeNull();

    // Verify audit events logged all transitions
    const eventCount = await countEvents(opp.id);
    expect(eventCount).toBeGreaterThanOrEqual(4); // mark + reopen + mark + reopen
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 7: edge — won opportunity can be reopened if manually set to lost somehow
  // (edge case: DB state where O5 has closedAt but was lost, not won)
  // ──────────────────────────────────────────────────────────────────────
  it('edge: O5_ENROLLED with lostReason (lost win) can be reopened', async () => {
    const caller = await staffCaller();
    const opp = await newOpp(caller);

    // Advance to O5_ENROLLED (sets closedAt automatically as won)
    await caller.crm.opportunityTransition({
      id: opp.id,
      stage: 'O5_ENROLLED',
      reason: 'Won',
    });

    let state = await getOppState(opp.id);
    expect(state.stage).toBe('O5_ENROLLED');
    expect(state.closedAt).toBeTruthy();
    expect(state.lostReason).toBeNull();

    // Now manually set lostReason via DB to simulate edge case
    // (This would normally not happen, but test robustness)
    await withRls(SUPER, (tx) =>
      tx.opportunity.update({
        where: { id: opp.id },
        data: { lostReason: 'other' },
      }),
    );

    // Verify edge state
    state = await getOppState(opp.id);
    expect(state.closedAt).toBeTruthy();
    expect(state.lostReason).toBe('other');

    // Should be able to reopen this edge case
    const reopened = await caller.crm.opportunityReopen({ id: opp.id });
    expect(reopened.closedAt).toBeNull();
    expect(reopened.lostReason).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 8: markLost with empty/invalid reason should be rejected by zod
  // ──────────────────────────────────────────────────────────────────────
  it('markLost: empty reason string → Zod validation error', async () => {
    const caller = await staffCaller();
    const opp = await newOpp(caller);

    // Attempt with empty reason
    await expect(
      caller.crm.opportunityMarkLost({
        id: opp.id,
        reason: 'invalid_reason' as never, // not a LostReason → Zod nativeEnum rejects
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 9: markLost preserves other opportunity fields (stage, owner, etc.)
  // ──────────────────────────────────────────────────────────────────────
  it('markLost: preserves stage + other fields, only updates closedAt + lostReason', async () => {
    const caller = await staffCaller();
    const opp = await newOpp(caller);

    // Advance to intermediate stage
    await caller.crm.opportunityTransition({
      id: opp.id,
      stage: 'O2_CONTACTED',
      reason: 'Test',
    });

    const before = await getOppState(opp.id);
    expect(before.stage).toBe('O2_CONTACTED');

    // Mark lost
    const result = await caller.crm.opportunityMarkLost({
      id: opp.id,
      reason: 'schedule',
    });

    // Stage should be unchanged
    expect(result.stage).toBe('O2_CONTACTED');
    expect(result.closedAt).toBeTruthy();
    expect(result.lostReason).toBe('schedule');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 10: reopen after won → should succeed (no guard on won + lost combo)
  // ──────────────────────────────────────────────────────────────────────
  it('reopen: won opportunity (O5 + closedAt, no lostReason) → clears closedAt', async () => {
    const caller = await staffCaller();
    const opp = await newOpp(caller);

    // Advance to O5 (won) — sets closedAt, lostReason = null
    await caller.crm.opportunityTransition({
      id: opp.id,
      stage: 'O5_ENROLLED',
      reason: 'Won',
    });

    let state = await getOppState(opp.id);
    expect(state.stage).toBe('O5_ENROLLED');
    expect(state.closedAt).toBeTruthy();
    expect(state.lostReason).toBeNull();

    // Should be able to reopen a won opportunity
    const reopened = await caller.crm.opportunityReopen({ id: opp.id });
    expect(reopened.closedAt).toBeNull();

    // After reopen, should be open again (can be advanced or lost)
    state = await getOppState(opp.id);
    expect(state.closedAt).toBeNull();
  });
});
