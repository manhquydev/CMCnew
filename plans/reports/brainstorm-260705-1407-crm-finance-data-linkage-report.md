# Brainstorm: liên kết dữ liệu CRM ↔ Tài chính khi lập phiếu thu

Ngày: 2026-07-05. Nguồn gốc: user review tài liệu `docs/user-guides/huong-dan-vong-doi-hoc-sinh.html`, phát hiện bước 5 (lập phiếu thu) yêu cầu gõ tay SĐT/tên PH/tên HS dù thông tin này đã có sẵn ở CRM — lo ngại rủi ro sai sót nhập liệu và thiếu liên kết chặt giữa 2 module.

## Vấn đề

1. **Rủi ro gõ tay lặp lại dữ liệu CRM → Tài chính.** Module Tài chính có 1 form "Học sinh mới" độc lập, nhập tay 100% (SĐT, tên PH, tên HS) — trùng lặp với dữ liệu đã có trong `Contact`/`Opportunity` ở CRM.
2. (Phát hiện thêm giữa phiên, từ 1 tin nhắn khác của user) **Tài liệu thiếu luồng "ghi danh thủ công"** — chỉ nhắc ghi danh tự động lúc duyệt phiếu, bỏ sót tab "Ghi danh" trong màn Lớp học (dùng cho học sinh cũ ghi danh thêm lớp).

## Phát hiện qua đọc code (không suy đoán)

- `apps/api/src/routers/finance.ts` `receiptCreate`: đã nhận sẵn `opportunityId` optional (dòng 483), gắn vào receipt để tính hoa hồng đúng cơ hội (dòng 1017-1048).
- `apps/admin/src/opportunity-detail.tsx` `createOpportunityReceipt` (dòng 407-434): có sẵn nút "Lập phiếu thu" ngay trên trang Cơ hội, tự điền `parentPhone: opp.contact.phone`, `parentName: opp.contact.fullName`, `studentName`, và gắn `opportunityId: opp.id` — **không gõ tay lại**.
- `apps/admin/src/finance-panel.tsx` (dòng ~1221-1387): form "Học sinh mới" độc lập trong module Tài chính — **hoàn toàn tách biệt, không có ô tìm/liên kết cơ hội CRM nào**. Đây là form được dùng trong buổi E2E walkthrough (chọn nhầm cửa vào).
- `apps/api/src/routers/enrollment.ts` `enroll` (dòng 51-): mutation ghi danh thủ công riêng biệt cho học sinh đã tồn tại, có sẵn guard chống trùng thân thiện (dòng 64-71, trả CONFLICT sạch thay vì P2002 thô) — pattern tham khảo cho phương án C.
- `apps/admin/src/class-workspace.tsx` (dòng 843, 885, 1296): tab "Ghi danh" trong màn Lớp học gọi thẳng `enrollment.enroll`.
- `apps/api/src/routers/crm.ts` `opportunityList` (dòng 201-212): trả tối đa 200 cơ hội/cơ sở kèm `contact.{fullName,phone}` — đủ dữ liệu để làm nền cho tra cứu theo SĐT, chưa có endpoint lọc theo SĐT riêng.

## Kết luận

Rủi ro user nêu là có thật, nhưng KHÔNG phải vì hệ thống chưa có cơ chế liên kết — mà vì **có 2 cửa vào cùng 1 chức năng** (`receiptCreate`), 1 cửa an toàn (từ trang Cơ hội, tự điền) đã tồn tại nhưng ít được dùng/biết tới, 1 cửa rủi ro (form Tài chính độc lập) không có gì ngăn gõ sai/gõ trùng và không cảnh báo khi trùng SĐT với 1 cơ hội đang mở.

## Phương án đánh giá

| # | Phương án | Việc phải làm | Chống được gì | Rủi ro/hạn chế |
|---|---|---|---|---|
| A | Chỉ sửa tài liệu — hướng dẫn luôn dùng nút "Lập phiếu thu" từ trang Cơ hội khi đã qua CRM | Sửa doc | Không gì (chỉ giáo dục) | Không ngăn được thói quen dùng sai cửa |
| B | Thêm ô "Tìm cơ hội theo SĐT" trong form Tài chính độc lập, tự điền nếu khớp | UI (`finance-panel.tsx`) + 1 query nhẹ (tái dùng/mở rộng `crm.opportunityList` hoặc thêm `crm.opportunityFindByPhone`) | Gõ sai/gõ lại khi ĐÃ có cơ hội CRM (rủi ro gốc user nêu) — chỉ ở 1 cửa | Chỉ bảo vệ cửa Tài chính, không bảo vệ các đường tạo receipt khác trong tương lai |
| C | Cảnh báo mềm phía server (`receiptCreate`) khi tạo phiếu học sinh mới mà SĐT trùng 1 cơ hội đang mở nhưng không gắn `opportunityId` — cần `confirmDuplicate: true` mới cho tạo tiếp | Backend (`finance.ts`) + dialog xác nhận FE | Tạo phiếu mồ côi/trùng ở MỌI cửa vào, kể cả tương lai (API, import) | Cần xử lý false-positive (SĐT dùng chung cho 2 con) bằng override rõ ràng, không chặn cứng |

B và C giải quyết 2 lỗi khác nhau (B = sai do gõ tay khi lẽ ra nên dùng dữ liệu có sẵn; C = quên liên kết/tạo trùng) — không thay thế nhau.

## Quyết định của user

- **Chọn cả B + C, làm B trước.**
- Đã sửa ngay `docs/user-guides/huong-dan-vong-doi-hoc-sinh.html` bước 5: thêm rõ 2 cửa vào (từ Cơ hội CRM vs khách vãng lai), làm nổi bật bước ghi danh tự động, bổ sung đoạn về ghi danh thủ công qua tab "Ghi danh" trong Lớp học (khắc phục phát hiện #2).

## Rủi ro/ràng buộc cần lưu ý khi lập plan cho B/C

- Đụng `finance.ts` (module tài chính, mutation nghiệp vụ tiền) — theo `docs/DECISION_INDEX.md` của dự án, cần kiểm tra hàng nào match trước khi sửa; nếu chưa có decision doc bao trùm khu vực này, việc thêm field `confirmDuplicate` + logic cảnh báo trùng có thể cần 1 decision doc mới (thay đổi hành vi API công khai).
- `crm.opportunityFindByPhone` (nếu thêm mới) cần xác định phạm vi RLS đúng như `opportunityList`/`opportunityGet` hiện tại (facility-scoped).
- Case SĐT dùng chung cho 2 con (anh chị em) là hợp lệ thật — cả B và C phải cho phép override rõ ràng, không được chặn cứng.

## Câu hỏi còn mở

- `crm.opportunityFindByPhone` nên là endpoint mới hay chỉ lọc client-side trên `opportunityList` đã có (tối đa 200 dòng/cơ sở, có thể đủ nhẹ để không cần endpoint riêng)?
- Ngưỡng "cơ hội đang mở" cho việc cảnh báo trùng (C) nên loại trừ đúng những stage nào — chỉ loại `lost`, hay cả cơ hội đã "Nhập học" (O5) từ rất lâu (có thể là dữ liệu cũ không còn liên quan)?
