# Phase 1 — Đặc tả nghiệp vụ: Identity & Lõi giáo vụ

> **Mục đích:** chốt rõ nghiệp vụ TRƯỚC khi code. Mỗi mục ghi rõ **[ĐỀ XUẤT]** (rút từ audit hệ cũ, bạn duyệt) và **[HỎI]** (cần bạn quyết).
> Trạng thái: ✅ **ĐÃ CHỐT** (2026-06-23) · Nguồn: [[cmc-old-system-inventory]] + `project-charter.md`.
>
> **Quyết định đã chốt:** Q1 cổng học sinh → **Phase 2** · Q2 **10 role** (thêm head_teacher + bgd) · Q3 chương trình ở **Course + Student**, lớp kế thừa · Q4 lifecycle lớp **planned→open→running→closed + cancelled** · Q5 lifecycle học sinh **admitted/active/on_hold/transferred/withdrawn/completed** · Q6 trùng lịch **chặn cứng cả phòng + giáo viên** · Q7 điểm danh **present/absent/late + cờ excused**.

## 0. Phạm vi Phase 1

**[ĐỀ XUẤT]** Phase 1 chỉ làm **phía nhân sự (Teaching/Admin) + bản ghi học sinh**, gồm:
- Quản lý Facility / User / Role / gán facility (Admin)
- Danh mục Khóa học (Course) · Lớp/khóa (ClassBatch) · Phòng (Room)
- Lịch tuần (ScheduleSlot) → sinh Buổi học (Session) · Timetable · gán giáo viên/phòng
- Hồ sơ Học sinh (Student) + Enrollment (ghi danh) + lifecycle
- Điểm danh (giáo viên/quản lý chấm)

**[HỎI Q1]** Cổng **đăng nhập học sinh/phụ huynh + xem điểm danh/streak** — để ở **Phase 2** (cùng toàn bộ trải nghiệm LMS) hay phải có ngay trong Phase 1? (Roadmap cũ ghi Phase 1 cho học sinh thấy streak; tôi đề xuất dời sang Phase 2 để Phase 1 gọn ở lõi giáo vụ, nhưng cần bạn chốt.)

---

## 1. Mô hình RBAC (bạn giao tôi rà soát & đề xuất)

**Bối cảnh:** Odoo cũ có persona BGĐ + tổ trưởng tách riêng; bản internal-rewrite gộp còn 8 role (quan_ly kiêm luôn duyệt). Hai nguồn mâu thuẫn.

**[ĐỀ XUẤT]** Mô hình 10 role cho rõ trách nhiệm thật của trung tâm:

| Role | Tên VN | Trách nhiệm chính (Phase 1) |
|---|---|---|
| `super_admin` | Quản trị tối cao | Toàn quyền, xuyên facility, quản lý user/facility |
| `quan_ly` | Quản lý vận hành | Tạo lớp, duyệt enrollment, xếp lịch, quản lý phòng (trong facility) |
| `head_teacher` | Tổ trưởng/Hiệu trưởng | Giám sát giáo viên, **duyệt level-up** (Phase 2), xem KPI lớp |
| `giao_vien` | Giáo viên | Xem lớp của mình, **điểm danh**, (chấm điểm ở Phase 2) |
| `sale` | Kinh doanh | CRM, tạo enrollment từ cơ hội (CRM ở Phase 3) |
| `cskh` | Chăm sóc KH | After-sale (Phase 5) |
| `ctv_mkt` | CTV marketing | CRM hạn chế (Phase 3) |
| `ke_toan` | Kế toán | Thu phí (Phase 3) |
| `hr` | Nhân sự | Lương/nhân sự (Phase 4) |
| `bgd` | Ban giám đốc | Dashboard read-only (Phase 5), không ghi |

**[HỎI Q2]** Duyệt mô hình 10 role này? Điểm cần chốt:
- `head_teacher` tách khỏi `quan_ly` — đúng tổ chức CMC không? (hay 1 người kiêm cả 2?)
- `bgd` có cần là role hệ thống ngay, hay chỉ là quyền xem thêm gắn cho quản lý?
- Trong Phase 1, ai được **tạo lớp** và ai được **điểm danh**? (đề xuất: tạo lớp = quan_ly/super_admin; điểm danh = giao_vien/quan_ly/super_admin)

> Lưu ý kỹ thuật: Phase 0 đang có enum 8 role; nếu duyệt 10 role tôi sẽ thêm `head_teacher`+`bgd` qua migration Phase 1.

---

## 2. Thực thể & vòng đời (lifecycle)

### 2.1 Course (Khóa học) — danh mục
**[ĐỀ XUẤT]** code, name, **program** (UCREA/BRIGHT_IG/BLACK_HOLE), mô tả, trạng thái (active/archived). Dùng chung toàn hệ (facility = null) hoặc theo cơ sở.

**[HỎI Q3]** **Chương trình (UCREA/BI/BH) gắn ở đâu?** Đề xuất: gắn ở **Course** (mỗi khóa thuộc 1 chương trình) và **Student** (học sinh đang theo chương trình nào). Lớp kế thừa chương trình từ Course. Đúng không, hay học sinh có thể học nhiều chương trình song song?

