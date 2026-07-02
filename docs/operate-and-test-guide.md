# CMCnew — Hướng dẫn vận hành & test (dành cho người mới)

Tài liệu này hướng dẫn **bootstrap ban giám đốc, tạo tài khoản, và thử từng tính năng** của hệ thống từng bước.
Viết theo kiểu cầm tay chỉ việc — không cần biết lập trình. Tất cả quy trình đều thực hiện trong giao diện web tại `http://localhost/`.

---

## 1. Kiến trúc hệ thống

Hệ thống gồm **một ứng dụng web duy nhất** (`Admin & Staff`), nhưng hiển thị những chức năng khác nhau dựa trên vai trò của người đăng nhập. Ngoài ra có **ứng dụng học tập riêng** dành cho học sinh & phụ huynh.

| Ứng dụng | Địa chỉ | Người dùng |
|---------|---------|-----------|
| **Admin & Staff** (nhân viên) | `http://localhost/` | Toàn bộ nhân viên (IT head, ban giám đốc, giáo viên, kế toán, sale, CSKH, v.v.) |
| **LMS** (học tập) | `http://localhost/lms/` | Học sinh (mã đăng nhập) & Phụ huynh (email) |
| **API** (backend) | `http://localhost/api` | Máy chủ (health check: `/api/health`) |

> **Mẹo**: Mở nhiều cửa sổ trình duyệt **ẩn danh** (incognito) để đăng nhập nhiều tài khoản khác nhau mà không bị lẫn phiên đăng nhập.

---

## 2. Khởi chạy stack (Docker Compose — Production-like)

Chạy lệnh này từ thư mục gốc dự án:

```bash
# 1. Chuẩn bị file biến môi trường
cp .env.production.example .env.production
# Edit .env.production với các mật khẩu thật, email, token, v.v.
# Quan trọng: set SEED_SUPERADMIN_EMAIL và SEED_SUPERADMIN_PASSWORD

# 2. Khởi động PostgreSQL
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d postgres

# 3. Chạy migration (tạo schema + tài khoản cơ sở dữ liệu)
docker compose -f docker/docker-compose.prod.yml --env-file .env.production \
  run --rm api-migrate

# 4. Seed IT head (super_admin) — chỉ chạy lần đầu
docker compose -f docker/docker-compose.prod.yml --env-file .env.production \
  run --rm api-seed

# 5. Khởi động toàn bộ dịch vụ
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d
```

**Sau khi khởi chạy:**
- Kiểm tra health: `curl http://localhost/api/health` → phải trả `{"ok":true}`
- Admin app: `http://localhost/` → hiện màn hình đăng nhập
- LMS app: `http://localhost/lms/` → hiện màn hình đăng nhập

---

## 3. Bootstrap: Tạo Ban Giám Đốc từ IT Head

### Mô hình tổ chức (3 vai trò chính)

Hệ thống chạy dựa trên **3 vai trò quản lý**:

1. **IT Head** (`super_admin`) — tạo 2 giám đốc & quản lý cấu hình hệ thống
2. **Giám Đốc Kinh Doanh** (`giam_doc_kinh_doanh`) — quản lý sales, CSKH, CTV marketing, kế toán, HR
3. **Giám Đốc Đào Tạo** (`giam_doc_dao_tao`) — quản lý giáo viên, chương trình học, chứng chỉ, cơ sở

### Bước 1: IT Head đăng nhập

```
Email:    <SEED_SUPERADMIN_EMAIL>       (vd: admin@cmc.local)
Password: <SEED_SUPERADMIN_PASSWORD>    (vd: Cmc#70a8901f!2026)
```

Mở `http://localhost/` → **Đăng nhập** → Bạn sẽ thấy **menu đầy đủ** (tất cả chức năng).

### Bước 2: IT Head tạo Giám Đốc Kinh Doanh

1. **Menu → Cơ Sở & Users → Quản Lý User**
2. **Nút "+ Tạo user mới"**
3. Nhập:
   - **Email**: `giam_doc_kinh_doanh@cmc.local` (hoặc email thật)
   - **Tên**: `Giám Đốc Kinh Doanh`
   - **Mật khẩu**: `ChangeMe123!` (người dùng sẽ đổi sau)
   - **Vai trò**: Chọn **`Giám Đốc Kinh Doanh`** từ danh sách
   - **Cơ Sở**: Chọn **`HQ`** (hoặc cơ sở chính)
