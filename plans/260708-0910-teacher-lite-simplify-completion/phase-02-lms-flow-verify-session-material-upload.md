---
phase: 2
title: "LMS flow verify + session material upload"
status: pending
priority: P1
effort: "L"
dependencies: [1]
---

# Phase 2: LMS flow verify + session material upload (ƯU TIÊN #1)

## Progress (2026-07-08) — 2b ĐÃ BUILD SẴN (correction)
- **2b DONE (đã tồn tại):** "upload học liệu theo buổi" KHÔNG phải pending-migration. Đã có đầy đủ:
  model `CurriculumLesson` (schema:195), `exercise.upsert(curriculumLessonId)` + `listByLesson`/`listByUnit`,
  và UI `CourseExerciseManager` (`course-exercise-manager.tsx:106`) — "Một unit 4 buổi có 4 slot upload
  riêng, bài tự mở sau buổi tương ứng". Truy cập qua section "Học liệu" (courses) trên nav teacher-lite.
  Plan `260706-1752` thực chất đã được implement. → Domain "upload tài liệu tương ứng buổi" THỎA.
- **2a PENDING (verify):** HS làm/nộp bài — built (`260702-1007`), cần **login HS test** để verify live.

## Overview

Đảm bảo luồng LMS PH+HS hoạt động thật: (a) **verify live** HS thấy file bài tập → làm → nộp → GV thấy
bài nộp (đã build ở plan `260702-1007-lms-homework-pdf-completion` — COMPLETED, chỉ kiểm chứng); (b)
**build** upload học liệu gắn đúng buổi/lesson (plan `260706-1752-session-level-exercises` — PENDING,
schema migration + Decision 0038).

## Requirements
- Functional (verify): HS login LMS → xem exercise của buổi đã học → làm (draw-on-PDF/answer) → nộp →
  GV thấy trong HomeworkFeed/session-detail Chấm bài.
- Functional (build): giám đốc/GĐĐT upload tài liệu học liệu **theo lesson/session** (không phải cả unit);
  HS chỉ thấy tài liệu của buổi đã diễn ra.
- Functional (verify): PH xem được layer bài làm của con (read-only, sau publish).

## Architecture
- **Verify path** (no build): `apps/lms/src/student-view.tsx` (làm/nộp), `apps/api/src/routers/submission.ts`
  (save/submit + version concurrency), `apps/lms/src/parent-view.tsx` (parent layer). Đã có MinIO blob.
- **Build path** = thực thi/absorb plan `260706-1752-session-level-exercises`:
  - Schema: `CurriculumLesson` per-session template dưới `CurriculumUnit`; `Exercise` gắn lesson; open/grade
    theo `ClassSession.curriculumLessonId`. Migration + Prisma generate (Decision 0038 supersedes 0022).
  - API: exercise open/submission/grade contracts theo lesson. `exercise.upsert` gate = `[giam_doc_dao_tao, giam_doc_kinh_doanh]`.
  - UI: teacher/giám đốc upload slot theo buổi; LMS student thấy theo session đã ended.

## Related Code Files
- Verify (no change): `apps/lms/src/student-view.tsx`, `apps/lms/src/parent-view.tsx`, `apps/api/src/routers/submission.ts`
- Build (per session-level-exercises plan): `packages/db/prisma/schema.prisma`, migration SQL,
  `apps/api/src/routers/exercise.ts`, `apps/admin/src/courses-panel.tsx` (CourseExerciseManager → session slots),
  `apps/lms/src/curriculum-sessions-tab.tsx`
- Decision: `docs/decisions/0038-*.md`

## Implementation Steps
1. **Verify live FIRST** (trước khi build): trên prod, login HS test → chạy full làm/nộp bài; ghi lại
   pass/fail + screenshot. Nếu luồng HS đã OK → phần (a) DONE, chỉ còn (b).
2. Quyết định: thực thi plan `260706-1752-session-level-exercises` inline trong phase này, HAY mark
   plan này `blockedBy: [260706-1752-session-level-exercises]` và làm plan đó trước. (Red-team/validate quyết.)
3. Nếu build: theo 5 phase của session-level-exercises (schema → migration/seed → API → UI → tests/deploy).
4. Verify upload học liệu theo buổi E2E: giám đốc upload → HS buổi tương ứng thấy → nộp → GV chấm.

## Success Criteria
- [ ] Live prod: HS test thấy bài → làm → nộp thành công; GV thấy bài nộp.
- [ ] Giám đốc upload tài liệu gắn đúng lesson/buổi; HS chỉ thấy buổi đã ended.
- [ ] PH xem layer con read-only sau publish.
- [ ] Migration (nếu có) chạy sạch dev+prod; typecheck + integration green.

## Risk Assessment
- **Rủi ro cao nhất**: đây là phase nặng nhất (schema migration, LMS contracts). Verify-first giảm rủi ro
  làm lại phần đã có.
- Overlap plan `260706-1752`: tránh double-build — chốt absorb vs depend ở red-team.
- Cần login HS test (user cấp) để verify; PH cần OTP (user tự làm).
- Data migration lesson-level: rollback plan + backfill an toàn (theo plan gốc).
