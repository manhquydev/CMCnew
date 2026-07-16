---
phase: 5
title: "Seed Gifts All Facilities"
status: done
priority: P2
dependencies: [2, 4]
---

# Phase 5: Seed Gifts All Facilities

## Overview
Đưa 21 ảnh quà vào repo (đổi tên slug ASCII), ingest vào gift-photo store, seed 21 quà cho **toàn bộ facility** với `starsRequired = số-trong-tên × 5`. Idempotent bằng DB constraint. Dev-verify trước, prod chạy sau xác nhận user. **High-risk** (migration data-model + ghi prod toàn cơ sở).

## ⚠️ Red-team corrections
- **F3/F8 (High)**: `Gift` không có `@@unique` (`schema.prisma:756`), guard `findFirst` theo `name` tiếng Việt drift → trùng, và có thể clobber/un-archive quà GĐKD đã sửa/lưu-trữ (`rewards.ts:228-244`).
- **F11 (Medium)**: seed phải dùng client **owner/`DIRECT_URL`** (bypass RLS như `packages/db/src/seed-lms.ts:6-8`) — client app RLS-scoped sẽ khiến `facility.findMany()` trả `[]` → **no-op thầm lặng** trên prod.

## Requirements
- Functional: mỗi facility có đúng 21 quà active, đúng tên/ảnh/sao (×5). Chạy lại không trùng, không đè quà đã archived/đã sửa.
- Non-functional: enumerate facility runtime; assert `>0` else throw; log số bản ghi/ facility.

## Architecture
- **Migration (F3)**: thêm `@@unique([facilityId, name])` vào `Gift` (data-model hard gate → high-risk lane). Chuẩn hoá `name.normalize('NFC').trim()` khi ghi.
- **Ảnh**: nguồn `D:/Downloads/Compressed/Quà tặng-20260716T013855Z-1-001/Quà tặng` (21 file, số sao trong tên). Copy vào `assets/gifts/` với slug kebab ASCII. Map `{ file, name (hiển thị có dấu, NFC), stars }`.
- **Parse sao (Session 2)**: regex `(\d+)\s*sao` lấy số NGAY TRƯỚC chữ "sao" (tránh số lẫn giữa như "Trò chơi 7 sắc… 25 sao" → 25). `starsRequired = số × 5`.
- **2 quà "Sticker" trùng tên (Session 2, đã xem ảnh gốc)** — đặt tên phân biệt:
  - `Sticker 10 sao.jpg` (dải sticker hình thỏ) → name **"Sticker hình thỏ"**, 50 sao.
  - `Sticker 15 sao.PNG` (sticker phồng 3D Capybara) → name **"Sticker phồng Capybara"**, 75 sao.
  - 19 quà còn lại: name = tên file bỏ hậu tố "N sao" (NFC). Map là danh sách tường minh trong seed (không tự suy tên từ file để tránh lỗi).
- **Ingest**: mỗi ảnh → `putGiftPhoto` (Phase 2) → ref; `imageUrl = ref` (không URL tuyệt đối — Phase 4 build). Ingest một lần, ref dùng chung mọi facility (content-addressed).
- **Seed** (`packages/db/src/seed-gifts.ts`, cùng chỗ `seed-lms.ts`): client owner/`DIRECT_URL`; `const facilities = await prisma.facility.findMany(); if (!facilities.length) throw`. **Chốt validation Q2 = create-if-absent THUẦN**: mỗi facility × mỗi quà `upsert({ where: { facilityId_name: {...} }, create: {...starsRequired: stars*5, imageUrl: ref, stock: -1, name: NFC}, update: {} })` — `update: {}` no-op. Bản ghi có sẵn (kể cả đã sửa sao/ảnh hoặc đã archived) **KHÔNG bị đụng**; `@@unique` chặn tạo trùng. Không un-archive, không đè giá trị GĐKD.
- **Prod driver ảnh (Q1) = S3**: ⚠️ **SUPERSEDED khi cook** — driver ảnh prod thực tế chốt lại **disk + bind-mount** (docker-compose.prod.tls.yml không có S3/MinIO wiring cho store nào). Xem `docs/decisions/0041-gift-photo-store-disk-driver.md`.
- Script `seed:gifts` trong `package.json` theo convention `seed:*`. ⚠️ **Vị trí thực tế khi cook**: CLI ingest ảnh nằm ở `apps/api/scripts/seed-gifts.ts` (script `seed:gifts` trong `apps/api/package.json`), KHÔNG phải `packages/db` — vì `packages/db` không thể import `putGiftPhoto` của `apps/api` (sai hướng dependency trong monorepo), theo đúng tiền lệ `apps/api/scripts/migrate-pdf-blobs-to-s3.ts`. Hàm core idempotent `seedGiftsCore` + `GIFT_DEFS` vẫn ở `packages/db/src/seed-gifts.ts` như plan gốc (export qua `@cmc/db/seed-gifts`).

