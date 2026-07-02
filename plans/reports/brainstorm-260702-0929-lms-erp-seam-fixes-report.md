# Brainstorm — Xử lý điểm đứt gãy FE↔BE↔DB (ERP + LMS)

Date: 2026-07-02 · Branch: develop · Mode: markdown only (no --html/--wiki)
Input: audit 3-scout (API parity / dead UI / dead DB) + 3 vòng hỏi-đáp với operator.

## 1. Problem statement

Audit nhánh develop tìm thấy các đứt gãy:
1. **UI chết**: 2 nút "Chọn bài tập mẫu"/"Phát lên LMS" (`apps/admin/src/schedule-detail.tsx:157-158`) không có handler — tàn dư mock Session-360 Phase 1, và là **khái niệm sai**: nghiệp vụ thật không có "phát bài" thủ công.
2. **Backend không UI**: cụm payroll/HR (`profileUpsert`, `rateCreate`, `payslipList`, `commissionForSale`, `payslipBulkMarkPaid`, `kpiSetAuto`, `syncCallMetrics`, `compensation.effective`…) gán quyền cho role `hr`/`ke_toan` mà **không ai giữ** → không màn hình nào gọi. `classBatch.update` (vừa ship 64bce29) chưa nút UI. `badge.list/create/archive/grant`, `shiftRegistration.withdraw/registeredInMonth`, `room.update/archive`, `course.archive`, `audit.follow/followers`, `sessionEvidence.listByClass/detailForPrincipal`, `checkInOut.history`, `crm.contactList`, `staffNotif.markRead`, `parentMeeting.setSchedule` chưa UI.
3. **Dư thừa**: `GradingThreshold` write-only (seed ghi, không ai đọc); `lmsAuth.loginParent` trái quyết định passwordless-OTP; `/showcase` (LMS) toàn mock nhưng reachable prod.
4. **Rủi ro kỹ thuật**: cast `as any`/`as unknown as` ở ≥5 panel ERP (payroll, kpi-evaluation, compensation, terms, shift-reg-detail) vô hiệu type-safety đầu-cuối của tRPC.
5. FE→BE parity: **0 lỗi** (~95 cặp lời gọi khớp 100%, LMS không gọi API staff). Không phải vấn đề.

## 2. Bối cảnh nghiệp vụ (operator cung cấp, 2026-07-02)

- Dự án **chuẩn bị vào thực tế**; lớp mới hoàn toàn; **prod không có bài nộp thật cần giữ** → được phép làm sạch dữ liệu bài tập cũ.
- Bài tập = tài sản **chương trình học**, upload **dần** theo bài (B1 có trước, B2 upload trước khi hệ thống mở); hệ thống **tự mở sau khi buổi học dạy bài đó kết thúc** theo giờ đã sinh khi tạo lớp. Không có "phát bài" thủ công.
- Doanh nghiệp nhỏ: ERP phục vụ `sale`, `giao_vien`, 2 giám đốc. Không ai giữ `hr`/`ke_toan`. Multi-role có thật (`roles: Role[]` + `primaryRole` hiển thị, check quyền = any-match, `permissions.ts:347`).

## 3. Quyết định đã chốt (operator, 3 vòng AskUserQuestion)

| # | Quyết định | Chọn |
|---|---|---|
| D1 | Mô hình bài tập | **A — Exercise gắn CurriculumUnit (global theo bài của khóa)**, mỗi lớp tự mở khi buổi mang unit đó kết thúc (kiểm tra lúc truy vấn, không cron). Loại B (per-lớp, trùng lặp upload) và C (template+instance, YAGNI). |
| D2 | Quyền tài liệu học tập | **Chỉ 2 giám đốc** (`giam_doc_dao_tao`, `giam_doc_kinh_doanh`) được tạo/sửa bài tập khung. Giáo viên KHÔNG — vì ảnh hưởng toàn hệ khóa học. (Thu hẹp `exercise.create/publish` hiện đang có `giao_vien`.) |
| D3 | HR/payroll ownership | **Chia theo mảng**: GĐ đào tạo quản nhân sự-lương mảng giáo viên; GĐ kinh doanh quản mảng sale/vận hành. Quyền module chuyển `['hr','ke_toan']` → 2 giám đốc + scoping theo domain nhân sự đích ở handler. Đảo một phần Phương án C → cần decision record mới. Giữ nguyên tách-quyền KPI confirm≠approve. |
| D4 | Dữ liệu bài tập prod | **Làm sạch được** — archive bài/bài nộp demo cũ, mô hình mới sạch từ đầu. |
| D5 | GradingThreshold | **Drop model** (tư vấn được chấp nhận): trẻ 3-11 tuổi đã có 3 kênh phản hồi (điểm, nhận xét định tính, sao); giữ hàm thuần `gradeFromPercent` + test trong domain-grading. |
| D6 | Phạm vi | **Gộp việc lớn + dọn nhỏ 1 đợt**: exercise auto-open + HR chia mảng + classBatch.update UI + bỏ cast as-any + xóa loginParent + drop GradingThreshold + chốt gate /showcase. |

