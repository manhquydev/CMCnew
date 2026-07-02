# CMCnew — Hướng dẫn sử dụng cho Giám Đốc (Kinh Doanh & Đào Tạo)

Tài liệu này dành cho **hai vai trò Giám Đốc** trong mô hình 3 trụ cột của trung tâm:

- **Giám Đốc Kinh Doanh** (`giam_doc_kinh_doanh`) — phụ trách tuyển sinh, CRM, chăm sóc khách hàng, doanh thu.
- **Giám Đốc Đào Tạo** (`giam_doc_dao_tao`) — phụ trách học vụ, lớp học, giáo viên.

Viết theo kiểu cầm tay chỉ việc — không cần biết kỹ thuật. Mọi thao tác thực hiện trong **một ứng dụng web nhân viên duy nhất**; giao diện tự lọc theo vai trò của bạn, nên mỗi giám đốc chỉ nhìn thấy đúng phần việc của mình.

> Mọi quyền trong tài liệu này lấy trực tiếp từ **bảng phân quyền của hệ thống**. Một số trang xem chung (như **Tổng quan**, **Lịch dạy**, **Lớp học**, **Khóa học**) hiện ra cho **mọi nhân sự** ở chế độ chỉ xem — thấy được trang không có nghĩa là bạn có quyền thao tác. Ngược lại, các **nút hành động** bên trong mới đi theo quyền của vai trò: nếu một nút không hiện, nghĩa là vai trò của bạn không có quyền đó — đây là thiết kế có chủ đích, không phải lỗi.

---

## 1. Đăng nhập

### Cách đăng nhập của Giám Đốc

Cả hai giám đốc đăng nhập bằng **tài khoản CMC EDU qua Microsoft (SSO)**:

1. Mở ứng dụng nhân viên trên trình duyệt.
2. Bấm **Đăng nhập với Microsoft**.
3. Đăng nhập bằng email công ty:
   - GĐ Kinh Doanh: `nhungdt@cmcvn.edu.vn`
   - GĐ Đào Tạo: `hongltn@cmcvn.edu.vn`
4. Sau khi xác thực, hệ thống đưa bạn vào giao diện với đúng các mục dành cho vai trò của mình.

> **Lưu ý:** Giám đốc **không** dùng mật khẩu riêng để vào ứng dụng — luôn đăng nhập qua Microsoft. Chỉ tài khoản IT (`admin@cmcvn.edu.vn`, vai trò super_admin) mới có "break-glass" đăng nhập bằng email + mật khẩu khi SSO gặp sự cố.

### Ba trụ cột tổ chức

| Vai trò | Tài khoản | Phụ trách |
|---------|-----------|-----------|
| IT (super_admin) | `admin@cmcvn.edu.vn` | Tạo tài khoản Microsoft, cấu hình hệ thống, toàn quyền |
| Giám Đốc Kinh Doanh | `nhungdt@cmcvn.edu.vn` | Kinh doanh, CRM, CSKH, thưởng, xem tài chính |
| Giám Đốc Đào Tạo | `hongltn@cmcvn.edu.vn` | Học vụ, lớp học, chấm điểm |

---

## 2. Tổng quan giao diện

Sau khi đăng nhập, bạn thấy:

- **Thanh trên cùng**: logo CMC, tên mục đang mở, chuông **Thông báo**, avatar, nút **Đăng xuất**.
- **Thanh bên trái (menu)**: các nhóm chức năng. Mỗi giám đốc chỉ thấy nhóm thuộc quyền của mình.
- **Khu vực chính**: nội dung của mục đang chọn.

Các nhóm menu trong hệ thống (theo tên hiển thị): **Giảng dạy**, **Lớp học**, **Học sinh**, **CRM & Kinh doanh**, **Tài chính**, **Nhân sự**, **Quản trị**. Phần dưới đây liệt kê chính xác mục nào hiện ra với từng giám đốc.

---

## 3. Hướng dẫn cho GIÁM ĐỐC KINH DOANH

GĐ Kinh Doanh nhìn thấy các mục: **Tổng quan**, **Cơ sở & Người dùng**, **CRM**, **Chăm sóc khách hàng**, **Đổi quà**, **Tài chính** (chỉ xem), **Đánh giá KPI**, **Phiếu lương của tôi**.

### 3.1. Tổng quan (Dashboard)

- Xem **bảng tổng quan doanh thu/hoạt động** của cơ sở (số liệu tổng hợp).
- Đây là trang đọc, không nhập liệu.

