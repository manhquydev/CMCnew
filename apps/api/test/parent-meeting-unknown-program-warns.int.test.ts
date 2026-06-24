import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';
import { generateParentMeetings } from '../src/services/parent-meeting-cadence.js';
import * as domainAcademic from '@cmc/domain-academic';

describe('parent-meeting warns on unknown program (no cadence configured)', () => {
  const FAC = 1;
  const NOW = new Date('2026-06-24T00:00:00.000Z');
  let testClassIdWithoutCadence: string;
  let testClassIdWithCadence: string;
  const courseIds: string[] = [];

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      // Create a course with a known enum program
      const courseWithCadence = await tx.course.create({
        data: { code: uniq('UCREA_CRS'), name: 'Known Program Course', program: 'UCREA' },
      });
      courseIds.push(courseWithCadence.id);

      // Create a RUNNING class with a known program (baseline; should have cadence)
      testClassIdWithCadence = (await tx.classBatch.create({
        data: {
          facilityId: FAC,
          code: uniq('WITH_CADENCE'),
          courseId: courseWithCadence.id,
          name: 'Running with Cadence',
          status: 'running',
          startDate: new Date('2026-01-10T00:00:00.000Z'),
        },
      })).id;

      // Create another course for the test; we'll temporarily mock the cadence map to exclude its program
      const courseWithoutCadence = await tx.course.create({
        data: { code: uniq('NO_CADENCE_CRS'), name: 'Program Without Cadence', program: 'BLACK_HOLE' },
      });
      courseIds.push(courseWithoutCadence.id);

      // Create a RUNNING class; we'll later mock the cadence map to exclude BLACK_HOLE
      testClassIdWithoutCadence = (await tx.classBatch.create({
        data: {
          facilityId: FAC,
          code: uniq('NO_CADENCE'),
          courseId: courseWithoutCadence.id,
          name: 'Running without Cadence',
          status: 'running',
          startDate: new Date('2026-01-10T00:00:00.000Z'),
        },
      })).id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      if (testClassIdWithoutCadence) {
        await tx.recordEvent.deleteMany({
          where: { entityType: 'class_batch', entityId: testClassIdWithoutCadence },
        });
        await tx.parentMeeting.deleteMany({ where: { classBatchId: testClassIdWithoutCadence } });
      }
      if (testClassIdWithCadence) {
        await tx.recordEvent.deleteMany({
          where: { entityType: 'class_batch', entityId: testClassIdWithCadence },
        });
        await tx.parentMeeting.deleteMany({ where: { classBatchId: testClassIdWithCadence } });
      }
      if (courseIds.length > 0) {
        await tx.classBatch.deleteMany({
          where: { id: { in: [testClassIdWithoutCadence, testClassIdWithCadence] } },
        });
        await tx.course.deleteMany({ where: { id: { in: courseIds } } });
      }
    });
  });

  it('emits a warning when a running class has a program not in the cadence map', async () => {
    // Clean up any prior warnings first
    await withRls(SUPER, (tx) =>
      tx.recordEvent.deleteMany({
        where: { entityType: 'class_batch', entityId: testClassIdWithoutCadence },
      }),
    );

    // Temporarily mock the cadence map to exclude BLACK_HOLE, simulating an unconfigured program
    const originalCadence = { ...domainAcademic.PARENT_MEETING_CADENCE_MONTHS };
    delete (domainAcademic.PARENT_MEETING_CADENCE_MONTHS as any)['BLACK_HOLE'];

    try {
      await generateParentMeetings(NOW);

      // Assert: 0 parent meetings created for the class without cadence
      const meetingsWithoutCadence = await withRls(SUPER, (tx) =>
        tx.parentMeeting.findMany({ where: { classBatchId: testClassIdWithoutCadence } }),
      );
      expect(meetingsWithoutCadence).toHaveLength(0);

      // Assert: exactly one warning audit record for the class without cadence
      const warningEvents = await withRls(SUPER, (tx) =>
        tx.recordEvent.findMany({
          where: {
            entityType: 'class_batch',
            entityId: testClassIdWithoutCadence,
            type: 'note',
          },
        }),
      );
      expect(warningEvents).toHaveLength(1);
      const warningEvent = warningEvents[0];
      expect(warningEvent.body).toContain("chưa cấu hình cadence");
      expect(warningEvent.body).toContain('BLACK_HOLE');
    } finally {
      // Restore the original cadence map
      Object.assign(domainAcademic.PARENT_MEETING_CADENCE_MONTHS, originalCadence);
    }
  });

  it('does not warn for a program that IS in the cadence map (baseline)', async () => {
    await generateParentMeetings(NOW);

    // Assert: class with cadence generates meetings as expected
    const meetingsWithCadence = await withRls(SUPER, (tx) =>
      tx.parentMeeting.findMany({ where: { classBatchId: testClassIdWithCadence }, orderBy: { scheduledAt: 'asc' } }),
    );
    expect(meetingsWithCadence.length).toBeGreaterThan(0);
    // UCREA cadence is 5 months: 2026-01-10 + 5mo = 2026-06-10, +10mo = 2026-11-10, +15mo = 2027-04-10
    expect(meetingsWithCadence.map((m) => m.scheduledAt.toISOString().slice(0, 10))).toEqual(['2026-06-10', '2026-11-10', '2027-04-10']);

    // Assert: no warning is emitted for the class with cadence
    const warningsWithCadence = await withRls(SUPER, (tx) =>
      tx.recordEvent.findMany({
        where: {
          entityType: 'class_batch',
          entityId: testClassIdWithCadence,
          type: 'note',
        },
      }),
    );
    expect(warningsWithCadence).toHaveLength(0);
  });

  it('does not create duplicate parent meetings when run again (generation is idempotent)', async () => {
    // Clean up prior state
    await withRls(SUPER, async (tx) => {
      await tx.parentMeeting.deleteMany({ where: { classBatchId: testClassIdWithoutCadence } });
      await tx.recordEvent.deleteMany({
        where: { entityType: 'class_batch', entityId: testClassIdWithoutCadence },
      });
    });

    // Temporarily mock the cadence map for this test
    const originalCadence = { ...domainAcademic.PARENT_MEETING_CADENCE_MONTHS };
    delete (domainAcademic.PARENT_MEETING_CADENCE_MONTHS as any)['BLACK_HOLE'];

    try {
      // First run
      await generateParentMeetings(NOW);

      const meetingsAfterFirstRun = await withRls(SUPER, (tx) =>
        tx.parentMeeting.findMany({ where: { classBatchId: testClassIdWithoutCadence } }),
      );
      // Should have 0 meetings since the class has no cadence
      expect(meetingsAfterFirstRun).toHaveLength(0);

      // Run again
      await generateParentMeetings(NOW);

      const meetingsAfterSecondRun = await withRls(SUPER, (tx) =>
        tx.parentMeeting.findMany({ where: { classBatchId: testClassIdWithoutCadence } }),
      );
      // Still 0 meetings; idempotent (no duplicates created)
      expect(meetingsAfterSecondRun).toHaveLength(0);

      // Warnings will accumulate (one per run), but that's expected behavior
      const allWarnings = await withRls(SUPER, (tx) =>
        tx.recordEvent.findMany({
          where: {
            entityType: 'class_batch',
            entityId: testClassIdWithoutCadence,
            type: 'note',
          },
        }),
      );
      expect(allWarnings.length).toBeGreaterThanOrEqual(2);
    } finally {
      Object.assign(domainAcademic.PARENT_MEETING_CADENCE_MONTHS, originalCadence);
    }
  });
});
