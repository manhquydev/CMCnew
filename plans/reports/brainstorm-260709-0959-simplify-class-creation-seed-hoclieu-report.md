# Brainstorm: Đơn giản hóa tạo lớp + Seed học liệu UCREA L1

**Date:** 2026-07-09
**Status:** Approved → Plan next
**Scope:** tiny (2 bounded changes, low risk)

## Problem

1. Tạo lớp hiện tại yêu cầu chọn course từ dropdown (L1–L5) — phức tạp không cần thiết khi mọi lớp mới đều bắt đầu từ L1.
2. 21 file PDF học liệu 3-4 tuổi nằm ngoài hệ thống (`hoc_lieu/3-4 tuổi/`), giáo viên phải upload tay từng file.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Auto-gán UCREA L1 khi tạo lớp, bỏ dropdown course | Mọi lớp mới bắt đầu L1; flow "lên khóa" xử lý sau |
| 2 | Seed 21 PDF → 21 Exercise liên kết 21 lesson đầu UCREA L1 | Alphabet sort → sequential mapping |
| 3 | Mapping: alphabet A→Z → lesson orderGlobal 1→21 | User confirmed, sẽ review sau trong UI |

## Approach

### Task 1: Simplify class creation
- File: `apps/admin/src/class-workspace.tsx` (CreateClassModal)
- Remove `courseId` state + Select dropdown
- Auto-resolve: lấy course đầu tiên có `unitCount > 0` sorted by `levelCode ASC` (= L1)
- API call giữ nguyên, chỉ truyền courseId tự động
- Fallback: nếu không có course nào có curriculum → hiện thông báo "Chưa có khung chương trình"

### Task 2: Seed học liệu PDF
- Script: `packages/db/src/seed-exercises.ts` (new)
- Flow: read 21 PDFs from disk → upload via pdf-store → create Exercise records
- Each Exercise: title = filename (sans .pdf), basePdfRef = SHA256 hash, curriculumLessonId = lesson by orderGlobal
- Idempotent: skip if Exercise with same title + lessonId exists
- Run via: `pnpm --filter @cmc/db seed:exercises` (add script to package.json)

## Files

| File | Action |
|------|--------|
| `apps/admin/src/class-workspace.tsx` | Edit: remove course dropdown, auto-assign L1 |
| `packages/db/src/seed-exercises.ts` | Create: seed script |
| `packages/db/package.json` | Edit: add seed:exercises script |

## Risks

- PDF mapping alphabet không khớp ý → mitigated: user sẽ reorder trong UI
- Course L1 chưa seed → mitigated: fallback message
- PDF > 20MB → 1 file (17MB) trong giới hạn, OK

## Next

→ `/ck:plan` to create implementation plan
