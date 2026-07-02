# Brainstorm: Gộp nav Giáo viên theo mẫu Lịch 360

**Ngày:** 2026-07-01
**Vai trò:** Giáo viên (giao_vien) — vòng 1/6 (sale, GĐKD, GĐĐT, học sinh, phụ huynh làm ở vòng sau)
**Trạng thái:** Đã chốt phương án, chờ /ck:plan

## 1. Vấn đề

Nav ERP (`apps/admin`) cho vai trò giáo viên có 9 mục riêng lẻ: Lịch dạy, Điểm danh, Chấm bài, Học bạ, Lớp học, Khóa học, Họp PH, Phiếu lương của tôi, Chấm công. Mỗi mục là 1 trang riêng dù nhiều mục cùng phục vụ 1 công việc thực tế (dạy 1 buổi học). Hệ thống đã có tiền lệ gộp thành công: "Lịch 360" (`apps/admin/src/schedule-detail.tsx`) — gộp xem thông tin buổi học + điểm danh + việc sau giờ học (đăng bài LMS/ảnh lớp/comment mẫu) vào 1 màn hình đổi giao diện theo mốc giờ (trước/trong/sau buổi).

Bug phát hiện kèm theo: mục "Chứng chỉ" có permission hợp lệ (`certificate.list`) nhưng bị hardcode `visible: false` tại `apps/admin/src/shell.tsx:390`.

## 2. Yêu cầu

- Gộp theo TÁC VỤ thực tế của giáo viên, không theo bảng dữ liệu kỹ thuật (đúng tinh thần Lịch 360).
- Không đổi cấu trúc phân quyền hiện có trong `packages/auth/src/permissions.ts` / `apps/admin/src/nav-permissions.ts`.
- Output vòng này: tài liệu đề xuất (không code, không plan.md).
- Phạm vi: chỉ vai trò giáo viên; 5 vai trò còn lại (sale, GĐKD, GĐĐT, học sinh, phụ huynh) để vòng sau.

## 3. Phân tích: 9 mục nav → 3 công việc thật

| Mục nav hiện tại | Permission | Công việc |
|---|---|---|
| Lịch dạy | open | A. Lịch giảng dạy |
| Điểm danh | attendance.mark | A |
| Chấm bài | grading.grade | A/B tuỳ ngữ cảnh |
| Họp PH | meetings.setStatus | A (khi gắn buổi/lớp cụ thể) |
| Lớp học | open | B. Quản lý học sinh |
| Khóa học | open | B |
| Học bạ | assessment.termList | B |
| Chứng chỉ | certificate.list (đang bug ẩn) | B |
| Phiếu lương của tôi | open | C. Lương & chấm công |
| Chấm công | checkin.punch | C |

## 4. Phương án đã đánh giá

**PA1 — Lịch 360 mở rộng (CHỌN):** 9 mục → 3 mục (Lịch giảng dạy / Quản lý học sinh / Lương & chấm công). Kéo Chấm bài + Họp PH vào màn `schedule-detail.tsx` có sẵn (thêm nhánh theo permission, không đổi máy trạng thái theo giờ đã có). Gộp Lớp học+Khóa học+Học bạ+Chứng chỉ thành 1 màn 3-4 tab. Gộp Phiếu lương+Chấm công thành 1 màn 2 tab.
- Được: đúng tinh thần Lịch 360, tận dụng component có sẵn (DRY), giáo viên vào ít chỗ hơn để xong việc trong ngày.
- Mất: `schedule-detail.tsx` phình to hơn, cần test lại kỹ các nhánh theo giờ + theo permission.
- Rủi ro: TRUNG BÌNH — không đổi rulebook quyền, chỉ đổi nơi hiển thị theo permission (giữ nguyên cách nav-permissions.ts gate từng phần).

**PA2 — Chỉ gộp menu (loại):** Giữ 9 trang y hệt, chỉ nhóm dưới 3 tiêu đề cha có thể xổ ra trong sidebar. Rủi ro rất thấp, làm nhanh, nhưng không giải quyết vấn đề gốc (vẫn 9 trang riêng) — không đúng tinh thần bạn muốn.

**PA3 — Tất cả trong 1 siêu màn hình (loại):** Rủi ro cao — tải nhiều dữ liệu không liên quan cùng lúc (lương không liên quan lịch dạy), vi phạm KISS, phình code quá vai trò 1 component.

## 5. Rủi ro phân quyền (đánh giá thẳng)

Gộp UI không đổi permission trong `permissions.ts` — chỉ đổi chỗ hiển thị. Rủi ro thật nằm ở lúc code màn gộp: dễ lỡ tay hiện 1 tab/nút mà quên check permission riêng của nó (vd hiện nút "Chấm bài" cho giáo viên không có quyền `grading.grade` vì tab đã "vào chung 1 màn"). Plan chi tiết PHẢI có checklist test riêng cho từng permission trong màn gộp.

## 6. Khuyến nghị

**Phương án 1**, lý do: đúng yêu cầu (nhân rộng Lịch 360), rủi ro kiểm soát được, tận dụng code có sẵn. Fix kèm bug "Chứng chỉ" bị ẩn cứng khi gộp vào tab "Quản lý học sinh".

**Quy ước đặt tên:** tên mục nav dùng thể nghiệp vụ tổ chức (vd "Lịch giảng dạy", "Quản lý học sinh", "Lương & chấm công"), tránh xưng "của tôi/tôi phụ trách" — hệ thống phục vụ nhiều người dùng trong tổ chức, không phải công cụ cá nhân.

## 7. Việc cần làm tiếp (next steps)

1. `/ck:plan` chi tiết cho PA1 — thiết kế cụ thể 3 màn hình mới, danh sách file sửa (`shell.tsx`, `nav-permissions.ts`, `schedule-detail.tsx`), checklist test theo từng permission.
2. Sau khi giáo viên xong, lặp lại brainstorm này cho: sale+GĐKD (khối kinh doanh), GĐĐT (khối đào tạo giám sát), rồi học sinh/phụ huynh (LMS).
3. Không đổi nav các vai trò khác trong vòng này.

## 8. Success metrics

- Từ 9 mục nav giáo viên → 3 mục, không mất chức năng nào.
- `nav-consistency.test.ts` (đã có) vẫn pass sau khi đổi.
- Test thủ công: giáo viên KHÔNG có quyền `grading.grade` không thấy tab chấm bài trong màn gộp (và ngược lại cho từng permission).
- Bug "Chứng chỉ" hết bị ẩn cứng.