### 2.2 ClassBatch (Lớp/khóa học cụ thể)
**[ĐỀ XUẤT]** Từ hệ cũ: `code` = **B-YYYY-NNNN** (sinh nguyên tử theo facility+năm), courseId, name, startDate, endDate?, `capacity` (tùy chọn), `status`.
- **Lifecycle [ĐỀ XUẤT]:** `planned → open → running → closed` (một chiều; `open`=đang tuyển, `running`=đang học, `closed`=kết thúc).

**[HỎI Q4]** Vòng đời lớp 4 trạng thái này đủ chưa? Có cần trạng thái `cancelled` (hủy lớp chưa khai giảng) không?

### 2.3 Student (Hồ sơ học sinh)
**[ĐỀ XUẤT]** name, ngày sinh, program hiện tại, level, facility, mã HS, phụ huynh liên kết (Phase sau). Tạo bởi sale/quan_ly.
- **Student lifecycle [ĐỀ XUẤT từ after-sale cũ]:** `admitted → active → on_hold(bảo lưu) → transferred → withdrawn → completed`.

**[HỎI Q5]** Lifecycle học sinh trên có khớp thực tế CMC? (Phase 1 chỉ cần `active`; các trạng thái bảo lưu/rút thuộc after-sale Phase 5 — nhưng tôi muốn chốt danh sách chuẩn ngay để không phải đổi schema sau.)

### 2.4 Enrollment (Ghi danh học sinh vào lớp)
**[ĐỀ XUẤT]** (classBatchId, studentId) duy nhất; `status`: `active → completed` / `dropped`. Liên kết `opportunityId` (để Phase 3 CRM truy vết — sửa lỗ A1 hệ cũ).

### 2.5 Room (Phòng học)
**[ĐỀ XUẤT]** facility+code duy nhất, name, capacity, active.

### 2.6 ScheduleSlot → Session (Lịch tuần → buổi học)
**[ĐỀ XUẤT]** Slot lặp tuần: (thứ, giờ bắt đầu/kết thúc, phòng, giáo viên) theo lớp → **generate** ra các Session theo khoảng ngày. Session: ngày, giờ, phòng, giáo viên, `status`: `planned → confirmed → cancelled`. Hỗ trợ buổi bù (makeup).

**[HỎI Q6]** **Quy tắc trùng lịch** khi xếp: hệ thống nên **chặn cứng** (1 phòng/1 giáo viên không thể 2 buổi cùng giờ) hay chỉ **cảnh báo**? (đề xuất: chặn cứng trùng phòng + trùng giáo viên.)

### 2.7 Attendance (Điểm danh)
**[ĐỀ XUẤT]** mỗi (session, enrollment) một bản ghi; `status`: **present / absent / late**; cờ `excused` (có phép); ghi chú. Chấm bởi giáo viên/quản lý. Idempotent (chấm lại ghi đè).

**[HỎI Q7]** Trạng thái điểm danh **present/absent/late + excused** đủ chưa? Có loại nào CMC dùng mà thiếu (vd: "vào muộn có phép", "nghỉ không phép")?

---

## 3. Bất biến kỹ thuật (tự quyết, không cần hỏi)
- Mọi bảng có `facility_id` → bật RLS + policy (theo pattern Phase 0).
- Mã lớp B-YYYY-NNNN sinh nguyên tử (advisory lock như hệ cũ).
- Mọi thay đổi trạng thái → ghi audit `record_event` (chuẩn bị cho audit log Phase 5).

---

## 4. Quyết định đã chốt (khóa schema)

| # | Quyết định |
|---|---|
| Q1 | Cổng đăng nhập học sinh/phụ huynh + xem điểm danh/streak → **Phase 2**. Phase 1 chỉ phía nhân sự + bản ghi học sinh. |
| Q2 | **10 role**: super_admin, quan_ly, **head_teacher**, giao_vien, sale, cskh, ctv_mkt, ke_toan, hr, **bgd**. (Phase 1 thêm `head_teacher`+`bgd` vào enum qua migration.) |
| Q3 | Chương trình (UCREA/BRIGHT_IG/BLACK_HOLE) gắn ở **Course** và **Student**; ClassBatch kế thừa từ Course. Mỗi học sinh 1 chương trình tại một thời điểm. |
| Q4 | ClassBatch lifecycle: `planned → open → running → closed`, thêm **`cancelled`** (hủy lớp chưa chạy). |
| Q5 | Student lifecycle enum: `admitted, active, on_hold, transferred, withdrawn, completed`. Phase 1 dùng `admitted/active`; phần còn lại kích hoạt ở Phase 5. |
| Q6 | Xếp lịch: **chặn cứng** trùng phòng VÀ trùng giáo viên cùng khung giờ. |
| Q7 | Attendance status: `present / absent / late` + cờ boolean **`excused`**. Streak chỉ tính `present`. |

→ Đây là hợp đồng nghiệp vụ Phase 1. Mọi schema/route bám đúng bảng này. Nếu phát sinh mơ hồ mới khi build, DỪNG và hỏi.
