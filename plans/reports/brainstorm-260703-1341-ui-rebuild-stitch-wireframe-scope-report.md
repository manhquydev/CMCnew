# Brainstorm: UI rebuild via /stitch — scope + sequencing (Phase D unblock)

**Ngày**: 2026-07-03
**Kích hoạt bởi**: user báo UX cụ thể — form tạo mới hiện ngay đầu trang danh sách (thay vì sau điều hướng/nút), thấy "không khoa học, không cho nghiệp vụ tốt". Yêu cầu rebuild UI có cấu trúc thống nhất (vd: mọi detail page đều có log) qua `/stitch` wireframe.

## Bối cảnh — không phải initiative mới

Đây chính là **Phase D** của `plans/260629-2127-odoo-parity-ux-framework/plan.md` (status: proposed), vốn bị hoãn cho tới khi Phase B+C (persona QA + UX audit) xong. B+C **vừa hoàn thành cùng ngày** (`plans/260703-1013-persona-qa-ux-audit/`) → Phase D giờ unblock.

Framework gốc đã định nghĩa đúng thứ user muốn — "cấu trúc UI giống nhau" cho mọi entity:
- `<ActivityLog>` — component log/chatter dùng chung (đã build, mới wire 5/17+ entity: student, receipt, opportunity, after_sale_case, class_batch)
- `<FilterBar>` / `<ViewSwitcher>` / `view-defaults.ts` — chuẩn hoá list-page (chưa build, F2)
- `<FacilityPicker>` — kill 8x facility-selector trùng lặp (chưa build, F1)

## Vấn đề cụ thể user nêu — đã verify bằng evidence

**Confirmed đúng.** Scan 17 panel `apps/admin/src/*.tsx` có cả form-field + table: **8 panel vi phạm** — form tạo/sửa nhiều field render thành `Card` cố định NGAY TRÊN bảng danh sách, không nằm trong Modal/Drawer:

| Panel | Form | Vị trí |
|---|---|---|
| `crm-panel.tsx` | "Tạo cơ hội mới" (6 field) | Trên pipeline kanban/table |
| `certificate-panel.tsx` | "Cấp chứng chỉ" (3 field) | Trên list chứng chỉ đã cấp |
| `compensation-panel.tsx` | "Tạo phiên bản chính sách lương" (3 field) | Trên bảng phiên bản đã ban hành |
| `email-outbox-panel.tsx` | "Gửi phiếu thu qua email" (2 field) | Trên bảng outbox |
| `facility-network-panel.tsx` | "Thêm IP WiFi công ty" (2 field) | Trên bảng network |
| `kpi-evaluation-panel.tsx` | "Tạo phiếu KPI kỳ này" (2 field) | Trên kanban KPI |
| `session-evidence-panel.tsx` | "Nhập tóm tắt/ghi chú buổi học" (2+ field) | Trên bảng comment |
| `shift-config-panel.tsx` | "Tạo nhóm ca / Tạo mẫu ca" (2 form, 3+6 field) | Trên bảng ca làm việc |

**Đối chứng pattern đúng đã có sẵn**: `students-panel.tsx`, `courses-panel.tsx` — form nằm trong `Modal` (`useDisclosure`), list-page chỉ có nút "Tạo mới" mở modal. Đây chính là convention cần áp cho 8 panel trên — không cần thiết kế mới, chỉ cần đúng pattern đã có.