## 4. Thiết kế hướng giải quyết (mức brainstorm)

### W1 — Bài tập theo khung + auto-open (lớn nhất)
- **Data**: `Exercise` tái cấu trúc thành tài sản khung: thêm `curriculumUnitId` (FK), bỏ ràng buộc lớp/cơ sở (global như `curriculum_unit`, tiền lệ decision 0021 — không RLS, mọi đường ghi gate quyền app-layer). `Submission` giữ nguyên per-student (đã có `facilityId`+`studentId`, unique `exerciseId+studentId`) — cô lập chuyển sang phía submission. Bài cũ: soft-archive.
- **Hiển thị LMS** (`exercise.listForPrincipal` viết lại): bài published của unit U hiện với học sinh S khi lớp của S có buổi mang `curriculumUnitId=U` đã **kết thúc** (`sessionDate`+`endTime` ≤ now, chuẩn TZ Asia/Saigon — cẩn thận ICT/UTC). Chưa upload = chưa có row; buổi overflow (unit null) = không bài.
- **ERP UI**: màn upload bài theo unit trong khu curriculum của GĐ (danh sách 60 unit/khóa → đính PDF/mô tả/sao/hạn); quyền `['giam_doc_dao_tao','giam_doc_kinh_doanh']`; audit log đầy đủ (tài sản dùng chung). 2 nút chết ở `schedule-detail.tsx` → thay bằng chỉ báo read-only "Bài tập buổi này (unit X): đã có/chưa upload · sẽ tự mở sau buổi".
- Luồng chấm bài/sao giữ nguyên.

### W2 — HR chia mảng cho 2 GĐ
- `permissions.ts` payroll/compensation: `['hr','ke_toan']` → `['giam_doc_kinh_doanh','giam_doc_dao_tao']`; handler scoping: nhân sự đích có role `giao_vien` → gd_dt, còn lại → gd_kd (super_admin bypass; cân nhắc tái dùng `kpi-authz`). KPI confirm/approve giữ nguyên.
- UI: nối `profileUpsert`/`rateCreate` form vào HR panel hiện có; sửa nav gate `nav-permissions.ts:92` (đang trỏ `payroll.payslipList` — procedure không UI nào gọi) → `payroll.roster`.
- Decision record mới (đảo một phần PA-C) + cập nhật permission-snapshot + parity test.

### W3 — Dọn nhỏ
- Nối `classBatch.update` vào form sửa lớp (`class-workspace.tsx`) — backend+quyền+test có sẵn.
- Thay cast `as any`/`as unknown as` bằng typed client theo `AppRouter` ở 5 panel.
- Xóa `lmsAuth.loginParent`; drop `GradingThreshold` (migration + gỡ seed); gate `/showcase` (DEV-only hoặc env flag).
- Các procedure backend-ready còn lại (badge admin, shift withdraw, room update…) KHÔNG làm đợt này → ghi `DEBT.md`.

## 5. Rủi ro & lưu ý
- **Lane: high-risk** (FEATURE_INTAKE hard gates: authorization + data model + existing behavior). Cần story folder + decision records + validation đủ 3 lớp bằng chứng.
- Restructure Exercise = migration prod → dựa trên D4 (không dữ liệu thật) nhưng vẫn phải có rollback note; chuỗi migration phải 0-drift (bài học work-shift 2026-07-01).
- TZ: so sánh "buổi đã kết thúc" phải chuẩn ICT — session lưu date + HH:mm string; test biên giờ.
- Thu hẹp quyền `giao_vien` (exercise.create/publish) = đổi hành vi hiện hữu — E2E teacher-nav và parity snapshot phải cập nhật đồng bộ.
- Bỏ cast `as any` có thể lộ lệch kiểu tiềm ẩn ở 5 panel — sửa tới đâu chạy typecheck tới đó.

## 6. Success criteria
1. GĐ upload bài B2 cho UCREA-L1 → mọi lớp học UCREA-L1 thấy B2 tự mở đúng sau buổi dạy B2 của lớp mình; trước đó HS không thấy.
2. Giáo viên không còn quyền tạo/publish bài tập; 2 nút chết biến mất, thay bằng chỉ báo trạng thái bài của buổi.
3. GĐ đào tạo tạo được hồ sơ+mức lương cho GV từ UI; GĐ kinh doanh cho sale; không ai đụng chéo mảng (test chặn).
4. `pnpm typecheck` sạch không còn `as any` quanh tRPC client; parity + int + e2e xanh; migration chain 0-drift trên prod-mirror.

## Unresolved
- Không còn — operator đã chốt D1-D6. Chi tiết cấu trúc bảng/tên cột/thứ tự phase để /ck:plan quyết.
