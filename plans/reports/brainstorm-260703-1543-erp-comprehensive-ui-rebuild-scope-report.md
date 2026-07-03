# Brainstorm: Comprehensive ERP UI rebuild — scope + style direction

**Ngày**: 2026-07-03
**Kích hoạt bởi**: user duyệt sơ bộ 3 khuôn mẫu + 4 màn hình /stitch từ phiên trước ("khá ổn tôi khá ưng"), muốn triển khai toàn diện, cung cấp thêm 25 thư mục tài nguyên tự tải từ Stitch account (`D:\Downloads\stitch_cmcnew\stitch_cmcnew\`).

## Sự thật cần nói thẳng (brutal honesty)

1. **Không có style-direction nào "cắm vào chạy".** Cả 11 hướng trong 25 thư mục đều đúng màu brand `#0071E3` hệt design-system.md hiện có, nhưng dùng bộ token Material-Design-3 (`surface-container-lowest`, `on-primary`...) hoàn toàn khác cấu trúc `--cmc-*` đang dùng. Chọn hướng nào cũng phải remap tay, không copy-paste.
2. **`code.html` là Tailwind CDN thuần, không phải Mantine.** Stack hiện tại 100% Mantine v7. Không thể "áp dụng trực tiếp" — phải viết lại thành component Mantine, dùng ảnh/code làm tham khảo layout+màu, không phải convert máy móc.
3. **8/15 màn hình đã có component thật đang chạy production** (login×2 [loại], cockpit CRM, hồ sơ nhân viên, họp phụ huynh, báo cáo điểm danh, list-template) → đây là redesign-tại-chỗ, không phải tính năng mới.
4. **4-5 màn hình chưa có primitive nào tồn tại** (record-detail dùng chung, calendar 3 kiểu) → xây mới, khớp đúng gap F3 mà `odoo-parity-ux-framework` plan gốc đã note "chưa build".

## Scope decomposition (3 giai đoạn độc lập)

| Giai đoạn | Nội dung | File chính | Phụ thuộc |
|---|---|---|---|
| A — Token remap | `docs/design-system.md` + `packages/ui/src/tokens.css`, theo triết lý Zero Elevation | tokens.css, design-system.md | Không |
| B — 2 primitive mới | `record-detail.tsx` (generic entity record) + `calendar-view.tsx` (tuần mặc định/tháng phụ, theo quyết định review trước) | packages/ui/src/*.tsx (mới) | A |
| C — Re-skin theo module | 8 màn hình đã tồn tại, mỗi module 1 plan riêng, tuần tự | crm-panel, staff-profile, meetings-panel, attendance-report-panel... | A + B |

## Quyết định (user-confirmed)

- **Style direction: Vietnamese Enterprise Core 3** (Zero Elevation, khắt khe hơn hiện tại) — chọn thay vì Pro-Density Minimalist (khuyến nghị ban đầu, ít remap hơn); user ưu tiên nhất quán cao hơn tốc độ triển khai.
- **Trình tự: primitive trước, re-skin sau** — Giai đoạn B (record-detail + calendar-view) phải xong trước khi C bắt đầu bất kỳ module nào, tránh re-skin 2 lần khi primitive đổi.
- **Loại bỏ hoàn toàn 2 màn login** khỏi phạm vi (user quyết định giữa phiên, không sửa `login-gate.tsx`/`lms-login-gate.tsx`).
- **Không đổi stack** — vẫn Mantine v7, không chuyển sang Tailwind dù mockup gốc là Tailwind.

## 11 style-direction — ranking đầy đủ (tham khảo)

Đánh giá theo triết lý flat/no-shadow/pill-CTA khớp design-system.md hiện có, KHÔNG theo khả năng remap tên token (không cái nào remap thẳng được):

1. Pro-Density Minimalist — ít remap nhất (không chọn)
2. **Vietnamese Enterprise Core 3 — đã chọn**
3. Viet Enterprise Precision
4. Vietnamese Enterprise Intelligence
5. Efficient Clarity
6. Precision Enterprise 1
7. Precision Enterprise 2
8. Efficient Precision
9. Vietnamese Enterprise Core 1
10. Vietnamese Parent Portal (font Plus Jakarta Sans, không phải system stack — cần đổi font nếu chọn)
11. Vietnamese Enterprise Core 2 (cho phép shadow "khi cần" — lỏng nhất)
- Joyful Learning Nexus — loại (glassmorphism, lệch hẳn triết lý flat)

## 8 màn hình có component thật (Giai đoạn C, tuần tự sau A+B)

| Màn hình mockup | Component thật | 
|---|---|
| Cockpit điều hành CRM | `biz-director-cockpit-panel.tsx`, `crm-panel.tsx` |
| Hồ sơ nhân viên | `staff-profile.tsx` |
| Lịch họp phụ huynh | `meetings-panel.tsx` |
| Báo cáo xu hướng điểm danh | `attendance-report-panel.tsx` |
| List templates ×2 | `packages/ui/src/data-table.tsx` |
| Kanban template | `packages/ui/src/view-switcher.tsx` (chưa rõ đã có drag-drop thật hay chỉ toggle — cần verify khi vào Giai đoạn C) |

## Rủi ro

- Zero Elevation (lựa chọn của user) khắt khe hơn design-system.md hiện có → nhiều component cũ (Card có border nhẹ, Modal có shadow-xl) sẽ cần audit lại toàn bộ, không chỉ 2 primitive mới.
- Giai đoạn C có 8 module × N finding cũ (Bucket A đã fix trong action-plan trước) — cần đảm bảo Giai đoạn C không revert các fix UX đã có (form-in-Modal, ActivityLog, FilterBar...).
- FacilityPicker DRY refactor (từ phiên trước) vẫn chưa commit trên nhánh `feat/phase-d-facility-picker-and-stitch-wireframes` — cần commit trước khi bắt đầu Giai đoạn A để tránh conflict.

## Next steps

`/ck:plan` cho Giai đoạn A+B (token remap + 2 primitive) — plan đầu tiên có thể bắt đầu ngay. Giai đoạn C tách plan riêng theo từng module, sau khi A+B xong.

## Unresolved Questions

1. Zero Elevation có áp dụng ngược cho các component ĐÃ SHIP (Card/Modal hiện dùng border+shadow-sm/xl theo design-system.md cũ) hay chỉ áp dụng cho phần mới xây? Ảnh hưởng phạm vi Giai đoạn A.
2. `view-switcher.tsx` có drag-drop kanban thật chưa hay chỉ list/kanban toggle — cần verify trước khi đưa vào Giai đoạn C's kanban re-skin.
3. Thứ tự ưu tiên 8 module trong Giai đoạn C — theo mức độ finding nghiêm trọng hay theo module hay dùng nhiều nhất?
