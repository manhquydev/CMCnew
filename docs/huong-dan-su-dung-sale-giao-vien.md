# CMCnew — Hướng dẫn sử dụng cho Sale & Giáo Viên

Tài liệu này dành cho hai vai trò trực tiếp:

- **Sale** (`sale`) — Tư vấn tuyển sinh.
- **Giáo Viên** (`giao_vien`) — Đứng lớp, chấm bài, đánh giá học sinh.

Viết theo kiểu cầm tay chỉ việc — không cần biết kỹ thuật. Mọi thao tác nằm trong **một ứng dụng web nhân viên duy nhất**; giao diện tự lọc theo vai trò, nên bạn chỉ thấy đúng phần việc của mình.

> Mọi quyền dưới đây lấy trực tiếp từ **bảng phân quyền của hệ thống**. Không thấy một mục menu hay một nút bấm = vai trò của bạn không có quyền đó. Đó là thiết kế, không phải lỗi.

---

## 1. Đăng nhập

Sale và giáo viên đăng nhập bằng **tài khoản CMC EDU qua Microsoft (SSO)**:

1. Mở ứng dụng nhân viên trên trình duyệt.
2. Bấm **Đăng nhập với Microsoft**.
3. Đăng nhập bằng email công ty `@cmcvn.edu.vn` của bạn.
4. Vào thẳng giao diện với đúng các mục dành cho vai trò của mình.

> Bạn không dùng mật khẩu riêng để vào ứng dụng — luôn đăng nhập qua Microsoft. Tài khoản của bạn do Giám Đốc tạo (Sale do GĐ Kinh Doanh tạo; Giáo Viên do GĐ Đào Tạo tạo) sau khi IT cấp email Microsoft.

### Tổng quan giao diện

- **Thanh trên cùng**: logo CMC, tên mục đang mở, chuông **Thông báo**, avatar, nút **Đăng xuất**.
- **Thanh bên trái (menu)**: nhóm chức năng theo quyền của bạn.
- **Khu vực chính**: nội dung mục đang chọn.

---

## 2. Hướng dẫn cho SALE (Tư vấn tuyển sinh)

Sale nhìn thấy các mục: **CRM**, **Học sinh**, **Phiếu lương của tôi** (và các trang mở chung như Lịch, Lớp học, Khóa học, Tổng quan ở chế độ xem).

### 2.1. CRM — công việc chính

- **Cơ hội (Opportunity)**:
  - Xem danh sách cơ hội.
  - **Tạo cơ hội mới** (khách tiềm năng: tên, SĐT, email).
  - **Chuyển giai đoạn** O1 → O2 → O3 → O4 → O5 (theo tiến độ tư vấn/ký hợp đồng).
  - **Đánh dấu mất** (lost) khi khách không theo, hoặc **mở lại** (reopen).
- **Liên hệ (Contact)**: xem danh sách, tạo liên hệ mới.
- **Bài test đầu vào**:
  - Xem danh sách bài test.
  - **Tạo lịch test** cho khách.

> Sale **không chấm điểm test** — việc chấm test do giáo viên/trưởng bộ môn làm.

### 2.2. Ghi danh học sinh

- Sale được **ghi danh** học sinh vào lớp (enrollment.enroll).
- Sale được **cập nhật thông tin học sinh** (student.update) — ví dụ chỉnh thông tin liên hệ.

### 2.3. Đánh giá KPI

- Sale **không có menu KPI riêng** để tự chấm. Phiếu KPI do **HR/quản lý khởi tạo** và **hệ thống tự tính** điểm theo dữ liệu.
- Sale được **xem** kết quả KPI của mình thông qua HR/quản lý; việc xác nhận và duyệt phiếu do Quản Lý/Giám Đốc làm. Sale không tự chấm/xác nhận/duyệt qua giao diện riêng.

### 2.4. Phiếu lương của tôi

- Xem **phiếu lương cá nhân** của bạn.

### 2.5. Sale KHÔNG làm được gì

- Không **chấm điểm test** đầu vào (việc của giáo viên).
- Không tạo/duyệt **phiếu thu**, không xem bảng giá/voucher (mục Tài chính không hiện).
- Không **tạo học sinh thủ công** — học sinh được tạo tự động khi Kế Toán/Quản Lý duyệt phiếu thu.
- Không quản lý **phụ huynh**, không **lớp học/lịch dạy/điểm danh/chấm bài/học bạ**.
- Không **tự chấm/xác nhận/duyệt KPI** (không có menu KPI riêng), không tạo nhân sự.
- Không **chăm sóc sau bán** (after-sale là của CSKH).

---

## 3. Hướng dẫn cho GIÁO VIÊN

Giáo viên nhìn thấy các mục: **Lịch dạy**, **Điểm danh**, **Chấm bài**, **Học bạ**, **Lớp học**, **Họp phụ huynh**, **Phiếu lương của tôi**.

