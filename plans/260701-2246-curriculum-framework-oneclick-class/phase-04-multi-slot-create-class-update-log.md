---
phase: 4
title: "Multi-Slot Create & Class Update Log"
status: done
priority: P1
dependencies: [1]
effort: "M"
---

# Phase 4: Multi-Slot Create & Class Update Log

## Overview
Mở rộng `classBatch.create` nhận **nhiều slot** (nhiều thứ/tuần) thay vì 1 `initialSlot`, và thêm
`classBatch.update` (tên/ngày KG/ngày kết thúc/sĩ số) với diff-log qua `diffChanges`.

## Requirements
- Functional: `create` nhận `slots: Slot[]` (0..n); mỗi slot validate `startTime<endTime`, guard facility (`assertSlotRefsInFacility`), log 1 dòng/slot.
- Functional: giữ tương thích `initialSlot` (nếu client cũ gửi) — normalize thành `slots`.
- Functional: `update` đổi `name/startDate/endDate/capacity`; log `type:'updated'` với `changes:[{field,old,new}]` (dùng `diffChanges`); không cho đổi `courseId` (khóa cứng khung).
- Non-functional: mọi mutation trong 1 tx + log cùng tx (pattern hiện có).

## Architecture
- `create` input: thay `initialSlot?` bằng `slots?: Slot[]`; refine từng slot; **validate không có 2 slot trùng `(dayOfWeek, startTime)`** (red-team #10 — createMany `skipDuplicates` sẽ âm thầm bỏ 1 slot vì `@@unique([classBatchId,sessionDate,startTime])` `schema.prisma:312`; `detectConflicts` không bắt vì chỉ so phòng/GV) → reject với thông báo rõ. Loop tạo slot + `assertSlotRefsInFacility` từng cái. Log: 1 `created` + 1 `updated` liệt kê slots.
- `update`: load before, update, `diffChanges(before, after, ['name','startDate','endDate','capacity'])` → `logEvent`. Guard permission mới `classBatch.update`.
- `courseId` **không** nằm trong input update (khóa cứng khung). Lưu ý `z.object` **strip** key lạ im lặng (không throw) — nên test assert *kết quả* (course không đổi), không assert "reject" (red-team #11).

## Related Code Files
- Modify: `apps/api/src/routers/class-batch.ts` (`create` multi-slot; thêm `update`)
- Modify: `packages/auth/src/permissions.ts` (`classBatch.update: ['giam_doc_dao_tao']`)
- Modify: `apps/api/test/fixtures/permission-snapshot.json` + `permission-parity.test.ts` (thêm entry update)
- Create: `apps/api/test/class-batch-create-multislot.int.test.ts`
- Create: `apps/api/test/class-batch-update-log.int.test.ts`

## Tests First (TDD)
1. `create-multislot`: tạo lớp 2 slot (T2 + T5) → 2 `scheduleSlot`; timeline `created` + dòng liệt kê 2 khung; guard facility chặn room/teacher lạ cơ sở; **2 slot trùng (T2,18:00) → reject** (red-team #10).
2. `update-log`: đổi `name` + `capacity` → `recordEvent type=updated` với `changes` đúng 2 field old→new; **gửi kèm `courseId` → course KHÔNG đổi** (assert kết quả, không assert throw — red-team #11).
3. **Authz-deny (red-team #7):** role `giao_vien`/`sale` gọi `update` → `FORBIDDEN`.
4. Đỏ trước, xanh sau.

## Implementation Steps
1. Viết test (đỏ).
2. Sửa `create` → `slots[]`; normalize `initialSlot`.
3. Thêm `update` + `diffChanges` log; thêm permission entry + cập nhật snapshot/parity test.
4. Xanh.

## Success Criteria
- [ ] Create nhiều slot tạo đúng số khung + log; guard facility giữ nguyên; slot trùng (day,startTime) bị reject.
- [ ] Update ghi diff-log đúng field; course không đổi kể cả khi client gửi courseId.
- [ ] Test authz-deny xanh; `permission-parity.test.ts` pass với entry `classBatch.update`.

## Risk Assessment
- Đổi shape input `create` (public) → UI Phase 6 phải cập nhật đồng bộ; giữ `initialSlot` normalize để không vỡ ngay.
- Quên cập nhật permission snapshot → parity test đỏ (đã đưa vào steps).
