import { PrismaClient, Program, UnitType } from '@prisma/client';
import nodeFs from 'node:fs';
import nodeUrl from 'node:url';
import nodePath from 'node:path';

/**
 * Seeds the hard-coded curriculum framework from curriculum_units_seed.csv.
 * Creates one Course per (program, level) and one CurriculumUnit per CSV row.
 * Idempotent: upserts by Course.code / CurriculumUnit.unitCode, so re-running never duplicates.
 */

/** Default CSV location, resolved relative to this source file (src → ../prisma/seed-data). */
export function defaultCsvPath(): string {
  const here = nodePath.dirname(nodeUrl.fileURLToPath(import.meta.url));
  return nodePath.resolve(here, '../prisma/seed-data/curriculum_units_seed.csv');
}

/**
 * RFC-4180-style parser: quote-aware so a field like "Sách: Gum, Gum, Gummy | Play Kit: ..."
 * keeps its embedded commas, and "" inside a quoted field is a literal quote. The "|" / "||"
 * separators used inside curriculum text are ordinary characters here — never delimiters.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      pushField();
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush a trailing line that has no closing newline.
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

/** CSV program label → Prisma enum. Only the two framework programs appear in the CSV. */
const PROGRAM_BY_LABEL: Record<string, Program> = {
  UCREA: Program.UCREA,
  'Bright I.G': Program.BRIGHT_IG,
};

/** Human-facing program name used to build a Course display name. */
const PROGRAM_DISPLAY: Record<Program, string> = {
  UCREA: 'UCREA',
  BRIGHT_IG: 'Bright I.G',
  BLACK_HOLE: 'Black Hole',
};

export interface CurriculumRow {
  unitCode: string;
  program: Program;
  levelCode: string;
  seqInLevel: number;
  orderGlobal: number;
  unitType: UnitType;
  assessment: string | null;
  theme: string;
  content: string | null;
  thinkingGoal: string | null;
  sessions: number;
}

const nullIfBlank = (v: string): string | null => (v.trim() === '' ? null : v);

/** Parse CSV text into typed rows, mapping columns by header name (order-independent). */
export function parseCurriculumRows(csvText: string): CurriculumRow[] {
  const table = parseCsv(csvText).filter((r) => r.some((c) => c.trim() !== ''));
  const header = (table[0] ?? []).map((h) => h.trim());
  if (header.length === 0) return [];
  const col = (name: string): number => {
    const idx = header.indexOf(name);
    if (idx === -1) throw new Error(`curriculum CSV missing column: ${name}`);
    return idx;
  };
  const ci = {
    unitCode: col('unit_code'),
    program: col('program'),
    levelCode: col('level_code'),
    seqInLevel: col('seq_in_level'),
    unitType: col('unit_type'),
    assessment: col('assessment'),
    theme: col('chu_de'),
    content: col('noi_dung'),
    thinkingGoal: col('tu_duy_dat_duoc'),
    sessions: col('sessions'),
    orderGlobal: col('order_global'),
  };
  return table.slice(1).map((r) => {
    const cell = (idx: number): string => r[idx] ?? '';
    const label = cell(ci.program).trim();
    const program = PROGRAM_BY_LABEL[label];
    if (!program) throw new Error(`curriculum CSV unknown program: "${label}"`);
    const unitType = cell(ci.unitType).trim() as UnitType;
    if (unitType !== UnitType.LESSON && unitType !== UnitType.REVIEW) {
      throw new Error(`curriculum CSV unknown unit_type: "${cell(ci.unitType)}"`);
    }
    return {
      unitCode: cell(ci.unitCode).trim(),
      program,
      levelCode: cell(ci.levelCode).trim(),
      seqInLevel: Number(cell(ci.seqInLevel)),
      orderGlobal: Number(cell(ci.orderGlobal)),
      unitType,
      assessment: nullIfBlank(cell(ci.assessment)),
      theme: cell(ci.theme),
      content: nullIfBlank(cell(ci.content)),
      thinkingGoal: nullIfBlank(cell(ci.thinkingGoal)),
      sessions: Number(cell(ci.sessions)),
    };
  });
}

/** Course code + display name derived from a (program, level) pair. */
export function courseCode(program: Program, levelCode: string): string {
  return `${program}-${levelCode}`;
}
function courseName(program: Program, levelCode: string): string {
  return `${PROGRAM_DISPLAY[program]} — Level ${levelCode}`;
}

export interface SeedCurriculumResult {
  courses: number;
  units: number;
}

/**
 * Upsert Courses (one per program+level) then CurriculumUnits. Idempotent.
 * Accepts an injected client so integration tests can drive it on the shared test DB.
 */
export async function seedCurriculum(
  client: PrismaClient,
  csvText: string = nodeFs.readFileSync(defaultCsvPath(), 'utf8'),
): Promise<SeedCurriculumResult> {
  const rows = parseCurriculumRows(csvText);

  // One Course per (program, level).
  const byCourse = new Map<string, { program: Program; levelCode: string }>();
  for (const r of rows) {
    byCourse.set(courseCode(r.program, r.levelCode), {
      program: r.program,
      levelCode: r.levelCode,
    });
  }
  const courseIdByCode = new Map<string, string>();
  for (const [code, meta] of byCourse) {
    const course = await client.course.upsert({
      where: { code },
      update: { name: courseName(meta.program, meta.levelCode), program: meta.program, levelCode: meta.levelCode },
      create: { code, name: courseName(meta.program, meta.levelCode), program: meta.program, levelCode: meta.levelCode },
    });
    courseIdByCode.set(code, course.id);
  }

  for (const r of rows) {
    const courseId = courseIdByCode.get(courseCode(r.program, r.levelCode))!;
    const data = {
      courseId,
      seqInLevel: r.seqInLevel,
      orderGlobal: r.orderGlobal,
      unitType: r.unitType,
      assessment: r.assessment,
      theme: r.theme,
      content: r.content,
      thinkingGoal: r.thinkingGoal,
      sessions: r.sessions,
    };
    await client.curriculumUnit.upsert({
      where: { unitCode: r.unitCode },
      update: data,
      create: { unitCode: r.unitCode, ...data },
    });
  }

  return { courses: byCourse.size, units: rows.length };
}

// ── CLI entrypoint ───────────────────────────────────────────────────────────
// Runs only when executed directly (tsx src/seed-curriculum.ts), never on import.
const isMain = process.argv[1] && nodeUrl.fileURLToPath(import.meta.url) === nodePath.resolve(process.argv[1]);
if (isMain) {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
  });
  seedCurriculum(prisma)
    .then((r) => console.log(`✓ Curriculum seed: ${r.courses} khóa (theo level), ${r.units} unit`))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
