---
title: "Chuan hoa ma lop hoc theo co so-chuong trinh-nam"
description: "Doi format ma lop tu B-YYYY-NNNN sang [Facility.code]-[UCR|BIG|BH]-[YY]-[seq]; counter khoa theo (facilityId, program, year); lop cu giu nguyen ma."
status: completed
priority: P2
branch: "develop"
tags: [backend, database, refactor]
blockedBy: []
blocks: []
created: "2026-07-04T16:55:54.549Z"
createdBy: "ck:plan"
source: skill
---

# Chuan hoa ma lop hoc theo co so-chuong trinh-nam

## Overview

Doi cach sinh ma lop hoc (`ClassBatch.code`) tu `B-{year}-{seq:0000}` sang
`[Facility.code]-[UCR|BIG|BH]-[YY]-[seq:0000]` (vd `HQ-UCR-26-0001`). Nguon
`Program` la enum co san (UCREA/BRIGHT_IG/BLACK_HOLE), khong dung `Course.code`.
Counter reset moi nam, khoa theo `(facilityId, program, year)` thay vi
`(facilityId, year)`.

Du an CHUA di vao van hanh (khong co du lieu lop that trong prod) — khong
can rang buoc backward-compat cho ma lop cu. Chuyen doi thang, khong can
giu/backfill ma cu.

Xem brainstorm goc: `plans/reports/brainstorm-260704-2347-class-code-facility-program-format-report.md`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Schema & Code Generation](./phase-01-schema-code-generation.md) | Completed |
| 2 | [Decision Doc & Wiring](./phase-02-decision-doc-wiring.md) | Completed |
| 3 | [Tests & Verification](./phase-03-tests-verification.md) | Completed |

## Dependencies

None. Doc noi bo (`BatchCodeCounter`, `formatBatchCode`, `nextBatchCode`,
`classBatch.create`) — khong dung vao plan dang chay khac.

## Acceptance Criteria

- Lop moi tao sau khi trien khai co ma dang `[FacilityCode]-[UCR|BIG|BH]-[YY]-[NNNN]`.
- Sinh ma dong thoi (concurrent create) cho cung (facility, program, year) khong
  bao gio trung ma — verify bang test atomic.
- `docs/decisions/0036-class-code-facility-program-format.md` ton tai, duoc
  index trong `docs/DECISION_INDEX.md`.

## Validation Log

### Session 1 — 2026-07-05

**Verification Pass (Standard tier, 3 phases):**
- Claims checked: 3 | Verified: 3 | Failed: 0 | Unverified: 0
- `receipt-code.ts:11` dung cung dang lock `(facilityId, year)` 2-int nhu
  `batch-code.ts` hien tai — doi key thu 2 sang `year*10+programIndex` tach
  batch-code khoi vo tinh serialize chung voi receipt-code (an toan, khong
  phai regression).
- Prisma compound key naming `facilityId_program_year` khop convention hien
  co (`facilityId_year`).
- Xac nhan lai: chi 4 file dung batch-code logic, khong co call site an
  trong seed script.

**Cau hoi & quyet dinh:**
1. Advisory-lock key encoding: **chon `year*10+programIndex`, giu dang
   2-tham-so `pg_advisory_xact_lock(int, int)`** (khong doi sang hash
   1-tham-so nhu `rewards.ts`/`shift-registration.ts` — giu nhat quan voi
   pattern hien tai cua `batch-code.ts`/`receipt-code.ts`).
2. **Du an chua di vao van hanh — khong co du lieu lop that trong prod.**
   Bo hoan toan yeu cau "giu nguyen ma cu" + test "old codes preserved" —
   khong can backward-compat, chuyen doi format thang (coi nhu hoan thien
   thiet ke truoc khi ship). Xem "Whole-Plan Consistency Sweep" ben duoi ve
   cac thay doi day chuyen o phase 1 va phase 3.

<!-- Updated: Validation Session 1 - removed old-code preservation requirement (no prod data exists) -->

### Whole-Plan Consistency Sweep

Sau quyet dinh #2 o tren, re-check toan bo plan + phase files:
- `plan.md` Overview + Acceptance Criteria: da sua, bo cau "giu nguyen ma cu"
  va bullet lien quan.
- `phase-01-schema-code-generation.md`: Success Criteria co 1 dong
  "Lop da ton tai truoc migration ... khong doi" — **da xoa** (khong con
  data cu de giu).
- `phase-03-tests-verification.md`: phan "Create (optional...)" mo ta test
  "old codes preserved" — **da xoa toan bo**, thay bang note ngan giai
  thich ly do khong can.
- Khong con noi nao khac trong plan nhac "giu ma cu"/"backward-compat"/
  "backfill". Sweep result: 0 unresolved contradiction.

## Completion Summary — 2026-07-05

All 3 phases implemented, reviewed, tested. Code-reviewer subagent: 0 findings.
Full API integration suite: 107 files / 594 tests pass. `@cmc/domain-academic`
+ `@cmc/api` typecheck clean. Migration
`20260705010000_batch_code_counter_program_scope` applied to dev DB
(TRUNCATE + ALTER, preserves existing RLS policy — verified by reviewer).