### 3.2. Cơ sở & Người dùng — tạo nhân sự team Kinh Doanh

GĐ Kinh Doanh được phép **tạo tài khoản ERP** cho team kinh doanh. Các vai trò bạn được tạo:

- **Sale** (Tư vấn tuyển sinh)
- **CSKH** (Chăm sóc khách hàng)
- **CTV Marketing** (`ctv_mkt`)

Bạn **chỉ** chọn được 3 vai trò trên trong ô vai trò — danh sách tự lọc; bạn không thể nâng ai lên cấp giám đốc hay super_admin. (Xem mục 5 "Tạo nhân sự mới" cho quy trình đầy đủ.)

### 3.3. CRM — toàn quyền

GĐ Kinh Doanh có **toàn quyền** với CRM, có thể tự làm hoặc giám sát/điều phối deal của team:

- **Cơ hội (Opportunity)**: xem danh sách, tạo mới, chuyển giai đoạn (O1 → O5), đánh dấu mất (lost), mở lại (reopen).
- **Liên hệ (Contact)**: xem danh sách, tạo mới.
- **Bài test đầu vào**: xem danh sách, tạo lịch test cho khách.

**KHÔNG làm được:** **chấm điểm test** — việc chấm test thuộc giáo viên (giám đốc không đứng lớp).

### 3.4. Chăm sóc khách hàng (After-sale)

Toàn quyền với ca chăm sóc sau bán để có thể vào cuộc hoặc phân lại ca:

- Xem danh sách ca, tạo ca mới.
- Chuyển trạng thái ca (transition).
- **Gán/phân ca** cho nhân viên CSKH.

**KHÔNG làm được:** **đặt vòng đời học sinh** (`setStudentLifecycle`) — thao tác này có ảnh hưởng tài chính nên chỉ GĐ Kinh Doanh mới làm.

### 3.5. Đổi quà (Rewards)

- **Tạo phần quà** (gift) trong chương trình thưởng.
- **Duyệt** yêu cầu đổi quà.

### 3.6. Tài chính — CHỈ XEM

GĐ Kinh Doanh có quyền **xem** tài chính để nắm doanh thu, **không** tạo/duyệt:

- Xem danh sách **phiếu thu** (receipt).
- Xem **bảng giá** (price list).
- Xem **voucher**.

**KHÔNG làm được:** tạo/duyệt/đối soát/hủy phiếu thu, tạo bảng giá, tạo voucher — các thao tác ghi này thuộc Kế Toán / GĐ Kinh Doanh.

### 3.7. Đánh giá KPI

- **Xem danh sách KPI** và mở chi tiết từng phiếu.
- **Xác nhận** phiếu KPI (kpiEvalConfirm).
- **Duyệt** phiếu KPI (kpiEvalApprove).

Xem chi tiết quy trình và quy tắc tách trách nhiệm ở **mục 6**.

### 3.8. Phiếu lương của tôi

- Xem **phiếu lương cá nhân** của chính bạn.

### 3.9. GĐ Kinh Doanh KHÔNG làm được gì

- Không có bất kỳ quyền **học vụ/giảng dạy** nào: không điểm danh, không chấm bài, không học bạ, không tạo/quản lý lớp, không lịch dạy, không chứng chỉ, không duyệt cấp độ, không họp phụ huynh, không tạo khóa học.
- Không **chuẩn bị dữ liệu KPI** (khởi tạo/tự điền/đặt điểm tự động) — đó là việc HR/Kế Toán.
- Không tạo vai trò ngoài sale/cskh/ctv_mkt/ke_toan/hr.

> Sau khi bỏ vai trò Quản Lý, GĐ Kinh Doanh **nay được** ghi tài chính (bảng giá/voucher/phiếu thu) và quản lý phụ huynh — trước đây thuộc Quản Lý.

---

## 4. Hướng dẫn cho GIÁM ĐỐC ĐÀO TẠO

GĐ Đào Tạo nhìn thấy các mục: **Tổng quan**, **Cơ sở & Người dùng**, **Lịch dạy**, **Điểm danh**, **Chấm bài**, **Học bạ**, **Lớp học**, **Họp phụ huynh**, **Duyệt cấp độ**, **Khóa học**, **Đánh giá KPI**, **Phiếu lương của tôi**.

> **Chứng chỉ:** tính năng này hiện **tạm ẩn — chưa sử dụng** (đã gỡ khỏi menu). Khi được bật lại, việc cấp/xem chứng chỉ sẽ thuộc GĐ Đào Tạo.

