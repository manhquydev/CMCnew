# Làm rõ toàn diện ERP + LMS CMC — báo cáo tổng hợp (master)

Ngày: 2026-06-26 · Branch: develop · Mode: research/clarification (chưa đổi code)

Gộp 5 báo cáo con:
- `compare-260626-2218-erp-lms-vs-openeducat-odoo-admissions-report.md` (luồng student/admission)
- `architecture-260626-2338-unified-erp-rbac-report.md` (gộp ERP + RBAC)
- `spec-audit-260626-2338-teacher-permissions-report.md` (quyền giáo viên)
- `gap-analysis-260626-2338-business-completeness-report.md` (độ đầy đủ nghiệp vụ)
- `ui-audit-260626-2338-unified-erp-redesign-direction-report.md` (UI/UX)
- Input nền: 10 tài liệu `plans/reports/xia_analysis/*`

---

## 0. Kết luận tổng (đọc cái này trước)

Hệ thống CMC có **engine lõi mạnh thật** (grading blend, receipt ledger, star ledger, payroll thuần TS, RLS đa tầng — đều hơn OpenEduCat/Odoo theo chính tài liệu xia). Cảm giác "sơ sài" **không** đến từ thiếu logic lõi, mà từ:
1. **Thiếu mô liên kết (connective tissue)** giữa các domain (CRM↔Student↔Enrollment↔Finance chưa khâu tự động).
2. **Thiếu bề mặt vận hành (operator surface):** không có chi tiết học sinh, không có sidebar lịch sử/chatter, list 233 dòng không lọc.
3. **Kiến trúc frontend chồng chéo:** 2 app admin/teaching trùng panel, app "teaching" thực ra là shell dùng chung → gây hiểu nhầm phân quyền.
4. **UI compose kém** (dùng ~30% canvas, empty state trơ, KPI card phẳng) — *token thiết kế đã ổn*, lỗi ở cách ghép màn.

→ Đây là tin tốt: phần lớn việc là **lắp ráp + đánh bóng**, không phải viết lại lõi.

---

## 1. Theme 1 — Gộp ERP về một mối + RBAC tập trung

**Phát hiện (architecture report):**
- Tách admin/teaching **chỉ là frontend**. Cả hai đã dùng chung: 1 API, 1 cookie `cmc.session`, 1 cơ chế `requireRole` + RLS (`apps/api/src/trpc.ts:54`, `packages/db/src/index.ts:33`).
- Các panel `crm/cskh/finance/payroll` là **file trùng lặp** giữa 2 frontend.
- **Không có bản đồ quyền tập trung** — danh sách role rải rác ~12 router + suy lại thành cờ `can*` ở frontend.

**Đề xuất:**
- Gộp thành **1 SPA staff duy nhất**, nav **lọc theo role** (mỗi nhân sự chỉ thấy module được phép). Học sinh/PH vẫn ở app LMS riêng.
- Thêm **registry quyền kiểu Odoo** (module → action → roles cho phép) thay cho `requireRole` rải rác. **Không** làm ABAC (RLS đã lo tenancy).
- Effort ~4–5 ngày, rủi ro thấp (merge SPA, giữ RLS/JWT).

## 2. Theme 4 — Quyền giáo viên (ĐÍNH CHÍNH)

**KHÔNG có lỗi phân quyền.** Bằng chứng:
- `classBatch.create` = `requireRole(quan_ly)` (`apps/api/src/routers/class-batch.ts:60`).
- Nút "+ Tạo lớp" chỉ render khi `isSuperAdmin || roles.includes('quan_ly')` (`apps/teaching/src/App.tsx:870`).
- Seed: `giaovien@cmc.local` chỉ có `[giao_vien]`. Screenshot là phiên **quản lý/super-admin**, không phải giáo viên.

**Vấn đề thật = UX/kiến trúc:** app tên "teaching" là shell dùng chung → quản lý đăng nhập thấy hết module ⇒ trông như giáo viên tạo lớp. **Theme 1 xử lý gọn.**

Giáo viên hiện bị giới hạn đúng (điểm danh, chấm bài, đánh giá định tính, đề xuất lên cấp). `head_teacher` mới duyệt lên cấp; chứng chỉ `head_teacher/quan_ly`. Khớp mô hình OpenEduCat (course/batch = đối tượng admin; faculty = dạy + chấm).

**Còn mở:** `head_teacher` có nên được xếp lịch/tạo lớp không; role gate có nên phân cấp (head_teacher kế thừa verb của giao_vien) — xem §6.

## 3. Theme 2 — Bổ sung nghiệp vụ (gap analysis)

