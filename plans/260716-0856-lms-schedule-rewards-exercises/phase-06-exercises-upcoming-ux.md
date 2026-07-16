---
phase: 6
title: "Exercises Upcoming UX"
status: pending
priority: P2
dependencies: []
---

# Phase 6: Exercises Upcoming UX

## Overview
Sửa `/#exercises` (ClimbView): hiện ≤2 node "sắp tới" **khóa mờ** (payload chỉ `upcomingCount`, KHÔNG id/tên — PA A, tuân thủ 0038), auto-scroll tới node "current", empty-state thân thiện.

## ⚠️ Red-team corrections
- **F9 (Medium)**: trả **chỉ `upcomingCount: number`** (cap 2) — KHÔNG `{id, program}`. `id` thật không "opaque"; `/files/exercise/:ref` phục vụ mọi principal đã đăng nhập (`index.ts:155-186`) → id là handle rò rỉ tiềm ẩn. Count-only triệt tiêu về mặt cấu trúc.
- **F8 (High)**: `listForPrincipal` phủ CẢ lesson lẫn unit path (`exercise.ts:139-148`). Upcoming phải mirror cả hai (`upcomingLessonIdsFor` + `upcomingUnitIdsFor`), không chỉ lesson.
- **F4 (High)**: fetch upcoming trong CÙNG `Promise.all` (`climb-view.tsx:55-59`) — nếu tách, `didInitialScroll` khóa vị trí trước khi node upcoming pop vào → cuộn nhầm. Dùng `useLayoutEffect`, xử lý `currentId===null`.
- **F7 (High) / F12 (Medium)**: `NodeState` đã có `'upcoming'` (render `+reward sao`, `cloud-climb.tsx:6,125`). Node mới là state **riêng** (vd `'locked'`) render KHÔNG title/reward/aria-title/onClick — không tái dùng `'upcoming'`.
- **F5 (Medium)**: upcoming chỉ hiện khi buổi tương lai **đã được xếp lịch** (cần `ClassSession` row). Ghi rõ giả định; empty-state khi chưa xếp lịch.

## Requirements
- Functional: khi có bài published của lesson/unit HS đang `active` enroll mà buổi **chưa** `sessionHasEnded` (đã xếp lịch) → hiện ≤2 node khóa nhãn cố định "🔒 Bài tiếp theo — mở sau buổi học tới". Mở trang cuộn tới node current. Node khóa không mở/nộp.
- Non-functional: KHÔNG phá `listForPrincipal`; KHÔNG rò rỉ id/title/reward bài chưa mở (assert cả API lẫn client).

## Architecture
- **API**: `apps/api/src/lib/exercise-open.ts` thêm `upcomingLessonIdsFor` + `upcomingUnitIdsFor` (buổi chưa kết thúc, đã xếp lịch, enroll active). `exercise.ts` thêm `upcomingForPrincipal` → đếm bài published thuộc (lessonIds ∪ unitIds theo đúng OR shape của `listForPrincipal` L147-148) NHƯNG loại các bài đã nằm trong opened set → trả `{ upcomingCount: min(count, 2) }`. KHÔNG select title/id ra ngoài.
- **Client** (`climb-view.tsx`): thêm `trpc.exercise.upcomingForPrincipal.query()` vào `Promise.all` L55-59; state `upcomingCount`. Render `upcomingCount` node `locked` phía trên đỉnh; `onClick` no-op. Đổi scroll: `useLayoutEffect` (một lần, cờ `didInitialScroll`) cuộn tới phần tử node `current` (ref theo `currentId`); `currentId===null` → cuộn tới done mới nhất hoặc top hợp lý. Empty-state: `visible.length===0 && upcomingCount===0` → thông báo thân thiện; `upcomingCount>0` → node khóa + dòng động viên.
- **BeanNode** (`cloud-climb.tsx`): thêm state `'locked'` — nhãn cố định, không title/reward/aria-title/onClick.

## Related Code Files
- Modify: `apps/api/src/lib/exercise-open.ts` — `upcomingLessonIdsFor`, `upcomingUnitIdsFor`.
- Modify: `apps/api/src/routers/exercise.ts` — `upcomingForPrincipal` (count-only).
- Modify: `apps/lms/src/climb-view.tsx` — fetch cùng Promise.all, render locked, scroll-to-current.
- Modify: `apps/lms/src/climb/cloud-climb.tsx` — state `'locked'`.
- Create test: `apps/api/test/exercise-upcoming-for-principal.int.test.ts`.

## Implementation Steps (TDD)
1. **Test trước** (`exercise-upcoming-for-principal.int.test.ts`):
   - Lesson-keyed exercise, buổi chưa kết thúc → `upcomingCount >= 1`; payload KHÔNG chứa `id`/`title`/`program` (assert keys == `['upcomingCount']`).
   - **Unit-keyed** exercise (curriculumLessonId null), buổi chưa kết thúc → cũng đếm (chứng minh phủ unit path).
   - Bài đã mở (buổi kết thúc) KHÔNG tính vào upcoming.
   - >2 bài sắp tới → cap 2. HS không enroll → 0.
   Chạy → đỏ.
2. Viết `upcomingLessonIdsFor` + `upcomingUnitIdsFor` + `upcomingForPrincipal` (count-only). Test xanh.
3. `climb-view.tsx`: fetch cùng Promise.all + render locked + scroll-to-current (useLayoutEffect).
4. `cloud-climb.tsx`: state `locked`.
5. Verify dev: HS chưa mở bài (có buổi sắp tới đã xếp) → ≤2 node khóa mờ; kiểm **network** không có title/id bài sắp tới; HS có bài đang làm → cuộn tới đúng node; node khóa click không mở; empty-state khi chưa xếp lịch buổi.

## Success Criteria
- [ ] `exercise-upcoming-for-principal.int.test.ts` xanh (đỏ trước); payload chỉ `upcomingCount`; phủ CẢ lesson + unit.
- [ ] `listForPrincipal` giữ nguyên shape.
- [ ] Node khóa render KHÔNG title/reward/aria-title; không nộp được (assert client no title text).
- [ ] Mở `#exercises` cuộn tới node current; `currentId===null` xử lý xác định.
- [ ] Network LMS không chứa tên/id bài sắp tới (0038-safe).
- [ ] Suite exercise/lms-lifecycle/security-invariants vẫn xanh.

## Risk Assessment
- **0038**: count-only + BeanNode locked (không title/reward) + assert API & client = ranh giới then chốt.
- Scroll: fetch cùng Promise.all + useLayoutEffect tránh giật/khóa nhầm; xử lý currentId null.
- Giả định buổi tương lai đã xếp lịch — nếu ops xếp lịch theo tuần, upcoming có thể 0 → empty-state, KHÔNG coi là lỗi.
