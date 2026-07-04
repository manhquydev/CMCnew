---
phase: 3
title: "Duyệt per-ticket + reject"
status: completed
priority: P1
dependencies: [2]
---

# Phase 3: Duyệt per-ticket + reject

## Overview

Chuyển duyệt từ per-punch → **per-ticket**: `pendingManual` trả phiếu; thêm `approveTicket`/`rejectTicket`. Duyệt phiếu stamp `approvedAt` lên mọi punch manual của user+ngày để `monthlyReport` không phải sửa.

## Requirements

- Functional:
  - `pendingManual(facilityId)` → danh sách **phiếu** `status=pending` (kèm reason, số lần bấm, ca hôm đó), lọc theo manager trực tiếp (giữ logic hiện có). Đếm số punch/phiếu bằng **1 query gộp** (`groupBy` theo userId+dateKey hoặc `_count`), KHÔNG loop N+1 theo từng phiếu. Giữ `take: 50`.
  - `approveManual({ ticketId })` → `status=approved`, set `approvedAt/approvedById` trên phiếu **và** trên tất cả `TimePunch(facilityId, userId, method='manual', timestamp ∈ ictDateRange(dateKey))`. **Có `facilityId` trong `where`** (tường minh, không chỉ dựa RLS — M3).
  - `rejectManual({ ticketId, note? })` → `status=rejected`; nếu phiếu **trước đó đã approved** thì **un-stamp** (`updateMany` set `approvedAt=null, approvedById=null` trên punch cùng dải) để không lọt vào công. Notify lại nhân viên.
  - Không tự duyệt/từ chối phiếu của chính mình (guard cả `approve` và `reject`).
- Non-functional: `assertCanApprovePunch` → `assertCanHandleTicket` (cùng luật hiện có: super_admin hoặc manager trực tiếp; approve/reject chung guard). Chỉ xử lý phiếu đang `pending` (approve/reject); approved↔rejected chuyển đổi có un-stamp như trên.

## Architecture

- Permission registry `packages/auth/src/permissions.ts` → `checkInOut`:
  - `approveManual` giữ roles cũ; thêm `rejectManual: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao']`.
- Stamp punch khi approve: `tx.timePunch.updateMany({ where: { userId, method: 'manual', timestamp: { gte, lt } (ictDateRange(dateKey)) }, data: { approvedById, approvedAt } })`.
- `pendingManual` đổi nguồn từ `timePunch` → `manualAttendanceTicket` join đếm punch. Giữ filter theo `employmentProfile.managerId` như hiện tại.
- `approveManual` đổi input `{ punchId }` → `{ ticketId }` — **breaking**; cập nhật FE Phase 4 đồng bộ.

### H1 — `todayStatus` phải phản ánh trạng thái duyệt (quyết định user: hiện "chờ duyệt/bị từ chối")

Hiện `todayStatus` lấy `punches[last]` làm giờ ra bất kể duyệt/từ chối → ngày bị từ chối vẫn hiện xanh "Hoàn thành". Sửa `todayStatus` trả thêm:
- `manualApproval: 'none' | 'pending' | 'approved' | 'rejected'` (từ phiếu hôm nay, nếu có punch manual).
- FE (Phase 4) dùng cờ này: rejected → KHÔNG badge xanh; pending → badge "chờ duyệt".
- Không đổi cách suy first/last (giờ vào/ra vẫn hiển thị), chỉ thêm lớp trạng thái duyệt.

## Related Code Files

- Modify: `apps/api/src/routers/check-in-out.ts` (`pendingManual`, `approveManual`, thêm `rejectManual`, `todayStatus` +manualApproval; thay `assertCanApprovePunch`→`assertCanHandleTicket`)
- Modify: `packages/auth/src/permissions.ts` (`checkInOut.rejectManual`)
- Reference: `apps/api/src/lib/attendance-penalty.ts` (`ictDateRange`), `emit-staff-notif.ts`

## Implementation Steps

1. **Test-first** (integration): 
   a. approve ticket → phiếu approved + tất cả punch manual của ngày có `approvedAt`; `monthlyReport` tính công đúng.
   b. reject ticket → phiếu rejected, punch KHÔNG có `approvedAt`, `monthlyReport` không tính công.
   c. tự duyệt/từ chối phiếu của mình → FORBIDDEN (cả approve và reject).
   d. approve phiếu đã approved / reject phiếu đã xử lý → CONFLICT.
   e. punch manual tạo **sau** khi approve (Phase 2 case) → auto có `approvedAt`.
   f. approved→rejected: un-stamp, punch mất `approvedAt`, rời khỏi công.
   g. `todayStatus.manualApproval` = 'pending'/'approved'/'rejected' đúng theo phiếu.
   h. `pendingManual` với 10 phiếu → số query không tăng tuyến tính (không N+1).
   Chạy → đỏ.
2. Thêm `rejectManual` vào permission registry.
3. Viết `pendingManual` (theo ticket), `approveManual({ticketId})`, `rejectManual({ticketId,note})`.
4. Guard tự-duyệt + trạng thái phiếu (pending mới xử lý được).
5. Notify nhân viên khi reject.
6. `gitnexus_impact` trên `approveManual`/`pendingManual` (caller: `checkin-panel.tsx`) → báo blast radius.
7. Chạy lại test → xanh; regression `work-shift-manual-punch-approval.spec.ts` (Phase 4 sẽ cập nhật E2E nếu vỡ do đổi shape).

## Success Criteria

- [ ] Case a–e xanh.
- [ ] `monthlyReport` không đổi code vẫn tính đúng (approve stamp `approvedAt`).
- [ ] `rejectManual` có permission + guard tự-xử-lý.
- [ ] Reject bắn notify nhân viên.

## Risk Assessment

- Đổi `approveManual` input shape (`punchId`→`ticketId`) là **breaking** cho FE + E2E → cập nhật đồng bộ Phase 4.
- `updateMany` theo dải thời gian ICT phải khớp `ictDateRange(dateKey)` — test biên (Phase B lo test nửa đêm; ở đây test 1 ngày thường).
- Reject rồi nhân viên chấm lại cùng ngày: **CHỐT (user)** = cho mở lại phiếu với **lý do MỚI** → về `pending`, manager duyệt lại. Logic reopen nằm ở Phase 2 (punch); Phase 3 chỉ set `rejected`. Chống lạm dụng: `logEvent` mỗi lần reject/resubmit (audit trail), notify manager mỗi resubmit — nếu về sau thấy spam thì thêm cap (YAGNI hiện tại, ghi lại).
- approved→rejected un-stamp: đảm bảo `updateMany` un-stamp đúng dải ICT + facilityId; test case f.
