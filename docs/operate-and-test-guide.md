# CMCnew — Hướng dẫn vận hành & test (dành cho người mới)

Tài liệu này giúp bạn **đăng nhập và thử từng tính năng** của hệ thống sau khi đã khởi chạy.
Viết theo kiểu cầm tay chỉ việc — không cần biết lập trình.

## 1. Hệ thống gồm 3 "cánh cửa" (3 web app)

Tất cả chạy trên cùng một địa chỉ `http://localhost`, khác nhau ở đường dẫn:

| App | Địa chỉ mở trên trình duyệt | Dành cho ai |
| --- | --- | --- |
| **Admin** (quản trị) | `http://localhost/` | Quản lý, kế toán, nhân sự, sale, CSKH, ban giám đốc |
| **Teaching** (dạy học) | `http://localhost/teaching/` | Giáo viên, trưởng bộ môn, quản lý lớp |
| **LMS** (làm bài tập) | `http://localhost/lms/` | Học sinh & phụ huynh |

> Mẹo: mở mỗi app ở một cửa sổ trình duyệt ẩn danh (incognito) riêng để đăng nhập nhiều tài khoản cùng lúc mà không bị lẫn phiên.

## 2. Tài khoản đã tạo sẵn (mật khẩu giống nhau cho dễ thử)

**Mật khẩu chung cho TẤT CẢ tài khoản dưới đây:** `Cmc#70a8901f!2026`

### Nhân viên (đăng nhập ở Admin và/hoặc Teaching — bằng email)

| Vai trò | Email đăng nhập | Làm được gì (tóm tắt) |
| --- | --- | --- |
| Super Admin | `admin@cmc.local` | Toàn quyền, cấu hình lương, tạo cơ sở & user |
| Quản lý cơ sở | `quanly@cmc.local` | Vận hành lớp, ghi danh, CRM, CSKH |
| Ban giám đốc | `bgd@cmc.local` | Duyệt KPI (bước cuối) |
| Trưởng bộ môn | `headteacher@cmc.local` | Duyệt lên cấp độ, cấp chứng chỉ |
| Giáo viên | `giaovien@cmc.local` | Lịch dạy, điểm danh, chấm bài, học bạ |
| Kế toán | `ketoan@cmc.local` | Tài chính, phiếu thu, lương |
| Nhân sự (HR) | `hr@cmc.local` | Hồ sơ nhân sự, tính lương, KPI |
| Tư vấn tuyển sinh | `sale@cmc.local` | CRM, cơ hội, ghi danh |
| Chăm sóc KH | `cskh@cmc.local` | Quản lý ca CSKH |
| CTV Marketing | `mkt@cmc.local` | (lead marketing) |

### Học sinh & phụ huynh (đăng nhập ở LMS)

| Vai trò | Đăng nhập bằng | Giá trị |
| --- | --- | --- |
| Học sinh | **Mã đăng nhập** | `TEST-001` |
| Phụ huynh | **Email** | `parent@cmc.local` |

## 3. Thứ tự thử nghiệm hợp lý (đi từ đầu đến cuối một vòng nghiệp vụ)

Nên thử theo thứ tự này để có sẵn dữ liệu cho bước sau.

### Bước A — Chuẩn bị danh mục (Admin, đăng nhập `admin@cmc.local`)
1. Mở `http://localhost/` → đăng nhập.
2. **Khóa học** → "Tạo khóa": nhập mã (vd `UCREA-01`), tên, chương trình → Lưu.
3. **Học sinh** → tạo vài học sinh (hoặc dùng `TEST-001` đã có). Thử **Sửa** một học sinh.
4. **Cơ sở & Users** (chỉ super/quản lý): xem danh sách cơ sở, người dùng; thử tạo 1 user mới.
5. **Tài chính** (kế toán/quản lý): tạo **Giá khóa học**, tạo **Voucher**.

