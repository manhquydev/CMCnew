---
title: "Chấm công: phiếu lý do ngoài WiFi + duyệt theo ngày"
description: "Phiếu chấm-ngoài-WiFi theo ngày: nhập lý do 1 lần/ngày, manager duyệt/từ chối 1 lần cả ngày. Đổi schema + luồng duyệt per-ticket."
status: completed
priority: P1
branch: "develop"
lane: high-risk
tags: [attendance, check-in-out, schema-migration, authorization]
blockedBy: []
blocks: [260704-2134-attendance-allday-punch-ux]
created: "2026-07-04T14:41:39.147Z"
createdBy: "ck:plan"
source: skill
---

# Chấm công: phiếu lý do ngoài WiFi + duyệt theo ngày

## Overview

Hiện chấm công ngoài mạng công ty tạo punch `manual` rời rạc, **không có lý do**, manager duyệt **từng punch**. Yêu cầu gốc: chấm ngoài WiFi phải **nhập lý do 1 lần đầu tiên/ngày**, lưu thành **phiếu**; manager **duyệt 1 lần** là hợp lệ cả ngày.

Plan này thêm model `ManualAttendanceTicket` (1 phiếu/người/ngày ICT), đổi `punch` để yêu cầu lý do lần đầu ngoài WiFi, và chuyển luồng duyệt từ per-punch → **per-ticket** (kèm hành vi **từ chối**). Giữ `monthlyReport` không phải sửa bằng cách stamp `approvedAt` lên punch khi duyệt phiếu.

Nguồn: `plans/reports/brainstorm-260704-2133-attendance-checkin-logic-fix-report.md`.

## Lane & Rủi ro

HIGH-RISK (FEATURE_INTAKE): đụng **data model + migration**, **authorization** (duyệt/từ chối), **public contract** (`punch` nhận `reason`, trả `requiresReason`; `pendingManual`/`approveManual` đổi hình dạng), **hành vi đã có** (có test chấm công). Cần decision record.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Schema & migration](./phase-01-schema-migration.md) | Completed |
| 2 | [Punch reason flow (server)](./phase-02-punch-reason-flow-server.md) | Completed |
| 3 | [Duyệt per-ticket + reject](./phase-03-duy-t-per-ticket-reject.md) | Completed |
| 4 | [UI dialog lý do & bảng duyệt phiếu](./phase-04-ui-dialog-l-do-b-ng-duy-t-phi-u.md) | Completed |

Thứ tự bắt buộc: 1 → 2 → 3 → 4 (schema nền trước).

## Core Decisions

1. **Phiếu theo NGÀY** — `@@unique([userId, dateKey])`, `dateKey` = ngày ICT (`ictDateKey`). Punch manual đầu ngày tạo phiếu; các lần sau cùng ngày gắn phiếu có sẵn, không hỏi lại lý do.
2. **RLS bắt buộc** (red-team C1) — bảng mới phải `ENABLE ROW LEVEL SECURITY` + policy isolation theo facility (khớp `time_punch`). KHÔNG framing "chỉ thêm bảng".
3. **Duyệt/từ chối per-ticket** — duyệt → `status=approved` + stamp `approvedAt/approvedById` lên **mọi punch manual** của user+ngày (`where` có `facilityId`); giữ `monthlyReport` cũ. Từ chối → `status=rejected`; nếu trước đó approved thì **un-stamp**. Guard tự-xử-lý cho cả approve/reject.
4. **Phiếu bị từ chối cho mở lại với LÝ DO MỚI** (user chốt) — punch tiếp + reason mới → phiếu về `pending`, notify resubmit, `logEvent` audit. Không cap (YAGNI, ghi lại).
5. **Punch sau khi phiếu đã duyệt** → auto-inherit approved (stamp luôn khi tạo).
6. **`punch` giữ backward-compat + return-shape an toàn** (red-team H2) — input `reason?` optional; `requiresReason`/`resubmit` phải return TRƯỚC/tách khỏi post-commit `.then` (nếu không sẽ bị `{...undefined}` nuốt cờ).
7. **`todayStatus` phản ánh duyệt** (red-team H1, user chốt) — trả `manualApproval: none|pending|approved|rejected`; FE: rejected KHÔNG hiện xanh "Hoàn thành".
8. **Reject là quyết định mới** — thêm permission `checkInOut.rejectManual` (mirror `approveManual`).

## Acceptance Criteria (toàn plan)

- [x] **RLS**: staff facility A không đọc được phiếu facility B (test RLS).
- [x] Ngoài WiFi lần đầu/ngày: `punch` không `reason` → `requiresReason`, không tạo punch. Có `reason` → tạo phiếu + punch. Cờ không bị nuốt sau post-commit (H2).
- [x] Ngoài WiFi lần 2+ (phiếu pending/approved): punch gắn phiếu sẵn, không cần reason.
- [x] Phiếu `rejected` + bấm lại + reason mới → phiếu về `pending`, notify resubmit, audit.
- [x] `@@unique([userId, dateKey])` chặn 2 phiếu/ngày (kể cả race — advisory lock).
- [x] Duyệt 1 lần → tất cả punch manual ngày đó có `approvedAt` (`where` có facilityId); `monthlyReport` đúng. Từ chối → không vào công; approved→rejected un-stamp.
- [x] `todayStatus.manualApproval` đúng; ngày bị từ chối không hiện xanh "Hoàn thành".
- [x] Không tự duyệt/từ chối phiếu của mình; `pendingManual` không N+1, giữ `take:50`.
- [x] `pnpm --filter @cmc/api typecheck` + `@cmc/admin typecheck` sạch; test chấm công xanh; migration + RLS chạy sạch trên dev.

## Open Questions (đã chốt ở gate validate)

- Ca đêm vắt qua nửa đêm ICT: **ngoài phạm vi đợt này** (user chốt). Phiếu khóa theo `dateKey` → ca đêm sẽ tách 2 ngày; xử lý sau nếu có nhân sự ca đêm.
- Phiếu bị từ chối: **cho mở lại với lý do mới** (user chốt) — xem Core Decision #4.
- Che IP: **bỏ cả ở API self-view** — thuộc Plan B phase-03.

## Dependencies

- **blocks** `260704-2134-attendance-allday-punch-ux` — cùng sửa `check-in-out.ts` + `checkin-panel.tsx`; làm A xong mới tới B để tránh xung đột file.
- Decision record: tạo `docs/decisions/NNNN-manual-attendance-daily-ticket.md` ở Phase 1 (đổi API shape + authorization + data ownership).
