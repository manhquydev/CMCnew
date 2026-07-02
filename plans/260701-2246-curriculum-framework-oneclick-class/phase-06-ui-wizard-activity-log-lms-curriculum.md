---
phase: 6
title: "UI Wizard Activity-Log & LMS Curriculum"
status: done
priority: P1
dependencies: [2, 3, 4, 5]
effort: "L"
---

# Phase 6: UI Wizard, Activity-Log & LMS Curriculum

## Overview
Lớp UI: wizard 1-click tạo lớp (khung khóa cứng + nhiều thứ/tuần), gắn timeline vào màn chi tiết
lớp, nút sửa/xóa khung, và **màn LMS session-list mới cho HS** hiển thị curriculum theo buổi
(quyết định user — không chỉ trên thẻ evidence).

## Requirements
- Functional: modal tạo lớp — chọn program → level → course; preview khung khóa cứng (số unit/`totalSessions`, list unit read-only); nhập tên + ngày KG + **nhiều thứ + giờ** + GV + phòng + sĩ số → 1 nút; gọi `classBatch.create({ slots })`.
- Functional: màn chi tiết lớp — **wrapper fetch** `audit.timeline({entityType:'class_batch', entityId})` → map `ActivityEntry[]` → `<ActivityLog entries={...} fieldLabels eventLabels />` (red-team #3 — component nhận `entries`, KHÔNG entityType/entityId; xem `activity-log.tsx:21-32`). Bảng slot thêm nút Sửa (form editSlot + tùy chọn "áp dụng buổi tương lai") + Xóa.
- Functional: **LMS session-list mới** cho HS/PH — API + view: liệt kê buổi của lớp HS đang học + nội dung curriculum (theme/content/thinkingGoal/assessment) theo `ClassSession.curriculumUnitId`, kể cả buổi chưa có evidence.
- Non-functional: convention Mantine + `@cmc/ui`; i18n VI; ẩn nút theo permission (`can(...)`).

## Architecture
- **Actor name (red-team #3b):** `audit.timeline` trả `actorId` (chưa resolve — `audit.ts:28-43`, `getTimeline` không có `actorName`). → thêm endpoint resolved (mô phỏng `staffTimeline` `audit.ts:136`) HOẶC mở rộng `audit.timeline` join `AppUser` trả `actorName`; UI map vào `ActivityEntry.actorName` (nếu không → hiện "Hệ thống" mọi dòng — `activity-log.tsx:18,91`).
- `class-workspace.tsx`: refactor modal create dùng `course.list` (đã mở rộng `levelCode`/count ở Phase 2) + `curriculum.listByCourse`; state `slots: Slot[]` (thêm/bớt hàng thứ+giờ); update call site `classBatch.create` sang `{ slots }`.
- **LMS mới:** API `lms/session.list` (hoặc mở rộng router lms) trả buổi của lớp HS (RLS student/parent context) join `curriculumUnit` (bỏ unit `null`-safe); view mới trong `apps/lms/src/` (tab "Lịch học/Nội dung") — hiện KHÔNG có (chỉ `SessionEvidenceTab` published-only, `student-view.tsx:911`, `session-evidence.ts:252-286`).

## Related Code Files
- Modify: `apps/admin/src/class-workspace.tsx` (wizard multi-slot + curriculum preview + activity-log wrapper + slot edit/remove)
- Reuse: `packages/ui/src/activity-log.tsx` (truyền `entries`)
- Modify: `apps/api/src/routers/audit.ts` (resolved timeline actorName) HOẶC router mới nhỏ
- Create: LMS session-list API (trong router lms/schedule) + view `apps/lms/src/*` (tab nội dung buổi)
- Modify (nếu tách): `apps/lms/src/student-view.tsx` (thêm tab)

## Tests First (TDD-lite)
- API integration (phủ chắc ở tầng dữ liệu):
  - `audit` resolved timeline: buổi tạo lớp → entry có `actorName` đúng (không "Hệ thống").
  - LMS session.list dưới RLS student → chỉ buổi lớp HS học; join `curriculumUnit` trả theme/content; buổi `curriculumUnitId=null` → field null-safe, không vỡ.
- UI e2e (nếu `apps/e2e` sẵn harness): tạo lớp 2 thứ → lớp + 2 khung; timeline hiện "Tạo lớp" + tên actor.

## Implementation Steps
1. API: resolved timeline (actorName) + test; LMS session.list + test.
2. Refactor modal create (multi-slot + curriculum preview khóa cứng) + cập nhật call site.
3. Gắn ActivityLog wrapper + slot edit/remove actions vào màn chi tiết lớp.
4. LMS: tab nội dung buổi theo curriculum.
5. Permission-gating nút (`can(...)`).

## Success Criteria
- [ ] 1-click tạo lớp ≥2 thứ; curriculum read-only (không sửa).
- [ ] Timeline lớp hiển thị đúng **tên người** thao tác (không "Hệ thống").
- [ ] Nút sửa/xóa khung gọi đúng API + phản ánh log.
- [ ] LMS HS xem được nội dung buổi theo curriculum; buổi null-unit không vỡ.

## Risk Assessment
- LMS session-list là **surface mới** (không có sẵn) → effort thực > "L" ban đầu; đây là phần lớn nhất của Phase 6 (red-team #8).
- Đổi shape `classBatch.create` (Phase 4) → grep + cập nhật đúng call site `classBatch.create.mutate` (`class-workspace.tsx`).
- RLS LMS: đảm bảo student/parent chỉ thấy buổi lớp mình; join `curriculum_unit` (global) không lộ dữ liệu nhạy cảm (chỉ nội dung học).
