# Quyết định: Cơ sở là "nhãn" trong một hệ thống liên kết (Odoo-style branches)

Ngày: 2026-06-24 · Lớp: kiến trúc + bảo mật (security-class) · Trạng thái: ĐÃ CHỐT

## Bối cảnh

Các cơ sở CMC **không phải các công ty độc lập** mà là **chi nhánh** của một hệ thống.
Data cần xuyên suốt; cơ sở chỉ nên là một **nhãn để phân biệt / lọc** (đúng tinh thần
Odoo: `company_id` là một chiều dữ liệu, quyền truy cập do "allowed companies" + record
rules quyết định, KHÔNG phải mỗi công ty một silo tách biệt).

## Phát hiện từ codebase (số liệu, không phải cảm tính)

Kiến trúc hiện tại **đã** khớp mô hình Odoo, theo 3 lớp:

1. **Định danh toàn hệ thống** (KHÔNG có `facilityId`, KHÔNG cô lập theo cơ sở):
   `Course`, `AppUser`, `ParentAccount`, `StudentAccount`. Đây vốn là data dùng chung.
2. **Data vận hành gắn nhãn cơ sở** (`facility_id` là một cột): student, enrollment,
   grade, receipt, payslip… `facility_id` chính là cái "nhãn" Odoo nói tới.
3. **Kiểm soát truy cập = record-rule tương đương Odoo**:
   - `UserFacility` (M2M) = `allowed_company_ids` của Odoo.
   - GUC `app.facility_ids` (set theo mỗi request) = bộ lọc công ty đang active.
   - `app_is_super_admin()` = quyền toàn hệ thống.
   - RLS policy `facility_id = ANY(app_facility_ids())` = record rule.

Một phụ huynh có con ở nhiều cơ sở đã chạy được (seed cross-facility): `ParentAccount`
là 1 bản ghi toàn hệ thống, mỗi `Guardian` mang `facilityId` của con. Đây đúng là
"data toàn hệ thống + nhãn cơ sở".

## Có xung đột không?

**KHÔNG.** Giữ RLS không mâu thuẫn với "cơ sở = nhãn" — RLS chính là lớp record-rule.
Gỡ RLS để "ai cũng thấy mọi thứ" sẽ là một bước **lùi bảo mật** (giáo viên chi nhánh A
đọc được lương/điểm chi nhánh B) và đập đi toàn bộ thứ đã verify ở mọi phase. Odoo cũng
KHÔNG cho mọi user thấy mọi công ty — nó áp record rule y như vậy.

## Khoảng hở thật sự (và là điều cần sửa)

Bảng định danh `parent_account` / `student_account` đang **chỉ `super_admin`** đụng được.
Nghĩa là ban lãnh đạo (`bgd`, `quan_ly`) không quản lý được phụ huynh ở cấp hệ thống —
trái với ý "phụ huynh là data xuyên suốt, các cơ sở liên kết, không quản lý PH theo cơ sở".

## Quyết định

1. **Giữ nguyên RLS** (no rip-out). Khẳng định triết lý "cơ sở = nhãn" đã là thiết kế hiện hữu.
2. **Mở bảng định danh toàn hệ thống cho staff**: đổi RLS của `parent_account` /
   `student_account` từ `super_admin-only` → `super OR principal_kind='staff'`. Phụ huynh/
   học sinh (principal parent/student) vẫn KHÔNG đọc được các bảng này.
3. **Quản lý phụ huynh do lãnh đạo phụ trách**: router guardian đổi từ `superAdminProcedure`
   → `requireRole(bgd, quan_ly)` (super luôn qua). Việc liên kết guardian↔student vẫn bị
   RLS của bảng `student` chặn theo cơ sở — tức scoping vận hành theo chi nhánh được giữ,
   chỉ định danh là toàn hệ thống. Đúng tầng Odoo.

## Đánh đổi đã chấp nhận (residual exposure)

Sau thay đổi, **mọi phiên staff** (kể cả giáo viên) về mặt DB có thể đọc bản ghi
`parent_account`/`student_account`. Đây là thông tin liên hệ vận hành (gọi phụ huynh) và
chấp nhận được trong một hệ thống chi nhánh liên kết. Hai chốt chặn:
- Router chỉ cho lãnh đạo gọi endpoint quản lý (gate vai trò ở tRPC).
- Mọi `select` đều loại trừ `passwordHash` / secret đăng nhập.

Ghi nhận trong `DEBT.md` như một quyết định bảo mật đã duyệt.
