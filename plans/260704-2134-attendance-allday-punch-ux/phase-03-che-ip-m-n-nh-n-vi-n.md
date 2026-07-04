---
phase: 3
title: "Che IP màn nhân viên"
status: completed
priority: P3
dependencies: [1]
---

# Phase 3: Che IP màn nhân viên (ex-Plan C)

## Overview

Bỏ cột IP khỏi bảng "Lịch sử 14 ngày" mà chính nhân viên xem. Giữ IP ở bảng duyệt của manager (audit hợp lệ). Thay đổi nhỏ, 1 file.

## Requirements

- Functional: bảng lịch sử 14 ngày (self-view) chỉ còn Ngày/Giờ/Phương thức; bỏ cột IP.
- Non-functional (**quyết định user: bỏ cả ở API self-view**): khi `targetUserId === session.userId`, endpoint `history` KHÔNG trả `ipAddress` (select loại bỏ); khi manager xem người khác (`userId` param) → giữ `ipAddress`. Tránh lộ IP qua network tab dù ẩn ở UI.

## Architecture

- `checkin-panel.tsx`: bảng "Lịch sử 14 ngày" (khoảng dòng 219–247) — bỏ `<Table.Th>IP</Table.Th>` và ô `{p.ipAddress}`. Bảng manager "Chờ duyệt ngoài WiFi" giữ nguyên cột IP.
- `check-in-out.ts` `history`: khi self-view (`targetUserId === session.userId`) dùng `select` bỏ `ipAddress`; nhánh manager giữ. Lưu ý type trả về khác nhau giữa 2 nhánh → union hoặc luôn có field optional; `HistoryPunch` type ở FE cập nhật theo.
- Banner IP đã bỏ từ plan trước — chỉ xác nhận không tái xuất hiện.

## Related Code Files

- Modify: `apps/admin/src/checkin-panel.tsx` (bảng lịch sử 14 ngày, type `HistoryPunch`)
- Modify: `apps/api/src/routers/check-in-out.ts` (`history` select bỏ ipAddress cho self-view)

## Implementation Steps

1. **Test-first**: (a) integration: `history` self-view → object KHÔNG có `ipAddress`; manager xem người khác → CÓ `ipAddress`. (b) E2E: staff `/checkin` → bảng 14 ngày không header "IP", không chuỗi IP; manager bảng duyệt vẫn có IP. Chạy → đỏ.
2. Server: `history` select bỏ `ipAddress` nhánh self-view.
3. FE: bỏ cột IP + cập nhật `HistoryPunch` type.
4. `@cmc/api` + `@cmc/admin typecheck`; chạy test → xanh.

## Success Criteria

- [ ] Bảng 14 ngày (nhân viên) không còn IP.
- [ ] Bảng duyệt manager vẫn có IP.
- [ ] `@cmc/admin typecheck` sạch.

## Risk Assessment

- Rủi ro thấp. Chỉ đảm bảo không có chỗ khác trong màn nhân viên rò IP (grep `ipAddress`/`ip` trong `checkin-panel.tsx` trước khi kết thúc).
- API `history` vẫn trả IP: đúng ý (manager/report cần). Không đổi contract.