### 4.1. Tổng quan (Dashboard)

- Xem bảng tổng quan hoạt động đào tạo của cơ sở. Trang đọc.

### 4.2. Cơ sở & Người dùng — tạo nhân sự team Đào Tạo

GĐ Đào Tạo được tạo tài khoản ERP cho team đào tạo. Các vai trò bạn được tạo:

- **Giáo Viên** (`giao_vien`)

Danh sách vai trò tự lọc — bạn không tạo được vai trò ngoài vai trò trên. (Quy trình ở mục 5.)

### 4.3. Khóa học

- **Tạo khóa học** mới (mã, tên, chương trình).
- **Lưu trữ (archive)** khóa học.

### 4.4. Lớp học — vòng đời lớp

GĐ Đào Tạo quản lý toàn bộ vòng đời lớp:

- **Tạo lớp** (class batch).
- **Đổi trạng thái lớp** (setStatus).
- **Hủy lớp** (cancel).
- **Mở lại lớp** (reopen).

### 4.5. Lịch dạy

- **Thêm khung lịch** cho lớp (addSlot): chọn thứ, giờ bắt đầu/kết thúc.
- **Sinh buổi học** (generateSessions) theo khung lịch trong khoảng ngày.

### 4.6. Điểm danh

- **Điểm danh** học sinh từng buổi (mark): đánh dấu có mặt/vắng.

### 4.7. Chấm bài & Học bạ

- **Chấm điểm** bài tập (grade) và **phát hành** điểm (publish) để học sinh thấy.
- **Học bạ (Assessment)**:
  - Xem danh sách kỳ học (term), tạo/sửa kỳ, **khóa/mở khóa** kỳ.
  - Quản lý **mẫu đánh giá** (template).
  - Nhập **đánh giá định tính** (upsertQualitative).
  - **Tính điểm tổng kết** (computeFinalGrade).

### 4.8. Họp phụ huynh

- **Đặt lịch họp** (setSchedule) và **đổi trạng thái** buổi họp (setStatus).

### 4.9. Duyệt cấp độ (Level-up)

- **Đề xuất** nâng cấp độ cho học sinh (propose).
- Xem **danh sách đề xuất đang chờ** (listPending).
- **Quyết định** duyệt/từ chối đề xuất nâng cấp độ (decide).

### 4.10. Chứng chỉ — *(tạm ẩn — chưa sử dụng)*

- Tính năng chứng chỉ hiện **chưa được dùng** và **đã ẩn khỏi menu**. Không có thao tác cấp/xem chứng chỉ ở thời điểm này.
- Khi tính năng được bật lại, GĐ Đào Tạo sẽ là người cấp chứng chỉ cho học sinh hoàn thành.

### 4.11. Đánh giá KPI

- **Xem danh sách KPI** và mở chi tiết phiếu.
- **Xác nhận** phiếu KPI.
- **Duyệt** phiếu KPI.

Chi tiết quy trình ở **mục 6**.

### 4.12. Phiếu lương của tôi

- Xem phiếu lương cá nhân của bạn.

### 4.13. GĐ Đào Tạo KHÔNG làm được gì

- Không có quyền **CRM** (cơ hội, liên hệ, test).
- Không có quyền **Chăm sóc khách hàng** (after-sale).
- Không **tài chính** (kể cả xem) và không **đổi quà** — các mục này không hiện trong menu của bạn.
- Không **chuẩn bị dữ liệu KPI** (khởi tạo/tự điền/đặt điểm tự động) — đó là việc HR/Kế Toán.
- Không tạo vai trò ngoài giáo viên.

---

## 5. Tạo nhân sự mới (quy trình hai bước)

Việc đưa một nhân viên mới vào hệ thống cần **hai bước**, do hai người khác nhau thực hiện:

### Bước 1 — IT tạo tài khoản Microsoft

- IT (super_admin) tạo địa chỉ email công ty `@cmcvn.edu.vn` cho nhân viên mới trên hệ thống Microsoft của trung tâm.
- Đây là điều kiện bắt buộc, vì nhân viên sẽ đăng nhập ERP bằng tài khoản Microsoft đó (SSO).

### Bước 2 — Giám Đốc tạo tài khoản trong ERP

