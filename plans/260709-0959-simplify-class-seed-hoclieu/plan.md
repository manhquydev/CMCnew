---
title: "Đơn giản hóa tạo lớp + Seed học liệu UCREA L1"
description: "Auto-gán UCREA L1 khi tạo lớp (bỏ dropdown course) + seed 21 PDF từ hoc_lieu/3-4 tuổi vào Exercise"
status: done
priority: P2
effort: 2h
branch: develop
tags: [class-creation, curriculum, seed, exercise]
created: 2026-07-09
---

# Đơn giản hóa tạo lớp + Seed học liệu UCREA L1

## Brainstorm

[Brainstorm report](../reports/brainstorm-260709-0959-simplify-class-creation-seed-hoclieu-report.md)

## Phases

| # | Phase | Est | Status | File |
|---|-------|-----|--------|------|
| 1 | Simplify class creation UI | 30m | done | [phase-01](phase-01-simplify-class-creation.md) |
| 2 | Seed exercise PDFs | 1h30m | done | [phase-02](phase-02-seed-exercise-pdfs.md) |

## Dependencies

- UCREA L1 curriculum must be seeded first (`pnpm --filter @cmc/db seed:curriculum`)
- PDF files must exist at `hoc_lieu/3-4 tuổi/` (21 files confirmed)

## Acceptance Criteria

1. CreateClassModal no longer shows course dropdown — auto-selects UCREA L1
2. Curriculum preview still renders for auto-selected course
3. End-date auto-estimate still works
4. 21 Exercise records exist linked to first 21 CurriculumLessons of UCREA L1
5. Each Exercise has `basePdfRef` pointing to content-addressed PDF in store
6. Seed script is idempotent (re-run safe)
7. `pnpm --filter @cmc/db seed:exercises` runs without error

## Validation Summary

**Validated:** 2026-07-09
**Questions asked:** 4

### Confirmed Decisions

- **Scope L2+**: Bỏ dropdown OK, khi cần L2+ sẽ thêm lại UI lúc đó. Hiện tại chỉ dạy L1.
- **Exercise status**: Seed với `status: published` — học sinh thấy bài tập ngay, giáo viên không cần bật tay.
- **PDF store path**: Dùng env `PDF_STORE_DIR`, fallback local dev path. Prod set env riêng.
- **Upsert behavior**: Ghi đè nếu đã tồn tại — seed data là source of truth cho học liệu chuẩn.

### Action Items

- [ ] Phase 02: đổi `status: 'draft'` → `status: 'published'` trong Exercise upsert
