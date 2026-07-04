# Brainstorm — Công ca: Workflow/UX fixes + Mã nhân sự CMCx

- **Ngày**: 2026-07-04
- **Nhánh**: develop
- **Skill**: /ck:brainstorm (mode: markdown)
- **Trạng thái**: ĐÃ CHỐT THIẾT KẾ — chờ handoff sang /ck:plan (2 plan)
- **Quyết định người dùng**: mã `CMC0001` (đệm 4 số, chỉ nhân sự) · khoá phiếu khi còn Nháp/Chờ duyệt · chặn ngày quá khứ ở cả tạo + gửi duyệt · tách 2 plan A/B

---

## ⚠️ Blocker phải xử lý trước khi implement

Toàn bộ `apps/api` đang **bị xoá khỏi working tree** (chưa commit — mọi file hiện trạng `D` trong `git status`). Backend chỉ còn trong HEAD (`dc354e7`). **Không plan nào implement được cho tới khi khôi phục** (`git checkout -- apps/api` hoặc xác định đây là restructure có chủ đích). Ghi rõ ở phần rủi ro mỗi plan.

---

## 1. Vấn đề & chẩn đoán gốc rễ (đã xác minh trong code)

| # | Triệu chứng | Root cause (file:vị trí) | Hướng sửa |
|---|-------------|--------------------------|-----------|
| 1 | Tạo được nhiều phiếu Nháp cùng lúc | `shift-registration.ts` `create`: guard chỉ chặn `status:'submitted'`, thiếu `draft` | Chặn `status ∈ {draft, submitted}` |
| 2a | Phiếu Nháp không sửa được ngày | Không có mutation sửa `fromDate/toDate`; detail panel không có UI sửa ngày (ngày chỉ set ở `NewRegForm`) | Thêm mutation `updateDates` + UI sửa ngày khi draft |
| 2b | Không validate "chỉ ngày tương lai" | `create` cho `fromDate=hôm nay/quá khứ`; `NewRegForm` mặc định `fromDate=today` | Chặn `fromDate > today` ở cả `create` và `submit` |
| 3 | Tích ca (chọn-1) rồi không bỏ được | `shift-reg-detail-panel.tsx:273` dùng `<Radio>` — radio HTML không bắn `onChange` khi đã checked; `toggle()` đã hỗ trợ bỏ chọn nhưng không nhận được sự kiện | Đổi Radio → điều khiển click-toggle (onClick ô/nút) |
| 4 | Màn quản lý duyệt không thấy nhân sự nào | `list` không `include` chủ phiếu; list panel không có cột nhân sự | `include user`, thêm cột "Nhân sự" |
| 5 | Chưa có Mã nhân sự | `employeeCode` không tồn tại toàn repo | Plan B — cột + sequence + backfill + hiển thị |

Ghi chú luồng hiện tại (đúng): trạng thái `draft → submitted → approved`(+`cancelled` khi supersede); `updateEntry`/`submit`/`withdraw` đã chặn đúng chủ phiếu & trạng thái draft; approve có advisory-lock chống race + supersede phiếu approved trùng khoảng ngày. **Không đụng các bất biến này.**

---

## 2. Chia phạm vi → 2 PLAN

### PLAN A — Workflow & UX công ca (rủi ro: trung bình)

Đụng: `apps/api/src/routers/shift-registration.ts`, `apps/admin/src/shift-reg-detail-panel.tsx`, `apps/admin/src/shift-reg-list-panel.tsx` (+ test int).

**A1. Khoá "1 phiếu xuyên suốt"**
- `create`: đổi guard → chặn nếu tồn tại phiếu `status ∈ {draft, submitted}` của user (`archivedAt: null`). Thông báo: "Bạn đang có phiếu chưa hoàn tất (Nháp/Chờ duyệt) — mở phiếu đó để sửa thay vì tạo mới."
- Frontend list panel: ẩn/disable nút "Tạo phiếu" khi user còn phiếu chưa duyệt; hiện hint dẫn tới phiếu đang mở.
- `approved`/`cancelled` KHÔNG chặn (cho tạo phiếu chu kỳ mới). `reject` đưa phiếu về `draft` → vẫn tính là "chưa hoàn tất" (đúng ý: phải mở ra sửa & nộp lại).

**A2. Sửa ngày phiếu Nháp + validate ngày tương lai**
- Backend: mutation mới `updateDates(id, fromDate, toDate)` — chỉ chủ phiếu, chỉ `draft`; validate `fromDate ≤ toDate` và `fromDate > today`. Khi thu hẹp khoảng ngày, **xoá entries nằm ngoài khoảng mới** (tránh entry mồ côi) — audit-log thay đổi.
- Backend `create`: thêm validate `fromDate > today` (Asia/Saigon boundary).
- Backend `submit`: thêm chốt chặn `fromDate > today` (phòng phiếu nháp để lâu thành quá khứ) — báo lỗi rõ để user sửa ngày rồi nộp lại.
- Frontend detail panel: khi `draft`, cho sửa `Từ ngày/Đến ngày` (DateInput `minDate = ngày mai`); lưu qua `updateDates`; reload lưới theo range mới.
- Frontend `NewRegForm`: mặc định `fromDate = ngày mai`, chặn chọn hôm nay/quá khứ.

