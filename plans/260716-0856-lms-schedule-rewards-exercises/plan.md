---
title: "LMS: hide schedule, gift photos+upload+seed, exercises upcoming UX"
description: ""
status: pending
priority: P2
branch: "develop"
tags: []
blockedBy: []
blocks: []
created: "2026-07-16T02:25:47.757Z"
createdBy: "ck:plan"
source: skill
---

# LMS: hide schedule, gift photos+upload+seed, exercises upcoming UX

## Overview

Ba yêu cầu LMS độc lập, làm test-first (TDD) để giữ nguyên hành vi hiện có:

1. **Ẩn `/#schedule`** cho HS + PH (nav + hash guard, cả hai shell).
2. **Đổi quà**: backend/UI quản lý đã có (chỉ `giam_doc_kinh_doanh`), NHƯNG LMS **chưa render `imageUrl`** (student-view.tsx:944-983). Bổ sung: content-addressed store (mirror **pdf-store.ts** — có driver disk|s3 thật), endpoint upload/serve ảnh quà, file-picker upload trong panel admin, **render ảnh trong LMS (student + parent)**, seed 21 quà (`sao = số-trong-tên × 5`) cho toàn bộ facility.
3. **UX `/#exercises`** (PA A): hiện ≤2 node "sắp tới" khóa mờ (**payload chỉ `upcomingCount`, không id/tên**), auto-scroll tới bài current, empty-state thân thiện.

**Nguồn:** `plans/reports/lms-schedule-rewards-exercises-260716-0856-lms-3-features-report.md`

**Lane intake:** **High-risk** — sau red-team: Phase 5 thêm migration `@@unique` (data-model hard gate) + seed prod toàn cơ sở. Cần xác nhận người dùng trước khi chạy prod.

## Governing Decisions (KHÔNG vi phạm)

- **0038-session-level-exercises**: "Exercise visibility derive from **ended** ClassSession — students only see work for lessons their class actually finished." → Phase 5 PA A **tuân thủ**: node upcoming KHÔNG truyền title/desc/pdf ra client, không mở nộp được. Không sửa quyết định.
- **0040 / RLS+audit**: mọi write mới (upload ảnh quà) tái dùng permission `rewards.giftCreate/giftUpdate` (actor `giam_doc_kinh_doanh`), KHÔNG thêm permission mới, giữ audit.

## Đã chốt (câu hỏi mở → quyết định)

| Câu hỏi | Chốt |
|---------|------|
| facilityId prod | Seed enumerate `facility.findMany()` runtime (client **owner/`DIRECT_URL`** bypass RLS như seed-lms.ts); assert `>0` else throw |
| Store ảnh quà | Mirror **pdf-store.ts** (`GIFT_PHOTO_STORE_DRIVER` disk\|s3 thật — KHÔNG mirror photo-store.ts vì chỉ disk); prod driver=s3 hoặc bind-mount ops |
| `imageUrl` | Lưu **ref** (64-hex) → render build `${API_URL}/files/gift-photo/${ref}`; nếu là http(s) URL thì dùng nguyên (backward-compat ô URL cũ) |
| CurriculumSessionsTab | Giữ component; chỉ chặn nav + hash. Không xóa |
| upcoming payload | Query `exercise.upcomingForPrincipal` trả **chỉ `upcomingCount`** (không id/program/title) → không phá `listForPrincipal`, triệt tiêu rò rỉ 0038 |
| idempotency seed | Thêm migration `@@unique([facilityId, name])` (NFC-normalize name) + upsert; skip quà đã `archivedAt` |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Hide Schedule HS+PH](./phase-01-hide-schedule-hs-ph.md) | Pending |
| 2 | [Gift Photo Store + Endpoints](./phase-02-gift-photo-store-endpoints.md) | Pending |
| 3 | [Gift Upload UI](./phase-03-gift-upload-ui.md) | Pending |
| 4 | [Render Gift Image in LMS](./phase-04-render-gift-image-lms.md) | Pending |
| 5 | [Seed Gifts All Facilities](./phase-05-seed-gifts-all-facilities.md) | Pending |
| 6 | [Exercises Upcoming UX](./phase-06-exercises-upcoming-ux.md) | Pending |

## Dependencies

- P3 → P2 (upload cần endpoint). P5 → P2 + P4 (seed cần store ingest + render để verify). P1, P2, P4, P6 độc lập.

## Red Team Review

### Session — 2026-07-16
**Findings:** 15 (15 accepted, 0 rejected). Reviewers: Security Adversary, Failure Mode Analyst, Assumption Destroyer (mỗi finding có `file:line`).
**Severity:** 2 Critical, 6 High, 7 Medium.

