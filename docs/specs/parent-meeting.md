# Đặc tả: Họp phụ huynh định kỳ theo lớp + nhắc tự động

> Trạng thái: ✅ **ĐÃ CHỐT** (2026-06-24) — quyết định nghiệp vụ do chủ dự án chốt, CTO spec hóa trước khi build.
> Bối cảnh: hệ thống chưa có thực thể "họp phụ huynh" nào (chỉ có `TestAppointment` của CRM và `ScheduleSlot`/`ClassSession` của lịch học). Đây là feature mới.

## Quyết định đã chốt
- **Họp phụ huynh = buổi họp định kỳ theo LỚP** (`ClassBatch`), không phải theo từng học sinh. 1 lịch họp → nhắc tất cả phụ huynh có con đang học (`Enrollment.status = active`) trong lớp đó.
- **Nhắc tự động qua node-cron NHÚNG trong tiến trình API** (không dựng worker/process riêng — ít ops nhất, đúng KISS). Nhịp: nhắc **trước T-1 ngày** (buổi họp nằm trong cửa sổ [now, now+24h]).
- **Chống nhắc trùng bằng cột `remindedAt` trên chính lịch họp** (idempotency ở tầng dữ liệu) — đơn giản và đúng hơn dùng Redis cho nhịp ngày. Redis (`:6380`) có sẵn nhưng KHÔNG cần cho cadence này.

## Mô hình dữ liệu
`ParentMeeting`:
- `id`, `facilityId`, `classBatchId` (FK → `ClassBatch`, cascade), `title`, `scheduledAt` (DateTime, giờ ICT), `location` (text, tùy chọn), `note` (tùy chọn).
- `status`: `scheduled → done | cancelled`.
- `remindedAt` (DateTime?, null = chưa nhắc) — cờ idempotency cho worker.
- `createdById`, `createdAt`, `archivedAt` (soft-delete). Audit/chatter mọi mutation.
- RLS: staff theo facility (giống các thực thể staff khác: `super OR (staff AND facility match)`). Phụ huynh đọc lịch họp của lớp con mình đang học (principal-aware, qua Guardian→Enrollment).

## Đường nhắc (worker tick)
`ParentMeeting (remindedAt=null, status=scheduled, scheduledAt ∈ [now, now+24h])`
→ `ClassBatch` → `Enrollment(active)` → `Student` → `Guardian` → `ParentAccount` (distinct)
→ tạo `Notification` cho mỗi phụ huynh: `recipientType='parent'`, `recipientId=parentAccountId`, `type='parent_meeting_reminder'`, `payload={meetingId, classBatchId, title, scheduledAt}`
→ set `meeting.remindedAt = now` (trong cùng giao dịch → không nhắc lại).

## Lộ trình build (slice dọc)
- **PM1 — Schema:** model `ParentMeeting` + migration + RLS policy (staff-facility + parent-via-enrollment). *Done:* migrate áp được; RLS chặn đúng.
- **PM2 — Router + worker:** CRUD staff (create/list/updateStatus/cancel) + parent-facing list (lmsAuth) + hàm tính người nhận (thuần, test được) + cron tick nhúng API + endpoint trigger thủ công (dev) để verify. *Done:* tạo lịch họp ngày mai → tick → đúng phụ huynh nhận notification → tick lần 2 không nhắc lại (remindedAt).
- **PM3 — UI:** staff đặt/đổi/hủy lịch họp trong app teaching; phụ huynh thấy lịch họp + notification trong LMS. *Done:* live.

## Bất biến kỹ thuật
- Worker idempotent qua `remindedAt`; tick lặp lại an toàn (đúng-một-lần mỗi lịch).
- Logic chọn người nhận tách thành hàm thuần (distinct parentAccountId của enrollment active) — test độc lập.
- Notification tái dùng hệ sẵn có (principal-aware RLS) — không thêm kênh mới.
- Giờ ICT; soft-delete; audit mọi mutation trạng thái.
