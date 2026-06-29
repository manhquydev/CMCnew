# Phase 03 — Admin CRM UI (tối thiểu)

## Context
- App: `apps/admin` (React). CRM panel hiện có (opportunity list/create, contact create) — tìm component CRM trong `apps/admin/src`.
- Dùng `@cmc/ui` components + tRPC client hiện hữu. KHÔNG tạo design mới — match pattern panel sẵn có.

## Requirements (chỉ surface đủ dùng, KISS)
1. **B2**: form tạo contact/lead thêm 2 input optional: `medium`, `campaign` (text/select đơn giản). Hiển thị trên contact detail.
2. **B4**: ở action "Đánh dấu mất", đổi ô nhập lý do tự do → **dropdown enum** `LostReason` (nhãn tiếng Việt) + ô note tuỳ chọn. List opportunity: badge/cột lý do mất + filter.
3. **B1**: ở opportunity detail — nút "Đổi người phụ trách" (manager-only, ẩn với role khác) gọi `opportunityReassign`; khối "Lịch sử phân bổ" đọc `assignmentHistory` (from→to, bởi ai, khi nào, lý do).

## Files
- Modify: component CRM trong `apps/admin/src/*` (xác định khi code; vd `crm-panel.tsx`).
- Dùng lại role-gate có sẵn (canCrm + manager check) như `shell.tsx` buildGroups.

## Validation
- `pnpm --filter admin typecheck` + build xanh.
- Smoke thủ công (hoặc e2e nhẹ): tạo lead có medium/campaign; markLost chọn enum; reassign hiển thị 1 dòng lịch sử.
- Nhãn tiếng Việt cho enum LostReason: giá→"Giá", schedule→"Lịch học", distance→"Khoảng cách", competitor→"Đối thủ", no_response→"Không phản hồi", not_ready→"Chưa sẵn sàng", other→"Khác".

## Risks
- Ẩn/hiện nút reassign theo role: dùng đúng helper role-gate hiện có, tránh tạo logic quyền mới ở UI (server vẫn là nguồn enforce).
