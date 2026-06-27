# Plan — Đóng 4 defect backlog họp-PH (sinh từ T13)

> Lập 2026-06-24. Lane: normal (stronger validation). Intake #1.
> Nguyên tắc: làm tuần tự theo wave · verify từng việc bằng test thật · item bảo mật/đổi-hành-vi (#1, #3) chạy review trước khi đóng.

## Quyết định nghiệp vụ (chủ dự án chốt 2026-06-24)
- **#2 Giờ họp:** giữ NGÀY, giờ = TBD/null. Cần cờ schema phân biệt "chưa chốt giờ" vs "đã chốt". Auto-gen → chưa chốt. UI hiển thị ngày + "(chưa chốt giờ)".
- **#3 Lớp đóng (running→closed) / cancel:** hủy mềm (status='cancelled') các meeting `scheduled` có `scheduledAt > now`.
- **#4 Program lạ:** vẫn bỏ qua sinh lịch nhưng **log cảnh báo** (audit/log) để vận hành phát hiện.

## Backlog items

| # | Việc | File chính | Verify-gate (đóng) | Review |
|---|------|-----------|--------------------|--------|
| B1 | `audit.follow` gate visibility (mirror `postNote`) trước `addFollower` | `apps/api/src/routers/audit.ts` | int-test: follow entity ngoài cơ sở → bị chặn (NOT_FOUND); follow entity hợp lệ → ok | 2-agent |
| B3 | Hủy mềm meeting tương lai khi lớp `setStatus→closed` và `cancel` | `apps/api/src/routers/class-batch.ts` | int-test: lớp running có 2 meeting tương lai → close → cả 2 = cancelled; meeting đã qua giữ nguyên | 2-agent |
| B4 | Warn khi program không có cadence (sinh 0 lịch im lặng) | `apps/api/src/services/parent-meeting-cadence.ts` | int-test: lớp program lạ → 0 meeting + 1 audit warn log | self |
| B2 | Meeting-time TBD: cờ `timeConfirmed` (migration additive) + render ngày-only khi chưa chốt + mutation `setSchedule` | `schema.prisma`, migration, `routers/parent-meeting.ts`, `apps/lms/src/parent-view.tsx` | int-test: auto-gen → timeConfirmed=false; setSchedule → true + giờ; myMeetings trả cờ. UI render "(chưa chốt giờ)" | self |

## Sóng thực thi (tránh đua migration/client)
- **Wave 1 (song song, không đụng schema):** B1, B3, B4 — 3 ck agent (Sonnet/Haiku), file rời nhau, mỗi agent tự viết int-test + tự chạy.
- **Wave 2 (đơn):** B2 (migration + router + UI + mutation + test).
- **Controller verify:** full int-suite + typecheck + `pnpm -r lint` xanh → commit từng cụm. Review B1/B3 trước khi đóng.

## File ownership (không chồng lấn)
- B1 → `audit.ts` (+ test)
- B3 → `class-batch.ts` (+ test)
- B4 → `parent-meeting-cadence.ts` (service, + test)
- B2 → `schema.prisma`, `migrations/`, `parent-meeting.ts`, `parent-view.tsx` (+ test)

## Kết quả (2026-06-24) — ĐÓNG
- Wave 1 (3 ck agent song song): B1, B3, B4 — int-suite 80/80, commit b39266e / 1e9ddb7 / 13ddf5e.
- Wave 2 (1 ck agent): B2 time-TBD (migration additive `time_confirmed` + `setSchedule` + render "(chưa chốt giờ)") — commit 3bea963.
- Review (1 code-reviewer, góc nhìn thứ 2; controller là pass 1) bắt **2 defect thật** → đã fix:
  - 🔴 CRITICAL: reminder không lọc `timeConfirmed` → nhắc meeting TBD ở 00:00 giả + đốt slot `remindedAt` → reminder thật không bao giờ chạy. Fix: `where.timeConfirmed=true` + test TBD-không-nhắc/chốt-giờ-rồi-nhắc. Commit **bf1fb8f**.
  - 🟠 HIGH: `audit.followers` thiếu gate (sibling B1) → rò rỉ danh sách follower xuyên cơ sở (record_follower không RLS). Fix: gate giống follow + test. Commit **ce94a87**.
- Verify cuối: int-suite **85/85 PASS**, typecheck + `pnpm -r lint` xanh. 6 commit trên `develop`.
- Backlog harness: #1–#4 → implemented; phát sinh **#5** (warn-volume, MED) + **#6** (reopen không khôi phục meeting, LOW) — defer.

## Câu hỏi mở
- B2: chưa có màn hình staff để nhập giờ (chỉ có backend `setSchedule` + parent-portal render). Staff UI hoãn — YAGNI; mở khi dựng màn quản lý họp PH.
- #5/#6: chờ chủ dự án xếp ưu tiên.
