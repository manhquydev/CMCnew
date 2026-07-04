---
phase: 2
title: "Reset theo ngày & test biên nửa đêm ICT"
status: completed
priority: P2
dependencies: [1]
---

# Phase 2: Reset theo ngày & test biên nửa đêm ICT

## Overview

Xác nhận trạng thái chấm công reset đúng khi sang ngày mới ICT; khóa bằng test biên nửa đêm. Chủ yếu là **kiểm chứng + test**, ít/không sửa code (logic ICT đã có).

## Requirements

- Functional: `todayStatus` sang ngày mới → `not_punched`; không dính punch/phiếu (Plan A) ngày cũ.
- Non-functional: biên UTC↔ICT (GMT+7) không lệch ngày.

## Architecture

- `ictDayRangeFor()` / `ictDateKey()` / `ictDateRange()` trong `attendance-penalty.ts` là nguồn ngày. Punch/phiếu đều khóa theo ICT.
- Nếu phát hiện lệch (vd `todayStatus` dùng `new Date(dateKey)` cho shiftEntry so với range ICT) → sửa nhỏ tại chỗ, có test chứng minh.

## Related Code Files

- Reference/verify: `apps/api/src/lib/attendance-penalty.ts`, `apps/api/src/routers/check-in-out.ts` (`todayStatus`, shiftEntry lookup)
- Create/Modify (test): unit test cho `attendance-penalty` biên ngày + integration `todayStatus` reset.

## Implementation Steps

1. **Test-first**:
   - Unit: `ictDateKey`/`ictDayRangeFor` tại 2026-xx-xx 16:59Z (=23:59 ICT) và 17:01Z (=00:01 ICT hôm sau) → dateKey khác nhau đúng.
   - Integration: punch lúc 23:59 ICT → ngày A; query `todayStatus` lúc 00:01 ICT hôm sau → `not_punched` (không thấy punch ngày A).
   - Nếu Plan A đã merge: phiếu ngày A không xuất hiện cho ngày B.
   Chạy → đỏ nếu có bug, xanh nếu logic đã đúng (test vẫn giữ làm regression).
2. Nếu test lộ bug biên → sửa tối thiểu (vd chuẩn hóa shiftEntry lookup theo `ictDateRange(dateKey)` thay vì `new Date(dateKey)`).
3. `@cmc/api` typecheck; chạy test → xanh.

## Success Criteria

- [ ] Test biên nửa đêm ICT xanh (dateKey đổi đúng chỗ).
- [ ] `todayStatus` reset sang ngày mới, không rò rỉ punch/phiếu ngày cũ.
- [ ] Nếu sửa code: có test chứng minh; không regress `monthlyReport`.

## Risk Assessment

- Ca đêm vắt qua nửa đêm ICT: **ngoài phạm vi** (giả định chốt ở validate). Ghi rõ giới hạn: nhân viên ca đêm 22:00–06:00 sẽ bị tách 2 ngày — cần user xác nhận chấp nhận.
- Máy chủ chạy UTC: mọi so sánh phải qua helper ICT, không dùng giờ local máy.