**A3. Bỏ chọn ca (UX toggle)**
- Đổi ô chọn-1-ca từ `<Radio onChange>` → phần tử click-toggle (VD `<Checkbox radio-style>` hoặc ô bấm) gọi thẳng `toggle(date, tmplId)` trên `onClick`, để click lần 2 bỏ chọn. Giữ nguyên `toggle()` (đã đúng) + guard `busy` + rollback.
- Giữ đồng nhất: chế độ nhiều-ca vẫn Checkbox (đang chạy đúng).

**A4. Hiện nhân sự trên màn quản lý/duyệt**
- Backend `list`: `include user { displayName, email }` (Plan B sẽ bổ sung `employeeCode`).
- Frontend list panel: thêm cột "Nhân sự" hiển thị `Họ tên · email` (khi Plan B xong: `CMC0001 · Họ tên · email`). Chỉ hiện với người có quyền xem nhiều phiếu (`visibleRegistrationWhere` đã lọc: HR/giám đốc/quản lý trực tiếp).

Acceptance A: (1) user có phiếu Nháp/Chờ duyệt → không tạo được phiếu mới; (2) sửa được ngày phiếu Nháp, không đặt được ngày ≤ hôm nay ở tạo/sửa/nộp; (3) click ca lần 2 bỏ chọn ở cả chế độ 1-ca và nhiều-ca; (4) manager thấy tên+email chủ phiếu.

### PLAN B — Mã nhân sự CMCx (rủi ro: cao — data model + migration + backfill)

**B1. Schema**: thêm `EmploymentProfile.employeeCode String? @unique` (chọn EmploymentProfile vì "chỉ nhân sự" = người có hồ sơ; sinh tại nơi HR tạo hồ sơ). Bảng đếm `employee_code_counter(id, last_seq)` 1 dòng — theo đúng pattern `shift_code_counter` (INSERT…ON CONFLICT…RETURNING) đã có sẵn trong repo.
**B2. Sinh mã**: hook tại `payroll.upsertEmploymentProfile` (payroll.ts:453) — nhánh tạo mới (chưa có code) → cấp `CMC` + `String(seq).padStart(4,'0')`. Mã không đổi khi update hồ sơ.
**B3. Backfill migration**: gán mã cho hồ sơ hiện có theo `createdAt ASC` → CMC0001, CMC0002…; set `last_seq = COUNT`. Idempotent (chỉ gán khi `employeeCode IS NULL`).
**B4. Hiển thị**: `shiftRegistration.list`/`get` include `user.employmentProfile.employeeCode`; list panel công ca hiện `CMC0001 · Họ tên · email`. (Tùy chọn mở rộng: danh sách nhân sự / màn duyệt khác — để phase riêng, không bắt buộc vòng này.)

Acceptance B: nhân sự mới được cấp mã tự tăng đệm 4 số; user cũ được backfill không trùng; màn công ca hiện mã.

Phụ thuộc: Plan A độc lập, ship trước với tên+email. Plan B bổ sung mã (cột A4 nâng cấp hiển thị). Không chặn nhau.

---

## 3. Rủi ro & lưu ý

- **Backend bị xoá working tree** — khôi phục trước (blocker chung).
- Plan B: migration + backfill = hard-gate data model → phải qua red-team + validate kỹ; chạy trên dev/prod-mirror trước.
- Timezone: mọi so sánh "ngày tương lai" theo Asia/Saigon, tránh lệch do UTC (backend đang dùng `new Date(fromDate)` — cần chuẩn hoá boundary khi thêm rule).
- `updateDates` thu hẹp range: phải dọn entries ngoài range trong cùng transaction + audit-log.
- Giữ nguyên: advisory-lock approve, supersede overlap, RLS `withRls`, `visibleRegistrationWhere`, permission registry.

## 4. Bước tiếp theo

1. `/ck:plan` cho **Plan A** (workflow/UX) → red-team → validate.
2. `/ck:plan` cho **Plan B** (mã nhân sự) → red-team → validate.
3. Chỉ dừng ở dựng plan (không implement) — theo yêu cầu.

## Câu hỏi còn mở

- Hiển thị mã nhân sự có cần lan sang các màn khác ngoài công ca (danh sách nhân sự, payroll, KPI…) trong đợt này không, hay để phase sau? (mặc định: chỉ công ca vòng này)
- Mã nhân sự có cần cho tài khoản nhân sự CHƯA có EmploymentProfile (chưa onboard HR) không? (thiết kế hiện tại: cấp khi tạo hồ sơ — người chưa onboard chưa có mã)
