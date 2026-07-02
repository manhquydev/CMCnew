---
phase: 1
title: "Data Model & Curriculum Seed"
status: done
priority: P1
dependencies: []
effort: "M"
---

# Phase 1: Data Model & Curriculum Seed

## Overview
Thêm model `CurriculumUnit` (global) + `UnitType` enum, gắn `Course.levelCode` và
`ClassSession.curriculumUnitId` (nullable). Đưa CSV vào codebase + importer seed đúng số unit/buổi,
map `Program "Bright I.G" → BRIGHT_IG`, upsert idempotent. **Course theo từng level** (quyết định user).

## Requirements
- Functional: **Course per (program, level)** — tạo UCREA-L1/L2/L3 + BRIGHT_IG-J/T/C/W/Q/U; mỗi Course có `levelCode`; unit link Course theo level.
- Functional: seed 60 unit gắn đúng Course; re-run seed không nhân bản (upsert theo `unitCode` + Course `code`).
- Functional: **reconcile course cũ** — seed-demo hiện tạo `UCREA-01/BIG-01/BH-01` (1/chương trình). Cập nhật seed-demo bind demo batch sang course/level mới; archive (soft) course generic cũ để không hiện 2 họ course ở wizard.
- Non-functional: migration thuần additive (bảng mới + cột nullable) → không phá dữ liệu/lớp hiện có.

## Architecture
```prisma
enum UnitType { LESSON REVIEW }

model CurriculumUnit {
  id            String    @id @default(uuid()) @db.Uuid
  courseId      String    @map("course_id") @db.Uuid
  course        Course    @relation(fields: [courseId], references: [id])
  unitCode      String    @unique @map("unit_code")   // UC-L1-01
  seqInLevel    Int       @map("seq_in_level")
  orderGlobal   Int       @map("order_global")
  unitType      UnitType  @map("unit_type")
  assessment    String?
  theme         String                                  // chu_de
  content       String?                                 // noi_dung (sách | play kit)
  thinkingGoal  String?   @map("thinking_goal")         // tu_duy_dat_duoc (LMS có thể hiển thị)
  sessions      Int
  createdAt     DateTime  @default(now()) @map("created_at")
  classSessions ClassSession[]
  @@index([courseId, orderGlobal])
  @@map("curriculum_unit")
}
// Course      += levelCode String? @map("level_code") ; units CurriculumUnit[]
// ClassSession += curriculumUnitId String? @map("curriculum_unit_id") @db.Uuid
//                curriculumUnit CurriculumUnit? @relation(fields:[curriculumUnitId],references:[id],onDelete:SetNull)
```
- **Bỏ cột `durationMonth`, `archivedAt`** (red-team: R3 read-only, không có luồng archive → YAGNI). Giữ `seqInLevel` (rẻ, hiển thị số thứ tự trong level).
- CSV → `packages/db/prisma/seed-data/curriculum_units_seed.csv`.
- Program map: `UCREA→UCREA`, `Bright I.G→BRIGHT_IG` (enum verified `schema.prisma:30-33`). Course code: `UCREA-L1`, `BRIGHT_IG-J`, …
- **RLS (red-team fix — premise cũ sai):** `course` KHÔNG có RLS policy — nó **tắt RLS**, đọc được nhờ `GRANT SELECT` + `ALTER DEFAULT PRIVILEGES` (`20260623045316_rls_tenancy/migration.sql:15-20`; loop tenancy loại trừ course ở `20260623071949_phase1_academic_core/migration.sql:263-276`). → **KHÔNG `ENABLE ROW LEVEL SECURITY` trên `curriculum_unit`**; để global như course (default GRANT tự kế thừa). `curriculum_unit` không có `facility_id`.
- **Invariant ghi lại:** vì global table không có RLS backstop, MỌI mutation `curriculum.*` tương lai PHẢI gate app-layer bằng permission (vd `giam_doc_dao_tao`) — như tiền lệ `app_user` (`permissions.ts:231-232`).

## Related Code Files
- Create: `packages/db/prisma/seed-data/curriculum_units_seed.csv` (**land trước, làm nguồn số liệu test**)
- Create: `packages/db/src/seed-curriculum.ts` (importer + parser CSV quote-aware; script `seed:curriculum`)
- Create: `packages/db/prisma/migrations/<ts>_curriculum_unit/migration.sql`
- Create: `packages/db/test/seed-curriculum.test.ts`
- Modify: `packages/db/prisma/schema.prisma` (CurriculumUnit, UnitType, Course.levelCode+units, ClassSession.curriculumUnitId+relation)
- Modify: `packages/db/src/seed-demo.ts` (rebind demo batch sang course/level mới; archive course generic cũ)
- Modify: `packages/db/package.json` (script `seed:curriculum`)

## Tests First (TDD)
1. `seed-curriculum.test.ts` (DB test) — **đếm suy ra từ CSV, không hard-code magic number** (red-team #4):
   - Parse CSV → `expectedRows`, group theo (program, level) → `expectedCoursesUnits`. Sau seed, DB khớp count từng course + tổng `Σ sessions`.
   - REVIEW rows (`unit_type=REVIEW`) → `unitType=REVIEW`; `assessment` giữ nguyên text.
   - Chạy importer 2 lần → tổng `curriculumUnit` không đổi (idempotent upsert).
   - `Program "Bright I.G"` → enum `BRIGHT_IG` (không throw).
   - **Parser biên field:** unit có nội dung chứa dấu phẩy trong ngoặc kép + `|`/`||` (vd `UC-L1-01`) → `theme/content/sessions/orderGlobal` không lệch cột.
2. Đỏ trước khi viết importer.

## Implementation Steps
1. Land CSV vào `seed-data/`.
2. Viết test (đỏ) — đọc CSV làm nguồn kỳ vọng + case biên field.
3. Sửa `schema.prisma`; `prisma migrate dev` sinh migration; **kiểm SQL KHÔNG có `ENABLE ROW LEVEL SECURITY` cho curriculum_unit**; additive.
4. Viết `seed-curriculum.ts`: parser CSV quote-aware (state-machine có test, hoặc thêm dep `csv-parse` nhỏ — repo hiện KHÔNG có parser nào, `package.json` không có csv); upsert Course per level (set `levelCode`) rồi upsert CurriculumUnit (theo `unitCode`).
5. Cập nhật `seed-demo.ts` rebind + archive legacy course; thêm script `seed:curriculum`; chạy → xanh.

## Success Criteria
- [ ] Test seed xanh (count suy từ CSV; idempotent; map program; parser biên field đúng).
- [ ] Migration additive, `curriculum_unit` KHÔNG bật RLS (global như course); build/prisma validate pass.
- [ ] `seed:curriculum` chạy sạch trên DB dev; wizard chỉ thấy 1 họ course/level (không trùng legacy).

## Risk Assessment
- **Prod có lớp bind course generic cũ** (`UCREA-01`…): trước khi archive legacy, kiểm ClassBatch/Receipt đang trỏ tới; nếu có → migrate binding hoặc giữ legacy `archivedAt`=null tới khi rà xong. Ghi rõ ở PR.
- Enum `BLACK_HOLE` không có curriculum → hợp lệ (không seed unit).
- Cross-plan: `schema.prisma` block `ClassSession` cũng bị `lms-climb-session-lock` sửa (thêm `exercises`/`classSessionId`) → phối hợp thứ tự sửa file (xem plan.md Dependencies).
