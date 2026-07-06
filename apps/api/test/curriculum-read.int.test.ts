import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { Role } from '@cmc/auth';
import { seedCurriculum, parseCurriculumRows, courseCode, defaultCsvPath } from '@cmc/db';
import { appRouter } from '../src/routers/index.js';
import type { ApiContext } from '../src/context.js';
import { staffCaller, prisma, withRls, SUPER } from './helpers.js';

const csvText = readFileSync(defaultCsvPath(), 'utf8');
const rows = parseCurriculumRows(csvText);

function expectFor(code: string): { units: number; sessions: number } {
  let units = 0;
  let sessions = 0;
  for (const r of rows) {
    if (courseCode(r.program, r.levelCode) === code) {
      units += 1;
      sessions += r.sessions;
    }
  }
  return { units, sessions };
}

/** A fully unauthenticated caller (no staff session, no LMS principal). */
function anonCaller() {
  const ctx: ApiContext = { c: {} as never, session: null, lms: null, ip: 'test' };
  return appRouter.createCaller(ctx);
}

describe('curriculum read API', () => {
  beforeAll(async () => {
    await seedCurriculum(prisma, csvText);
  });

  it('listByCourse returns units ordered by orderGlobal with unitCount + totalSessions from CSV', async () => {
    const code = courseCode('UCREA', 'L1');
    const course = await prisma.course.findUniqueOrThrow({ where: { code } });
    const caller = await staffCaller();
    const res = await caller.curriculum.listByCourse({ courseId: course.id });

    const exp = expectFor(code);
    expect(res.unitCount).toBe(exp.units);
    expect(res.totalSessions).toBe(exp.sessions);
    const orders = res.units.map((u) => u.orderGlobal);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    const lessonCount = res.units.reduce((sum, unit) => sum + unit.lessons.length, 0);
    expect(lessonCount).toBe(exp.sessions);
    const first = res.units[0]!;
    expect(first.lessons.map((lesson) => lesson.seqInUnit)).toEqual([1, 2, 3, 4]);
    expect(first.lessons.map((lesson) => lesson.lessonCode)).toEqual([
      `${first.unitCode}-S01`,
      `${first.unitCode}-S02`,
      `${first.unitCode}-S03`,
      `${first.unitCode}-S04`,
    ]);
  });

  it('places the Bright review unit last for level J', async () => {
    const code = courseCode('BRIGHT_IG', 'J');
    const course = await prisma.course.findUniqueOrThrow({ where: { code } });
    const caller = await staffCaller();
    const res = await caller.curriculum.listByCourse({ courseId: course.id });
    expect(res.units.at(-1)!.unitType).toBe('REVIEW');
  });

  it('course.list exposes levelCode + unitCount + totalSessions for curriculum courses', async () => {
    const caller = await staffCaller();
    const list = await caller.course.list();
    const code = courseCode('UCREA', 'L1');
    const entry = list.find((c) => c.code === code);
    const exp = expectFor(code);
    expect(entry).toBeTruthy();
    expect(entry!.levelCode).toBe('L1');
    expect(entry!.unitCount).toBe(exp.units);
    expect(entry!.totalSessions).toBe(exp.sessions);
  });

  it('is readable by any staff role (giao_vien) but rejects the unauthenticated', async () => {
    // facility is RLS-scoped → read it through a super context, not the bare client.
    const hq = await withRls(SUPER, (tx) => tx.facility.findFirstOrThrow({ where: { code: 'HQ' } }));
    const course = await prisma.course.findUniqueOrThrow({
      where: { code: courseCode('UCREA', 'L1') },
    });
    const teacher = await staffCaller({
      primaryRole: Role.giao_vien,
      roles: [Role.giao_vien],
      isSuperAdmin: false,
      facilityIds: [hq.id],
    });
    const res = await teacher.curriculum.listByCourse({ courseId: course.id });
    expect(res.unitCount).toBeGreaterThan(0);

    await expect(anonCaller().curriculum.listByCourse({ courseId: course.id })).rejects.toThrow();
  });
});
