# Chặng 6 — Email tài khoản tới Phụ huynh

Mục tiêu: xác nhận hệ thống có gửi (hoặc xếp hàng gửi) email thông báo tài khoản LMS cho PH sau khi phiếu thu được duyệt.

## Kết quả tại phiên này

Brevo (transport gửi email cho địa chỉ ngoài công ty — quyết định 0030) **chưa cấu hình key thật ở local** (quyết định preflight chặng 0) → email **không gửi thật ra ngoài**, chỉ dừng ở bước xếp hàng (outbox), đúng theo phương án fallback đã chốt.

Verify SQL:
```sql
SELECT transport, status, to_address, template_kind
FROM email_outbox
WHERE to_address LIKE '%@gmail.com'
ORDER BY created_at DESC;
```
Kết quả:
```
transport | status | to_address                  | template_kind
brevo     | queued | manhquy.mqy+e2e2@gmail.com  | lms_account_ready
```

`status='queued'` xác nhận: hệ thống ĐÃ tạo đúng bản ghi email (đúng transport `brevo` vì địa chỉ ngoài domain công ty, đúng loại `lms_account_ready`) — chỉ chưa gửi ra ngoài vì thiếu API key Brevo ở môi trường local. Khi triển khai thật (có Brevo key), cron `runEmailOutbox` (chạy mỗi phút) sẽ tự động gửi các dòng `queued` này.

## Bug thật phát hiện + đã sửa ở chặng này

Khi verify lần đầu (phiếu PT-2026-0001, chặng 5), **không có dòng email_outbox nào được tạo** dù đã nhập email PH lúc duyệt — phát hiện bug thật trong `finance.ts` (đọc nhầm biến `receipt.parentEmail` thay vì `input.parentEmail`), đã sửa và verify lại thành công ở phiếu PT-2026-0014 (kết quả ở trên). Xem chi tiết `../05-receipt-approve/guide.md` và `reports/bug-log.md` #9.

## Vai trò tiếp theo
Chặng 7 (Phụ huynh/Học sinh): đăng nhập cổng học LMS — xem `../07-portal-login/guide.md`.
