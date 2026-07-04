---
title: "Chấm công: nút bấm cả ngày (đầu+cuối) + reset ngày + che IP"
description: "Bỏ khóa completed để bấm cả ngày (lần đầu=vào, lần cuối=ra); debounce 30s→5s + UX ẩn-5s-hiện-lại; verify reset theo ngày ICT; che IP màn nhân viên."
status: completed
priority: P2
branch: "develop"
lane: normal
tags: [attendance, check-in-out, ux, privacy]
blockedBy: [260704-2133-attendance-manual-ticket-reason]
blocks: []
created: "2026-07-04T14:41:45.874Z"
createdBy: "ck:plan"
source: skill
---

# Chấm công: nút bấm cả ngày (đầu+cuối) + reset ngày + che IP

## Overview

Ba sửa lỗi UX/quyền riêng tư trên màn chấm công (gộp Plan C vào đây vì cùng file `checkin-panel.tsx`):

1. **Bấm cả ngày** (req#1): UI hiện khóa nút sau lần bấm thứ 2 (`isCompleted`) → không ghi được giờ về thật. Bỏ khóa; nút hiện suốt ngày, lần đầu = giờ vào, mọi lần sau = cập nhật giờ ra = lần cuối. Debounce server 30s→5s + UX ẩn nút 5s rồi hiện lại.
2. **Reset theo ngày** (req#3): xác nhận + test biên nửa đêm ICT; đảm bảo không dính punch/phiếu ngày cũ.
3. **Che IP** (req#4, ex-Plan C): bỏ cột IP ở bảng "Lịch sử 14 ngày" của nhân viên; giữ IP bảng manager.

Nguồn: `plans/reports/brainstorm-260704-2133-attendance-checkin-logic-fix-report.md`.

## Lane & Rủi ro

NORMAL. Không đụng schema. Server đổi 1 hằng số (debounce) + FE bỏ nhánh khóa + bỏ 1 cột. Rủi ro chính: bỏ khóa completed cho phép bấm nhiều → dựa debounce 5s + report vẫn lấy first/last nên không sai số liệu.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [UX bấm cả ngày & debounce 5s](./phase-01-ux-b-m-c-ng-y-debounce-5s.md) | Completed |
| 2 | [Reset theo ngày & test biên nửa đêm ICT](./phase-02-reset-theo-ng-y-test-bi-n-n-a-m-ict.md) | Completed |
| 3 | [Che IP màn nhân viên](./phase-03-che-ip-m-n-nh-n-vi-n.md) | Completed |

## Core Decisions

1. Nút không biến mất sau check-out. Nhãn: chưa punch → "CHECK-IN"; đã có ≥1 punch → "CHECK-OUT / Cập nhật giờ về".
2. Sau mỗi lần bấm: hiện xác nhận giờ vừa ghi → ẩn nút 5s → hiện lại. UX 5s khớp debounce server 5s.
3. `todayStatus` giữ logic first/last cho giờ vào/ra. (Cờ `manualApproval` do Plan A thêm — Plan B không đụng.)
4. IP bỏ khỏi bảng nhân viên **và** khỏi payload API `history` self-view (user chốt M2); manager/report giữ (audit).

## Acceptance Criteria (toàn plan)

- [x] Bấm ≥3 lần/ngày: nút luôn hiện (trừ 5s cooldown); `todayStatus` = (lần đầu, lần cuối).
- [x] Debounce server = 5s; bấm trong 5s → CONFLICT (giữ chống double-submit).
- [x] Sang ngày mới ICT: trạng thái reset (not_punched), không dính punch/phiếu ngày cũ; test biên 23:59→00:01 ICT.
- [x] Bảng "Lịch sử 14 ngày" (nhân viên) không còn cột IP; API `history` self-view không trả `ipAddress`; bảng/API manager vẫn có IP.
- [x] `@cmc/api` + `@cmc/admin` typecheck sạch; E2E `work-shift-attendance.spec.ts` xanh.

## Dependencies

- **blockedBy** `260704-2133-attendance-manual-ticket-reason` — Plan A sửa cùng `check-in-out.ts` + `checkin-panel.tsx` trước. Làm B sau khi A merge để tránh xung đột file.

## Open Questions

- Debounce 5s có đủ chống spam punch? Đánh giá ở Phase 1 (đề xuất: đủ, vì report chỉ lấy first/last; nếu lo, giữ 5s + rate-limit tầng route đã có).
