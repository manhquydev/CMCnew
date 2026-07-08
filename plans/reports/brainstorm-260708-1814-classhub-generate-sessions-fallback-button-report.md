---
title: "Fallback thủ công cho sinh buổi tự động (class-workspace.tsx)"
date: 260708-1814
status: decided
mode: brainstorm
scope: tiny
---

# Vấn đề
Vừa thêm auto-generate buổi học khi tạo lớp (`class-workspace.tsx` `CreateClassModal.create`). 2 lỗ hổng rủi ro:
1. `generateSessions` throw lỗi (trùng lịch phòng/GV) lúc tạo lớp → có toast lỗi nhưng không có nút bấm lại ngay, chỉ ghi trong message text.
2. `endDate` chưa tính kịp lúc tạo (preview curriculum chưa load) → auto-gen bị skip ÂM THẦM, không toast gì.

Fallback thủ công đã tồn tại (`ClassHub.doGenerate`, dùng `batch.startDate/endDate` sẵn có, không cần nhập gì) nhưng nằm 2 lớp menu ("Thao tác" → "Sinh lại buổi theo lịch"). `SessionsTab` khi 0 buổi chỉ hiện **text hint**, không phải nút thật.

# Approaches
- **A (chosen):** Đổi text hint ở `SessionsTab` (0 buổi) thành nút thật gọi `generateSessions` bằng `batch.startDate/endDate`. Fix thêm: toast rõ khi auto-gen skip/fail lúc tạo lớp (không còn im lặng). Ít code nhất — tái dùng logic `doGenerate`.
- B: Banner cảnh báo đầu hub (ngoài tab), luôn thấy ngay — cần thêm 1 query đếm buổi ở `ClassHub`. Reject cho giờ (YAGNI, chưa có bằng chứng GV bỏ sót tab).
- C: Auto-retry ngầm, không thêm nút — reject, đi ngược yêu cầu có nút thủ công.

# Quyết định
A. Lý do: rẻ nhất, đúng chỗ vấn đề hiện ra, không thêm state/query mới, không bắt user làm việc thừa (1 click tại chỗ thay vì đào 2 lớp menu).

# Việc cần làm (tiny — patch trực tiếp, không cần plan riêng)
1. `SessionsTab`: thêm prop `onGenerate`/tái dùng `doGenerate` từ `ClassHub`, render nút thật thay dòng text khi `sessions.length === 0`.
2. `CreateClassModal.create`: khi `!endDate` (auto-gen bị skip) → thêm `notifyError`/`notifyInfo` báo rõ, thay vì im lặng.
3. tsc + live-verify tab "Buổi học" của 1 lớp mới tạo (case trùng lịch + case bình thường).

# Unresolved
- Không.
