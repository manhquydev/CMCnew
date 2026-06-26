---
title: "ERP Prod-Readiness: Admin Finance+CRM + Teaching Filter + LMS Polish"
description: "Port Finance+CRM sections to Admin, add class search/filter to Teaching, verify+polish LMS views"
status: pending
priority: P1
branch: "develop"
tags: ["ui", "erp", "prod-ready"]
blockedBy: []
blocks: []
created: "2026-06-25T18:44:35.467Z"
createdBy: "ck:plan"
source: skill
---

# ERP Prod-Readiness: Admin Finance+CRM + Teaching Filter + LMS Polish

## Overview

Session này bổ sung 3 vấn đề thực tế phát hiện qua browser review (2026-06-26):

1. **Admin thiếu Finance + CRM** — ke_toan/quan_ly phải dùng Teaching app để xem phiếu thu và pipeline CRM. Backend đã có `trpc.finance.*` + `trpc.crm.*`; chỉ cần thêm 2 section vào admin shell.
2. **Teaching class list 233 items, không filter** — UX tệ khi số lớp lớn; cần search text + status filter.
3. **LMS student/parent views chưa verify live** — 715+584 dòng code tồn tại nhưng chưa test trong browser với account thật.

Reuse code tối đa: `FinancePanel` + `CrmPanel` đã có trong Teaching → import vào Admin.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Admin Finance+CRM sections](./phase-01-admin-finance-crm-sections.md) | Pending |
| 2 | [Teaching class search+filter](./phase-02-teaching-class-search-filter.md) | Pending |
| 3 | [LMS student-parent verify+polish](./phase-03-lms-student-parent-verify-polish.md) | Pending |

## Key Decisions

- Phase 1 không viết lại panel — import trực tiếp từ teaching app (`../../teaching/src/*`) hoặc tách shared panel vào packages/ui nếu cần. Ưu tiên speed.
- Phase 2 chỉ thêm filter UI phía trên class list — không refactor workspace logic.
- Phase 3 tạo seed account cho student/parent để test live, không viết lại component.

## Acceptance Criteria

- [ ] Admin có nav item "Tài chính" → hiển thị receipt list + approve/send workflow
- [ ] Admin có nav item "CRM" → hiển thị pipeline + opportunity detail
- [ ] Teaching class list có search box + status filter chips, filter hoạt động client-side
- [ ] LMS: đăng nhập bằng account học sinh → thấy bài tập + điểm + sao
- [ ] LMS: đăng nhập bằng account phụ huynh → thấy học bạ + lịch họp
- [ ] `pnpm -r typecheck` + `pnpm -r build` pass