4. **Lưu** → Tài khoản được tạo ✓

### Bước 3: IT Head tạo Giám Đốc Đào Tạo

Lặp lại bước 2, nhưng:
- **Email**: `giam_doc_dao_tao@cmc.local`
- **Tên**: `Giám Đốc Đào Tạo`
- **Vai trò**: **`Giám Đốc Đào Tạo`**

### Bước 4: Giám Đốc Kinh Doanh tạo team kinh doanh

Đăng xuất IT Head. Đăng nhập lại với:
```
Email:    giam_doc_kinh_doanh@cmc.local
Password: ChangeMe123!
```

**Menu → Cơ Sở & Users → Quản Lý User**, tạo các tài khoản sau:

| Email | Tên | Vai Trò |
|-------|-----|---------|
| `sale@cmc.local` | Tư Vấn Tuyển Sinh | **Sale** |
| `cskh@cmc.local` | Chăm Sóc KH | **CSKH** |
| `mkt@cmc.local` | Cộng Tác Viên MKT | **CTV Marketing** |

> **Lưu ý**: Giám Đốc Kinh Doanh chỉ có quyền tạo 3 vai trò này. Nếu muốn tạo vai trò khác, hãy về IT Head.

### Bước 5: Giám Đốc Đào Tạo tạo team giáo viên

Đăng xuất, rồi đăng nhập lại với:
```
Email:    giam_doc_dao_tao@cmc.local
Password: ChangeMe123!
```

**Menu → Cơ Sở & Users → Quản Lý User**, tạo tài khoản giáo viên:

| Email | Tên | Vai Trò |
|-------|-----|---------|
| `giaovien@cmc.local` | Giáo Viên | **Giáo Viên** |

> **Lưu ý**: Giáo viên nào làm Trưởng Bộ Môn hoặc Quản Lý Cơ Sở vẫn có vai trò **Giáo Viên**. Quyền bổ sung (duyệt level-up, tạo lớp) được ghi vào hệ thống qua quyền cấp chức vụ.

### Bước 6: IT Head tạo các vai trò chuyên môn

Đăng nhập lại bằng `admin@cmc.local` (IT Head):

**Menu → Cơ Sở & Users → Quản Lý User**, tạo:

| Email | Tên | Vai Trò |
|-------|-----|---------|
| `ketoan@cmc.local` | Kế Toán | **Kế Toán** |
| `hr@cmc.local` | Nhân Sự (HR) | **Nhân Sự** |

> **Lưu ý**: Kế Toán và HR được tạo bởi IT Head. Các vai trò sale/CSKH/CTV marketing được Giám Đốc Kinh Doanh tạo; giáo viên được Giám Đốc Đào Tạo tạo.

---

## 4. Luồng vận hành hàng ngày (QUY TRÌNH từng bộ phận)

### A. Mảng Tuyển Sinh & Tài Chính

**Người tham gia**: Sale (`sale@cmc.local`), CSKH (`cskh@cmc.local`), Kế Toán (`ketoan@cmc.local`)

#### Lịch sự kiện thường
1. **Sale tạo Cơ Hội CRM**
   - Menu → **CRM → Cơ Hội** → **+ Tạo mới**
   - Nhập: Tên khách (hoặc company), SĐT, email
   - Chọn **Giai đoạn**: O1 (Lead) → Lưu
   - Cập nhật tiến độ: O1 → O2 → O3 → O4 → O5 (Ký hợp đồng)

2. **CSKH quản lý Ca Hỗ Trợ**
   - Menu → **CSKH → Quản Lý Ca** → **+ Tạo ca**
   - Gán nhân viên sale/CSKH
   - Ghi chú tương tác

