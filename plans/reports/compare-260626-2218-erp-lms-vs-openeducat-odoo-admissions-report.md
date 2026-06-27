# Đánh giá thật ERP + LMS của CMC — đối chiếu OpenEduCat & Odoo

Ngày: 2026-06-26 · Mode: `xia --compare` (research-only, chưa đổi code)
Nguồn bằng chứng:
- CMC hiện trạng: scout nội bộ (xem trích dẫn file:line bên dưới)
- OpenEduCat: `plans/reports/researcher-260626-2224-openeducat-admissions-student-architecture-report.md`
- Odoo CRM: `plans/reports/researcher-260626-2224-odoo-crm-lead-conversion-analysis-report.md`

---

## 0. Kết luận thẳng (TL;DR)

Lỗi bạn chỉ ra là **đúng và là lỗi thiết kế gốc**, không phải lỗi UI lặt vặt:

> CMC cho **admin/sale tạo học sinh trực tiếp** (`student.create`), tách rời khỏi luồng cơ hội O1→O5. Học sinh trở thành **bản ghi mồ côi** (`lifecycle='admitted'` nhưng không gắn lớp, không gắn cơ hội, không gắn phụ huynh).

Cả OpenEduCat lẫn Odoo — hai hệ vận hành thật nhiều năm — đều **cấm tạo "đối tượng cuối" trực tiếp**. Học sinh/khách hàng chỉ **sinh ra như đầu ra của một quy trình có cổng trạng thái** (admission / conversion). Đây chính là mô hình CMC cần.

Mức độ trưởng thành hiện tại: **Phase 0/1 (identity + academic core) + CRM (Phase 3) gắn thêm nhưng chưa khâu vào vòng đời học sinh.** Các "đường nối" giữa CRM → Student → Enrollment → Finance đang là thao tác tay, dễ tạo dữ liệu rác và sai quy kết hoa hồng.

---

## 1. Hiện trạng CMC (có bằng chứng)