**Cùng phát hiện đã nằm trong master findings hôm nay** (`plans/reports/ui-ux-designer-260703-persona-qa-master-findings-report.md`, finding #25): "CRM page layout puts data-entry form above pipeline overview (wrong priority for director)" — Bucket B (redesign decision). Scout của brainstorm này mở rộng finding #25 từ 1 panel → 8 panel, cùng root cause.

## Approaches đánh giá

### A. Fix 8 panel ngay (Modal), tách khỏi Phase D
- ➕ Giải quyết đúng bức xúc cụ thể, nhanh, rủi ro thấp (convention đã có, copy pattern từ students-panel)
- ➕ Không cần chờ /stitch/framework — có thể ship trong 1 plan `normal` lane
- ➖ Không tận dụng được cơ hội thiết kế lại toàn diện nếu sau này Phase D đổi mold list-page

### B. Gộp vào Phase D, sửa 1 lần cùng thiết kế mới
- ➕ Tránh sửa 2 lần
- ➖ Bức xúc cụ thể của user phải chờ hết cả chu trình wireframe→duyệt→build mới được fix — thời gian dài, không tương xứng độ phức tạp của fix

**Khuyến nghị: A** — mismatch độ phức tạp giữa vấn đề (Modal có sẵn, đổi 1 pattern) và giải pháp (chờ rebuild toàn diện) quá lớn. Modal pattern không phụ thuộc F1/F2/wireframe — sửa xong không bị redesign lại vì Phase D chỉ đổi *bên trong* list (FilterBar/ViewSwitcher), không đổi chuyện "form phải ở Modal".

### Sequencing Phase D: framework trước hay wireframe trước
**User đã chọn: framework trước.** Lý do đúng: F1 (ActivityLog/FacilityPicker/view-defaults, không đổi behavior) + F2 pilot (FilterBar/ViewSwitcher trên CRM) định hình các primitive UI sẽ dùng. Vẽ wireframe trước rồi mới build primitive → primitive đổi, wireframe sai theo, phải vẽ lại.

### Wireframe round 1: 2 khuôn mẫu (detail-page + list-page) thay vì cả module hay cả sweep
Lý do: 33 finding trong master report trải trên ~10+ trang khác nhau nhưng cùng vài root-cause pattern (thiếu log, form sai vị trí, thiếu default view). Vẽ khuôn mẫu trước → validate 1 lần → nhân rộng, thay vì vẽ 10-15 trang riêng rồi phát hiện khuôn sai phải sửa hàng loạt.

- **Detail-page mold**: KHÔNG copy layout `staff-profile.tsx` hiện tại — để `/stitch` generate concept mới (2-cột label|value + notebook tabs + chatter/log bên phải, tham khảo Odoo research đã có trong `brainstorm-260630-0012-odoo-density-mode-design-language-report.md`). Áp dụng cho student/opportunity/staff/facility detail.
- **List-page mold**: FilterBar + ViewSwitcher chuẩn, nút "Tạo mới" luôn mở Modal (không bao giờ form cố định trên list) — chính là fix cho 8 panel ở trên, generalize thành rule thiết kế.

## Giải pháp cuối (đề xuất, chờ xác nhận)

1. **Track 1 (song song, làm ngay)**: Plan nhỏ (`normal` lane) sửa 8 panel → form vào Modal, theo pattern students-panel/courses-panel. Không chờ /stitch.
2. **Track 2 (Phase D, tuần tự)**:
   - F1: build/wire `<ActivityLog>` cho các entity còn thiếu + `<FacilityPicker>` + `view-defaults.ts` (không đổi UI hiện tại — behavior-neutral)
   - F2 pilot: `<FilterBar>`/`<ViewSwitcher>` trên CRM (module pilot đã chọn sẵn trong plan gốc — có kanban+log rồi)
   - Sau F1+F2 xong: dùng `/stitch` vẽ 2 khuôn mẫu (detail-page mới, list-page chuẩn) → user duyệt
   - Sau duyệt: nhân rộng khuôn mẫu ra các module theo thứ tự ưu tiên trong Bucket B (checkin discoverability, profile page, date-format standard, parent-meeting surfacing...)
3. Cả 2 track dùng Bucket A/B của master findings report làm nguồn input có sẵn — không cần audit lại từ đầu.

## Rủi ro

- Track 1 và Track 2 chạm cùng file (`crm-panel.tsx` sẽ vừa được sửa Modal ở Track 1, vừa là pilot F2 sau đó) → Track 2's F2 phải build trên bản đã sửa Modal của Track 1, không phải bản gốc. Sequencing: Track 1 xong trước khi F2 CRM pilot bắt đầu, hoặc rõ ràng file ownership nếu chạy song song.
- `/stitch` cần `STITCH_API_KEY` — đã cấu hình trong `.env`, xác nhận hoạt động trước khi bắt đầu round wireframe.
- Đang ở nhánh `main` — theo AGENTS.md, code/commit không được chạy thẳng trên main. Report này (docs-only) ổn ở main, nhưng khi bắt đầu implement (cả Track 1 và Track 2) phải chuyển `develop` hoặc nhánh con.

## Next steps

- Xác nhận giải pháp cuối (mục "Giải pháp cuối" ở trên) — đặc biệt: đồng ý Track 1 tách riêng, xác nhận thứ tự F1→F2→wireframe, xác nhận phạm vi wireframe round 1 = 2 khuôn mẫu.
- Sau xác nhận: `/ck:plan` cho Track 1 (fix 8 panel, normal lane) và `/ck:plan --tdd` hoặc default cho Track 2 F1 (high-risk lane theo plan gốc, vì đổi framework layer).

## Unresolved Questions

1. Track 1 và F2-CRM-pilot ai làm trước — chạy tuần tự (Track 1 xong hẳn mới bắt đầu F2) hay có thể song song với rõ file ownership?
2. Thứ tự ưu tiên module sau khi 2 khuôn mẫu được duyệt — theo Bucket B nào trước (checkin discoverability #12, profile page #19, date-format #22, hay theo business priority khác)?
3. `/stitch` export ra Tailwind/HTML — cần map ngược sang Mantine v7 components hiện tại của dự án; có cần thêm bước "stitch-to-mantine adapter" trong Phase D không, hay để mỗi module tự chuyển tay khi implement?
