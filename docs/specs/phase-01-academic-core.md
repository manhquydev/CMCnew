# Phase 1 — Đặc tả nghiệp vụ: Identity & Lõi giáo vụ

> **Mục đích:** chốt rõ nghiệp vụ TRƯỚC khi code. Đây là **hợp đồng nghiệp vụ** — mọi schema/route bám đúng. Nếu phát sinh mơ hồ MỚI khi build → DỪNG và hỏi.
> Trạng thái: ✅ **ĐÃ CHỐT** (2026-06-23) · Nguồn: [[cmc-old-system-inventory]] + `project-charter.md` + adversarial spec review.

## Tóm tắt quyết định đã chốt
- **Cổng học sinh/phụ huynh → Phase 2.** Phase 1 chỉ phía nhân sự (Teaching/Admin) + bản ghi học sinh.
- **RBAC 10 role** (thêm `head_teacher` + `bgd`).
- **Program + Course = danh mục GLOBAL dùng chung toàn hệ** (không facility-scope). Từ ClassBatch trở xuống mới facility-scoped + RLS.
- **ClassBatch lifecycle:** `planned → open → running → closed` + `cancelled`; **hủy linh hoạt** (mọi trạng thái, kèm lý do, **mở lại được**).
- **Student lifecycle:** `admitted/active/on_hold/transferred/withdrawn/completed` (Phase 1 dùng admitted/active).
- **Enrollment:** Phase 1 chỉ `active`; **hoàn tất thủ công** khi đóng lớp.
- **Capacity:** cảnh báo mềm khi vượt (không chặn).
- **Xếp lịch:** chặn cứng trùng phòng + trùng giáo viên.
- **Điểm danh:** present/absent/late + cờ `excused`; streak chỉ tính present.
- **🆕 Audit/Chatter đầy đủ kiểu Odoo** — hạ tầng **cross-cutting làm ngay Phase 1**, mọi record có log thay đổi + ghi chú tay + người theo dõi + timeline.
- **UI = Mantine** (3 app). **Soft-delete/archive mọi nơi** (active/archivedAt + log), không xóa cứng. **Student.level** để nullable, chốt mô hình ở Phase 2.

---

## 0. Phạm vi Phase 1
- Quản lý Facility / User / Role / gán facility (Admin)
- Danh mục **Program + Course** (global) · Lớp/khóa (ClassBatch) · Phòng (Room)
- Lịch tuần (ScheduleSlot) → sinh Buổi học (Session) · Timetable · gán giáo viên/phòng
- Hồ sơ Học sinh (Student) + Enrollment (ghi danh)
- Điểm danh (giáo viên/quản lý chấm)
- **Hạ tầng Audit/Chatter dùng chung** (gắn vào tất cả thực thể trên)

Ngoài phạm vi Phase 1: cổng đăng nhập học sinh/phụ huynh, xem điểm/streak phía học sinh → **Phase 2**.

---

## 1. RBAC — 10 role

| Role | Tên VN | Trách nhiệm (Phase 1) |
|---|---|---|
| `super_admin` | Quản trị tối cao | Toàn quyền, xuyên facility, quản lý user/facility |
| `quan_ly` | Quản lý vận hành | **Tạo lớp**, duyệt enrollment, xếp lịch, quản lý phòng (trong facility) |
| `head_teacher` | Tổ trưởng/Hiệu trưởng | Giám sát giáo viên, duyệt level-up (Phase 2), xem KPI lớp |
| `giao_vien` | Giáo viên | Xem lớp của mình, **điểm danh** |
| `sale` | Kinh doanh | Tạo học sinh/enrollment (CRM Phase 3) |
| `cskh` | Chăm sóc KH | After-sale (Phase 5) |
| `ctv_mkt` | CTV marketing | CRM hạn chế (Phase 3) |
| `ke_toan` | Kế toán | Thu phí (Phase 3) |
| `hr` | Nhân sự | Lương/nhân sự (Phase 4) |
| `bgd` | Ban giám đốc | Dashboard read-only (Phase 5) |

- **Tạo lớp:** quan_ly / super_admin. **Điểm danh:** giao_vien / quan_ly / super_admin.
- Phase 0 đang có enum 8 role → Phase 1 thêm `head_teacher` + `bgd` qua migration.

---

## 2. Thực thể & vòng đời

### 2.1 Program + Course (danh mục GLOBAL)
- **Program**: enum `UCREA / BRIGHT_IG / BLACK_HOLE` (toàn hệ).
- **Course**: code, name, **program**, mô tả, trạng thái (active/archived). **Global — không facility_id, không RLS** (danh mục tham chiếu dùng chung mọi cơ sở). Đây là *chủ đích*, không phải lỗ hổng tenancy.

