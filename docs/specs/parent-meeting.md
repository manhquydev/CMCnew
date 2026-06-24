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
→ `ClassBatch` → `Enrollment(active)` → distinct `Student`
→ tạo `Notification` cho **mỗi học sinh** (1/HS): `recipientType='student'`, `recipientId=studentId`, `type='parent_meeting_reminder'`, `payload={meetingId, classBatchId, title, scheduledAt}`. Phụ huynh thấy nhắc qua feed principal-aware sẵn có (notification của HS được surface cho PH của HS đó) — không gửi trực tiếp theo `parentAccountId`.
→ set `meeting.remindedAt = now` (trong cùng giao dịch → không nhắc lại).

## Lộ trình build (slice dọc) — ✅ HOÀN TẤT 2026-06-24
- **PM1 — Schema:** ✅ `ParentMeeting` + migration `20260624025523_phase5_parent_meeting` + RLS (staff-facility + parent-via-enrollment, nhân từ exercise). Commit 605c576.
- **PM2 — Router + worker:** ✅ CRUD staff (create/list/setStatus) + `myMeetings` (lmsAuth) + service idempotent + cron nhúng (node-cron */30) + `runReminders` super-only. Commit 9f5284f. *Verified live:* tick nhắc 1 lịch → 3 notification; tick lần 2 → 0 (remindedAt); PH HQ thấy trong feed + myMeetings; PH CS2 không thấy (RLS).
- **PM3 — UI:** ✅ tab "Họp PH" trong chi tiết lớp (teaching): tạo/list/đã-họp/hủy. Commit 4be4bf3. PH nhận nhắc qua feed notification sẵn có (PM2). *Verified live:* list + setStatus qua tRPC.

## Bất biến kỹ thuật
- Worker idempotent qua `remindedAt`; tick lặp lại an toàn (đúng-một-lần mỗi lịch).
- Logic chọn người nhận = distinct `studentId` của enrollment active (service `parent-meeting-reminder.ts`) — recipientId theo HS, PH nhận gián tiếp qua feed.
- Notification tái dùng hệ sẵn có (principal-aware RLS) — không thêm kênh mới.
- Giờ ICT; soft-delete; audit mọi mutation trạng thái.