> Giáo viên **không có menu "Duyệt cấp độ" riêng**. Việc **đề xuất nâng cấp độ** được làm **ngay trong mục Học bạ** (xem 3.7).
>
> **Chứng chỉ:** tính năng này hiện **tạm ẩn — chưa sử dụng** (đã gỡ khỏi menu).

### 3.1. Lịch dạy

- Xem **lịch dạy** của mình (buổi hôm nay/tuần) và danh sách buổi học.

### 3.2. Điểm danh

- Chọn buổi → **Điểm danh** (mark): đánh dấu từng học sinh có mặt/vắng → Lưu.

### 3.3. Chấm bài

- **Chấm điểm** bài tập (grade) và **phát hành** điểm (publish) để học sinh thấy kết quả.
- **Bài tập (Exercise)**: **tạo** bài tập (create) và **phát hành** bài tập (publish) cho học sinh làm.
- **Bài nộp (Submission)**: xem danh sách bài nộp theo bài tập, mở từng bài để chấm.

### 3.4. Học bạ (Assessment)

- Xem **mẫu đánh giá** (template) và danh sách kỳ học (termList).
- Nhập **đánh giá định tính** cho học sinh (upsertQualitative).
- **Tính điểm tổng kết** (computeFinalGrade).

> Giáo viên **không** tạo/sửa/khóa kỳ học — đó là việc của Trưởng Bộ Môn/Quản Lý/GĐ Đào Tạo.

### 3.5. Bài test đầu vào — chấm điểm

- Giáo viên **chấm điểm bài test** đầu vào (testGrade) do Sale/CSKH tạo lịch.

### 3.6. Họp phụ huynh

- **Đặt lịch họp** (setSchedule) và **đổi trạng thái** buổi họp (setStatus) cho lớp mình phụ trách.

### 3.7. Đề xuất nâng cấp độ

- **Đề xuất** nâng cấp độ cho học sinh (propose) — thao tác này nằm **ngay trong mục Học bạ**, không phải một menu "Duyệt cấp độ" riêng.

> Giáo viên **chỉ đề xuất** cấp độ; **quyết định** duyệt nâng cấp thuộc Trưởng Bộ Môn / GĐ Đào Tạo.
>
> **Chứng chỉ:** tính năng cấp/xem chứng chỉ hiện **tạm ẩn — chưa sử dụng**.

### 3.8. Huy hiệu (Badge) — *(chưa có giao diện)*

- Về mặt hệ thống, giáo viên có quyền **trao huy hiệu** (grant) cho học sinh, nhưng **hiện chưa có màn hình** cho thao tác này, nên trên thực tế chưa dùng được.

### 3.9. Đánh giá KPI

- Giáo viên **không có menu KPI riêng** để tự chấm. Phiếu KPI do **HR/quản lý khởi tạo** và **hệ thống tự tính** điểm.
- Giáo viên được **xem** kết quả KPI của mình qua HR/quản lý; xác nhận/duyệt do Quản Lý/Giám Đốc làm.

### 3.10. Phiếu lương của tôi

- Xem **phiếu lương cá nhân** của bạn.

### 3.11. Giáo viên KHÔNG làm được gì

- **Không tạo lớp** — tạo/quản lý vòng đời lớp là của Trưởng Bộ Môn / Quản Lý / GĐ Đào Tạo.
- Không tạo khung lịch/sinh buổi học (lịch dạy do Quản Lý/Trưởng Bộ Môn/GĐ ĐT thiết lập); giáo viên chỉ **xem** lịch của mình.
- Không **tạo/sửa/khóa kỳ học**, không **quyết định** nâng cấp độ. (Chứng chỉ tạm ẩn — chưa dùng.)
- Không có quyền **CRM** (trừ chấm test), **Tài chính**, **Chăm sóc khách hàng**, **Phụ huynh**, **Nhân sự/Lương**, **Đổi quà**.
- Không **tự chấm/xác nhận/duyệt KPI** (không có menu KPI riêng), không tạo nhân sự.
- Không tạo học sinh (học sinh sinh tự động khi duyệt phiếu thu).

---

## 4. Lưu ý nhanh

- Đăng nhập **bằng Microsoft (SSO)**; không có mật khẩu riêng cho ứng dụng nhân viên.
- Menu chỉ hiện đúng phần việc của bạn; thiếu nút = thiếu quyền.
- **Sale**: CRM (cơ hội/liên hệ/test) + ghi danh + cập nhật học sinh + xem lương. Không chấm test, không tài chính, không có menu KPI riêng.
- **Giáo viên**: điểm danh, chấm bài/bài tập, học bạ, chấm test, đề xuất cấp độ (trong Học bạ), họp PH + xem lương. **Không tạo lớp**, không quyết định cấp độ. (Chứng chỉ tạm ẩn; huy hiệu chưa có giao diện.)
- KPI của bạn do **HR/quản lý khởi tạo** và **hệ thống tự tính**; bạn được **xem**, không tự chấm/xác nhận/duyệt qua giao diện riêng.
