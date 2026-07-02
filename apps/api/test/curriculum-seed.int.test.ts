import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  seedCurriculum,
  parseCurriculumRows,
  courseCode,
  defaultCsvPath,
  type CurriculumRow,
} from '@cmc/db';
import { prisma } from './helpers.js';

// The CSV is the single source of truth: every expectation below is derived from it,
// so the test can never drift from the seed data (no hard-coded 60/240 magic numbers).
const csvText = readFileSync(defaultCsvPath(), 'utf8');
const rows = parseCurriculumRows(csvText);

/** Expected units + total sessions per Course code, derived straight from the CSV. */
function expectedByCourse(): Map<string, { units: number; sessions: number }> {
  const m = new Map<string, { units: number; sessions: number }>();
  for (const r of rows) {
    const code = courseCode(r.program, r.levelCode);
    const cur = m.get(code) ?? { units: 0, sessions: 0 };
    cur.units += 1;
    cur.sessions += r.sessions;
    m.set(code, cur);
  }
  return m;
}

describe('curriculum seed (CSV → CurriculumUnit)', () => {
  beforeAll(async () => {
    await seedCurriculum(prisma, csvText);
  });

  it('parses quoted fields with embedded commas without shifting columns', () => {
    const byCode = new Map(rows.map((r) => [r.unitCode, r]));
    const l101 = byCode.get('UC-L1-01') as CurriculumRow;
    // Content is quoted because it contains commas ("Gum, Gum, Gummy") — must stay intact.
    expect(l101.content).toBe('Sách: Gum, Gum, Gummy | Play Kit: Bữa ăn phụ');
    expect(l101.theme).toBe('Bạn bè');
    expect(l101.sessions).toBe(4);
    expect(l101.orderGlobal).toBe(1);

    // Commas inside a quoted thinking-goal must not leak into the sessions/order columns.
    const l204 = byCode.get('UC-L2-04') as CurriculumRow;
    expect(l204.thinkingGoal).toContain('A=B,B=C');
    expect(l204.sessions).toBe(4);

    // A Bright row: quoted theme with a comma + "||" separator kept literally inside content.
    const t3 = byCode.get('IG-T3') as CurriculumRow;
    expect(t3.program).toBe('BRIGHT_IG');
    expect(t3.theme).toContain('những vì sao và tôi');
    expect(t3.content).toContain('||');
  });

  it('maps "Bright I.G" label to the BRIGHT_IG enum and tags REVIEW units', () => {
    const rev = rows.find((r) => r.unitCode === 'IG-J-REV') as CurriculumRow;
    expect(rev.program).toBe('BRIGHT_IG');
    expect(rev.unitType).toBe('REVIEW');
    expect(rev.assessment).toBe('Thi lên level');
  });

  it('creates one Course per level with the unit count + total sessions from the CSV', async () => {
    for (const [code, exp] of expectedByCourse()) {
      const course = await prisma.course.findUnique({
        where: { code },
        include: { units: true },
      });
      expect(course, `course ${code} should exist`).not.toBeNull();
      expect(course!.levelCode).toBeTruthy();
      expect(course!.units.length).toBe(exp.units);
      const sessionSum = course!.units.reduce((s, u) => s + u.sessions, 0);
      expect(sessionSum).toBe(exp.sessions);
    }
  });

  it('orders units by orderGlobal ascending within a course', async () => {
    const l1 = await prisma.course.findUniqueOrThrow({
      where: { code: courseCode('UCREA', 'L1') },
      include: { units: { orderBy: { orderGlobal: 'asc' } } },
    });
    const orders = l1.units.map((u) => u.orderGlobal);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    // The Bright review unit is the last (highest seqInLevel) in its level.
    const jRev = await prisma.curriculumUnit.findUniqueOrThrow({ where: { unitCode: 'IG-J-REV' } });
    const jUnits = await prisma.curriculumUnit.findMany({ where: { courseId: jRev.courseId } });
    expect(Math.max(...jUnits.map((u) => u.seqInLevel))).toBe(jRev.seqInLevel);
  });

  it('is idempotent: re-running the seed does not duplicate units or courses', async () => {
    const codes = [...expectedByCourse().keys()];
    const unitsBefore = await prisma.curriculumUnit.count();
    const coursesBefore = await prisma.course.count({ where: { code: { in: codes } } });
    await seedCurriculum(prisma, csvText);
    expect(await prisma.curriculumUnit.count()).toBe(unitsBefore);
    expect(await prisma.course.count({ where: { code: { in: codes } } })).toBe(coursesBefore);
  });
});