3. **Kế Toán tạo & Duyệt Phiếu Thu**
   - Menu → **Tài Chính → Phiếu Thu** → **+ Tạo mới**
   - Nhập: Mã học sinh (nếu đã có) hoặc email phụ huynh
   - Nhập: Số tiền, ghi chú
   - **Trạng thái**: `Nháp` → Nộp → Quản Lý xác nhận → **Kế Toán duyệt**
   - **Khi duyệt phiếu**: Hệ thống **tự động tạo học sinh + tài khoản LMS** (nếu là học sinh mới):
     - **Mã đăng nhập LMS** = mã học sinh (vd `HS-2026-0042`); **mật khẩu tạm hiện 1 lần** ngay sau khi duyệt — nhân viên ghi lại để đưa phụ huynh.
     - Nếu nhập **email phụ huynh** ở phiếu: hệ thống còn gửi email thông tin tài khoản (khi email đã cấu hình).
     - Xem/đặt lại tài khoản LMS bất cứ lúc nào ở **Chi tiết học sinh → Tài khoản LMS → Đặt lại mật khẩu** (cũng tạo tài khoản cho học sinh cũ chưa có).
   
   > ⚠️ **Quan trọng**: Học sinh **KHÔNG được tạo thủ công**. Chỉ được tạo khi duyệt phiếu thu.

---

### B. Mảng Giáo Dục (Lớp, Dạy, Chấm)

**Người tham gia**: Giáo Viên (`giaovien@cmc.local`), Giám Đốc Đào Tạo hoặc nhân viên được phân công (tạo lớp/lịch dạy)

#### Khung Chương Trình (khóa cứng) & seed
- Khung chương trình (UCREA L1/L2/L3, Bright I.G J/T/C/W/Q/U) là **dữ liệu khóa cứng**:
  mỗi level là một `Course` (`UCREA-L1`, `BRIGHT_IG-J`, …) gắn danh sách `CurriculumUnit`
  (chủ đề / nội dung / sách-play-kit / tư duy / assessment) theo `order_global`.
- Nạp/refresh khung: `pnpm --filter @cmc/db seed:curriculum` (idempotent — chạy lại không nhân bản).
  Chạy trước `seed:demo` khi dựng dữ liệu mẫu. Prod nạp qua `DIRECT_URL` (chủ sở hữu DB).
- Khung **không sửa qua UI** vòng này (chỉ seed + xem). Danh sách unit hiển thị read-only ở modal tạo lớp.

#### Tạo Lớp 1-Click (khung khóa cứng + nhiều thứ/tuần)
1. **Giám Đốc Đào Tạo tạo Lớp Học**: Menu → **Lớp Học** → **+ Tạo lớp**
   - Chọn **Khung chương trình** (chương trình → level, vd `UCREA-L1`) → xem preview khung khóa cứng
     (số unit / số buổi + danh sách chủ đề).
   - Nhập: Tên lớp, ngày khai giảng/kết thúc, sĩ số.
   - Thêm **nhiều khung giờ trong tuần** (nút **+ Thêm thứ**): mỗi khung = Thứ + giờ + phòng + GV.
     Không được trùng (thứ, giờ bắt đầu) — hệ thống báo lỗi.
   - Bấm **Tạo lớp (1 click)** → lớp + tất cả khung lịch được tạo trong một thao tác.

#### Sinh Buổi Học (gán nội dung curriculum theo buổi)
1. **Mở Lớp → Tab "Lịch"** → **Sinh Buổi Học** → chọn khoảng ngày → hệ thống sinh buổi theo khung.
   - Mỗi buổi được **gán `curriculumUnitId`** theo thứ tự thời gian: unit #1 phủ `sessions` buổi đầu,
     unit #2 các buổi kế, … (mỗi unit = N buổi thật).
   - Buổi dư (vượt tổng số buổi của khung) → không gắn unit (null). Buổi thiếu → phần unit cuối chưa phủ.
   - **Sửa/Xóa khung lịch** ngay trong tab: nút **Sửa** (đổi thứ/giờ/phòng/GV, tùy chọn *áp dụng buổi
     tương lai*) và **Xóa** (lưu trữ khung — buổi đã sinh vẫn giữ). Mọi thay đổi ghi vào tab **Nhật ký**.
   - ⚠️ **Lưu ý vận hành:** hệ thống **tính lại toàn bộ** ánh xạ un↔buổi mỗi lần sinh/sửa khung để giữ
     đúng thứ tự thời gian. Nếu sinh buổi cho khoảng ngày **sau** rồi mới sinh khoảng **trước**, nội dung
     curriculum hiển thị của các buổi cũ có thể dịch lại cho đúng thứ tự. Nên sinh buổi theo thứ tự thời gian.

