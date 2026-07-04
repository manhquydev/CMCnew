# Brainstorm: ERP UI rebuild — decompose into 7 independent plans

**Ngày**: 2026-07-03
**Kích hoạt bởi**: user yêu cầu tách nhỏ hơn nữa khỏi "Phase A+B" gộp 1 plan — cần mỗi plan 1 mục tiêu rõ, để loop tuần tự tới khi xong.

## Quyết định: 7 plan độc lập, phụ thuộc tuyến tính rõ ràng

| # | Plan | Nội dung | Phụ thuộc | Research đã có |
|---|---|---|---|---|
| 1 | Token remap | `docs/design-system.md` + `tokens.css` → Zero Elevation | Không | `researcher-260703-1549-shadow-blast-radius-report.md` |
| 2 | Primitive: record-detail | `packages/ui/src/record-detail.tsx`, tách generic từ `staff-profile.tsx` | 1 | `researcher-260703-1549-record-detail-calendar-primitives-report.md` |
| 3 | Primitive: calendar-view | `packages/ui/src/calendar-view.tsx`, hand-built (không có sẵn trong @mantine/dates 7.15.2) | 1 | (cùng report trên) |
| 4 | Re-skin: CRM cockpit + pipeline | `biz-director-cockpit-panel.tsx`, `crm-panel.tsx` | 1,2 | — |
| 5 | Re-skin: Staff profile | `staff-profile.tsx` → dùng primitive Plan 2 | 1,2 | — |
| 6 | Re-skin: Meetings + Attendance report | `meetings-panel.tsx`, `attendance-report-panel.tsx` | 1,3 | — |
| 7 | Re-skin: List/Kanban templates | `data-table.tsx`, `view-switcher.tsx` | 1 | — |

## Research findings đã áp dụng

**Shadow blast radius (Plan 1)**: THẤP — 7 component Mantine có shadow default trong `theme.ts` (Card, Paper, Modal, Select, Menu, Notification, Drawer), tất cả định nghĩa inline trong 1 file, không cascade ra nhiều component. Chỉ 1/79 file TSX có inline shadow riêng (`showcase-view.tsx`). ~12 điểm sửa, ~2h effort. **Lưu ý quan trọng**: không zero toàn bộ shadow — dropdown/modal cần giữ depth-cue chức năng (không phải card nghỉ tĩnh), Zero Elevation áp cho decorative shadow, không áp cho functional.

**Record-detail/calendar (Plan 2,3)**: `staff-profile.tsx` đã có sẵn Tabs+Chatter pattern, cần tham số hoá: fieldLabels, formatValue, tabs[], sections[], entityType, permission callbacks. Calendar không có sẵn primitive trong Mantine — phải tự xây tuần/tháng dùng dayjs+Grid, đúng theo khuyến nghị gốc của `odoo-parity-ux-framework` plan (tránh dep nặng). 4 entity dùng calendar ngay khi xong: testAppointment, scheduleSession, parentMeeting, attendance.

## Next steps

Tạo 7 plan dir, Plan 1 detail đầy đủ (phase file) để bắt đầu ngay, Plan 2-7 khung sườn (frontmatter + scope + acceptance criteria) — điền chi tiết khi tới lượt vì phụ thuộc kết quả plan trước.

## Unresolved Questions

1. Dropdown/modal có cần giữ shadow hay chuyển hẳn sang border+backdrop intensification? (từ shadow-blast-radius report)
2. Field-render trong record-detail.tsx có cần custom render() ngoài type-enum không?
3. Thứ tự Plan 4-7 — theo mức độ finding nghiêm trọng hay theo module dùng nhiều nhất?
