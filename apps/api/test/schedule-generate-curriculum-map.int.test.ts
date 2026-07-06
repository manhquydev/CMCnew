import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { seedCurriculum, courseCode, defaultCsvPath } from '@cmc/db';
import { staffCaller, withRls, SUPER, uniq, prisma } from './helpers.js';

/**
 * Phase 3 — curriculum unit mapping on schedule.generateSessions.
 * Uses the real seeded UCREA-L1 curriculum (12 units × 4 sessions = 48 total sessions;
 * unit #1 = UC-L1-01, unit #2 = UC-L1-02, ...) so counts are never hard-coded — they
 * come from the same CSV the seed importer reads.
 */
describe('schedule.generateSessions — curriculum unit mapping', () => {
  const FAC = 1;
  let courseId: string;
  let unit1Id: string;
  let unit2Id: string;
  let unit1LessonIds: string[];
  let unit2LessonIds: string[];

  const batchIds: string[] = [];

  beforeAll(async () => {
    await seedCurriculum(prisma, readFileSync(defaultCsvPath(), 'utf8'));
    const course = await withRls(SUPER, (tx) =>
      tx.course.findUniqueOrThrow({ where: { code: courseCode('UCREA', 'L1') } }),
    );
    courseId = course.id;
    const units = await withRls(SUPER, (tx) =>
      tx.curriculumUnit.findMany({
        where: { courseId },
        orderBy: { orderGlobal: 'asc' },
        include: { lessons: { orderBy: { seqInUnit: 'asc' } } },
      }),
    );
    unit1Id = units[0]!.id; // UC-L1-01, sessions=4
    unit2Id = units[1]!.id; // UC-L1-02, sessions=4
    unit1LessonIds = units[0]!.lessons.map((lesson) => lesson.id);
    unit2LessonIds = units[1]!.lessons.map((lesson) => lesson.id);
  });

  afterAll(async () => {
    await withRls(SUPER, (tx) => tx.classSession.deleteMany({ where: { classBatchId: { in: batchIds } } }));
    await withRls(SUPER, (tx) => tx.scheduleSlot.deleteMany({ where: { classBatchId: { in: batchIds } } }));
    await withRls(SUPER, (tx) => tx.classBatch.deleteMany({ where: { id: { in: batchIds } } }));
  });

  async function makeBatch(code: string) {
    const batch = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: { facilityId: FAC, code: uniq(code), courseId, name: `Curriculum map ${code}`, status: 'running' },
      }),
    );
    batchIds.push(batch.id);
    return batch;
  }

  it('maps exactly 48 sessions across 12 units in orderGlobal order (full match, no overflow/shortage)', async () => {
    const batch = await makeBatch('CUM-FULL');
    // 1 weekly slot × 48 weeks = 48 sessions. No room/teacher → no conflict-check interference.
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: { facilityId: FAC, classBatchId: batch.id, dayOfWeek: 1, startTime: '08:00', endTime: '09:00' },
      }),
    );
    const caller = await staffCaller();
    const gen = await caller.schedule.generateSessions({
      classBatchId: batch.id,
      startDate: '2090-01-02', // a Monday
      endDate: '2090-11-27', // 48 Mondays total (verified via enumerateSessions math)
    });
    expect(gen.created).toBe(48);

    const sessions = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({
        where: { classBatchId: batch.id },
        orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
      }),
    );
    expect(sessions).toHaveLength(48);
    expect(sessions.slice(0, 4).every((s) => s.curriculumUnitId === unit1Id)).toBe(true);
    expect(sessions.slice(4, 8).every((s) => s.curriculumUnitId === unit2Id)).toBe(true);
    expect(sessions.slice(0, 4).map((s) => s.curriculumLessonId)).toEqual(unit1LessonIds);
    expect(sessions.slice(4, 8).map((s) => s.curriculumLessonId)).toEqual(unit2LessonIds);
    expect(sessions.every((s) => s.curriculumUnitId !== null)).toBe(true);
    expect(sessions.every((s) => s.curriculumLessonId !== null)).toBe(true);
  });

  it('overflow: 50 sessions against the 48-slot curriculum leaves the last 2 sessions null', async () => {
    const batch = await makeBatch('CUM-OVERFLOW');
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: { facilityId: FAC, classBatchId: batch.id, dayOfWeek: 2, startTime: '08:00', endTime: '09:00' },
      }),
    );
    const caller = await staffCaller();
    const gen = await caller.schedule.generateSessions({
      classBatchId: batch.id,
      startDate: '2091-01-02', // a Tuesday
      endDate: '2091-12-11', // 50 Tuesdays total
    });
    expect(gen.created).toBe(50);

    const sessions = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({
        where: { classBatchId: batch.id },
        orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
      }),
    );
    expect(sessions).toHaveLength(50);
    expect(sessions.slice(0, 48).every((s) => s.curriculumUnitId !== null)).toBe(true);
    expect(sessions.slice(0, 48).every((s) => s.curriculumLessonId !== null)).toBe(true);
    expect(sessions[48]!.curriculumUnitId).toBeNull();
    expect(sessions[49]!.curriculumUnitId).toBeNull();
    expect(sessions[48]!.curriculumLessonId).toBeNull();
    expect(sessions[49]!.curriculumLessonId).toBeNull();
  });

  it('shortage: 40 sessions covers only the first 10 units, leaving 2 units uncovered', async () => {
    const batch = await makeBatch('CUM-SHORT');
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: { facilityId: FAC, classBatchId: batch.id, dayOfWeek: 3, startTime: '08:00', endTime: '09:00' },
      }),
    );
    const caller = await staffCaller();
    const gen = await caller.schedule.generateSessions({
      classBatchId: batch.id,
      startDate: '2092-01-02', // a Wednesday
      endDate: '2092-10-01', // 40 Wednesdays total
    });
    expect(gen.created).toBe(40);

    const sessions = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({
        where: { classBatchId: batch.id },
        orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
      }),
    );
    const mappedUnitIds = new Set(sessions.map((s) => s.curriculumUnitId).filter(Boolean));
    const mappedLessonIds = new Set(sessions.map((s) => s.curriculumLessonId).filter(Boolean));
    expect(mappedUnitIds.size).toBe(10); // 40 / 4 sessions-per-unit
    expect(mappedLessonIds.size).toBe(40);
    expect(sessions.every((s) => s.curriculumUnitId !== null)).toBe(true); // no overflow at 40 < 48
    expect(sessions.every((s) => s.curriculumLessonId !== null)).toBe(true);
  });

  it('ordering hazard: adding an earlier-weekday slot and regenerating reassigns old sessions too', async () => {
    const batch = await makeBatch('CUM-REORDER');
    // Friday slot first — 4 weeks → exactly unit1's capacity (4 sessions).
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: { facilityId: FAC, classBatchId: batch.id, dayOfWeek: 5, startTime: '18:00', endTime: '19:00' },
      }),
    );
    // Window chosen so it holds exactly 4 Fridays (01-02,01-09,01-16,01-23) — verified via
    // enumerateSessions math. Only the Friday slot exists yet, so only Fridays are created.
    const WINDOW_START = '2093-01-02';
    const WINDOW_END = '2093-01-27'; // also holds exactly 4 Tuesdays once that slot is added
    const caller = await staffCaller();
    await caller.schedule.generateSessions({
      classBatchId: batch.id,
      startDate: WINDOW_START,
      endDate: WINDOW_END,
    });
    const fridaysBefore = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({ where: { classBatchId: batch.id }, orderBy: { sessionDate: 'asc' } }),
    );
    expect(fridaysBefore).toHaveLength(4);
    expect(fridaysBefore.every((s) => s.curriculumUnitId === unit1Id)).toBe(true);

    // Add a Tuesday slot (earlier in the week than Friday) and regenerate over the same window.
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: { facilityId: FAC, classBatchId: batch.id, dayOfWeek: 2, startTime: '18:00', endTime: '19:00' },
      }),
    );
    await caller.schedule.generateSessions({
      classBatchId: batch.id,
      startDate: WINDOW_START,
      endDate: WINDOW_END,
    });

    const allAfter = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({
        where: { classBatchId: batch.id },
        orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
      }),
    );
    // Chronological merge: Fri1,Tue1,Fri2,Tue2,Fri3,Tue3,Fri4,Tue4 = 8 sessions.
    expect(allAfter).toHaveLength(8);
    // First 4 (Fri1,Tue1,Fri2,Tue2) → unit1; next 4 (Fri3,Tue3,Fri4,Tue4) → unit2.
    expect(allAfter.slice(0, 4).every((s) => s.curriculumUnitId === unit1Id)).toBe(true);
    expect(allAfter.slice(4, 8).every((s) => s.curriculumUnitId === unit2Id)).toBe(true);
    expect(allAfter.slice(0, 4).map((s) => s.curriculumLessonId)).toEqual(unit1LessonIds);
    expect(allAfter.slice(4, 8).map((s) => s.curriculumLessonId)).toEqual(unit2LessonIds);
    // The two Friday sessions that used to be unit1 alone (Fri3, Fri4 in the old 4-session
    // order) have moved to unit2 now that Tuesdays are interleaved — proves recompute
    // touches OLD sessions, not just newly-inserted ones.
    const fridaysAfter = allAfter.filter((s) => s.sessionDate.getUTCDay() === 5);
    expect(fridaysAfter).toHaveLength(4);
    expect(fridaysAfter[0]!.curriculumUnitId).toBe(unit1Id);
    expect(fridaysAfter[1]!.curriculumUnitId).toBe(unit1Id);
    expect(fridaysAfter[2]!.curriculumUnitId).toBe(unit2Id);
    expect(fridaysAfter[3]!.curriculumUnitId).toBe(unit2Id);
    expect(fridaysAfter.map((s) => s.curriculumLessonId)).toEqual([
      unit1LessonIds[0],
      unit1LessonIds[2],
      unit2LessonIds[0],
      unit2LessonIds[2],
    ]);
  });

  it('cancelled sessions are excluded from the position count (do not consume a curriculum slot)', async () => {
    const batch = await makeBatch('CUM-CANCEL');
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: { facilityId: FAC, classBatchId: batch.id, dayOfWeek: 4, startTime: '08:00', endTime: '09:00' },
      }),
    );
    const caller = await staffCaller();
    await caller.schedule.generateSessions({
      classBatchId: batch.id,
      startDate: '2094-01-07', // a Thursday
      endDate: '2094-01-28', // 4 Thursdays total
    });
    const four = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({ where: { classBatchId: batch.id }, orderBy: { sessionDate: 'asc' } }),
    );
    expect(four).toHaveLength(4);
    // Cancel the 2nd session directly (no per-session cancel API exists yet — out of scope).
    await withRls(SUPER, (tx) => tx.classSession.update({ where: { id: four[1]!.id }, data: { status: 'cancelled' } }));

    // Extend the window by one more Thursday to force a new candidate → triggers recompute.
    await caller.schedule.generateSessions({
      classBatchId: batch.id,
      startDate: '2094-01-07',
      endDate: '2094-02-04', // 5 Thursdays total
    });

    const nonCancelled = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({
        where: { classBatchId: batch.id, status: { not: 'cancelled' } },
        orderBy: { sessionDate: 'asc' },
      }),
    );
    // If the cancelled session had NOT been excluded from position counting, the 4th
    // non-cancelled session (the new 5th Thursday) would overflow into unit2 (position 5).
    // Excluding it correctly keeps all 4 non-cancelled sessions inside unit1's 4-slot capacity.
    expect(nonCancelled).toHaveLength(4);
    expect(nonCancelled.every((s) => s.curriculumUnitId === unit1Id)).toBe(true);
    expect(nonCancelled.map((s) => s.curriculumLessonId)).toEqual(unit1LessonIds);
  });
});