#### Ghi Danh Học Sinh
1. **Giám Đốc Đào Tạo mở Lớp → Tab "Ghi Danh"** → **+ Ghi Danh**
2. Tìm kiếm học sinh (nhập mã hoặc tên)
3. Chọn từ danh sách → **Lưu**

#### Điểm Danh & Chấm Bài (Giáo Viên)
1. **Menu → Lịch Dạy** → xem danh sách buổi dạy hôm nay/tuần
2. Chọn buổi → mở màn hình **Buổi học 360**
   - Trước buổi: xem thông tin lớp, phòng, giáo viên, roster
   - Từ 15 phút trước giờ bắt đầu: hệ thống mở luồng điểm danh
   - Sau giờ kết thúc: hệ thống hiển thị các việc sau buổi học
3. **Điểm Danh**
   - Kiểm tra từng học sinh (Có mặt / Vắng)
   - **Lưu**
   
4. **Menu → Chấm Bài**
   - Chọn bài tập → Chấm điểm từng học sinh
   - **Phát Hành** bài tập để học sinh thấy kết quả

> Ghi chú: Các thẻ sau buổi học trong Buổi học 360 hiện là mock cho phase tiếp theo: phát bài tập LMS, nhận xét theo form, upload ảnh lớp, publish cho phụ huynh. Dữ liệu ảnh/nhận xét thật chưa được lưu và chưa hiển thị ở LMS trong slice này.

#### Học Bạ & Đánh Giá
1. **Giáo Viên → Menu → Học Bạ** (Assessment)
   - Chọn lớp & học sinh
   - Nhập đánh giá định tính (xếp loại A/B/C/...)
   - Xem **Điểm Tổng Kết** (tính từ bài tập + học bạ)

2. **Trưởng Bộ Môn → Menu → Cấp Độ & Chứng Chỉ**
   - Duyệt yêu cầu lên cấp độ từ giáo viên
   - Cấp chứng chỉ cho học sinh hoàn thành

---

### C. Mảng Nhân Sự & Lương

**Người tham gia**: Nhân Sự (`hr@cmc.local`), Giám Đốc Kinh Doanh hoặc Giám Đốc Đào Tạo (duyệt KPI)

#### Tính & Duyệt Lương
1. **HR → Menu → Nhân Sự & Lương → Hồ Sơ**
   - Tạo hồ sơ nhân sự cho từng nhân viên (nếu chưa có)
   - Nhập: Tên, Mã số, Ngày vào làm

2. **HR → Menu → Nhân Sự & Lương → Mức Lương**
   - Nhập: Lương cơ bản, hoa hồng, điều kiện kích hoạt
   - Set **Effective From**: Ngày bắt đầu áp dụng

3. **HR → Menu → Nhân Sự & Lương → Tính Lương**
   - Chọn kỳ lương (vd `2026-06`)
   - Hệ thống tính tự động → **Chốt**
   - **Trả**: Chuyển tiền cho nhân viên (ghi lý do, ngày trả)

#### KPI & Đánh Giá
1. **HR tạo Phiếu KPI**
   - Menu → **KPI & Rewards → Phiếu KPI** → **+ Tạo**
   - Chọn nhân viên & kỳ đánh giá
   - Gửi cho nhân viên **Nộp bản tự đánh giá**

2. **Nhân Viên Nộp KPI**
   - Nhận thông báo → Menu → **KPI & Rewards**
   - Nhập: Đánh giá (điểm tự, hoa hồng đạt được)
   - **Nộp**

3. **Quản Lý Xác Nhận**
   - Menu → **KPI & Rewards → Phiếu KPI**
   - Chọn phiếu → **Xác Nhận** (có thể chỉnh sửa điểm/hoa hồng + ghi lý do)

4. **Ban Giám Đốc Duyệt (Bước Cuối)**
   - Menu → **KPI & Rewards** → chọn phiếu → **Duyệt**
   - Phiếu được khoá & lưu vào hồ sơ

