---
phase: 5
title: "Slot Edit-Remove & Cascade"
status: done
priority: P1
dependencies: [3, 4]
effort: "M"
---

# Phase 5: Slot Edit-Remove & Cascade

## Overview
`schedule.editSlot` (đổi thứ/giờ/phòng/GV) + `schedule.removeSlot` (soft-archive), ghi timeline.
R1: editSlot đổi template + **tùy chọn** áp dụng cho buổi tương lai (chưa qua/chưa hủy), có kiểm
tra trùng. Phụ thuộc Phase 3 (recompute curriculum sau khi đổi giờ/thứ).

## Requirements
- Functional: `editSlot({ slotId, dayOfWeek?, startTime?, endTime?, roomId?, teacherId?, applyToFuture? })`:
  - Load slot **qua `withRls`** (slot mang `classBatchId`); validate `startTime<endTime`; guard facility.
  - Log `type:'updated'` body old→new (thứ/giờ/GV/phòng).
  - `applyToFuture=true`: update buổi **scoped `classBatchId = slot.classBatchId`** (red-team #5 — KHÔNG chỉ facility), chưa hủy & `sessionDate>=today`, khớp `(dayOfWeek cũ + startTime cũ)` **dùng `getUTCDay`** (red-team #9 — khớp `enumerate` `domain schedule.ts:36`, tránh bẫy UTC+7).
  - **Trước update: check trùng CẢ (a) phòng/GV (`detectConflicts`) VÀ (b) unique key batch `@@unique([classBatchId,sessionDate,startTime])`** (red-team #6 — đổi startTime có thể đụng P2002); loại chính các buổi đang update khỏi tập so sánh (tránh self-conflict). Trùng → `CONFLICT`, rollback.
  - Nếu đổi `startTime`/`dayOfWeek` (reorder) → **gọi lại recompute curriculum của Phase 3** cho batch (red-team #8 — tránh drift mapping unit).
- Functional: `removeSlot({ slotId })`: set `archivedAt`; KHÔNG xóa buổi đã sinh; log rõ.
- Non-functional: 1 tx; conflict → throw + rollback.
- **Authz:** `requirePermission('schedule','editSlot')` / `('schedule','removeSlot')` — verify bằng test deny (red-team #7).

## Architecture
- `editSlot`: load slot(+batch facility) qua RLS; diff human-readable (map DOW→tên thứ). Nhánh `applyToFuture`: match buổi tương lai theo (classBatchId + dayOfWeek cũ qua getUTCDay + startTime cũ) → dual conflict check → update → recompute curriculum → log số buổi.
- `removeSlot`: archive template; log nêu buổi đã sinh không bị xóa.

## Related Code Files
- Modify: `apps/api/src/routers/schedule.ts` (`editSlot`, `removeSlot`)
- Modify: `packages/auth/src/permissions.ts` (`schedule.editSlot`, `schedule.removeSlot` → `['giam_doc_dao_tao']`)
- Modify: `apps/api/test/fixtures/permission-snapshot.json` + `permission-parity.test.ts`
- Create: `apps/api/test/schedule-edit-slot.int.test.ts`
- Create: `apps/api/test/schedule-remove-slot.int.test.ts`

## Tests First (TDD)
1. `edit-slot`:
   - Đổi `teacherId` (no applyToFuture) → template đổi; timeline "GV: A→B"; buổi tương lai KHÔNG đổi.
   - `applyToFuture=true` đổi giờ → buổi tương lai lớp NÀY cập nhật; buổi đã qua giữ nguyên; log số buổi; **curriculum re-map đúng sau reorder**.
   - **Cross-class (red-team #5):** 2 lớp cùng cơ sở T2-18:00; sửa lớp A applyToFuture → buổi lớp B KHÔNG đổi.
   - **Unique-key collision (red-team #6):** đổi startTime trùng slot khác cùng ngày → `CONFLICT` (không P2002 raw).
   - Trùng phòng/GV → `CONFLICT`. Guard facility: room/teacher lạ cơ sở → chặn.
   - **Authz (red-team #7):** role `giao_vien`/`sale` gọi → `FORBIDDEN`.
2. `remove-slot`: archive → `listSlots` không còn; buổi đã sinh vẫn tồn tại; timeline có dòng xóa; authz deny.
3. Đỏ trước, xanh sau.

## Implementation Steps
1. Viết test (đỏ), gồm cross-class + unique-key + authz-deny.
2. `editSlot`: update template + log; nhánh applyToFuture (match batch-scoped + dual conflict + update + recompute curriculum + log).
3. `removeSlot`: archive + log.
4. Permission entries + snapshot/parity.
5. Xanh.

## Success Criteria
- [ ] editSlot log old→new; applyToFuture chỉ đụng lớp đúng (classBatchId); recompute curriculum sau reorder.
- [ ] Đổi startTime trùng → CONFLICT (không 500); trùng phòng/GV → CONFLICT.
- [ ] removeSlot archive template, giữ buổi đã sinh.
- [ ] Test authz-deny xanh cho cả 2 mutation; parity pass.

## Risk Assessment
- Match buổi theo (dayOfWeek+startTime cũ) có thể mơ hồ nếu đã đổi giờ trước đó (không có `slotId` FK — `schema.prisma:293-314`) → chỉ áp dụng cho buổi tương lai khớp giá trị hiện tại của slot trước khi đổi; ghi rõ trong test.
- R2 (edit buổi lẻ) ngoài phạm vi (OUT scope).
