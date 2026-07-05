---
phase: 2
title: "Decision Doc & Wiring"
status: completed
priority: P2
dependencies: [1]
---

# Phase 2: Decision Doc & Wiring

## Overview

Ghi lai quyet dinh doi format ma lop vao `docs/decisions/` (bat buoc theo
`FEATURE_INTAKE.md` vi day la thay doi data model + hanh vi cong khai da co),
index vao `docs/DECISION_INDEX.md` de Decision Lookup Hard Rule bat duoc lan
sau ai do sua `code.ts`/`batch-code.ts`/`BatchCodeCounter`.

## Requirements

- Decision doc so `0036` (so tiep theo sau `0035`, xem
  `docs/DECISION_INDEX.md` dong 15-17).
- Index row tro dung 3 file: `packages/domain-academic/src/code.ts`,
  `apps/api/src/services/batch-code.ts`, `schema.prisma` (model
  `BatchCodeCounter`).
- Khong sua/xoa cac decision doc khac.

## Architecture

Khong co thay doi kien truc o phase nay — chi la doc + index, dung template
co san `docs/templates/decision.md`.

## Related Code Files

- Create: `D:\project\CMCnew\docs\decisions\0036-class-code-facility-program-format.md`
- Modify: `D:\project\CMCnew\docs\DECISION_INDEX.md` — them 1 row moi vao
  bang chinh (sau dong `0035`, truoc cac dong "harness process" khong lien
  quan code).

## Implementation Steps

1. Copy `docs/templates/decision.md`, dien:
   - Title: "Class code format: [Facility.code]-[program abbrev]-[YY]-[seq]"
   - Context: tom tat tu brainstorm report (§1-2 cua
     `plans/reports/brainstorm-260704-2347-class-code-facility-program-format-report.md`).
   - Decision: format cuoi cung (§4 brainstorm report) + 3 quyet dinh chinh
     (nguon Program enum, reset theo nam, giu ma cu).
   - Alternatives Considered: Course.code lam nguon (bi loai vi chua chuan
     hoa); khong nhung nam (bi loai vi rui ro trung hinh thuc); backfill ma
     cu (bi loai — khong can thiet, rui ro pha vo tham chieu cu).
   - Consequences: Positive (ma lop de doc, phan biet ro co so + chuong
     trinh + nam); Tradeoffs (2 dinh dang ma lop song song trong he thong —
     lop cu `B-YYYY-NNNN`, lop moi `[FC]-[PC]-[YY]-[NNNN]` — nguoi dung can
     hieu ca 2).
   - Follow-Up: neu sau nay chuan hoa `Course.code`, co the can 1 quyet dinh
     rieng ve co doi nguon ma chuong trinh sang Course.code hay khong.
   - Status: Accepted.
2. Them row vao `docs/DECISION_INDEX.md` theo dung format bang hien co
   (cot: Module/File pattern | Rule 1 dong | Decision doc | Status).

## Success Criteria

- [x] `docs/decisions/0036-class-code-facility-program-format.md` ton tai,
      dung template, Status = Accepted.
- [x] `docs/DECISION_INDEX.md` co 1 row moi tro dung file, khong sua/xoa row
      khac.

## Risk Assessment

- Rui ro thap — thuan doc. Chi can dam bao khong ghi de len row `0035` hoac
  cac row khac khi edit file index (dung Edit voi old_string cu the, khong
  Write toan bo file).
