# Research Report: Callio (Phonenet) API Integration cho KPI cuộc gọi

> Thực hiện: 2026-06-25 11:34 ICT · Nguồn: docs.callio.vn, github.com/gadgetvn/phonenet-sdk, callio.vn hướng dẫn tích hợp

## Executive Summary

Callio chạy trên backend **Phonenet** (`clientapi.phonenet.io`). Không cần webhook để lấy
dữ liệu cuộc gọi cho KPI — dùng **polling CDR API bằng token** (token có sẵn trong
`client.callio.vn → Cài đặt → Quản lý token`). Đây là hướng khả thi nhất vì UI Callio của
user KHÔNG có mục cấu hình webhook lộ ra ngoài.

Kiến trúc Phonenet (từ sơ đồ chính thức repo) có 4 module: **WebRTC** (gọi/nghe ở frontend),
**User** (CRUD user/extension), **Call/CDR** (lịch sử cuộc gọi + ghi âm — backend), **Webhook**
(Phonenet push tới bên thứ 3 khi có cuộc gọi — backend, cần liên hệ Callio bật).

## Xác nhận kỹ thuật

### Base + Auth
- Base URL: `https://clientapi.phonenet.io`
- Auth: HTTP header `token: <token>` (KHÔNG phải Bearer). Content-Type `application/json`.
- Token lấy ở `client.callio.vn → Cài đặt → Quản lý token`. Token kế thừa quyền của user tạo ra nó.

### CDR API (lịch sử cuộc gọi) — nguồn dữ liệu KPI calls
```
GET /cdr?page=1&pageSize=100&group=<groupId>&keyword=<text>
Header: token: <token>
```
- Phân trang `page`/`pageSize` (giống User API, trả `{docs, totalDocs, limit, totalPages, page}`).
- Field response chi tiết (duration/billsec/direction/ext...) KHÔNG có trong README; cần capture
  1 response thật để khóa schema. **Tài liệu đầy đủ nằm trong file .docx của repo + ảnh CDR
  (chưa OCR được hết).**

### User API — map extension → userId hệ thống
```
GET /user?page=1&pageSize=100&keyword=
```
Response mỗi user gồm: `_id`, `email`, `name`, `phone`, `ext` (số extension), `role`
(owner/admin/agent), `active`. → **Map được:** `ext` của Callio ↔ `email` ↔ `AppUser` trong CMCnew.

## Hướng tích hợp đề xuất cho CMCnew

**Polling job (KISS, không cần Callio bật webhook):**
1. Lưu `callioExt` (số extension) vào `EmploymentProfile`/`AppUser` — map sang user nội bộ.
2. Cron/worker mỗi N phút (hoặc chạy khi tính lương): `GET /cdr` theo khoảng kỳ lương, phân trang hết.
3. Lọc cuộc gọi hợp lệ: `direction = outbound` (gọi ra) **AND** `duration/billsec > 5s`.
4. Gom theo `ext` → đếm số cuộc hợp lệ/tuần → so chuẩn 360 calls/tuần → ra điểm tiêu chí PC hiệu suất.
5. Lưu snapshot vào bảng `call_metric` (đóng băng theo kỳ, có audit) để lương tái lập được.

**Vì sao polling thay vì webhook:** webhook Phonenet cần Callio bật phía server (UI user không có);
polling chỉ cần token user tự lấy được → ít phụ thuộc, tự chủ, đủ cho mục đích tính lương theo kỳ.

## Cần user cung cấp để khóa schema
1. **Token Callio** (hoặc 1 token test) — để gọi thử `/cdr` và `/user`.
2. **1 CDR response mẫu** (gọi `GET /cdr?page=1&pageSize=1` với token) — khóa tên field thật:
   `duration`? `billsec`? `direction`/`callType`? `ext`/`agent`? `startTime`?
3. Xác nhận quy ước "extension nào của ai" — gán `callioExt` cho từng sale.

## Red flags
- Field name CDR CHƯA chắc — tuyệt đối không hardcode trước khi có response thật.
- Múi giờ: CDR có thể trả epoch ms (giống User API `createTime: 1579714789883`) — chuẩn hóa ICT.
- Rate limit: chưa tài liệu hóa; polling nên có backoff + pageSize hợp lý (100).
- "Cuộc gọi hợp lệ >5s": phải xác nhận đo bằng `billsec` (thời gian đàm thoại thực) chứ không phải
  `duration` tổng (gồm thời gian đổ chuông) — 2 con số khác nhau về bản chất.

## Unresolved questions
1. Field duration thật của CDR là gì (`billsec` vs `duration`)?
2. Callio có cho bật webhook qua support không, hay chỉ polling?
3. Rate limit `/cdr` là bao nhiêu?

## Sources
- https://github.com/gadgetvn/phonenet-sdk (README + sơ đồ kiến trúc)
- https://callio.vn/tich-hop-phan-mem-ben-thu-3/
- https://wiki.getfly.vn/portal/post/2380
- https://docs.callio.vn/
