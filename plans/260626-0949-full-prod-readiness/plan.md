---
title: "Full Prod Readiness: Bell + HR Panel + Design Sweep + Docker"
description: "Wire staff bell notification, redesign HR panel, fix Teaching logo+pagination, sweep design tokens, build Docker full stack — sẵn sàng cho prod deployment"
status: pending
priority: P1
branch: "develop"
tags: ["ui", "erp", "docker", "prod-ready", "bell-notification"]
blockedBy: []
blocks: []
created: "2026-06-26T09:49:00.000Z"
createdBy: "ck:plan"
source: skill
---

> **Status note (2026-07-02, ops-hardening P5):** NOT superseded by `260628-0147-prod-deployment`. The
> live `erp+hoc.cmcvn.edu.vn` environment is an interim/test deployment only — operator will clear and
> redeploy the real production environment after the 6-plan completeness pipeline
> (`plans/260702-1109-*`, `plans/260702-1007-*`, `plans/260702-1030-*`) ships. This plan's scope remains
> relevant work; re-check against actual shipped state before closing.

# Full Prod Readiness: Bell + HR Panel + Design Sweep + Docker

## Overview

Kế hoạch hoàn thiện toàn diện hệ thống ERP+LMS trước khi deploy prod.
Dựa trên live browser inspection 2026-06-26: 4 server đang chạy, backend 36 stories done,
nhưng có 6 gap cụ thể cần fix.

Phases 01–04 **song song** (không đụng file nhau). Phase 05–06 tuần tự sau khi 01–04 xanh.

## Quyết định nghiệp vụ đã chốt (2026-06-26)

| # | Quyết định |
|---|---|
| D1 | Teaching app giữ đủ sections (tất cả staff, role-gate hiện tại là đúng) |
| D2 | HR Panel UX: staff list table trước → click → drawer detail |
| D3 | Docker: full stack (api + 3 frontend + nginx) |
| D4 | Redesign depth: full prod — redesign panels + bell wiring + Docker + pagination |

## Phases

| Phase | Name | Parallel? | Status |
|-------|------|-----------|--------|
| 01 | [Bell Notification Wiring](./phase-01-bell-notification-wiring.md) | ✅ parallel | Pending |
| 02 | [HR Panel Redesign](./phase-02-hr-panel-redesign.md) | ✅ parallel | Pending |
| 03 | [Teaching Logo + Pagination + Filter](./phase-03-teaching-logo-pagination.md) | ✅ parallel | Pending |
| 04 | [Docker Full Stack](./phase-04-docker-full-stack.md) | ✅ parallel | Pending |
| 05 | [Design Tokens Content Sweep + LMS Verify](./phase-05-design-tokens-lms-verify.md) | ⛔ sau 01–04 | Pending |
| 06 | [Final Verify — typecheck + build + e2e](./phase-06-final-verify.md) | ⛔ sau 05 | Pending |

## Gaps từ live inspection

| Gap | File | Mô tả |
|-----|------|--------|
| A | apps/admin/src/shell.tsx | Bell `display:none`, chưa wire staffNotif router |
| B | apps/teaching/src/shell.tsx | Logo "C" box ≠ Admin "CMC" text; bell hiện nhưng không wire |
| C | apps/admin/src/payroll-panel.tsx | Chỉ có 1 Select dropdown, cần staff table + drawer |
| D | apps/teaching/src/App.tsx (Classes section) | 233 lớp load toàn bộ, cần pagination 20/page |
| E | Tất cả content panels | Design tokens chưa áp đều (badge icon+color, table TH uppercase) |
| F | docker/ | Chỉ có postgres+redis, chưa có Dockerfile cho apps |

## Acceptance Criteria Tổng

- [ ] Bell Admin + Teaching: unreadCount badge, click → Popover danh sách + markAllRead
- [ ] HR Panel: staff table (tên/role/cơ sở/bậc lương) → click → Drawer payslips+KPI+bulk-pay
- [ ] Teaching topbar: "CMC" text thay vì "C" box
- [ ] Teaching class list: pagination 20/page, filter status giữ
- [ ] docker compose -f docker/docker-compose.prod.yml up --build: tất cả service healthy
- [ ] pnpm typecheck + pnpm lint + pnpm build + pnpm test:e2e — tất cả xanh

## Files Reference

```
apps/admin/src/shell.tsx          — Phase 01
apps/teaching/src/shell.tsx       — Phase 01 + 03
apps/admin/src/payroll-panel.tsx  — Phase 02
apps/teaching/src/App.tsx         — Phase 03
packages/ui/src/                  — Phase 01 (useStaffNotif hook)
docker/                           — Phase 04
apps/*/src/ (tất cả panels)       — Phase 05
```

## Related Plans

- `plans/260625-2215-prod-ready-redesign/` — AppShell layout xong (✅ done)
- `plans/260625-1542-operational-flow-ui-hardening/` — Toast + validators xong (✅ done)
- `plans/260626-0133-erp-prod-readiness/` — Pending, scope bị supersede bởi plan này (teaching filter → Phase 03 này)