#### Cơ Cấu Lương & Chính Sách
1. **IT Head → Menu → Cấu Hình → Cơ Cấu Lương**
   - Xem/sửa: Mức lương tối thiểu, % hoa hồng, điều khoản phụ cấp
   - Tất cả thay đổi được ghi lại lịch sử

---

### D. Mảng Học Sinh & LMS

**Người tham gia**: Học Sinh (LMS), Phụ Huynh (LMS), Giáo Viên (Admin, bộ phận chấm bài)

#### Học Sinh (Đăng Nhập Mã)
1. Mở `http://localhost/lms/`
2. **Đăng Nhập**: 
   - **Mã Học Sinh**: `TEST-001` (hoặc mã được tạo từ phiếu thu duyệt)
   - **Mật Khẩu**: (= SEED_SUPERADMIN_PASSWORD hoặc được set lúc duyệt phiếu)

3. **Nội dung sau khi đăng nhập**:
   - **Khóa Học**: Xem các lớp đang học
   - **Lịch học & Nội dung**: Danh sách buổi học của lớp + nội dung khung chương trình theo từng buổi
     (chủ đề / nội dung-sách-play-kit / tư duy đạt được / assessment) — kể cả buổi chưa có ảnh/nhận xét
   - **Buổi học (ảnh & nhận xét)**: Ảnh + nhận xét giáo viên đã publish
   - **Bài Tập**: Xem bài giáo viên phát hành → Làm → **Nộp Bài**
   - **Điểm & Huy Hiệu**: Xem điểm sau khi giáo viên chấm, sao/huy hiệu đạt được
   - **Bảng Xếp Hạng**: Xem xếp hạng so với bạn cùng lớp

#### Phụ Huynh (Đăng Nhập Email)
1. Mở `http://localhost/lms/`
2. **Đăng Nhập**:
   - **Email**: `parent@cmc.local` (hoặc email được tạo lúc duyệt phiếu)
   - **Mật Khẩu**: (= SEED_SUPERADMIN_PASSWORD)

3. **Nội dung sau khi đăng nhập**:
   - **Tiến Trình Con**: Xem học sinh được gắn với tài khoản (nếu có)
   - **Lịch học & Nội dung**: Buổi học của con + nội dung khung chương trình theo từng buổi
   - **Điểm & Huy Hiệu**: Xem điểm của con
   - **Lịch Họp Phụ Huynh**: Xem lịch họp sắp tới & đã qua (thông báo T-1 qua email)
   - **Thông Báo**: Nhận thông báo từ hệ thống (cập nhật điểm, sự kiện, v.v.)

---

## 5. Đăng Nhập: Cơ Chế & Cấu Hình

### Local (Phát Triển): Đăng Nhập Mật Khẩu
- **Tất cả vai trò** đăng nhập bằng: **Email + Mật Khẩu**
- Biến môi trường: `SSO_ENABLED=false`
- Cookie: `COOKIE_SECURE=false` (vì dùng HTTP, không HTTPS)

### Production: Microsoft SSO + Break-Glass
- **Nhân viên (trừ IT Head)**: Đăng nhập bằng **Microsoft Entra (SSO)** — email phải là `@cmcvn.edu.vn`
- **IT Head (super_admin)**: Vẫn dùng **Email + Mật Khẩu** (break-glass khi SSO gặp sự cố)
- **Học sinh**: Đăng nhập mã học sinh + mật khẩu (không dùng SSO)
- **Phụ huynh**: Đăng nhập email + **OTP** (gửi qua Microsoft Graph email)

Cấu hình: `SSO_ENABLED=true` + `ENTRA_*` biến môi trường

---

## 6. Thử Nghiệm Toàn Luồng (Ví Dụ Thực)

### Kịch Bản: "Từ Tuyển Sinh đến Phụ Huynh Theo Dõi"

1. **Sale tạo Cơ Hội CRM** (`sale@cmc.local`)
   - Menu → CRM → Cơ Hội → Tạo: "Nguyễn Văn A"
   - Chuyển từ O1 → O5 (ký hợp đồng)

2. **Kế Toán tạo Phiếu Thu** (`ketoan@cmc.local`)
   - Menu → Tài Chính → Phiếu Thu → Tạo
   - Nhập: Email phụ huynh = `parent@cmc.local`, số tiền = 5,000,000
   - **Gửi** (status = Nháp)

