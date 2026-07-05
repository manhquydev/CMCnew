---
phase: 1
title: "Schema & Code Generation"
status: completed
priority: P1
dependencies: []
---

# Phase 1: Schema & Code Generation

## Overview

Doi khoa cua `BatchCodeCounter` tu `(facilityId, year)` sang
`(facilityId, program, year)`, them ham map `Program -> viet tat`, sua
`formatBatchCode`/`nextBatchCode` de nhan them tham so `program`, wire vao
`classBatch.create`.

## Requirements

- Functional:
  - Ma lop moi = `[Facility.code]-[UCR|BIG|BH]-[YY]-[seq:0000]`.
  - `Program -> viet tat`: `UCREA->UCR`, `BRIGHT_IG->BIG`, `BLACK_HOLE->BH`
    (constant map, khong can bang DB).
  - Counter reset moi nam, khoa theo `(facilityId, program, year)`. Bat dau
    tu 0 cho moi to hop moi — KHONG ke thua so dem cu (dimension `program`
    chua tung duoc track truoc day).
  - Lop da ton tai GIU NGUYEN ma `B-YYYY-NNNN` — khong backfill, khong doi.
- Non-functional:
  - Sinh ma phai atomic duoi concurrent create cho cung
    `(facility, program, year)` — dung lai co che advisory lock hien co,
    mo rong key de bao gom `program`.
  - Khong doi public contract cua `classBatch.create` input (client van chi
    gui facilityId/courseId/..., khong can them field moi — server tu suy ra
    `program` tu `course.program` da join san qua `courseId`).

## Architecture

- **Advisory lock key**: Postgres `pg_advisory_xact_lock` nhan toi da 2
  bigint (hoac 1 bigint). Hien tai dung `(facilityId, year)` — 2 int co san.
  Them chieu `program` (enum 3 gia tri) can 1 trong 2 cach:
  1. Encode `program` thanh so nho (0/1/2, thu tu enum) va nhet vao 1 trong 2
     slot bang cach ghep bit (vd `key2 = year * 10 + programIndex`) — giu 2
     tham so cho `pg_advisory_xact_lock(int, int)`.
  2. Hoac dung ham 1-tham-so `pg_advisory_xact_lock(bigint)` va tu hash
     `(facilityId, programIndex, year)` thanh 1 bigint (vd
     `facilityId * 1_000_000 + programIndex * 10_000 + year`).
  Chon cach (1) — don gian hon, khong can hash, de doc, it rui ro va cham
  (collision) hon vi khong nen key nhieu chieu vao 1 so nguyen lon.
  `key2 = year * 10 + programIndex` (programIndex 0/1/2, year < int32 an
  toan vi year ~2026 * 10 + 2 << int32 max).
- **Prisma migration**: `BatchCodeCounter` PK doi tu `[facilityId, year]`
  sang `[facilityId, program, year]`. Vi day la doi PK cua bang counter noi
  bo (khong co FK tham chieu tu bang khac, khong co du lieu nghiep vu quan
  trong ngoai so dem), migration co the DROP + CREATE lai bang (mat du lieu
  counter cu la CHAP NHAN DUOC vi lop cu da tao xong, khong can tiep tuc dem
  tiep tu so cu — dimension moi bat dau tu 0).

## Related Code Files

- Modify: `D:\project\CMCnew\packages\db\prisma\schema.prisma`
  — them `program Program` vao model `BatchCodeCounter`, doi
  `@@id([facilityId, year])` thanh `@@id([facilityId, program, year])`.