### Bước B — Mở lớp & dạy (Teaching, đăng nhập `quanly@cmc.local` rồi `giaovien@cmc.local`)
1. Mở `http://localhost/teaching/`.
2. **Lớp học** (quản lý): tạo lớp mới gắn với khóa ở bước A.
3. Mở chi tiết lớp → tab **Lịch** (Khung lịch): thêm khung (thứ, giờ bắt đầu < giờ kết thúc) → **Sinh buổi học** theo khoảng ngày.
4. Tab **Ghi danh**: ghi danh học sinh `TEST-001` vào lớp (chỉ quản lý/sale).
5. Đăng nhập lại bằng `giaovien@cmc.local`:
   - **Lịch dạy** (Hôm nay): xem các buổi dạy của mình theo tuần.
   - **Điểm danh**: chọn buổi hôm nay → điểm danh học sinh.
   - **Chấm bài**: tạo bài tập cho lớp → phát hành.
6. **Học bạ** (Assessment): nhập đánh giá định tính, xem điểm tổng kết.

### Bước C — Học sinh làm bài (LMS, đăng nhập học sinh `TEST-001`)
1. Mở `http://localhost/lms/` → đăng nhập bằng **Mã** `TEST-001`.
2. Tab **Khóa học**: xem lớp/khóa đang học.
3. Tab bài tập: mở bài giáo viên đã phát hành → làm & **Nộp bài**.
4. Sau khi giáo viên chấm (Teaching → Chấm bài): xem điểm, **sao**, **huy hiệu**, **bảng xếp hạng**.

### Bước D — Phụ huynh theo dõi (LMS, đăng nhập `parent@cmc.local`)
1. Xem tiến trình con, điểm, huy hiệu.
2. Tab **Lịch họp**: xem lịch họp phụ huynh (sắp tới + đã qua).
3. Tab **Thông báo**: xem thông báo.

### Bước E — Tuyển sinh & tài chính (Admin)
1. `sale@cmc.local` → **CRM**: tạo cơ hội (liên hệ + SĐT) → chuyển bước O1→…→O5.
2. `cskh@cmc.local` → **Chăm sóc KH**: tạo ca, **gán** cho nhân viên, ghi chú.
3. `ketoan@cmc.local` → **Tài chính**: tạo **phiếu thu** cho học sinh → duyệt.

### Bước F — Lương & KPI (Admin)
1. `hr@cmc.local` → **Nhân sự & Lương**:
   - Tạo **hồ sơ** nhân sự + **mức lương** (effectiveFrom).
   - **Tính lương** một kỳ (vd `2026-06`) → **Chốt** → **Trả**.
2. **Đánh giá KPI**: `hr` tạo phiếu → nhân viên **nộp** → `quanly` **xác nhận** → `bgd` **duyệt**.
   - Quản lý cấp trên có thể **điều chỉnh** điểm KPI / hoa hồng (có ghi lý do, lưu vết).
3. `admin@cmc.local` → **Cơ cấu lương**: xem/sửa tham số chính sách lương.
4. **Đổi quà**: duyệt yêu cầu đổi quà của học sinh.

## 4. Kiểm tra nhanh hệ thống "còn sống"

- `http://localhost/api/health` → phải trả `{"ok":true}`.
- Mở 3 app ở mục 1 → đều hiện màn hình đăng nhập.

## 5. Lưu ý quan trọng

- Đây là bản chạy nội bộ trên `http://localhost` (chưa có HTTPS). **Đổi mật khẩu** các tài khoản trước khi dùng thật, và bật HTTPS khi đưa lên mạng công khai.
- Mật khẩu DB nội bộ (`cmc_app`) đang để mặc định — cần đổi trước khi mở ra ngoài.
- Mỗi vai trò chỉ thấy đúng menu được phép (phân quyền theo cây + theo cơ sở).

## Câu hỏi còn mở

- Khi nào đưa lên môi trường công khai (cần HTTPS + đổi toàn bộ mật khẩu mặc định)?
- Có cần tạo sẵn dữ liệu mẫu nhiều hơn (nhiều lớp/học sinh) để demo không?
