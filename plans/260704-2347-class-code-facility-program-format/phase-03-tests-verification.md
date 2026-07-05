---
phase: 3
title: "Tests & Verification"
status: completed
priority: P1
dependencies: [1, 2]
---

# Phase 3: Tests & Verification

## Overview

Cap nhat test atomic hien co (`batch-code-atomicity.int.test.ts`) cho
signature + format moi cua `nextBatchCode`/`formatBatchCode`, chay full suite
lien quan de bat regression. Du an chua di vao van hanh (khong co du lieu lop
that trong prod) nen KHONG can test/backfill cho ma cu — xem
`## Validation Log` trong `plan.md`.

## Requirements

- Functional: moi assertion format `B-YYYY-NNNN` trong test hien co phai doi
  thanh `[FacilityCode]-[ProgramAbbrev]-[YY]-[NNNN]`.
- Non-functional: giu nguyen 3 invariant da test (unique / dung format /
  contiguous sequence) — chi doi regex + input params, khong bot test case.

## Architecture

Khong co kien truc moi — chi la cap nhat test theo API moi tu Phase 1.

## Related Code Files

- Modify: `D:\project\CMCnew\apps\api\test\batch-code-atomicity.int.test.ts`
  — cap nhat toan bo 3 test case:
  - `nextBatchCode(tx, FACILITY, DIRECT_TX_YEAR)` → them tham so `program`
    (dung `'UCREA'`) va `facilityCode` (query truoc hoac hardcode `'HQ'` —
    facility HQ da seed san, id=1).
  - Regex `^B-\d{4}-\d{4}$` → doi thanh
    `^HQ-UCR-\d{2}-\d{4}$` (hoac dong regex generic hon
    `^[A-Z0-9]+-(UCR|BIG|BH)-\d{2}-\d{4}$` de it fragile hon).
  - `counter.findUnique({ where: { facilityId_year: {...} } })` → doi thanh
    `facilityId_program_year: { facilityId, program: 'UCREA', year }`.
  - `afterAll` cleanup: `batchCodeCounter.delete` cung phai doi where-key
    sang composite moi.
- Reference (khong sua): `apps/api/test/class-create-initial-slot.int.test.ts`,
  `apps/api/test/class-batch-create-multislot.int.test.ts` — chay lai de bat
  regression tu viec doi `classBatch.create` (Phase 1 buoc 4).

## Implementation Steps

1. Sua `formatBatchCode` unit-level assertions (neu co unit test rieng cho
   `packages/domain-academic` — kiem tra `code.ts` co file test canh no,
   neu chua co thi them 1 test file nho `code.test.ts` voi vai case: viet
   tat dung cho ca 3 program, overflow guard van hoat dong, year duoc cat
   con 2 chu so dung).
2. Sua `batch-code-atomicity.int.test.ts` theo checklist "Related Code
   Files" o tren.
3. Chay: `pnpm --filter @cmc/api test batch-code-atomicity` va
   `pnpm --filter @cmc/api test class-create-initial-slot
   class-batch-create-multislot` — xac nhan xanh.
4. Chay `pnpm --filter @cmc/api test` full neu thoi gian cho phep (bat cac
   test khac co the dang assert format ma lop cu o cho khac chua duoc scout —
   grep lai `B-YYYY` / `B-\\d{4}` truoc khi coi phase nay xong).

## Success Criteria

- [x] `batch-code-atomicity.int.test.ts` xanh voi format + signature moi.
- [x] Khong con test nao con lai assert cung format `B-YYYY-NNNN` cho lop
      MOI tao sau khi trien khai (grep confirm).
- [x] `class-create-initial-slot` + `class-batch-create-multislot` van
      xanh (khong regression tu viec doi `classBatch.create`).

<!-- Updated: Validation Session 1 - dropped "old codes preserved" test;
     project has no legacy production data to preserve. -->

## Risk Assessment

- **Test khac ngoai pham vi da biet co the hardcode `B-` prefix** — grep
  rong `B-\d{4}-\d{4}` truoc khi dong phase de chac chan khong bo sot file
  test nao assert format cu cho lop MOI.
- **Seed data (`seed.ts`, `seed-demo.ts`) co the dang tao ClassBatch qua
  `nextBatchCode` truc tiep** — neu co, seed script cung can cap nhat call
  site (them `program`/`facilityCode`) de khong loi compile/runtime khi
  chay seed lai.