- Create: migration moi duoi `D:\project\CMCnew\packages\db\prisma\migrations\`
  (chay `pnpm --filter @cmc/db exec prisma migrate dev --name
  batch_code_counter_program_scope`).
- Modify: `D:\project\CMCnew\packages\domain-academic\src\code.ts`
  — them export `PROGRAM_CODE_ABBREV: Record<Program, string>` map
  (`UCREA: 'UCR'`, `BRIGHT_IG: 'BIG'`, `BLACK_HOLE: 'BH'`); doi
  `formatBatchCode(facilityCode, program, year, seq)` tra ve
  `${facilityCode}-${PROGRAM_CODE_ABBREV[program]}-${String(year).slice(-2)}-${String(seq).padStart(4,'0')}`.
  Giu nguyen overflow guard `seq > 9999`.
- Modify: `D:\project\CMCnew\apps\api\src\services\batch-code.ts`
  — `nextBatchCode` nhan them `program: Program` va `facilityCode: string`
  (hoac lookup facility trong ham); doi advisory-lock call thanh
  `pg_advisory_xact_lock($1::int, $2::int)` voi
  `$2 = year * 10 + PROGRAM_INDEX[program]`; upsert `batchCodeCounter` voi
  key composite `{ facilityId_program_year: { facilityId, program, year } }`.
- Modify: `D:\project\CMCnew\apps\api\src\routers\class-batch.ts`
  (`create` mutation, dong ~110-130) — sau khi resolve `courseId`, join
  them `course.program` (hien Course da duoc load qua relation, can
  `include: { course: { select: { program: true, ... } } }` hoac 1 query rieng
  truoc khi goi `nextBatchCode`); truyen `program` + `facility.code` (query
  `tx.facility.findUniqueOrThrow({ where: { id: input.facilityId },
  select: { code: true } })`) vao `nextBatchCode`.

## Implementation Steps

1. Sua `schema.prisma`: them field `program Program` vao `BatchCodeCounter`,
   doi composite PK. Chay `prisma migrate dev` de sinh migration file.
2. Them `PROGRAM_CODE_ABBREV` constant + `PROGRAM_ORDER_INDEX` (thu tu co dinh
   cho advisory-lock encoding) vao `packages/domain-academic/src/code.ts`.
   Sua `formatBatchCode` signature nhan `(facilityCode, program, year, seq)`.
3. Sua `nextBatchCode` trong `apps/api/src/services/batch-code.ts`: nhan them
   `program`, tinh `lockKey2 = year * 10 + PROGRAM_ORDER_INDEX[program]`, doi
   upsert key sang composite `(facilityId, program, year)`.
4. Sua `classBatch.create` (`class-batch.ts`): query `course.program` va
   `facility.code` truoc khi goi `nextBatchCode`; truyen dung tham so moi.
5. Chay `pnpm --filter @cmc/db exec prisma generate` de cap nhat Prisma
   Client types sau khi doi schema.

## Success Criteria

- [x] `BatchCodeCounter` co PK `(facilityId, program, year)` trong schema +
      migration da chay thanh cong tren dev DB.
- [x] `formatBatchCode('HQ', 'UCREA', 2026, 1)` tra ve `'HQ-UCR-26-0001'`.
- [x] `classBatch.create` voi course co `program = BRIGHT_IG` tai facility
      `CS2` nam 2026 sinh ma dang `CS2-BIG-26-000N`.
- [x] Tao 2 lop cung `(facility, program, year)` lien tiep → so TT tang dan
      khong trung (0001, 0002, ...).

<!-- Updated: Validation Session 1 - project not yet in production, no legacy
     class-code data to preserve; dropped backward-compat criterion. -->

## Risk Assessment

- **Advisory-lock key encoding sai** → 2 request concurrent cho khac
  `program` nhung vo tinh trung `lockKey2` se serialize khong can thiet (chi
  la mat hieu nang, KHONG mat tinh dung dan vi upsert van dung composite key
  rieng) — chap nhan duoc, uu tien dung + don gian hon toi uu perf.
- **Prisma PK migration tren bang co du lieu** — `BatchCodeCounter` la bang
  noi bo, it rows (1 row / facility+year hien tai), DROP+CREATE an toan. Nếu
  Prisma tu sinh migration dang ALTER thay vi DROP, kiem tra file migration
  truoc khi apply len prod (khong am tham chay migrate deploy chua review).
- **Quen update `prisma generate`** sau khi doi schema → TypeScript compile
  loi o moi noi dung `BatchCodeCounter` type — chay generate ngay sau migrate.
