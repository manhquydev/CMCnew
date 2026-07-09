import { PROGRAM_ORDER_INDEX, type ClassProgram } from '@cmc/domain-academic';

interface CourseLike {
  program: ClassProgram;
  levelCode: string | null;
  unitCount: number;
}

/**
 * Picks the default auto-selected course for Teacher Lite class creation.
 * Filters to courses with a seeded curriculum (unitCount > 0), then orders by
 * program priority [UCREA, BRIGHT_IG, BLACK_HOLE] and levelCode ascending —
 * NOT by course code (BRIGHT_IG-C < UCREA-L1 alphabetically, which previously
 * caused Bright to win over UCREA regardless of program intent).
 */
export function pickDefaultCourse<T extends CourseLike>(courses: T[]): T | null {
  const withCurriculum = courses.filter((c) => c.unitCount > 0);
  const sorted = [...withCurriculum].sort((a, b) => {
    const programDiff = PROGRAM_ORDER_INDEX[a.program] - PROGRAM_ORDER_INDEX[b.program];
    if (programDiff !== 0) return programDiff;
    return (a.levelCode ?? '').localeCompare(b.levelCode ?? '');
  });
  return sorted[0] ?? null;
}
