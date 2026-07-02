import { rangesOverlap } from './time.js';

export interface SlotInput {
  dayOfWeek: number; // 0=Sun .. 6=Sat
  startTime: string; // HH:mm
  endTime: string;
  roomId?: string | null;
  teacherId?: string | null;
}

export interface SessionLike {
  id?: string;
  sessionDate: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  roomId?: string | null;
  teacherId?: string | null;
}

export interface Conflict {
  kind: 'room' | 'teacher';
  date: string;
  candidate: SessionLike;
  against: SessionLike;
}

/** Expand weekly slots into concrete sessions across [startDate, endDate] (inclusive). */
export function enumerateSessions(slots: SlotInput[], startDate: string, endDate: string): SessionLike[] {
  const out: SessionLike[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid startDate/endDate (expected YYYY-MM-DD)');
  }
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    const iso = d.toISOString().slice(0, 10);
    for (const s of slots) {
      if (s.dayOfWeek === dow) {
        out.push({
          sessionDate: iso,
          startTime: s.startTime,
          endTime: s.endTime,
          roomId: s.roomId ?? null,
          teacherId: s.teacherId ?? null,
        });
      }
    }
  }
  return out;
}

export interface ExpandableUnit {
  id: string;
  sessions: number;
}

export interface AssignUnitsResult {
  /** sessionId → curriculumUnitId, or null when the session has no unit (overflow / no curriculum). */
  mapping: Map<string, string | null>;
  /** Sessions matched to a real unit. */
  mappedCount: number;
  /** Sessions beyond the curriculum's total capacity (Σ unit.sessions) — mapped to null. */
  overflowCount: number;
  /** Units in the curriculum that received zero sessions in this pass. */
  uncoveredUnits: number;
}

/**
 * Zips ordered sessions against a curriculum expanded by `sessions` count (each unit repeated
 * `sessions` times, in caller-provided order — callers pass units sorted by orderGlobal).
 * Pure and deterministic: same inputs always produce the same mapping, so callers can
 * recompute the WHOLE batch every time instead of tracking incremental offsets.
 */
export function assignUnitsToSessions(
  units: ExpandableUnit[],
  orderedSessionIds: string[],
): AssignUnitsResult {
  const expanded: string[] = [];
  for (const u of units) {
    for (let i = 0; i < u.sessions; i++) expanded.push(u.id);
  }

  const mapping = new Map<string, string | null>();
  let mappedCount = 0;
  for (let i = 0; i < orderedSessionIds.length; i++) {
    const unitId = expanded[i] ?? null;
    mapping.set(orderedSessionIds[i]!, unitId);
    if (unitId !== null) mappedCount++;
  }

  const overflowCount = Math.max(0, orderedSessionIds.length - expanded.length);
  const assignedUnitIds = new Set(expanded.slice(0, orderedSessionIds.length));
  const uncoveredUnits = units.filter((u) => !assignedUnitIds.has(u.id)).length;

  return { mapping, mappedCount, overflowCount, uncoveredUnits };
}

/** Detect hard-block conflicts: same room or same teacher overlapping on a date.
 * Checks candidates against existing sessions AND against each other. */
export function detectConflicts(candidates: SessionLike[], existing: SessionLike[] = []): Conflict[] {
  const conflicts: Conflict[] = [];
  const seen: SessionLike[] = [...existing];
  for (const c of candidates) {
    for (const e of seen) {
      if (c.sessionDate !== e.sessionDate) continue;
      if (!rangesOverlap(c.startTime, c.endTime, e.startTime, e.endTime)) continue;
      if (c.roomId && e.roomId && c.roomId === e.roomId) {
        conflicts.push({ kind: 'room', date: c.sessionDate, candidate: c, against: e });
      }
      if (c.teacherId && e.teacherId && c.teacherId === e.teacherId) {
        conflicts.push({ kind: 'teacher', date: c.sessionDate, candidate: c, against: e });
      }
    }
    seen.push(c);
  }
  return conflicts;
}
