import { describe, it, expect } from 'vitest';
import { assignUnitsToSessions, type ExpandableUnit } from './schedule.js';

/** 12 units × 4 sessions each = 48 slots, unit ids "U1".."U12" in orderGlobal order. */
function twelveUnits(sessionsEach = 4): ExpandableUnit[] {
  return Array.from({ length: 12 }, (_, i) => ({ id: `U${i + 1}`, sessions: sessionsEach }));
}
const sessionIds = (n: number, prefix = 'S') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

describe('assignUnitsToSessions', () => {
  it('zips 12 units×4 sessions across 48 ordered sessions in orderGlobal order', () => {
    const res = assignUnitsToSessions(twelveUnits(), sessionIds(48));
    expect(res.mappedCount).toBe(48);
    expect(res.overflowCount).toBe(0);
    expect(res.uncoveredUnits).toBe(0);
    // Sessions 1-4 → U1, 5-8 → U2, ...
    expect(res.mapping.get('S1')).toBe('U1');
    expect(res.mapping.get('S4')).toBe('U1');
    expect(res.mapping.get('S5')).toBe('U2');
    expect(res.mapping.get('S48')).toBe('U12');
  });

  it('overflow: 50 sessions against a 48-slot curriculum → last 2 sessions map to null', () => {
    const res = assignUnitsToSessions(twelveUnits(), sessionIds(50));
    expect(res.mappedCount).toBe(48);
    expect(res.overflowCount).toBe(2);
    expect(res.mapping.get('S49')).toBeNull();
    expect(res.mapping.get('S50')).toBeNull();
    // Nothing before the overflow point is affected.
    expect(res.mapping.get('S48')).toBe('U12');
  });

  it('shortage: 40 sessions covers only the first 10 units, leaving 2 units uncovered', () => {
    const res = assignUnitsToSessions(twelveUnits(), sessionIds(40));
    expect(res.mappedCount).toBe(40);
    expect(res.overflowCount).toBe(0);
    expect(res.uncoveredUnits).toBe(2);
    expect(res.mapping.get('S40')).toBe('U10');
  });

  it('ordering hazard: recomputing after inserting an earlier session reassigns everything', () => {
    // Original 4 sessions in date order S1..S4 (each week apart) mapped to U1 (4 sessions/unit).
    const first = assignUnitsToSessions(twelveUnits(), ['S1', 'S2', 'S3', 'S4']);
    expect([...first.mapping.values()]).toEqual(['U1', 'U1', 'U1', 'U1']);

    // A session earlier than all four is inserted (e.g. an earlier weekday slot added later).
    // Recompute must re-sort by (date,startTime) BEFORE calling this helper — the caller's
    // job — but assignUnitsToSessions itself is stateless: same ordered ids in → same mapping.
    // Simulate the corrected date order after inserting "S0" as the earliest session.
    const second = assignUnitsToSessions(twelveUnits(), ['S0', 'S1', 'S2', 'S3', 'S4']);
    expect(second.mapping.get('S0')).toBe('U1');
    expect(second.mapping.get('S4')).toBe('U2'); // pushed out of U1's window, not left stale
    // No session keeps a "stale" unit inconsistent with the recomputed order.
    expect([...second.mapping.values()]).toEqual(['U1', 'U1', 'U1', 'U1', 'U2']);
  });
});