**P0 — mô liên kết tối thiểu để hết "sơ sài" (khớp quyết định đã chốt):**
1. **Provisioning học sinh atomic tại `receipt.approve`** — hiện CHƯA xây: `receipt.create` đòi `studentId` có sẵn và `student.create` vẫn sống (`student.ts:17`) ⇒ vẫn đẻ được học sinh mồ côi. Đây là P0 quan trọng nhất, hội tụ đúng quyết định đã chốt (sinh HS khi đóng tiền, dedupe SĐT phụ huynh, gỡ `student.create` khỏi UI).
2. **Trang chi tiết học sinh** (HS + phụ huynh + enrollment + cơ hội + receipt + điểm).
3. **2 bug lịch (P0):** query trùng lịch load toàn bộ lịch sử session của cơ sở, thiếu lọc ngày (`schedule.ts:151-153`); `ClassSession.roomId/teacherId` thiếu FK (`schema.prisma:269-288`).

**P1 — làm dày bề mặt:**
- **Chatter/activity sidebar:** dữ liệu `RecordEvent` có nhưng không hiển thị; `getFollowers` read-only (chưa fan-out); chưa có model `RecordActivity` (việc cần làm). Đây là thứ khiến màn "mỏng" so với Odoo.
- **Config-as-code:** trọng số grading hardcode (thêm cột weight cho `GradingTemplate`); khóa kỳ/điểm (`isLocked`); badge quota.

**Do-NOT-build (tránh over-engineer, chính tài liệu xia cũng bác):** subject/prerequisite tree, sổ kế toán kép, resource.calendar, rule engine kiểu Python, generic goal engine.

## 4. Theme 3 — Thiết kế lại UI

**Nền tảng `packages/ui` đã chuyên nghiệp** — lỗi ở compose màn, không phải design system.
- Sửa = thêm ~8 primitive (`EmptyState`, `StatCard`, `DataTable`, `PageHeader`, `StatusBadge`…) + gộp 2 shell thành 1 `StaffShell` lọc theo role, rồi áp dụng từng màn. Additive, rủi ro thấp, **không đổi token màu**.
- Báo cáo UI có sẵn: IA thống nhất, map role→nhóm nav, persona→màn landing, 5 redesign màn trọng điểm (dashboard, class-detail/scheduling, list students, CRM pipeline), rollout 4 pha.
- Bước kế: chạy `/design` với IA này làm input để ra design cụ thể.

---

## 5. Lộ trình đề xuất (để chạy harness + goal + loop)

Mỗi pha là một story/plan độc lập, có acceptance rõ để loop tự kiểm.

| Pha | Tên | Nội dung | Rủi ro | Phụ thuộc |
|----|----|----|----|----|
| **F0** | RBAC registry + gộp shell | Registry quyền tập trung; merge admin+teaching → 1 StaffShell lọc theo role; persona→landing | TB (auth) | — |
| **F1** | Student provisioning atomic | receipt.approve → tạo Student+Enrollment+Guardian (dedupe SĐT PH); gỡ student.create khỏi UI; rollback khi reject | **Cao** (data, finance) | F0 |
| **F2** | Student Detail + fix lịch | Trang chi tiết HS; lọc ngày query trùng lịch; FK room/teacher | TB | F1 |
| **F3** | UI primitives + redesign màn | 8 primitive packages/ui; áp dụng dashboard/list/CRM/class-detail; chạy /design | Thấp | F0 |
| **F4** | Chatter/activity + config-as-code | RecordActivity + follower fan-out→SSE; sidebar lịch sử; weight DB; khóa kỳ | TB | F2 |

F0 và (chuẩn bị) F3 có thể chạy song song. F1 là high-risk → cần story folder execplan/design/validation + xác nhận trước khi code.

---

## 6. Câu hỏi cần bạn chốt (để khóa plan)

**Nhóm RBAC/role:**
1. Role gate **phân cấp** không? (head_teacher tự động có mọi quyền của giao_vien; quan_ly là superuser của staff?) hay mỗi role liệt kê quyền tường minh, không kế thừa?
2. `head_teacher` có được **tạo lớp / xếp lịch** không, hay chỉ `quan_ly` (+ vai trò academic-admin) mới được?
3. Có role `ctv_mkt` hiện **không có quyền nào** (grant-less) — bỏ hay định nghĩa quyền cho nó?

**Nhóm provisioning/finance (F1):**
4. **Receipt bị reject/huỷ SAU khi đã sinh Student** thì xử lý sao? (rollback lifecycle về trạng thái trước? giữ Student nhưng đánh dấu? — ảnh hưởng định nghĩa "1 học sinh").
5. Một học sinh **học nhiều chương trình/khoá cùng lúc** có được không (multi-program enrollment) hay 1 tại 1 thời điểm?

**Nhóm vận hành:**
6. Nhân sự có cần **inbox/thông báo việc cần làm** (RecordActivity kiểu Odoo) ở F4 không, hay chỉ cần sidebar lịch sử là đủ?
7. Bạn muốn plan ra **1 mega-plan** hay **tách theo pha F0..F4** (mỗi pha 1 plan để loop chạy lần lượt)?

---

## 7. Việc tiếp theo tôi đề xuất
- Bạn trả lời §6 → tôi build plan (high-risk story cho F1) + chạy `/design` cho UI.
- Sau đó bạn khởi động harness + goal + loop để thực thi từng pha đến khi xanh.
