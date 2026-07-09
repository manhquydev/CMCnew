import { PrismaClient, ExerciseType, ExerciseStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_STORE_DIR = process.env.PDF_STORE_DIR
  ?? path.resolve(__dirname, '../../api/.data/pdf');
const HOC_LIEU_DIR = process.env.HOC_LIEU_DIR
  ?? path.resolve(__dirname, '../../../hoc_lieu/3-4 tuổi');

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

async function main() {
  const course = await prisma.course.findFirst({
    where: { program: 'UCREA', levelCode: 'L1' },
  });
  if (!course) {
    console.error('UCREA L1 course not found — run seed:curriculum first');
    process.exit(1);
  }

  const lessons = await prisma.curriculumLesson.findMany({
    where: { courseId: course.id },
    orderBy: { orderGlobal: 'asc' },
    include: { curriculumUnit: { select: { id: true } } },
  });

  const files = (await readdir(HOC_LIEU_DIR))
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort((a, b) => a.localeCompare(b, 'vi'));

  const count = Math.min(files.length, lessons.length);
  if (count === 0) {
    console.log('No PDFs or lessons to seed');
    return;
  }

  await mkdir(PDF_STORE_DIR, { recursive: true });

  let created = 0;
  let updated = 0;

  for (let i = 0; i < count; i++) {
    const fileName = files[i]!;
    const lesson = lessons[i]!;
    const pdfPath = path.join(HOC_LIEU_DIR, fileName);
    const buf = await readFile(pdfPath);
    const ref = createHash('sha256').update(buf).digest('hex');
    const title = path.basename(fileName, '.pdf');

    const storePath = path.join(PDF_STORE_DIR, `${ref}.pdf`);
    try {
      await access(storePath, constants.F_OK);
    } catch {
      await writeFile(storePath, buf);
    }

    const existing = await prisma.exercise.findUnique({
      where: {
        curriculumLessonId_type: {
          curriculumLessonId: lesson.id,
          type: ExerciseType.homework,
        },
      },
    });

    if (existing) {
      await prisma.exercise.update({
        where: { id: existing.id },
        data: { basePdfRef: ref, title, status: ExerciseStatus.published },
      });
      updated++;
    } else {
      await prisma.exercise.create({
        data: {
          title,
          basePdfRef: ref,
          curriculumLessonId: lesson.id,
          curriculumUnitId: lesson.curriculumUnit.id,
          type: ExerciseType.homework,
          status: ExerciseStatus.published,
        },
      });
      created++;
    }

    console.log(`  [${i + 1}/${count}] ${title} → lesson ${lesson.lessonCode}`);
  }

  console.log(`\nDone: ${created} created, ${updated} updated, ${files.length - count} skipped (no matching lesson)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
