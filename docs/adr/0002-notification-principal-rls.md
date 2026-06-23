# ADR 0002 — Notification RLS phải principal-aware (không facility-only)

Trạng thái: **Đã áp dụng** (2026-06-23, security-class) · Slice S1.6 · Bổ sung cho [0001](0001-stack-and-architecture.md) và quyết định principal-aware RLS (migration `20260623100000_principal_aware_rls`).

## Bối cảnh

Migration principal-aware RLS (S1.3) nâng policy của `student`, `enrollment`, `submission`,
`grade`, `star_transaction`, `reward`, `exercise` sang dạng *staff→facility, parent/student→ownership*
— **nhưng bỏ sót bảng `notification`**. Bảng này vẫn giữ policy Phase-2 cũ: facility-only.

Hệ quả thật: một phụ huynh/HS principal khi đọc `notification` sẽ khớp mệnh đề
`facility_id = ANY(app_facility_ids())` → **thấy MỌI thông báo trong cùng cơ sở**, kể cả thông
báo điểm của con nhà khác. Đây là rò rỉ dữ liệu giữa các gia đình (privacy leak), phát hiện khi
build đường đọc notification + SSE realtime ở S1.6.

## Quyết định

Notification là dữ liệu **được địa chỉ hoá** (`recipient_id` = id của HS sở hữu). Policy phải pin
theo chủ sở hữu, không theo cơ sở:

```sql
USING (
  app_is_super_admin()
  OR (app_principal_kind() = 'staff' AND (facility_id IS NULL OR facility_id = ANY (app_facility_ids())))
  OR (app_principal_kind() <> 'staff' AND recipient_id = ANY (app_student_ids()))
)
WITH CHECK ( ... cùng dạng ... )
```

- **staff**: giữ phạm vi cơ sở (`facility_id IS NULL` = broadcast hệ thống vẫn an toàn cho staff).
- **parent/student**: chỉ `recipient_id ∈ app.student_ids` (tập con/chính mình).
- `WITH CHECK` cho principal tự cập nhật (đánh dấu đã đọc) đúng hàng của mình; không thể đổi
  `recipient_id` sang HS khác (cả hai mệnh đề đều ghim).

Migration: `20260623120000_notification_principal_rls`.

## Hệ quả & bằng chứng

- Đóng lỗ rò: phụ huynh chỉ thấy thông báo của con mình.
- Bằng chứng tái lập được: `pnpm --filter @cmc/db exec tsx src/verify-notification-rls.ts`
  → parent A chỉ thấy A (không thấy B), student B chỉ thấy mình, staff thấy cả cơ sở.

## Bài học (đưa vào checklist)

Khi thêm bảng tenant mới hoặc viết migration principal-aware: **liệt kê ĐỦ mọi bảng có dữ liệu
gắn HS/PH** — kiểm tra từng bảng đã chuyển sang ownership chưa, đừng để sót bảng nào ở facility-only.
Bảng "được địa chỉ hoá theo recipient" dễ bị bỏ quên vì không có cột `student_id` trực tiếp.
