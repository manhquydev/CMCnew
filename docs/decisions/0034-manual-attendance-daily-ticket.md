# Decision 0034 — Chấm công ngoài WiFi: phiếu theo ngày (không per-punch), lý do 1 lần, duyệt/từ chối 1 lần

- Status: accepted
- Date: 2026-07-04
- Lane: HIGH-RISK (FEATURE_INTAKE.md — data model, authorization, public contract)
- Plan: `plans/260704-2133-attendance-manual-ticket-reason/`
- Related: brainstorm `plans/reports/brainstorm-260704-2133-attendance-checkin-logic-fix-report.md`

## Bối cảnh

Thiết kế gốc yêu cầu: chấm công ngoài WiFi công ty phải nhập lý do, nhưng chỉ **1 lần đầu tiên trong ngày**;
manager duyệt **1 lần** là hợp lệ cả ngày (không duyệt từng lượt bấm). Hệ thống cũ tạo 1 `TimePunch`
độc lập mỗi lần bấm, không có trường lý do, và duyệt từng punch riêng lẻ — không khớp yêu cầu.

## Quyết định

1. Thêm bảng `manual_attendance_ticket`: 1 phiếu/người/ngày (`@@unique([userId, dateKey])`, `dateKey`
   theo giờ ICT). Phiếu mang `reason`, `status` (pending/approved/rejected), `approvedById/At`.
2. `punch()` rẽ nhánh theo trạng thái phiếu trong ngày: chưa có phiếu → yêu cầu lý do (tạo phiếu);
   phiếu pending/approved → gắn punch, không hỏi lại; phiếu rejected → cho nhập lý do MỚI để mở lại
   (`status` về `pending`).
3. Duyệt chuyển từ per-punch sang **per-ticket**: `approveManual({ticketId})` stamp `approvedAt` lên
   toàn bộ `TimePunch` thủ công của người dùng trong ngày đó (không sửa `monthlyReport`, vẫn đọc
   `punch.approvedAt`). `rejectManual` un-stamp nếu trước đó đã approved.
4. Bảng mới **bắt buộc bật Row-Level Security** theo đúng pattern `time_punch`
   (`app_is_super_admin() OR (app_principal_kind()='staff' AND facility_id = ANY(app_facility_ids()))`)
   — phát hiện qua red-team: role runtime `cmc_app` sẽ trả toàn bộ row nếu thiếu RLS, rò `reason`
   (nội dung nhạy cảm) chéo cơ sở.
5. `todayStatus` trả thêm `manualApproval: none|pending|approved|rejected` để UI không hiển thị "Hoàn
   thành" cho ngày bị từ chối (trước đó mâu thuẫn với payroll).

## Ngoài phạm vi

- Ca đêm vắt qua nửa đêm ICT: phiếu sẽ tách 2 ngày — chấp nhận đợt này, xử lý sau nếu phát sinh nhân
  sự ca đêm thật.
- Cap số lần resubmit sau khi bị từ chối: chưa giới hạn (YAGNI), có audit qua `logEvent` + notify.

## Ảnh hưởng

- Breaking: `checkInOut.approveManual` đổi input `{punchId}` → `{ticketId}`; `pendingManual` trả
  danh sách phiếu thay vì punch. Cả 2 caller (`checkin-panel.tsx`, E2E) cập nhật trong cùng plan.
- Migration: `20260704155851_manual_attendance_ticket` (add-table + RLS only, không alter bảng cũ).