### 2.2 ClassBatch (Lớp cụ thể) — **facility-scoped + RLS**
- `code` = **B-YYYY-NNNN** (sinh nguyên tử theo facility+năm), facilityId, courseId (→ kế thừa program), name, startDate, endDate?, `capacity?`, `status`.
- **Lifecycle:** `planned → open → running → closed` + `cancelled`.
- **Hủy lớp (linh hoạt):** cho hủy từ **bất kỳ** trạng thái, **bắt buộc nhập lý do hủy** (ghi vào audit/chatter). **Cho mở lại** (cancelled → trạng thái trước đó) kèm lý do.
- **Cascade khi hủy:** các Session tương lai → `cancelled`; Session đã diễn ra giữ nguyên (đã có điểm danh = đã học). Enrollment **giữ nguyên** để audit (không tự withdraw ở Phase 1).
- Capacity: **cảnh báo mềm** khi enrollment vượt (không chặn).

### 2.3 Student (Hồ sơ học sinh) — **facility-scoped + RLS**
- name, ngày sinh, **program** hiện tại, level, facilityId, mã HS, (liên kết phụ huynh: Phase sau). Tạo bởi sale/quan_ly.
- **Lifecycle:** `admitted, active, on_hold, transferred, withdrawn, completed`. Phase 1 dùng `admitted` (mới tạo) / `active` (đã có enrollment); các trạng thái bảo lưu/chuyển/rút kích hoạt ở Phase 5 (after-sale).

### 2.4 Enrollment (Ghi danh) — **facility-scoped (qua student/batch)**
- (classBatchId, studentId) duy nhất; **Phase 1 chỉ `status = active`**.
- **Hoàn tất thủ công:** khi đóng lớp, quản lý đánh dấu enrollment → `completed` (không tự động).
- `opportunityId` (nullable) — để Phase 3 CRM truy vết (sửa lỗ A1 hệ cũ).
- reserved/transferred/withdrawn → Phase 5.

### 2.5 Room (Phòng học) — **facility-scoped + RLS**
- facility+code duy nhất, name, capacity, active.

### 2.6 ScheduleSlot → Session — **facility-scoped (qua batch)**
- Slot lặp tuần: (thứ, giờ bắt đầu/kết thúc, phòng, giáo viên) theo lớp → **generate** Session theo khoảng ngày.
- Session: ngày, giờ, phòng, giáo viên, `status`: `planned → confirmed → cancelled`. Hỗ trợ buổi bù (makeup).
- **Idempotent generate:** khóa duy nhất (classBatchId, sessionDate, startTime); chạy lại bỏ qua session đã có, trả về danh sách conflict.
- **Trùng lịch = chặn cứng**: 1 phòng hoặc 1 giáo viên không thể 2 session chồng giờ (áp dụng cả buổi bù). Giờ lưu chuẩn ICT (UTC+7).

### 2.7 Attendance (Điểm danh) — **facility-scoped (qua session/enrollment)**
- Mỗi (session, enrollment) một bản ghi; `status`: **present / absent / late** + cờ boolean **`excused`** (có phép) + ghi chú.
- Chấm bởi giao_vien/quan_ly. Idempotent (chấm lại ghi đè).
- **Streak chỉ tính `present`** (absent/late đều ngắt; `excused` chỉ là cờ audit, không cộng streak).

### 2.8 🆕 Audit / Chatter (cross-cutting — kiểu Odoo)
Mọi thực thể nghiệp vụ (ClassBatch, Student, Enrollment, Session, Attendance, Room, User…) gắn vào hạ tầng dùng chung:
- **Tự động log thay đổi trường/trạng thái:** ai · khi nào · trường nào · cũ → mới (ví dụ lớp `running → cancelled` kèm lý do).
- **Ghi chú/bình luận tay** (message) gắn vào record.
- **Người theo dõi (followers)** của record.
- **Timeline hiển thị** trên UI chi tiết của record (như Odoo chatter).
- Lưu polymorphic (entityType + entityId), không lưu PII/tiền nhạy cảm trong nội dung log.

---

## 3. Bất biến kỹ thuật
- Mọi bảng có `facility_id` → bật RLS + policy (pattern Phase 0) + test cô lập. (Program/Course global → không RLS, là chủ đích.)
- Mã lớp B-YYYY-NNNN sinh nguyên tử (advisory lock).
- Logic nghiệp vụ nặng (sinh session, kiểm trùng lịch, sinh mã, streak) → `packages/domain-academic` thuần, test độc lập.
- Mọi mutation trạng thái → ghi audit/chatter (§2.8) — bắt buộc, không bỏ.

---

## 4. Bảng quyết định (khóa schema)

| Mục | Quyết định |
|---|---|
| Cổng học sinh | → Phase 2 |
| RBAC | 10 role (+head_teacher, +bgd); tạo lớp=quan_ly; điểm danh=giao_vien/quan_ly |
| Program/Course | **Global dùng chung**, không facility-scope |
| ClassBatch | facility-scoped; lifecycle +cancelled; **hủy mọi trạng thái + lý do + mở lại**; cascade session tương lai→cancelled, enrollment giữ |
| Student | facility-scoped; lifecycle admitted/active/on_hold/transferred/withdrawn/completed |
| Enrollment | Phase 1 chỉ active; **completed thủ công** khi đóng lớp |
| Capacity | cảnh báo mềm |
| Scheduling | chặn cứng trùng phòng+GV; generate idempotent; ICT |
| Attendance | present/absent/late + excused; streak chỉ present |
| **Audit/Chatter** | **đầy đủ kiểu Odoo, cross-cutting, làm nền ngay Phase 1** |
