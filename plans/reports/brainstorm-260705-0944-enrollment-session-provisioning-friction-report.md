# Brainstorm: Ghi danh / Sinh buổi học / CRM→Student friction

Date: 2026-07-05. Branch: develop.

## Problem statement

PO complaint: quy trình để 1 học sinh tồn tại + ghi danh + vào lớp quá rườm rà, nhiều bước thủ công rủi ro cao. 3 triệu chứng cụ thể:
1. Test CRM tới O5 (thắng deal) không thấy học sinh đâu trong hệ thống.
2. "Sinh buổi học" là bước bấm tay riêng dù input đã đủ từ lúc tạo lớp.
3. Ghi danh (enroll) UI có lẫn cả tạo học sinh — trong khi ghi danh lẽ ra phải đi sau xác nhận đóng phí.

Mục tiêu trước mắt: dọn đường để tính năng nhận xét/đánh giá HS + gửi ảnh lớp cho PH hoạt động được — cả hai phụ thuộc chuỗi Student→Enrollment→ClassSession→Attendance chạy trơn tru.

## Hiện trạng thật (scout code, không phải doc)

- **Student chỉ tạo tại `finance.receiptApprove`** (`apps/api/src/routers/finance.ts:791-801`) — atomic: Student + ParentAccount + Enrollment (nếu có classBatchId) + LMS account. Chủ đích, theo quyết định `docs/decisions/0033-student-login-phone-identity.md`: "no regular staff UI path can create an orphan student outside the financial provisioning seam".
- **CRM (Contact/Opportunity, O1-O5) không đụng Student.** O5 = flag trạng thái business, không tự tạo Receipt. → Case PO test tới O5 không ra student là ĐÚNG theo thiết kế hiện tại, không phải bug — nhưng là gap thao tác: không ai document rõ bước bàn giao CSKH→Finance.
- **`enrollment.enroll`** (`enrollment.ts:51`) chỉ cần `studentId` có sẵn, KHÔNG check receipt/thanh toán. Lỗ hổng thật: ghi danh lớp thứ 2+ cho student đã tồn tại không cần xác nhận đóng phí gì cả.
- **`CreateStudentModal`** (`class-workspace.tsx:758-889`) nhét trong tab Enroll, chỉ hiện với super_admin — lẫn lộn 2 concern (ghi danh vs tạo hồ sơ break-glass).
- **Session generation**: `class-batch.create` đã capture đủ `startDate/endDate/slots[]`; `schedule.generateSessions` chỉ đọc lại đúng data đó + date range để enumerate `ClassSession`. Không có lý do kỹ thuật để tách bước bấm tay — chỗ tối ưu rẻ nhất.
- **Attendance** (`attendance.ts` `mark`/`markAll`) bắt buộc `ClassSession` tồn tại trước — phụ thuộc cứng vào generateSessions đã chạy.

## Quyết định đã chốt với PO

| # | Vấn đề | Quyết định |
|---|--------|-----------|
| 1 | CRM(O5)→Student | **Giữ nguyên kiến trúc** (0033 không đảo ngược). Bổ sung: SOP tài liệu quy trình bàn giao CSKH→Finance + nút UI "Tạo phiếu thu" trên card Opportunity O5, nhảy sang màn Receipt với tên HS/SĐT PH/lớp điền sẵn từ Opportunity (không tự tạo student, chỉ đỡ gõ tay + giảm thất lạc thông tin khi chuyển phòng ban). |
| 2 | Sinh buổi học | Tự động sinh sessions ngay trong transaction tạo lớp nếu đủ startDate/endDate/slots. Nút "Sinh lịch" giữ lại làm nút tái tạo/mở rộng (thêm slot mới, gia hạn ngày, hoặc lớp tạo thiếu ngày ban đầu). |
| 3 | Ghi danh chưa đóng phí | Enroll 2 bước: `enrollment.enroll` tạo Enrollment ở trạng thái `pending_payment` ngay (giữ chỗ sĩ số), chuyển `active` (tính điểm danh/đánh giá) khi Receipt tương ứng được duyệt. |
| 4 | Tạo HS lẫn trong Enroll UI | Xoá `CreateStudentModal` khỏi tab Ghi danh. Tính năng break-glass/seed (nếu vẫn cần) chuyển sang trang quản trị riêng, tách khỏi luồng ghi danh. |

## Implementation considerations & risks

- **#3 là thay đổi data model + business logic tài chính** → chạm risk flags "Data model" + "Existing behavior" + có thể "Authorization" (ai được enroll pending vs active) → lane **high-risk** theo `docs/FEATURE_INTAKE.md` risk checklist, cần story folder high-risk + decision doc nếu thay đổi enrollment status enum/flow.
- Cần xử lý: Enrollment đang `active` hiện tại (dữ liệu cũ) — migration cần backfill status mặc định `active` cho enrollment cũ để không phá điểm danh/đánh giá đang chạy.
- #2 (auto-gen sessions) cần xử lý case lớp sửa slots/dates SAU khi đã tạo (đổi lịch) — nút thủ công vẫn cần tồn tại để re-generate, tránh double-booking phòng/GV (logic conflict-check đã có sẵn ở `schedule.ts:174-219`, tái dùng được).
- #1 (nút UI) là bổ sung thuần UI, rủi ro thấp, không đổi rule tạo student.
- #4 (xoá modal) rủi ro thấp nếu không ai đang phụ thuộc luồng breakglass đó — cần confirm với ops trước khi xoá hẳn (hay chỉ ẩn/deprecate).

## Success metrics

- CRM O5 case có SOP rõ ràng: staff biết chính xác bước tiếp theo, không còn "học sinh biến mất".
- Tạo lớp xong → sessions có ngay, không cần bấm thêm (trừ case sửa lịch).
- Enrollment lớp 2+ không thể vào trạng thái active (tính điểm danh) nếu chưa có receipt approved — audit trail rõ ràng.
- Tab Ghi danh không còn form tạo học sinh.

## Next steps

- Không tự triển khai — cần `/ck:plan` (khuyến nghị mode high-risk cho phần #3, normal cho #1/#2/#4) để tách phase, viết story/decision doc cho thay đổi enrollment status.

## Unresolved questions

- Enrollment cũ (đã active) có cần audit lại xem có receipt hậu thuẫn hay không, hay chấp nhận backfill mặc định active không hồi tố?
- Trang quản trị riêng cho break-glass student-create (#4) — tạo mới hay dùng lại trang Student Management hiện có (nếu có)?
