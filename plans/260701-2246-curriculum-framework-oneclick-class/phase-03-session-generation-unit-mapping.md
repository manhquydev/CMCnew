---
phase: 3
title: "Session Generation Unit Mapping"
status: done
priority: P1
dependencies: [1, 2]
effort: "M"
---

# Phase 3: Session Generation Unit Mapping

## Overview
Gán `curriculumUnitId` cho từng buổi curriculum của lớp. **Thiết kế lại (red-team #1): mỗi lần
generate, TÍNH LẠI mapping cho TOÀN BỘ buổi curriculum của lớp** (update cả buổi cũ, không chỉ
buổi mới) — để idempotent thật kể cả khi thêm slot vào thứ sớm hơn. Phải khóa hành vi hiện có
trước (idempotency chèn + detectConflicts) bằng characterization tests.

## Requirements
- Functional: sau khi insert buổi mới, **recompute**: lấy tất cả `ClassSession` của batch thuộc curriculum (loại `status='cancelled'` và `isMakeup=true`), sort `(sessionDate,startTime)`, zip với danh sách unit bung theo `order_global` (mỗi unit lặp `sessions` lần), **update `curriculumUnitId` cho cả buổi cũ lẫn mới**.
- Functional: dư buổi (số buổi > `Σ sessions`) → `curriculumUnitId=null`; thiếu → phần unit chưa phủ bỏ qua. 1 log tổng hợp ("map X buổi; Y buổi dư null; Z unit chưa phủ").
- Functional: Course không có unit (BLACK_HOLE) → bỏ recompute (giữ null).
- Non-functional: giữ nguyên chặn trùng phòng/GV (`detectConflicts`) + idempotent chèn hiện tại (`schedule.ts:170-181,216-228`).

## Architecture
- Pure helper `assignUnitsToSessions(unitsExpanded, orderedSessionIds) → Map<sessionId, unitId|null>` trong `@cmc/domain-academic` (co-location với `enumerateSessions`/`detectConflicts` — `src/schedule.ts`). Signature tối thiểu; KHÔNG khái quát cho caller giả định (red-team #6 — bỏ lý do "tái dùng").
- Router `generateSessions`: sau `createMany`, load **toàn bộ** buổi curriculum của batch (loại cancelled + isMakeup) ordered `(sessionDate,startTime)`; gọi helper; `updateMany`/loop update `curriculumUnitId`. Cùng tx.
- `isMakeup=true` hiện KHÔNG được set ở đâu (`schema.prisma:306` default; grep `isMakeup: true` = 0) → loại khỏi recompute là filter phòng hờ, KHÔNG viết test riêng cho makeup (red-team Scope #1). Nhưng **cancelled thì có thật** (cascade `class-batch.ts:195-198`) → PHẢI loại cancelled khỏi recompute.

## Related Code Files
- Modify: `packages/domain-academic/src/schedule.ts` (+`assignUnitsToSessions`) + `index.ts` export
- Modify: `apps/api/src/routers/schedule.ts` (`generateSessions`: recompute toàn batch + 1 log)
- Create: `packages/domain-academic/test/assign-units.test.ts`
- Modify: `apps/api/test/schedule-generate-*.int.test.ts` (characterization + recompute)

## Tests First (TDD) — 2 tầng
1. **Characterization (khóa hành vi cũ) — xanh trước khi sửa router:**
   - `generateSessions` 2 lần → lần 2 `created=0` (idempotent chèn).
   - Trùng phòng/GV trong cửa sổ → throw `CONFLICT`.
2. **Recompute mapping (đỏ → xanh):**
   - `assignUnitsToSessions`: 12 unit×4 + 48 buổi → buổi 1-4=unit#1,…, đúng `order_global`.
   - Dư: 50 buổi → 2 cuối null. Thiếu: 40 buổi → 10 unit đầu phủ; 1 log tổng hợp.
   - **Ordering hazard (red-team #1/#2):** tạo slot [T5] generate 4 tuần → recompute; THÊM slot [T2] (thứ sớm hơn) generate lại → **mọi buổi (cũ+mới) được gán lại** theo (date,startTime) xen kẽ đúng, KHÔNG lặp/lệch unit. (Case then chốt — bắt buộc.)
   - **Cancelled loại khỏi offset:** hủy 1 buổi giữa → recompute không tính buổi cancelled vào vị trí.

## Implementation Steps
1. Characterization tests → xanh (chưa sửa).
2. `assignUnitsToSessions` + unit test (đỏ → xanh).
3. Sửa `generateSessions`: nạp units theo course batch; sau createMany, load toàn bộ buổi curriculum (loại cancelled/makeup) ordered; update `curriculumUnitId` cả cũ+mới; 1 `logEvent` tổng hợp.
4. Full test schedule → xanh.

## Success Criteria
- [ ] Characterization pass (idempotency chèn + conflict giữ nguyên).
- [ ] Recompute đúng order; **thêm slot thứ sớm hơn re-run không lệch unit** (ordering hazard test xanh).
- [ ] Cancelled không chiếm vị trí unit; dư→null; 1 log tổng hợp.

## Risk Assessment
- Recompute update-all: chi phí O(số buổi) mỗi generate — chấp nhận (lớp ~48 buổi). Trong 1 tx.
- Phase 5 `editSlot(applyToFuture)` đổi giờ/thứ sẽ reorder → PHẢI gọi lại recompute này (Phase 5 tham chiếu). Tránh drift mapping.
- Không đụng buổi `isMakeup`/cancelled → giữ audit/điểm danh.
