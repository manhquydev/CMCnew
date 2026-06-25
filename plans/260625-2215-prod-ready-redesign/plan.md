# Plan — Prod-ready: Staff Notify + Payroll gaps + Full ERP UI Redesign

> Lập: 2026-06-25 22:15 · Nhánh: develop · Lane: **high-risk**
> Mục tiêu: unblock prod — lấp 3 lỗ hổng backend + redesign toàn bộ UI theo design-system.md đã chốt.

## Quyết định nghiệp vụ đã chốt (session này)

| # | Quyết định |
|---|---|
| N1 | Staff in-app notification: bell + SSE cho 4 sự kiện (hủy lớp, ghi danh mới, phiếu thu chờ duyệt, KPI chờ xét) |
| N2 | MAES Dashboard: bỏ v1 — dùng exec summary hiện tại |
| N3 | Portal nhân viên xem payslip + Bulk payment + Commission/overtime tự động feed variablePay |
| N4 | Redesign song song cả 3 app (admin/teaching/lms) theo design-system.md |

## Phases

| Phase | Mô tả | Files sở hữu | Status |
|---|---|---|---|
| B | **Backend gaps**: staff_notification schema+router+SSE, bulk payment, commission auto-feed | packages/db, apps/api/src/routers/ | ✅ done (typecheck pass; migration cần DB online) |
| D1 | **Admin UI redesign**: AppShell sidebar layout + áp design tokens (7 sections) | apps/admin/src/ | ✅ done (typecheck+build pass) |
| D2 | **Teaching UI redesign**: AppShell sidebar grouped nav (5 nhóm, 16 panel) + design tokens | apps/teaching/src/ | ✅ done (typecheck+build pass) |
| D3 | **LMS UI redesign**: shell layout + design tokens cho student/parent view | apps/lms/src/ | ✅ done (nested AppShell fixed; typecheck+build pass) |

## Verify kết quả (2026-06-25 23:18)

- **typecheck**: 14/14 xanh (toàn monorepo)
- **unit tests**: 129/129 pass
- **build**: 4/4 app xanh (chunk size warning = pre-existing, không phải issue mới)
- **Migration cần chạy sau khi DB online**: `pnpm --filter @cmc/db migrate:dev -- --name phase_staff_notify`

> B và D1/D2/D3 có thể chạy song song (không đụng file nhau).

## Backend scope (Phase B)

### S1 — Staff notification
- Schema mới: `StaffNotification` (id, recipientId, event, title, body, data, readAt, facilityId, createdAt)
- Enum `StaffNotifEvent`: `class_cancelled | enrollment_new | receipt_pending_approval | kpi_pending_review`
- RLS: staff-by-facility (staff thấy thông báo của facility mình)
- Router `staffNotif`: `list`, `unreadCount`, `markAllRead`, `markRead`
- SSE endpoint: `/api/events/staff` (giống notification.ts LMS — dùng lại SSEManager)
- Emit event từ: `class.cancel` → emit cho quan_ly cơ sở; `enrollment.create` → emit quan_ly/head_teacher; `receipt.create` → emit ke_toan; `kpiEvaluation.submit` → emit manager
- Harness: story `STAFF-NOTIFY`

### S2 — Bulk payment
- `payslipBulkPay(ids: string[])`: loop finalized payslips → mark paid, return { succeeded, failed }
- Auth: requireRole hr, ke_toan, super_admin
- Harness: story `PAY-BULK`

### S3 — Commission auto-feed
- Khi `payslipCompute(staffId, period)` chạy: nếu staff có role `sale`, tự gọi `commissionForSale(period)` → set `variablePay.commission` tự động
- Nếu đã finalized → skip (không overwrite)
- Harness: story `PAY-AUTO-COMM`

## UI Design System (áp cho D1/D2/D3)

Nguồn: `docs/design-system.md` — Apple-inspired Mantine v7.

**Layout bắt buộc:**
```
Topbar 56px sticky: Logo | Breadcrumb | Notifications bell | User avatar
Sidebar 240px: NavLink groups, active = brand-muted bg
Content: padding 32px, max-width 1280px
```

**Component conventions:**
- Button primary: `variant="filled" radius={9999}` (pill)
- Cards: `radius="lg" style={{ border: '1px solid var(--cmc-border)' }}`
- Table: `striped highlightOnHover`, headers uppercase 11px
- Status badge: always badge + icon pair
- Icons: `@tabler/icons-react`, size 18 sidebar / 16 in-table
- No gradient, no emoji, no custom hex (dùng `var(--cmc-*)`)

## Acceptance criteria

- [ ] Staff bell xuất hiện ở topbar ERP apps; unread count badge; click → list
- [ ] Bulk pay: ke_toan chọn nhiều payslip → mark paid 1 lần
- [ ] Commission auto-feed: compute payslip sale → variablePay.commission tự điền
- [ ] Admin/Teaching/LMS: sidebar nav thật, topbar sticky, content layout đúng
- [ ] Toàn monorepo: `pnpm lint` + `pnpm -r typecheck` + `pnpm -r build` xanh
- [ ] e2e smoke 9/9 tiếp tục xanh (không break login flow)

## Files reference

- Design: `docs/design-system.md`
- Schema: `packages/db/prisma/schema.prisma`
- API: `apps/api/src/routers/`, `apps/api/src/index.ts`
- Admin panels: `apps/admin/src/` (App.tsx + *-panel.tsx)
- Teaching panels: `apps/teaching/src/` (App.tsx + *-panel.tsx + grading.tsx)
- LMS: `apps/lms/src/` (App.tsx, student-view.tsx, parent-view.tsx)
- UI package: `packages/ui/src/`