| # | Finding | Sev | Disposition | Applied To |
|---|---------|-----|-------------|------------|
| 1 | LMS RewardsTab không render `imageUrl` | Critical | Accept | Phase 4 (mới) |
| 2 | `photo-store.ts` không có s3 driver → mirror `pdf-store.ts` + ops bind-mount/backup | Critical | Accept | Phase 2 |
| 3 | Seed non-idempotent (no `@@unique`, clobber archived) | High | Accept | Phase 5 |
| 4 | Scroll-to-current race fetch tách; `didInitialScroll` khóa nhầm | High | Accept | Phase 6 |
| 5 | `imageUrl` format lệch P3/P4, cả hai sai → lưu ref, build client-side | High | Accept | Phase 3+4 |
| 6 | `apps/lms` không có test runner → guard Phase 1 sang `apps/e2e` + grep e2e | High | Accept | Phase 1 |
| 7 | State `locked` trùng `upcoming` (đã render reward) | High | Accept | Phase 6 |
| 8 | Upcoming chỉ phủ lesson, bỏ unit path | High | Accept | Phase 6 |
| 9 | Trả `upcomingCount` thôi (bỏ id/program) | Medium | Accept | Phase 6 |
| 10 | Serve ảnh thêm DB gate facility (đúng "theo facility") | Medium | Accept | Phase 2 |
| 11 | Seed dùng owner/`DIRECT_URL` + assert facilities>0 | Medium | Accept | Phase 5 |
| 12 | BeanNode nhánh locked riêng (bỏ title/reward/aria/onClick) + assert client | Medium | Accept | Phase 6 |
| 13 | Ghi rõ giả định upcoming = buổi tương lai đã xếp lịch | Medium | Accept | Phase 6 |
| 14 | Pin gate upload = `rewards.giftCreate` | Medium | Accept | Phase 2 |
| 15 | Phase 3: helper `uploadSessionPhoto` đã có (client.ts:34); admin không có testing-library → verify thủ công | Medium | Accept | Phase 3 |

### Whole-Plan Consistency Sweep
- `imageUrl` = ref thống nhất P2/P3/P4/P5.
- Store = pdf-store.ts pattern thống nhất P2/P5 (bỏ mọi tham chiếu "photo-store disk|s3").
- Upcoming payload = count-only thống nhất P6 + decisions table (bỏ `{id, program}` cũ).
- Lane = high-risk (P5 migration) phản ánh ở Overview + Phase 5.
- Không mâu thuẫn còn lại.

## Validation Log

### Session 1 — 2026-07-16
Red Team đã cung cấp verification evidence → bỏ qua verification pass (guard). 4 câu quyết định (mode=prompt):

| # | Câu hỏi | Chốt | Áp vào |
|---|---------|------|--------|
| 1 | Driver ảnh prod | **S3/MinIO** (mirror pdf-store env prod) — bỏ bind-mount | Phase 2, Phase 5 |
| 2 | Precedence seed-vs-GĐKD | **Create-if-absent thuần** — KHÔNG update sao/ảnh bản có sẵn, KHÔNG un-archive | Phase 5 |
| 3 | Serve authz ảnh quà | **Facility-scoped qua DB gate** (gift.findFirst dưới RLS) | Phase 2 (đã có) |
| 4 | Migration `@@unique([facilityId, name])` | **Có** — thêm unique, high-risk lane | Phase 5 (đã có) |

> ⚠️ **Câu 1 SUPERSEDED khi cook Phase 5**: `docker-compose.prod.tls.yml` (file thật deploy) hoá ra không có wiring S3/MinIO cho bất kỳ store nào — giả định "mirror pdf-store S3" đã stale. Re-confirm với user → chốt lại **disk + bind-mount**. Xem `docs/decisions/0041-gift-photo-store-disk-driver.md`.

### Whole-Plan Consistency Sweep (post-validation)
- Phase 2 prod driver → **s3 primary** (bỏ "hoặc bind-mount"); ops = cấu hình s3 env như pdf-store, không cần sửa compose bind-mount.
- Phase 5 seed → `upsert` với `update: {}` (no-op) hoặc create-if-not-exists; không đè field nào của bản có sẵn.
- Câu 3, 4 đã khớp plan sẵn — không đổi.
- Không mâu thuẫn còn lại. **Failed: 0 → đủ điều kiện cook.**

### Session 2 — 2026-07-16 (edge-case sweep)
Rà tình huống rìa. Nhóm A tự chốt (an toàn), Nhóm B user quyết.

**Nhóm A — ghi vào phase:**
| Edge case | Xử lý | Phase |
|-----------|-------|-------|
| Ảnh ref mất/hỏng (dev reset xoá blob) → ô ảnh vỡ | `<Image>` onError → fallback IconGift | 4 |
| Tên file số lẫn giữa ("Trò chơi 7 sắc… 25 sao") | Parse regex `(\d+)\s*sao` (số ngay trước "sao") | 5 |
| Ảnh upload quá nặng | Cap 8MB (như session-photo) | 2 |
| Serve khớp ref | `imageUrl` == ref (exact), không `contains` (tránh false-match) | 2 |
| Migration `@@unique` lỗi nếu prod đã có 2 quà trùng tên | Bước tiền-kiểm trùng `(facilityId,name)` TRƯỚC migrate; có trùng → dừng xử lý trước | 5 |
| Cơ sở tạo MỚI sau seed | Không tự có quà; chạy lại seed (idempotent) hoặc GĐKD thêm tay — giới hạn đã biết | 5 |

**Nhóm B — user quyết:**
| Câu | Chốt |
|-----|------|
| 2 quà "Sticker" trùng tên | Xem ảnh gốc → đặt **"Sticker hình thỏ" (50 sao, từ file 10 sao)** + **"Sticker phồng Capybara" (75 sao, từ file 15 sao)**. Các quà khác giữ tên gốc bỏ hậu tố "N sao". |
| Ẩn trang Lịch học làm mất chỗ xem nội dung buổi | **Ẩn hẳn** cho cả HS+PH — chấp nhận mất view nội dung/chủ đề buổi trong LMS (quyết định sản phẩm của user). |

### Whole-Plan Consistency Sweep (post-Session 2)
- Phase 5 map tên: 21 quà, xử lý riêng 2 Sticker (không trùng), sao = số-file×5.
- Phase 2 cap 8MB + serve exact-ref; Phase 4 onError fallback — đã ghi.
- Phase 1: xác nhận ẩn hẳn, không thêm việc bảo toàn nội dung.
- Không mâu thuẫn. **Failed: 0.**
