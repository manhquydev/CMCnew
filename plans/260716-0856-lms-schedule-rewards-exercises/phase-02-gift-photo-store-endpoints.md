---
phase: 2
title: "Gift Photo Store + Endpoints"
status: done
priority: P2
dependencies: []
---

# Phase 2: Gift Photo Store + Endpoints

## Overview
Hạ tầng lưu ảnh quà: content-addressed store **mirror `pdf-store.ts`** (driver disk|s3 thật), và hai endpoint Hono — upload (gated `giam_doc_kinh_doanh`) + serve (facility-scoped qua DB gate). KHÔNG mirror `photo-store.ts`.

## ⚠️ SUPERSEDED (Phase 5 cook): prod driver = disk, not S3
Every "prod driver = S3/MinIO" line below (F2 correction, Requirements, Architecture's Ops
paragraph) was locked during planning but reversed during Phase 5 implementation: the real
deployed `docker-compose.prod.tls.yml` has zero S3/MinIO wiring for ANY store, so "mirror
pdf-store's prod S3 setup" pointed at something that isn't actually live. Re-confirmed with the
user → prod uses **disk + bind-mount**, matching how pdf-store/session-photo actually run today.
See `docs/decisions/0041-gift-photo-store-disk-driver.md`. The disk|s3 driver seam in
`gift-photo-store.ts` itself is unaffected — only which driver prod is configured to use changed.

## ⚠️ Red-team corrections
- **F2 (Critical)**: `apps/api/src/services/photo-store.ts:18` là **disk-only** — không có s3. Seam disk|s3 thật ở `apps/api/src/services/pdf-store.ts:17,71-140`. **Mirror pdf-store.ts.** Prod session-photo sống nhờ **bind-mount** (`docker/docker-compose.prod.tls.yml:113-114`) + `scripts/ensure-blob-store-dirs.sh:12-15`, không phải S3.
- **F10 (Medium)**: serve phải có **DB gate facility** (các endpoint blob khác đều query dưới RLS: session-photo `index.ts:132-143`, exercise `index.ts:172-175`). "Chỉ cần đăng nhập" là oracle đọc blob cross-facility.
- **F14 (Medium)**: gate upload = **một** permission `rewards.giftCreate` (không "hoặc giftUpdate"; mọi `rewards.*` cùng role nên OR vô nghĩa nhưng phải pin để test đóng contract).

## Requirements
- Functional: `POST /upload/gift-photo` nhận ảnh (jpeg/png/webp), validate magic+size, trả `{ ref }`; chỉ `rewards.giftCreate` ghi được. `GET /files/gift-photo/:ref` trả ảnh chỉ khi ref gắn với một Gift **hiển thị dưới RLS của caller**.
- Non-functional: dedup sha256; không permission mới; prod driver=s3 hoặc bind-mount trước khi seed (Phase 5).

## Architecture
- **Store** `apps/api/src/services/gift-photo-store.ts` (mới): copy khung `pdf-store.ts` — `GIFT_PHOTO_STORE_DRIVER` (disk|s3), `GIFT_PHOTO_STORE_DIR` (default `.data/gift-photos`), S3 prefix riêng. Tái dùng validator ảnh của photo-store (`assertValidSessionPhoto`/`detectPhotoContentType`) hoặc copy — export chúng nếu cần. `putGiftPhoto`/`readGiftPhoto`/`giftPhotoExists`.
- **Upload authz** (`index.ts`, mirror L105-121): `can(session.roles, isSuperAdmin, 'rewards', 'giftCreate')` → 403 nếu không; 401 ẩn danh; 413 quá cỡ; 400 không phải ảnh.
- **Serve authz** (`index.ts`, mirror L123-153): resolve staff HOẶC LMS cookie → 401 nếu không; `withRls(rlsCtx, tx.gift.findFirst({ where: { imageUrl: ref, archivedAt: null }, select: { id: true } }))` — **so khớp exact** `imageUrl == ref` (không `contains`, tránh false-match với URL ngoài trùng chuỗi) → 403 nếu không thấy (facility-scope thật); rồi stream Content-Type + `Cache-Control: private`.
- **Cap size (Session 2)**: giới hạn 8MB (hằng `MAX_GIFT_PHOTO_BYTES` như session-photo) → 413 nếu vượt.
- **Ops (F2) — chốt validation: prod driver = S3/MinIO**: `GIFT_PHOTO_STORE_DRIVER=s3`, tái dùng cấu hình bucket/env mà `PDF_STORE_DRIVER=s3` đang dùng trên prod (tra `.env`/compose lúc code); mirror seam `pdf-store.ts:71-140`. KHÔNG cần bind-mount compose. Dev có thể dùng disk (`GIFT_PHOTO_STORE_DIR`). Xác nhận bucket/prefix sẵn sàng trước Phase 5 prod.

## Related Code Files
- Create: `apps/api/src/services/gift-photo-store.ts` (mirror `pdf-store.ts`).
- Modify: `apps/api/src/index.ts` — 2 endpoint mới.
- Modify: `apps/api/src/services/photo-store.ts` — export validators nếu tái dùng (không đổi hành vi session-photo).
- Modify (ops): `docker/docker-compose.prod.yml`, `docker/docker-compose.prod.tls.yml`, `scripts/ensure-blob-store-dirs.sh`, `scripts/backup-db.sh`.
- Create test: `apps/api/test/gift-photo-upload.int.test.ts`.

## Implementation Steps (TDD)
1. **Test trước** (`gift-photo-upload.int.test.ts`):
   - Upload PNG bằng `giam_doc_kinh_doanh` → 200 + `ref` 64-hex.
   - Tạo Gift với `imageUrl` chứa ref → serve bằng LMS principal **cùng facility** → 200 + content-type đúng.
   - Serve bằng principal **khác facility** (ref không gắn gift nào của họ) → 403 (chứng minh facility gate).
   - Upload role không quyền (`giao_vien`) → 403; ẩn danh upload/serve → 401; không phải ảnh → 400; quá cỡ → 413.
   Chạy → **đỏ**.
2. Viết `gift-photo-store.ts` (mirror pdf-store driver seam).
3. Thêm 2 endpoint vào `index.ts` theo authz trên.
4. Chạy test → **xanh**. Chạy suite API liên quan (rewards, session-evidence) → xanh.
5. Cập nhật ops: set `GIFT_PHOTO_STORE_DRIVER=s3` + bucket/prefix (tái dùng cấu hình pdf-store S3) trên prod; ghi rõ đã chốt. Dev để disk.

## Success Criteria
- [x] `gift-photo-upload.int.test.ts` phủ 200/403(role)/403(cross-facility)/401/400/413 và xanh (đỏ trước).
- [x] Store dùng driver seam của `pdf-store.ts` (disk|s3), không phải disk-only.
- [x] Không thêm entry `permissions.ts`.
- [x] Ops: prod driver **đổi thành disk + bind-mount** (không phải s3, xem SUPERSEDED note trên) — bind-mount + ensure-blob-store-dirs.sh + backup-db.sh đã cập nhật, ghi rõ ở decision 0041.
- [x] Suite API hiện có vẫn xanh (trừ 5 failure pre-existing không liên quan — xem báo cáo).

## Risk Assessment
- Nếu prod quên set driver=s3 (rơi về disk trong container ephemeral) → ảnh 404 sau redeploy. Mitigation: xác nhận `GIFT_PHOTO_STORE_DRIVER=s3` + bucket trước Phase 5 prod.
- Export validator từ photo-store → giữ nguyên chữ ký session-photo (không hồi quy).
