import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { Role } from '@cmc/auth';
import { seedCurriculum, parseCurriculumRows, courseCode, defaultCsvPath } from '@cmc/db/seed-curriculum';
import { staffCaller, prisma, withRls, SUPER, superAdminUserId, uniq } from './helpers.js';

const FACILITY = 1;

const csvText = readFileSync(defaultCsvPath(), 'utf8');
const rows = parseCurriculumRows(csvText);

function totalSessionsFor(code: string): number {
  let sessions = 0;
  for (const r of rows) {
    if (courseCode(r.program, r.levelCode) === code) sessions += r.sessions;
  }
  return sessions;
}

describe('Teacher Lite class creation — server-truth session count (no manual endDate)', () => {
  let dbReachable = false;
  const cleanup = { batchIds: [] as string[] };

  beforeAll(async () => {
    try {
      await superAdminUserId();
      await seedCurriculum(prisma, csvText);
      dbReachable = true;
    } catch {
      console.warn('DB not reachable - Teacher Lite session-count tests skipped');
    }
  });

  afterAll(async () => {
    if (!dbReachable || cleanup.batchIds.length === 0) return;
    await withRls(SUPER, (tx) => tx.classBatch.deleteMany({ where: { id: { in: cleanup.batchIds } } }));
  });

  it(
    'generates EXACTLY Σ curriculumUnit.sessions rows, on the slot weekday, starting on/after startDate',
    async () => {
      if (!dbReachable) return;
      const code = courseCode('UCREA', 'L1');
      const course = await prisma.course.findUniqueOrThrow({ where: { code } });
      const expectedSessions = totalSessionsFor(code);
      expect(expectedSessions).toBeGreaterThan(0);

      const caller = await staffCaller({
        roles: [Role.giam_doc_kinh_doanh],
        primaryRole: Role.giam_doc_kinh_doanh,
        isSuperAdmin: false,
        facilityIds: [FACILITY],
      });

      // 2026-08-03 is a Monday.
      const startDate = '2026-08-03';
      const result = await caller.teacherLite.createClass({
        facilityId: FACILITY,
        courseId: course.id,
        startDate,
        slot: { dayOfWeek: 1, startTime: '18:00', endTime: '19:30' },
        generateSessions: true,
      });
      cleanup.batchIds.push(result.batch.id);

      expect(result.sessions.created).toBe(expectedSessions);

      const sessions = await withRls(SUPER, (tx) =>
        tx.classSession.findMany({
          where: { classBatchId: result.batch.id },
          orderBy: { sessionDate: 'asc' },
        }),
      );
      expect(sessions).toHaveLength(expectedSessions);
      for (const s of sessions) {
        expect(s.sessionDate.getUTCDay()).toBe(1);
        expect(s.startTime).toBe('18:00');
        expect(s.endTime).toBe('19:30');
        expect(s.sessionDate.getTime()).toBeGreaterThanOrEqual(new Date(`${startDate}T00:00:00Z`).getTime());
      }

      const firstDate = sessions[0]!.sessionDate.toISOString().slice(0, 10);
      const lastDate = sessions.at(-1)!.sessionDate.toISOString().slice(0, 10);
      expect(firstDate).toBe(startDate);

      const batch = await withRls(SUPER, (tx) => tx.classBatch.findUniqueOrThrow({ where: { id: result.batch.id } }));
      expect(batch.endDate?.toISOString().slice(0, 10)).toBe(lastDate);
    },
  );

  it('ignores a manually-passed endDate — session count still comes from the curriculum', async () => {
    if (!dbReachable) return;
    const code = courseCode('UCREA', 'L1');
    const course = await prisma.course.findUniqueOrThrow({ where: { code } });
    const expectedSessions = totalSessionsFor(code);

    const caller = await staffCaller({
      roles: [Role.giam_doc_dao_tao],
      primaryRole: Role.giam_doc_dao_tao,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

    const result = await caller.teacherLite.createClass({
      facilityId: FACILITY,
      courseId: course.id,
      startDate: '2026-09-07',
      // Deliberately too short a window to fit all curriculum sessions if the range-based
      // path were still used — proves count-mode ignores endDate entirely.
      endDate: '2026-09-14',
      slot: { dayOfWeek: 1, startTime: '18:00', endTime: '19:30' },
      generateSessions: true,
    });
    cleanup.batchIds.push(result.batch.id);

    expect(result.sessions.created).toBe(expectedSessions);
  });

  it('a course with no curriculum units generates zero sessions (no silent range fallback)', async () => {
    if (!dbReachable) return;
    const bareCourse = await withRls(SUPER, (tx) =>
      tx.course.create({ data: { code: uniq('CRS_BARE'), name: 'Bare course (no curriculum)', program: 'UCREA' } }),
    );
    const caller = await staffCaller({
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

    const result = await caller.teacherLite.createClass({
      facilityId: FACILITY,
      courseId: bareCourse.id,
      startDate: '2026-10-05',
      slot: { dayOfWeek: 1, startTime: '18:00', endTime: '19:30' },
      generateSessions: true,
    });
    cleanup.batchIds.push(result.batch.id);

    expect(result.sessions.created).toBe(0);

    await withRls(SUPER, (tx) => tx.classBatch.deleteMany({ where: { id: result.batch.id } }));
    await withRls(SUPER, (tx) => tx.course.deleteMany({ where: { id: bareCourse.id } }));
  });
});
