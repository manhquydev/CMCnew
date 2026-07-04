---
phase: 1
title: "UX bấm cả ngày & debounce 5s"
status: completed
priority: P1
dependencies: []
---

# Phase 1: UX bấm cả ngày & debounce 5s

## Overview

Bỏ khóa `isCompleted` để nút chấm công hiện suốt ngày; mỗi lần bấm sau check-in cập nhật giờ ra = lần cuối. Đổi debounce server 30s→5s + UX ẩn nút 5s rồi hiện lại.

## Requirements

- Functional:
  - Chưa punch → nút "CHECK-IN". Có ≥1 punch → nút "CHECK-OUT / Cập nhật giờ về", hiện cả khi đã `completed`.
  - Mỗi lần bấm: hiện xác nhận giờ vừa ghi → disable/ẩn nút 5s → hiện lại.
  - Server debounce = 5s (đang 30s).
- Non-functional: giữ advisory lock chống race; `todayStatus` first/last không đổi.

## Architecture

- Server `check-in-out.ts`: `PUNCH_DEBOUNCE_MS = 30_000` → `5_000`.
- FE `checkin-panel.tsx`: bỏ nhánh ẩn nút khi `isCompleted`; nút render dựa `isCheckedIn` cho nhãn, không dựa `isCompleted` để ẩn. Thêm cooldown 5s (state + setTimeout) sau `punch()`.

## Related Code Files

- Modify: `apps/api/src/routers/check-in-out.ts` (`PUNCH_DEBOUNCE_MS`)
- Modify: `apps/admin/src/checkin-panel.tsx` (bỏ khóa completed, cooldown 5s, nhãn nút)
- Modify (E2E): `apps/e2e/tests/work-shift-attendance.spec.ts` (case bấm >2 lần)

## Implementation Steps

1. **Test-first**:
   - Server integration: 3 punch cách nhau >5s trong ngày → `todayStatus.checkOut` = punch cuối; punch cách <5s → CONFLICT.
   - E2E: sau check-out, nút vẫn hiện; bấm lại (sau cooldown) → giờ ra cập nhật.
   Chạy → đỏ.
2. Đổi debounce 30s→5s.
3. FE: bỏ điều kiện ẩn nút theo `isCompleted`; thêm state `cooldown` 5s sau mỗi punch; đổi nhãn.
4. `gitnexus_impact({target: "punch"})` xác nhận không caller nào khác phụ thuộc 30s.
5. `@cmc/api` + `@cmc/admin` typecheck; chạy test → xanh.

## Success Criteria

- [ ] Nút không biến mất sau check-out; bấm lại cập nhật giờ ra.
- [ ] Debounce = 5s; <5s → CONFLICT.
- [ ] Cooldown UX 5s hoạt động (nút ẩn/disable rồi hiện lại).
- [ ] `todayStatus` vẫn (đầu, cuối).

## Risk Assessment

- Cho bấm vô hạn → nhiều row. Debounce 5s + report first/last ⇒ không sai số liệu; dung lượng punch/ngày chấp nhận được.
- Nếu Plan A đã đổi `punch` (reason), phase này chỉ đụng hằng số debounce + FE — merge sau A, kiểm không đè logic reason.