## Related Code Files
- Create: `assets/gifts/*` (21 ảnh), `packages/db/src/seed-gifts.ts`.
- Create migration: `@@unique([facilityId, name])` trên Gift (`schema.prisma:741-758` + `prisma migrate`).
- Reuse: `putGiftPhoto` (Phase 2), owner client pattern (`seed-lms.ts:6-8`).
- Create test: `apps/api/test/seed-gifts.int.test.ts`.

## Implementation Steps (TDD)
1. **Test trước** (`seed-gifts.int.test.ts`): facility test; chạy hàm seed core 2 lần → 21 quà/facility (không 42), `starsRequired === stars*5`. Thêm case: 2 Sticker ra 2 bản ghi khác tên (50 + 75 sao); quà bị archived trước → re-seed KHÔNG un-archive; quà có `starsRequired` bị GĐKD chỉnh → re-seed KHÔNG đè. Đỏ trước.
2. **Tiền-kiểm trùng (Session 2)**: trước migration, query `GROUP BY (facilityId, name) HAVING count>1` — nếu prod đã có quà trùng tên → DỪNG, xử lý/gộp trước (migration `@@unique` sẽ fail nếu còn trùng). Ghi kết quả kiểm.
3. Migration `@@unique([facilityId, name])` + `prisma migrate dev`.
4. Chuẩn hoá 21 tên → map tường minh (parse `stars` regex, 2 Sticker đặt tên riêng), copy ảnh `assets/gifts/`.
5. Hàm seed core idempotent (tách I/O để test) + ingest ảnh + assert facilities>0.
6. Test → xanh.
7. **Dev**: chạy seed thật; verify LMS (Phase 4) HS thấy 21 quà đúng ảnh + sao ×5.
8. **Prod**: DỪNG — xác nhận user + chạy lại tiền-kiểm trùng tên (bước 2) trên chính DB prod + xác nhận thư mục bind-mount `gift-photos` đã sẵn sàng trên host (driver ảnh prod = **disk + bind-mount**, xem `docs/decisions/0041-gift-photo-store-disk-driver.md`) trước khi chạy. Sau xác nhận: chạy bằng owner/`DIRECT_URL`, log số bản ghi/ facility.

## Success Criteria
- [x] Migration `@@unique([facilityId, name])` applied (dev + **prod**, verified via `pg_indexes` on `cmcnew-prod-postgres-1`: `gift_facility_id_name_key` present).
- [x] `seed-gifts.int.test.ts` xanh: idempotent + sao×5 + không un-archive + không đè giá trị GĐKD.
- [x] Dev: mọi facility (HQ, CS2) đủ 21/21 quà; verify trực tiếp trên browser — ảnh đúng, sao đúng, sort theo sao tăng dần. Seed chạy 2 lần xác nhận idempotent thật (không phải chỉ test).
- [x] **Prod: đã chạy** (2026-07-16, user xác nhận riêng). Tiền-kiểm trùng tên: 0 dòng trùng. Bind-mount `gift-photos` đã active đúng destination. Kết quả: facility `LD` (id=1, facility DUY NHẤT hiện có trên prod) 21/21 gifts, chạy lại lần 2 vẫn 21 (không 42) — idempotent xác nhận thật trên DB prod, không chỉ test.
  - **Gap phát hiện khi chạy prod (chưa có trong plan gốc)**: `apps/api/Dockerfile` không `COPY` thư mục `assets/` gốc repo vào image → container prod thiếu nguồn ảnh để script ingest (dù đích ghi — thư mục bind-mount — vẫn đúng). Khắc phục tạm thời bằng `docker cp` 21 ảnh vào container (ephemeral, mất khi container tái tạo lần deploy sau — không ảnh hưởng vì ảnh đã ingest xong nằm ở bind-mount, không cần lại assets/ nữa trừ khi cần seed thêm facility mới). Cũng phát hiện `gift-photos` bind-mount trên host bị `root:root` (chưa từng chown) → `EACCES` khi container chạy user `cmc` (uid 100/gid 101); đã `chown -R 100:101`. **Follow-up chưa làm**: thêm `assets/` vào `Dockerfile` COPY + thêm `gift-photos` chown vào `scripts/ensure-blob-store-dirs.sh` để lần seed facility mới sau này không cần thao tác tay.

## Risk Assessment
- **High-risk**: migration + ghi prod toàn cơ sở. Bắt buộc dev-verify + user-confirm + driver ảnh prod OK trước prod.
- Un-archive/đè GĐKD: chặn bằng skip-archived + update-chỉ-ảnh (không đè sao).
- Tên có dấu → slug ASCII cho file; `name` NFC-normalize + `@@unique` chặn trùng.
- Nếu chạy nhầm client RLS-scoped → assert `facilities>0` throw thay vì no-op.
- **Cơ sở tạo MỚI sau seed** không tự có 21 quà — chạy lại `seed:gifts` (idempotent, chỉ thêm chỗ thiếu) hoặc GĐKD thêm tay. Giới hạn đã biết, không xử tự động đợt này (YAGNI).
- **Prod đã có quà trùng tên** → migration `@@unique` fail. Bước tiền-kiểm (step 2) bắt buộc chạy + xử lý trước migrate.