1. Mở **Cơ sở & Người dùng** trên menu.
2. Bấm **Tạo người dùng**.
3. Nhập:
   - **Email**: đúng địa chỉ `@cmcvn.edu.vn` mà IT vừa tạo.
   - **Tên hiển thị**.
   - **Vai trò**: chọn từ danh sách (đã tự lọc theo quyền của bạn — GĐ KD thấy sale/cskh/ctv_mkt/ke_toan/hr; GĐ ĐT chỉ thấy giáo viên).
   - **Vai trò chính**: chọn vai trò chính của nhân viên (nếu để trống, hệ thống mặc định lấy vai trò đầu tiên trong danh sách vai trò đã chọn).
   - **Cơ sở**: chọn cơ sở của nhân viên.

> Form tạo người dùng **không có ô mật khẩu** — nhân viên đăng nhập bằng tài khoản Microsoft (SSO), không đặt mật khẩu trong ERP.
4. **Lưu**. Hệ thống tạo tài khoản ERP và liên kết với tài khoản Microsoft; nhân viên đăng nhập lần đầu qua **Đăng nhập với Microsoft** (SSO).

> Giám đốc **không** đặt/đổi vai trò, không bật/tắt hoạt động, không đổi cơ sở của tài khoản đã tồn tại — những thao tác này dành riêng cho IT (super_admin). Giám đốc cũng chỉ thấy nhân sự trong cơ sở của mình.

---

## 6. Quy trình chấm & duyệt KPI (tách trách nhiệm)

KPI đi qua **bốn trạng thái**:

```
draft (nháp) → submitted (đã nộp) → confirmed (đã xác nhận) → approved (đã duyệt)
```

### Ai làm gì

| Bước | Trạng thái | Người thực hiện |
|------|-----------|-----------------|
| Chuẩn bị dữ liệu (khởi tạo phiếu, tự điền, đặt điểm tự động) | tạo `draft` | **HR / Kế Toán** |
| Nộp phiếu (sau khi hệ thống tính điểm) | `submitted` | **HR / Kế Toán** (nhân viên không có menu tự nộp riêng; được xem kết quả qua HR/kế toán) |
| Xác nhận | `confirmed` | **Giám Đốc** |
| Duyệt (bước cuối) | `approved` | **Giám Đốc** |

### Quy tắc tách trách nhiệm (quan trọng)

- **Người DUYỆT phải khác người XÁC NHẬN** trên cùng một phiếu. Hệ thống **chặn** người vừa xác nhận tự duyệt phiếu đó. Nhờ vậy một giám đốc không thể vừa xác nhận vừa duyệt cùng một phiếu.
- Vai trò của giám đốc trong KPI là **xác nhận và duyệt** — phần *executive*. Hai giám đốc là ban điều hành phê duyệt KPI cho toàn trung tâm.
- **Giám đốc KHÔNG chuẩn bị dữ liệu KPI**: việc khởi tạo phiếu, tự điền, đặt điểm tự động là của HR/Kế Toán. Giám đốc cũng không thấy được các thao tác chuẩn bị này.

### Cách giám đốc thao tác

1. Mở **Đánh giá KPI** trên menu.
2. Chọn phiếu đang ở trạng thái phù hợp.
3. Bấm **Xác nhận** (nếu là người xác nhận), hoặc **Duyệt** (nếu phiếu đã được người khác xác nhận).

> Mẹo phối hợp: nếu một giám đốc đã **xác nhận** phiếu, hãy để **giám đốc còn lại** thực hiện bước **duyệt**, đảm bảo hai người khác nhau.

---

## 7. Lưu ý nhanh

- Các trang xem chung (Tổng quan, Lịch dạy, Lớp học, Khóa học) hiện cho mọi nhân sự ở chế độ chỉ xem; chỉ **nút hành động** bên trong mới theo quyền — thiếu nút = thiếu quyền (không phải lỗi).
- Giám đốc đăng nhập **bằng Microsoft (SSO)**, không bằng mật khẩu.
- GĐ Kinh Doanh: kinh doanh + CRM + CSKH + thưởng + **tài chính (ghi)** + phụ huynh + KPI; **không** học vụ.
- GĐ Đào Tạo: học vụ + lớp + KPI; **không** CRM/tài chính/thưởng. (Chứng chỉ tạm ẩn — chưa sử dụng.)
- KPI: người duyệt ≠ người xác nhận trên cùng phiếu.
- **Đặt lại mật khẩu LMS cho học sinh**: tuy hai giám đốc có quyền này về mặt hệ thống, mục **Học sinh** hiện chưa hiển thị trên menu của giám đốc, nên trên thực tế thao tác này do **super_admin (quản trị hệ thống)** thực hiện trong mục **Học sinh**.