### 1.1 Học sinh được tạo trực tiếp — không cần quy trình
- `apps/api/src/routers/student.ts:17-48` — `student.create` chỉ cần role `quan_ly` | `sale`, không cần opportunity/enrollment, set thẳng `lifecycle='admitted'`.
- `apps/admin/src/students-panel.tsx:341-380` — nút "Thêm học sinh" gọi `trpc.student.create`.
- Hệ quả (smell #1, #16): học sinh "admitted" mồ côi, chỉ thành `active` khi có enrollment đầu tiên (`enrollment.ts:90-101`). Tạo nhầm = dữ liệu rác vĩnh viễn.

### 1.2 Pipeline cơ hội có, nhưng KHÔNG sinh ra học sinh
- `Opportunity` (`schema.prisma:933-956`): stage `O1_LEAD..O5_ENROLLED`, có auto-hook O3 (đặt lịch test) và O4 (chấm test) — `crm.ts:270-330`. Đây là điểm **đang làm tốt**.
- Nhưng `Opportunity.studentName` chỉ là **string tự do**, không trỏ tới `Student`.
- O5_ENROLLED **không** auto tạo Student / Enrollment. Nhân viên phải tự tay tạo Student rồi tự truyền `enrollment.opportunityId` (`enrollment.ts:58,82`). → seam yếu (smell #2, #10, #17).

### 1.3 Không có trang chi tiết học sinh
- `students-panel.tsx`: chỉ có list + modal sửa 4 trường (`fullName, program, dateOfBirth, lifecycle`). **Không** có profile xem: enrollment, phụ huynh, lịch sử cơ hội, receipt, điểm test (smell #3).
- Phụ huynh nằm ở panel riêng `guardians-panel.tsx`, không gắn vào màn học sinh (smell #4, #13).

### 1.4 Phụ huynh không được bắt ở đầu vào
- `ParentAccount` (`schema.prisma:425-437`) + `Guardian` (`455-469`) tồn tại, nhưng tạo học sinh **không** thu thông tin phụ huynh; phải tạo tách rời (smell #4). Sale không được tạo ParentAccount (chỉ `bgd|quan_ly`) → chặn sale onboard lead (smell #18).

### 1.5 Lifecycle & ràng buộc lỏng
- 6 trạng thái `admitted→active→on_hold|transferred|withdrawn|completed` nhưng chỉ 1 chuyển tự động; sửa tay qua edit modal **không audit** (smell #7).
- `studentCode` unique toàn cục, không scope theo facility (smell #8); capacity chỉ cảnh báo, không chặn (smell #9).

---

## 2. OpenEduCat làm gì (mô hình admissions chuẩn)

- **`op.student` kế thừa `res.partner`** — học sinh là một "contact" có thêm thuộc tính học vụ, không phải bảng tách rời. (`openeducat_core/models/student.py:61-183`)
- **KHÔNG tạo student trực tiếp.** Student chỉ sinh ra qua state machine admission:
  `draft → submit → confirm → admission → done`, mỗi bước là một method có tên. (`openeducat_admission/models/admission.py:77-89`)
- **Cổng tạo học sinh là `enroll_student()`** — tại bước admission→done, **một transaction** tạo đồng thời: `op.student` + enrollment `op.student.course` + fee milestones + đăng ký môn. (`admission.py:451-513`, `get_student_vals` `249-320`)
- **Enrollment là model hạng nhất** `op.student.course` (batch, roll_number, academic_year, term, subjects) — không phải m2m ẩn.
- **Parent (`op.parent`) cũng là res.partner**, link m2m tới student, bắt quanh thời điểm admission.
- **Ranh giới module rõ:** ERP = core/admission/fees/parent/timetable; LMS = assignment/exam/activity; classroom là biên.

## 3. Odoo CRM làm gì (mô hình pipeline + provisioning chuẩn)

- **Lead vs Opportunity là cùng 1 bảng `crm.lead`**, phân biệt bằng field `type` ('lead'|'opportunity') + quyền, không tách bảng.
- **Stage là DB rows (`crm.stage`)**, cấu hình được theo team; `is_won`, `sequence`, `fold`. Won = `probability==100 & stage.is_won`; Lost = `active=false & probability=0` + `crm.lost.reason` riêng để báo cáo. → KHÔNG hard-code enum.
- **Provisioning khi convert:** `_handle_partner_assignment()` tự tạo `res.partner` (nếu `create_missing`), map dữ liệu qua `_prepare_customer_values()`. **Cảnh báo:** Odoo core **không dedupe** — tạo partner mới mỗi lần; cần thêm logic find-or-create.
- **`res.partner` thống nhất** công ty/cá nhân/khách qua `is_company`, `parent_id/child_ids`, `type`.

---

## 4. Decision Matrix (CMC nên theo cách nào)

| Quyết định | Cách CMC hiện tại | OpenEduCat / Odoo | Khuyến nghị cho CMC |
| --- | --- | --- | --- |
| Tạo học sinh | `student.create` trực tiếp (admin/sale) | Chỉ qua `enroll_student()` ở cuối admission | **Bỏ tạo trực tiếp.** Student sinh tự động khi O5/nhập học. Giữ `student.create` chỉ cho migration/seed (role hẹp, có cờ). |
| Seam Opportunity→Student | string `studentName`, thủ công | Admission `done` tạo student trong 1 transaction | **Thêm `opportunity.convertToStudent()`**: tại O5 (hoặc receipt.approve) tạo Student + Enrollment + link Guardian atomically. |
| Pipeline stage | enum `O1..O5` hard-code | DB rows cấu hình (Odoo) | Giữ enum O1..O5 (đã khớp nghiệp vụ CMC, đã verify) — **không đảo ngược quyết định người dùng**. Chỉ cân nhắc DB-config nếu sau này cần nhiều phễu. |
| Trang Students | list + sửa 4 trường | profile đầy đủ | **Thêm Student Detail**: thông tin HS + phụ huynh + enrollment + cơ hội + receipt + điểm. List chỉ lọc/xem/sửa-trường-được-phép (đúng ý bạn). |
| Phụ huynh | panel tách rời, không bắt ở intake | bắt tại admission, link m2m | **Thu phụ huynh tại bước cơ hội/nhập học**, hiển thị trong Student Detail; cho sale tạo được liên hệ phụ huynh. |
| Dedupe | không có | Odoo cũng thiếu (bài học ngược) | **Thêm find-or-create** theo (phone/email) trước khi tạo Student để tránh trùng. |
| Quy kết hoa hồng | freeze ở receipt.approve | ownerId trên lead | Giữ (đã verify theo spec payroll-v2) nhưng ghi nhận rủi ro đổi owner giữa O5↔receipt (smell #19). |

---

## 5. Khuyến nghị triển khai (xếp theo ưu tiên)

**P0 — Sửa lỗi gốc bạn nêu (Opportunity → Student provisioning)**
1. Thêm thủ tục `crm.convertToStudent` (atomic): từ Opportunity ở O5 → tạo `Student` (find-or-create theo phone), tạo `Enrollment`, link `Guardian` từ contact, set `lifecycle='active'`, audit đầy đủ. Mô phỏng `enroll_student()` của OpenEduCat.
2. Khóa `student.create`: chuyển sang nội bộ (chỉ seed/migration, role `quan_ly` + cờ rõ ràng), gỡ nút "Thêm học sinh" khỏi UI vận hành thường.

**P0 — Student Detail view**
3. Trang chi tiết học sinh: tab Thông tin HS (đầu vào), Phụ huynh, Enrollment, Lịch sử cơ hội, Receipt, Điểm test. List Students chỉ còn lọc/xem + sửa các trường được phép.

**P1 — Khâu phụ huynh vào đầu vào**
4. Bắt thông tin phụ huynh ngay ở cơ hội/nhập học; hiển thị trong Student Detail; nới quyền để sale tạo liên hệ phụ huynh.

**P1 — Chốt các seam còn hở**
5. receipt.approve ↔ opportunity O5 nhất quán (smell #10); audit khi đổi lifecycle (smell #7); cân nhắc scope `studentCode` theo facility (smell #8); quyết định chặn vs cảnh báo capacity (smell #9, cần bạn chốt nghiệp vụ).

**P2 — LMS account provisioning**
6. Tự tạo `StudentAccount` (login LMS) khi convert, thay vì out-of-band (smell #5, #12).

---

## 6. Quyết định nghiệp vụ (đã chốt với user 2026-06-26)

1. **Điểm sinh học sinh:** tại **`receipt.approve`** (đã đóng tiền). Một bản ghi chỉ tính là "học sinh thật" sau khi phiếu thu được duyệt. → Seam chính = `receipt.approve` tạo `Student` + `Enrollment` + link `Guardian` atomically (không phải O5).
2. **`student.create` trực tiếp:** **bỏ hẳn khỏi UI vận hành**. Gỡ nút "Thêm học sinh"; thủ tục chỉ giữ nội bộ cho seed/migration (role hẹp + cờ rõ ràng + audit).
3. **Capacity:** **chỉ cảnh báo** (giữ `overCapacity` flag hiện tại), không chặn cứng, không waitlist.
4. **Dedupe:** **find-or-create theo SĐT phụ huynh** trước khi tạo Student.

Còn cần làm rõ khi vào plan (không chặn việc bắt đầu):
- Trường nào ở Students được phép sửa sau khi đã thành học sinh (phần "đầu vào bất biến").
- Hành vi khi receipt bị reject/huỷ sau khi đã sinh Student (rollback lifecycle?).

---

## Phụ lục — bản đồ smell → file
student.create trực tiếp: `apps/api/src/routers/student.ts:17-48` ·
UI tạo: `apps/admin/src/students-panel.tsx:341-380` ·
seam thủ công: `apps/api/src/routers/enrollment.ts:58,82` ·
auto-hook CRM (đang tốt): `apps/api/src/routers/crm.ts:270-330` ·
guardian tách rời: `apps/admin/src/guardians-panel.tsx` ·
hoa hồng freeze: `apps/api/src/routers/finance.ts:256-262`
