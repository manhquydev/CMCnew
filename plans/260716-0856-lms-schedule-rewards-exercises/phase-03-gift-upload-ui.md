---
phase: 3
title: "Gift Upload UI"
status: done
priority: P2
dependencies: [2]
---

# Phase 3: Gift Upload UI

## Overview
Thêm upload ảnh từ thiết bị vào panel quản lý quà (tạo + sửa). GĐKD chọn ảnh → upload qua endpoint Phase 2 → lưu **ref** vào `imageUrl`. Giữ ô URL cũ cho ảnh ngoài. Sửa số sao + thay ảnh đã có sẵn.

## ⚠️ Red-team corrections
- **F15**: helper upload **đã tồn tại** — `uploadSessionPhoto`/`uploadExercisePdf` ở `packages/ui/src/client.ts:21,34` (dùng `API_URL`), admin đã tái dùng (`session-evidence-panel.tsx`). Thêm `uploadGiftPhoto` cùng file theo đúng khuôn.
- **F5**: lưu **ref** (không lưu URL tuyệt đối build-time). Render dựng URL client-side (Phase 4).
- **F15/F7**: admin có `vitest` nhưng **không** `@testing-library/react`/jsdom (mọi test admin là `.test.ts` logic-only). KHÔNG viết `.test.tsx` render — verify thủ công.

## Requirements
- Functional: form Tạo/Sửa quà có `FileInput`; upload xong hiện preview + set `imageUrl = <ref>`. Lưu dùng `giftCreate`/`giftUpdate` sẵn có.
- Non-functional: báo lỗi rõ (loại/size); ô URL cũ vẫn chạy; không phá form.

## Architecture
- `packages/ui/src/client.ts`: thêm `uploadGiftPhoto(file: File): Promise<string>` mirror `uploadSessionPhoto` (POST `/upload/gift-photo`, `Content-Type: file.type`, trả `ref`).
- `rewards-panel.tsx`: state `uploading`; `FileInput` (Mantine) → `uploadGiftPhoto` → `form.setFieldValue('imageUrl', ref)`; preview `<Image src={\`${API_URL}/files/gift-photo/${ref}\`}>`. Disable nút Lưu khi đang upload. Giữ `TextInput` URL (cho ảnh ngoài) — hai nguồn ghi cùng field `imageUrl` (ref hoặc http URL).

## Related Code Files
- Modify: `packages/ui/src/client.ts` — thêm `uploadGiftPhoto` + export `API_URL` (đã export).
- Modify: `apps/admin/src/rewards-panel.tsx` — `GiftCreateCard` (~L37), `GiftEditModal` (~L130): FileInput + preview + busy.

## Implementation Steps
1. Thêm `uploadGiftPhoto` vào `client.ts` (mirror `uploadSessionPhoto`).
2. `GiftCreateCard`: FileInput + preview + set `imageUrl=ref`; giữ ô URL.
3. `GiftEditModal`: tương tự (thay ảnh khi sửa); số sao đã có (`starsRequired`).
4. **Verify thủ công (dev)** — checklist (không giả test):
   - Tạo quà upload ảnh máy → xuất hiện trong `giftListAdmin` + LMS "Đổi quà" hiển thị đúng ảnh (sau Phase 4).
   - Sửa `starsRequired` + thay ảnh → cập nhật đúng.
   - Ô URL ngoài vẫn hiển thị.
5. Lint/typecheck admin + ui xanh.

## Success Criteria
- [x] GĐKD upload ảnh từ máy khi tạo/sửa quà; `imageUrl` lưu ref.
- [x] Ô URL cũ vẫn dùng được.
- [x] Sửa số sao + thay ảnh hoạt động.
- [x] Lint/typecheck xanh; verify thủ công ghi rõ trong report (không có test render giả). Review tìm 1 bug thật (cross-record photo-ref leak khi upload dở dang rồi đổi gift khác) — đã fix bằng targetGiftId guard.

## Risk Assessment
- Không có hạ tầng test component admin → dựa verify thủ công; nêu rõ, không tạo smoke test rỗng.
- `imageUrl` giờ chứa ref HOẶC URL → Phase 4 render phải phân biệt (64-hex ref vs http URL).
