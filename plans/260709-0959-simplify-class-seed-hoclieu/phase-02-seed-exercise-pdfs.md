# Phase 02: Seed Exercise PDFs

## Context

- Parent: [plan.md](plan.md)
- Depends on: Phase 01 (not blocking — independent)
- Brainstorm: [report](../reports/brainstorm-260709-0959-simplify-class-creation-seed-hoclieu-report.md)

## Overview

- **Date:** 2026-07-09
- **Priority:** P2
- **Effort:** 1h30m
- **Status:** pending
- **Review:** pending

## Key Insights

- Exercise model: `curriculumLessonId` (FK), `basePdfRef` (sha256 hash), `title`, `type` (default: homework), `status` (default: draft)
- Unique constraint: `@@unique([curriculumLessonId, type])` — one exercise per lesson per type
- PDF store: content-addressed via sha256, `putPdf(ref, buf)` in `apps/api/src/services/pdf-store.ts`
- Disk driver default: `.data/pdf/{ref}.pdf`
- UCREA L1 has 12 units × 4 sessions = 48 CurriculumLessons (orderGlobal 1→48 within L1)
- 21 PDFs in `hoc_lieu/3-4 tuổi/` — map to first 21 lessons (alphabet sort → sequential)

## Requirements

1. Create seed script at `packages/db/src/seed-exercises.ts`
2. Read 21 PDFs from `hoc_lieu/3-4 tuổi/`, sorted alphabetically
3. For each PDF: compute sha256, write to PDF store dir, create Exercise record
4. Link each Exercise to CurriculumLesson by orderGlobal (1→21) within UCREA L1
5. Exercise status: `published` (validated — học sinh thấy ngay, không cần bật tay)
6. Upsert: ghi đè nếu đã tồn tại (seed = source of truth cho học liệu chuẩn)
6. Add `seed:exercises` script to `packages/db/package.json`

## Related Code Files

| File | Role |
|------|------|
| `packages/db/src/seed-curriculum.ts` | Pattern reference — existing seed script |
| `packages/db/prisma/schema.prisma` L673-693 | Exercise model definition |
| `apps/api/src/services/pdf-store.ts` | Content-addressed PDF storage |
| `packages/db/package.json` | Add new script entry |
| `hoc_lieu/3-4 tuổi/*.pdf` | Source PDFs (21 files) |

## Architecture

```
seed-exercises.ts
  ├── Read PDFs from disk (sorted alphabetically)
  ├── For each PDF:
  │   ├── sha256(buffer) → ref
  │   ├── Write buffer to .data/pdf/{ref}.pdf (direct disk, not via API)
  │   └── prisma.exercise.upsert({ curriculumLessonId, type: 'homework' })
  └── Report: created N, skipped M
```

The seed runs in `packages/db/` context but needs to write PDFs to the API's `.data/pdf/` dir. Use env `PDF_STORE_DIR` or default to `../../apps/api/.data/pdf` relative to script.

## Implementation Steps

### Step 1: Create seed-exercises.ts

```ts
// packages/db/src/seed-exercises.ts
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
```

Key logic:
1. Find UCREA L1 course: `prisma.course.findFirst({ where: { program: 'UCREA', levelCode: 'L1' } })`
2. Get first 21 CurriculumLessons ordered by `orderGlobal ASC`
3. Read PDF dir, sort filenames alphabetically, take first 21
4. For each (pdf, lesson) pair:
   - `buf = readFile(pdfPath)`
   - `ref = sha256(buf).toString('hex')`
   - Write to `{PDF_STORE_DIR}/{ref}.pdf` (skip if exists)
   - `prisma.exercise.upsert({ where: { curriculumLessonId_type: { curriculumLessonId: lesson.id, type: 'homework' } }, create: { title, basePdfRef: ref, curriculumLessonId, curriculumUnitId: lesson.curriculumUnitId, type: 'homework', status: 'draft' }, update: { basePdfRef: ref, title } })`

### Step 2: Handle PDF store path

```ts
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_STORE_DIR = process.env.PDF_STORE_DIR
  ?? path.resolve(__dirname, '../../api/.data/pdf');
const HOC_LIEU_DIR = path.resolve(__dirname, '../../../hoc_lieu/3-4 tuổi');
```

### Step 3: Add package.json script

```json
"seed:exercises": "tsx src/seed-exercises.ts"
```

### Step 4: Add export to package.json

```json
"./seed-exercises": "./src/seed-exercises.ts"
```

## PDF → Lesson Mapping (Alphabet Sort)

| # | PDF Filename | Lesson orderGlobal |
|---|-------------|-------------------|
| 1 | 1 nửa hoàn hảo - Phương tiện.pdf | 1 |
| 2 | 1 Phần và Toàn bộ.pdf | 2 |
| 3 | Ai là ai thế nhỉ.pdf | 3 |
| 4 | Con gì ăn cái gì.pdf | 4 |
| 5 | Đếm & Tổng hợp số phạm vi 10.pdf | 5 |
| 6 | Đếm & Tổng hợp số.pdf | 6 |
| 7 | Đếm Tổng hợp lượng.pdf | 7 |
| 8 | Đếm tổng hợp màu sắc.pdf | 8 |
| 9 | Hình học cơ bản.pdf | 9 |
| 10 | Luyện nét cơ bản 2.pdf | 10 |
| 11 | Luyện nét cơ bản.pdf | 11 |
| 12 | Màu sắc tương ứng bóng đá.pdf | 12 |
| 13 | Màu sắc tương ứng.pdf | 13 |
| 14 | Nối hình tương ứng.pdf | 14 |
| 15 | Phân loại phương tiện giao thông.pdf | 15 |
| 16 | Số liền trước liền sau.pdf | 16 |
| 17 | Tìm hình bóng chủ đề Giáng sinh.pdf | 17 |
| 18 | Tìm hình bóng.pdf | 18 |
| 19 | Tìm hình phù hợp - Chủ đề giáng sinh.pdf | 19 |
| 20 | Tư duy thị giác.pdf | 20 |
| 21 | Tư duy tổng hợp.pdf | 21 |

## Todo

- [ ] Create `packages/db/src/seed-exercises.ts`
- [ ] Add `seed:exercises` script to `packages/db/package.json`
- [ ] Test: run `pnpm --filter @cmc/db seed:exercises` on dev
- [ ] Verify: 21 Exercise records in DB with basePdfRef
- [ ] Verify: 21 PDF files in `.data/pdf/` directory

## Success Criteria

1. `pnpm --filter @cmc/db seed:exercises` completes without error
2. 21 Exercise records in DB linked to UCREA L1 lessons 1-21
3. Each Exercise has valid `basePdfRef` (64-char hex sha256)
4. PDF files exist in store directory
5. Re-running script produces no duplicates (idempotent)
6. Exercises visible in admin UI course exercise manager

## Risk Assessment

- **Low**: self-contained seed script, no schema changes
- File `Tư duy tổng hợp.pdf` is 17MB — within 20MB limit
- Vietnamese filenames with diacritics — Node.js handles UTF-8 natively on Windows

## Security Considerations

- PDFs are educational worksheets, no sensitive data
- Content-addressed store prevents path traversal (sha256 hex only)

## Next Steps

After both phases: verify in browser → commit
