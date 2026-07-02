---
phase: 2
title: "Curriculum Read API & Permission"
status: done
priority: P1
dependencies: [1]
effort: "S"
---

# Phase 2: Curriculum Read API & Permission

## Overview
Endpoint tRPC đọc curriculum để UI 1-click preview khung (số unit, số buổi, danh sách unit theo
thứ tự). Vòng này **chỉ read** (R3) → `protectedProcedure` (mọi staff, như Course global). Chưa
thêm permission resource `curriculum` (YAGNI, hoãn cùng UI quản trị write).

## Requirements
- Functional: `curriculum.listByCourse({ courseId })` → units sắp theo `orderGlobal`, kèm `totalSessions = Σ sessions`, `unitCount`. (Genuinely mới — đọc units.)
- Functional: **mở rộng `course.list` hiện có** (red-team #12 — KHÔNG tạo `curriculum.courses` trùng): thêm `levelCode` + `_count.units` + aggregate `totalSessions`. Một endpoint list-courses duy nhất.
- Non-functional: read-only; không FK write; đọc được vì `curriculum_unit`/`course` global (RLS off + GRANT, xem Phase 1).

## Architecture
- Router mới `apps/api/src/routers/curriculum.ts` chỉ chứa `listByCourse`; mount vào `appRouter` tại **`apps/api/src/routers/index.ts:39`** (red-team #12 — `_app.ts` KHÔNG tồn tại; appRouter ở `index.ts`, vd `course: courseRouter` line 45).
- Dùng `withRls(rlsContextOf(ctx.session), …)`; shape gọn (tránh Prisma Json depth).
- `course.list` (`apps/api/src/routers/course.ts`) → thêm select `levelCode` + `_count.units`; sessions aggregate qua secondary `groupBy` nếu N+1.

## Related Code Files
- Create: `apps/api/src/routers/curriculum.ts` (chỉ `listByCourse`)
- Create: `apps/api/test/curriculum-read.int.test.ts`
- Modify: `apps/api/src/routers/index.ts` (mount `curriculum`)
- Modify: `apps/api/src/routers/course.ts` (`list` += levelCode/unitCount/totalSessions)
- KHÔNG sửa permission/fixtures vòng này (read-only).

## Tests First (TDD)
1. `curriculum-read.int.test.ts` (count kỳ vọng suy từ CSV như Phase 1, không hard-code):
   - `listByCourse` Course UCREA-L1 → đúng unitCount + totalSessions từ CSV; thứ tự `orderGlobal` tăng dần.
   - Bright I.G-J → REVIEW unit ở cuối.
   - `course.list` trả `levelCode` + `unitCount` + `totalSessions`.
   - Gọi bằng staff bất kỳ (giao_vien) → OK; unauthenticated → throw.
2. Đỏ trước, xanh sau.

## Implementation Steps
1. Viết test (đỏ).
2. Viết router `curriculum.ts` (`listByCourse`); mở rộng `course.list`.
3. Mount `curriculum` vào `index.ts`; chạy test xanh.

## Success Criteria
- [ ] Test read xanh (count suy từ CSV/order/authz; `course.list` có levelCode+counts).
- [ ] `curriculum` router mount tại `index.ts`, gọi được từ client tRPC.
- [ ] `permission-parity.test.ts` vẫn pass — **không đụng fixtures** (red-team #6/#12: `protectedProcedure` read KHÔNG cần entry snapshot/registry; `permission-parity.test.ts:26-49` chỉ so registry↔snapshot).

## Risk Assessment
- KHÔNG thêm entry `curriculum` vào snapshot (sẽ làm parity invariant #1 đỏ). Read-only không cần.
- Aggregate sessions N+1 → gom bằng `groupBy`/secondary query.