3. **Kế Toán duyệt Phiếu** (hoặc **Quản Lý xác nhận** trước)
   - **Duyệt** → Hệ thống **tự động tạo học sinh** `TEST-002` (hoặc mã tự động)
   - Email phụ huynh nhận thông báo + mã/mật khẩu

4. **Quản Lý ghi danh học sinh**
   - Menu → Lớp Học → Chọn lớp → Tab Ghi Danh
   - Ghi danh `TEST-002` vào lớp (hôm nay hoặc khoảng ngày)

5. **Giáo Viên điểm danh & chấm bài**
   - Menu → Lịch Dạy → chọn buổi → Buổi học 360 → Điểm Danh
   - Menu → Chấm Bài → Chấm & Phát Hành

6. **Phụ Huynh theo dõi LMS** (`parent@cmc.local`)
   - Mở `http://localhost/lms/`
   - Đăng nhập → Xem tiến trình con, điểm số, huy hiệu

---

## 7. Kiểm Tra Hệ Thống "Còn Sống"

```bash
# Kiểm tra API health
curl http://localhost/api/health
# → Trả: {"ok":true}

# Kiểm tra 3 app load được
# Admin/Staff: http://localhost/     → Hiện login
# LMS:         http://localhost/lms/ → Hiện login
# API:         http://localhost/api  → API endpoint list
```

---

## 8. Lưu Ý Quan Trọng

1. **Mật Khẩu Ban Đầu**:
   - Tất cả tài khoản được tạo dùng chung 1 mật khẩu (SEED_SUPERADMIN_PASSWORD) lần đầu
   - **Người dùng PHẢI đổi mật khẩu riêng** trong mục **Cài Đặt → Thay Đổi Mật Khẩu**

2. **Phân Quyền**:
   - Mỗi vai trò chỉ thấy **menu & chức năng được phép** (phân quyền theo vai trò + cơ sở)
   - Nếu không thấy nút nào, bạn không có quyền — hỏi IT Head

3. **Tạo Học Sinh**:
   - ⚠️ **KHÔNG tạo thủ công** — chỉ được tạo khi **duyệt phiếu thu**
   - Khi duyệt phiếu, hệ thống tự động tạo tài khoản học sinh + phụ huynh

4. **HTTP vs HTTPS**:
   - **Local dev** (`http://localhost`): COOKIE_SECURE=false, SSO tắt, SSE hoạt động bình thường
   - **Production** (HTTPS + SSO): COOKIE_SECURE=true, bật SSO, các shared mailbox Graph

5. **Database**:
   - Runtime dùng tài khoản `cmc_app` (áp dụng RLS — row-level security)
   - Migrations dùng `cmc` owner (bypass RLS)
   - **Đổi mật khẩu `cmc_app` sau khi migrate** trước khi đưa prod

---

## 9. Câu Hỏi Thường Gặp

**Q: Làm sao để xóa tài khoản?**
- A: IT Head → Menu → Cơ Sở & Users → Quản Lý User → Chọn user → **Tắt Hoạt Động** (không xóa hẳn, để giữ dữ liệu lịch sử)

**Q: Làm sao thay đổi vai trò của người dùng?**
- A: Chỉ IT Head có quyền → Menu → Cơ Sở & Users → Quản Lý User → Chọn user → Sửa vai trò → Lưu

**Q: Nếu quên mật khẩu học sinh?**
- A: Quản Lý reset qua menu **Cài Đặt → Quản Lý Tài Khoản Học Sinh**, hoặc IT Head reset trực tiếp

**Q: Phụ huynh không nhận được email thông báo?**
- A: Kiểm tra: GRAPH_CLIENT_SECRET, GRAPH_SENDER_NOTIFY, GRAPH_TENANT_ID được set đúng trong .env.production; hoặc ENTRA_CLIENT_SECRET chưa được cấp từ IT

**Q: Làm sao để chạy trên HTTPS?**
- A: Cần SSL certificate + sửa nginx.conf + set COOKIE_SECURE=true, CORS_ORIGINS=https://... — hỏi IT ops team
