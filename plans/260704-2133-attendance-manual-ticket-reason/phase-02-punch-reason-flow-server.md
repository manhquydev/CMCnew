---
phase: 2
title: "Punch reason flow (server)"
status: completed
priority: P1
dependencies: [1]
---

# Phase 2: Punch reason flow (server)

## Overview

Đổi `checkInOut.punch` để khi chấm **ngoài WiFi**: lần đầu/ngày yêu cầu `reason` → tạo phiếu; lần sau gắn phiếu sẵn, không hỏi lại.

## Requirements

Rẽ nhánh theo **trạng thái phiếu** (không chỉ theo tồn tại phiếu — tránh mâu thuẫn với phiếu `rejected`):

- Functional (ngoài WiFi):
  - **Chưa có phiếu** hôm nay:
    - thiếu `reason` → trả `{ requiresReason: true }`, KHÔNG tạo punch.
    - có `reason` → tạo `ManualAttendanceTicket(status=pending)` + punch manual; notify manager 1 lần.
  - **Phiếu `pending`/`approved`** → tạo punch manual, bỏ qua reason. Nếu `approved` → stamp `approvedAt/approvedById` lên punch mới luôn.
  - **Phiếu `rejected`** (quyết định user: cho mở lại với lý do MỚI):
    - thiếu `reason` → trả `{ requiresReason: true, resubmit: true }` (UI báo "phiếu đã bị từ chối, nhập lý do mới"), KHÔNG tạo punch.
    - có `reason` → cập nhật phiếu về `status=pending`, ghi `reason` mới, xóa `approvedAt/approvedById`; tạo punch manual; **notify manager (resubmit)**; `logEvent` phân biệt lần nộp lại (audit chống lạm dụng).
  - Trong WiFi → punch `ip` như cũ (không phiếu).
- Non-functional: giữ advisory lock + debounce; unique phiếu chống race. Reopen là `update` cùng transaction (không vi phạm unique).

## Architecture

- Input: `punch` nhận `z.object({ reason: z.string().trim().min(3).max(500).optional() }).optional()`.
- `dateKey = ictDateKey(new Date())` (từ `attendance-penalty.ts`).
- Tra phiếu: `tx.manualAttendanceTicket.findUnique({ where: { userId_dateKey: { userId, dateKey } } })`.
- Tạo/mở lại phiếu trong cùng transaction với punch; `@@unique` là chốt chặn race cuối (advisory lock đã có).
- Notify manager chỉ khi **tạo phiếu mới** hoặc **reopen (resubmit)** — không bắn mỗi punch.

**⚠️ Return-shape (H2 — landmine)**: `punch` hiện kết bằng `.then(({punch,ipAllowed,pushFn}) => { pushFn?.(); return {...punch, ipAllowed}; })`. Nhánh `requiresReason` return sớm KHÔNG có `punch/pushFn` → nếu đi qua `.then` sẽ `{...undefined}` = `{}`, **mất cờ `requiresReason`** → FE không mở modal. **Bắt buộc**: trả `requiresReason` TRƯỚC/tách khỏi `.then` post-commit (early return từ trong `withRls` callback với marker, rồi `.then` chuyển tiếp nguyên vẹn; hoặc bọc union type `{requiresReason:true,...} | {punch,...}` và xử lý cả 2 trong `.then`).

**CONFLICT vs requiresReason**: nếu đã có punch trước đó trong cửa sổ debounce, lần bấm ngoài WiFi đầu ngày ném `CONFLICT` (không phải `requiresReason`). FE (Phase 4) phải phân biệt 2 lỗi này.

## Related Code Files

- Modify: `apps/api/src/routers/check-in-out.ts` (`punch`)
- Reference: `apps/api/src/lib/attendance-penalty.ts` (`ictDateKey`, `ictDayRangeFor`)
- Reference: `apps/api/src/lib/emit-staff-notif.ts`

## Implementation Steps

1. **Test-first** (integration, test DB): thêm cases vào bộ test punch —
   a. ngoài WiFi, không reason → `requiresReason=true`, 0 punch, 0 phiếu.
   b. ngoài WiFi, có reason → 1 phiếu pending + 1 punch manual; notify bắn 1 lần.
   c. ngoài WiFi lần 2 cùng ngày (phiếu pending) → 1 phiếu (không thêm), 2 punch; notify KHÔNG bắn lại.
   d. trong WiFi → punch ip, 0 phiếu.
   e. phiếu `rejected` + không reason → `requiresReason=true, resubmit=true`, 0 punch mới.
   f. phiếu `rejected` + reason mới → phiếu về `pending` (reason mới, approvedAt=null), +1 punch, notify resubmit.
   g. phiếu `approved` + bấm tiếp → punch mới có `approvedAt` ngay (auto-inherit).
   h. return-shape: assert response `requiresReason` KHÔNG bị nuốt sau post-commit `.then`.
   Chạy → đỏ.
2. Sửa `punch`: nhận input reason; sau khi tính `ipAllowed`, rẽ nhánh theo phiếu như Architecture.
3. Chuyển emit notify sang chỉ khi tạo phiếu mới; giữ pattern push-after-commit hiện có.
4. `gitnexus_impact({target: "punch"})` báo blast radius (caller: `checkin-panel.tsx`) trước khi sửa; ghi vào report.
5. Chạy lại test → xanh. Regression: bộ test chấm công cũ vẫn xanh.

## Success Criteria

- [ ] 4 case a–d xanh.
- [ ] `requiresReason` không tạo punch/phiếu.
- [ ] Notify manager chỉ 1 lần/ngày (lúc tạo phiếu).
- [ ] Debounce 30s + advisory lock còn nguyên (Phase B sẽ đổi 5s — KHÔNG đổi ở đây).
- [ ] Test chấm công hiện có không regress.

## Risk Assessment

- Đổi public contract `punch` (input + trả `requiresReason`): FE Phase 4 phải xử lý; giữ optional để không vỡ caller khác.
- Race tạo 2 phiếu: advisory lock (theo userId) + `@@unique` bọc 2 lớp.
