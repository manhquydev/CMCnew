# 0010 Callio (Phonenet) call-metrics cho KPI sale

Date: 2026-06-25

## Status

Accepted

## Context

KPI sale yêu cầu chỉ tiêu cuộc gọi (tài liệu CMC: 360 cuộc/tuần). Tổng đài đang dùng là
**Callio**, chạy trên backend **Phonenet** (`clientapi.phonenet.io`). Giao diện Callio của
operator KHÔNG có mục cấu hình webhook lộ ra; chỉ có "Quản lý token". Cần lấy lịch sử cuộc gọi
để tính KPI mà không phụ thuộc Callio bật webhook phía server.

Đã verify live bằng token thật (2026-06-25): `GET /user` và `GET /call` hoạt động với header `token`.

## Decision

Tích hợp theo **polling** (CMCnew chủ động kéo), không webhook:

- Auth: HTTP header `token: <CALLIO_API_TOKEN>` (env), KHÔNG phải Bearer.
- Endpoint lịch sử cuộc gọi: `GET {CALLIO_API_BASE}/call?from=<ms>&to=<ms>&page=&pageSize=100`.
  Filter thời gian `from`/`to` (epoch ms) hoạt động phía server; phân trang `page`/`pageSize`
  với `hasNextPage`.
- **Cuộc gọi hợp lệ** (đếm cho KPI) = `direction === "outbound"` **AND** `billDuration > 5`
  (giây đàm thoại thực; KHÁC `duration` = tổng gồm đổ chuông).
- **Map nhân sự**: `call.fromUser.email` (hoặc `fromExt`) ↔ `AppUser.email`. Lưu `callioExt`
  trên `EmploymentProfile` để map ổn định.
- **Snapshot theo kỳ**: gom số liệu vào bảng `call_metric` (đóng băng theo `periodKey`, có audit)
  để lương tái lập được; không gọi Callio lại khi recompute payslip đã có snapshot.
- Token trống = bỏ qua đồng bộ (KPI calls = 0), không ném lỗi.

## Alternatives Considered

1. **Webhook Phonenet push CDR**: cần Callio bật phía server, operator không tự làm được → loại
   cho v1; có thể bổ sung sau nếu Callio hỗ trợ.
2. **Đếm trực tiếp mỗi lần tính lương (không snapshot)**: số liệu đổi nếu Callio sửa CDR → mất
   tính tái lập của payslip đã finalize → loại.

## Consequences

Positive:

- Tự chủ: chỉ cần token operator tự lấy được; không lệ thuộc cấu hình phía Callio.
- Payslip tái lập được nhờ snapshot đóng băng theo kỳ.
- Field đã verify thật (billDuration, direction, fromUser.email) — không đoán schema.

Tradeoffs:

- Polling tốn request hơn webhook; mitigate bằng filter `from`/`to` + pageSize 100 + chạy theo kỳ.
- Rate limit Phonenet chưa tài liệu hóa → thêm backoff khi 429.
- Phụ thuộc gán đúng `callioExt`/email cho từng sale; sai map = KPI calls sai.
