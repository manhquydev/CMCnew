# 2026-07-05 — Chấm công: phiếu lý do + bấm cả ngày + che IP — shipped

Triển khai đủ pipeline brainstorm → plan → red-team → validate → implement cho 4 yêu cầu
gốc về chấm công: (1) bấm nhiều lần lấy đầu+cuối, (2) chấm ngoài WiFi cần lý do 1
lần/ngày + duyệt 1 lần, (3) reset qua ngày mới, (4) che IP.

## Sự cố đầu phiên

`apps/api/` (377 file) bị xóa khỏi working tree khi mở phiên (không rõ nguyên nhân) —
`git restore` khôi phục 100% từ HEAD, không mất gì.

## Tách 2 plan (không nhồi 1 plan)

- **Plan A** (`260704-2133-attendance-manual-ticket-reason`, HIGH-RISK): thêm model
  `ManualAttendanceTicket` (1 phiếu/người/ngày ICT, RLS bắt buộc), đổi `punch()` rẽ nhánh
  theo trạng thái phiếu, chuyển duyệt per-punch → per-ticket, thêm `rejectManual`.
- **Plan B** (`260704-2134-attendance-allday-punch-ux`, NORMAL, phụ thuộc A): bỏ khóa nút
  sau checkout, debounce 30s→5s + cooldown UX, verify reset ICT, che IP self-view.

## Phát hiện thật qua red-team + code-review (không phải lý thuyết)

- **RLS thiếu trên bảng mới** → rò lý-do-nghỉ chéo cơ sở (role `cmc_app` trả toàn bộ row
  nếu không bật RLS). Bắt buộc thêm policy khớp `time_punch`.
- **Return-shape landmine**: nhánh `requiresReason` đi qua `.then` post-commit cũ sẽ bị
  `{...undefined}` nuốt mất cờ, FE không mở modal.
- **Blast radius vượt phạm vi plan gốc**: `dashboard.ts` có bản sao logic `pendingManual`
  cho hộp duyệt điều hành (`myApprovals`), và 2 cockpit panel (`biz-director`,
  `edu-director`) gọi `approveManual({punchId})` — không nằm trong danh sách file của plan
  ban đầu, phát hiện qua grep + code-review, đã sửa đồng bộ.
- **Test fixture snapshot thiếu**: `permission-snapshot.json` chưa có `checkInOut.rejectManual`
  → `permission-parity.test.ts` fail. Sửa. (2 lỗi khác — `brevo-client.test.ts`,
  `guardian.resetFamilyPassword` snapshot — xác nhận có sẵn từ trước qua `git stash`, không
  đụng tới, ngoài phạm vi.)

## Kết quả

- Migration `manual_attendance_ticket` + RLS, `manual_attendance_notif_events` (2 enum
  value mới) — áp dụng dev DB sạch.
- 594/594 integration test xanh (107 file); typecheck + lint sạch cả `@cmc/api`/`@cmc/admin`/`@cmc/db`.
- Cả 2 plan qua code-review gate: Plan A có 1 CRITICAL + 1 MEDIUM + 1 LOW (đã sửa hết,
  re-verify xanh); Plan B không có finding nào.
- Quy trình khôi phục thủ công 1 process dev-server bị khóa file Prisma engine (dừng đúng
  `pnpm --filter @cmc/api dev`, không đụng process khác) để chạy `prisma generate`.

## Chưa xong / follow-up

- E2E (`work-shift-manual-punch-approval.spec.ts`, `work-shift-attendance.spec.ts`) đã cập
  nhật theo API mới nhưng **chưa chạy** phiên này (không có dev/browser stack sống — đã
  dừng api dev server để giải phóng file lock, chưa khởi động lại).
- Ca đêm vắt nửa đêm ICT: ngoài phạm vi (quyết định user).
- Resubmit sau reject: chưa giới hạn số lần (YAGNI có chủ đích, có audit log).

## Quyết định ghi lại

`docs/decisions/0034-manual-attendance-daily-ticket.md` — phiếu theo ngày, RLS bắt buộc,
duyệt/từ chối per-ticket, reopen với lý do mới.
