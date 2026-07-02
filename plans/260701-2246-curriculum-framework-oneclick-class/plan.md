---
title: "Curriculum Framework Hard-Code + 1-Click Class Creation"
description: "Hard-code khung chương trình (CurriculumUnit seed CSV) → 1-click tạo lớp → cấu hình nhiều thứ/tuần → sinh buổi map unit → log vận hành đầy đủ → LMS hiển thị curriculum theo buổi."
status: done
priority: P1
branch: "develop"
lane: high-risk
tags: [academic, lms, curriculum, schedule, audit]
blockedBy: []
blocks: []
created: "2026-07-01T16:22:50.471Z"
createdBy: "ck:plan"
source: skill
mode: tdd
brainstorm: "plans/reports/brainstorm-260701-2246-curriculum-framework-oneclick-class-report.md"
---

# Curriculum Framework Hard-Code + 1-Click Class Creation

## Overview

Khóa cứng khung chương trình (UCREA L1-L3, Bright I.G J/T/C/W/Q/U) thành bảng `CurriculumUnit`
seed từ `curriculum_units_seed.csv`. Cho phép **1-click tạo lớp** với course khóa cứng, rồi cấu
hình nhiều thứ/tuần + giờ + GV + phòng + ngày KG. Khi sinh buổi, bung mỗi unit thành `sessions`
buổi thật theo `order_global` và gán `ClassSession.curriculumUnitId` → LMS hiển thị chủ đề/nội
dung/sách/play-kit/assessment theo từng buổi. Bổ sung các mutation sửa/xóa khung lịch + sửa lớp,
tất cả ghi timeline (Chatter `@cmc/audit`) để giám sát mọi thay đổi vận hành của lớp.

**Lane:** high-risk — chạm data model + tRPC public contract + đa domain (academic + LMS + audit).
**Mode:** TDD — mỗi phase test-first; đặc biệt phải khóa hành vi hiện có của
`schedule.generateSessions` (idempotency) + `domain-academic.detectConflicts` trước khi mở rộng.

### Quyết định đã chốt (brainstorm + red-team)
- A1 bảng DB `CurriculumUnit`; B1 tạo vỏ → cấu hình → sinh buổi; C1 nối unit vào từng `ClassSession`.
- Map `sessions`: **1 unit = N buổi thật** (bung theo `order_global`). Gán unit = **recompute toàn bộ buổi curriculum của lớp mỗi lần generate** (idempotent thật, không lệch khi thêm slot).
- **Course theo từng level** (UCREA-L1/L2/L3, BRIGHT_IG-J/T/C/W/Q/U); reconcile course generic cũ (`UCREA-01`…) ở seed-demo.
- Trường khóa cứng: program/level/units/số buổi/loại buổi/assessment/nội dung. Cấu hình: cơ sở/tên/ngày KG/thứ+giờ/GV/phòng/sĩ số.
- **LMS Acceptance #3: xây màn session-list mới cho HS** (không chỉ trên thẻ evidence published).
- R1: `editSlot` đổi template + **tùy chọn** áp dụng buổi tương lai (scoped `classBatchId`, check trùng phòng/GV **và** unique-key, recompute curriculum sau reorder) + log.
- R2: **không** làm edit buổi lẻ vòng này.
- R3: curriculum vòng này **chỉ seed + read** (`protectedProcedure`, YAGNI). `curriculum_unit` global — **KHÔNG bật RLS** (như `course`, dựa GRANT).

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Data Model & Curriculum Seed](./phase-01-data-model-curriculum-seed.md) | Done |
| 2 | [Curriculum Read API & Permission](./phase-02-curriculum-read-api-permission.md) | Done |
| 3 | [Session Generation Unit Mapping](./phase-03-session-generation-unit-mapping.md) | Done |
| 4 | [Multi-Slot Create & Class Update Log](./phase-04-multi-slot-create-class-update-log.md) | Done |
| 5 | [Slot Edit-Remove & Cascade](./phase-05-slot-edit-remove-cascade.md) | Done |
| 6 | [UI Wizard Activity-Log & LMS Curriculum](./phase-06-ui-wizard-activity-log-lms-curriculum.md) | Done |

## Implementation Status — 2026-07-02

All 6 phases implemented on `develop` (TDD, high-risk lane). **9 test files, 38 curriculum-feature
tests green** + full regression (schedule/class-batch/audit/LMS/parity) with zero regressions.
Typecheck clean on api/db/domain-academic/auth/admin; my new code adds no lint/type errors.

- **P1**: `CurriculumUnit` + `UnitType` + `Course.levelCode` + `ClassSession.curriculumUnitId` (additive
  migration `20260701230000_curriculum_unit`, no RLS — global like `course`). Quote-aware CSV parser +
  idempotent importer (`seed-curriculum.ts`, script `seed:curriculum`) → 9 courses/level, 60 units, 240
  sessions. `seed-demo` rebinds demo batch to `UCREA-L1` + soft-archives legacy generic courses.
- **P2**: `curriculum.listByCourse` (protectedProcedure, read-only) + `course.list` extended with
  `levelCode`/`unitCount`/`totalSessions` (grouped query, no N+1). Mounted in `routers/index.ts`.
- **P3**: pure `assignUnitsToSessions` (`@cmc/domain-academic`) + `recomputeCurriculumMapping` service;
  `generateSessions` recomputes the WHOLE batch (excludes cancelled/makeup) → stable under slot reorder.
- **P4**: `classBatch.create` accepts `slots[]` (normalizes `initialSlot`, rejects duplicate day/time);
  new `classBatch.update` with primitive-safe `diffChanges` log; `courseId` immutable; `classBatch.update`
  permission + snapshot; authz-deny tested.
- **P5**: `schedule.editSlot` (batch-scoped `applyToFuture`, dual conflict check room/GV + unique-key,
  `getUTCDay` alignment, curriculum recompute on reorder) + `removeSlot` (soft-archive, sessions kept);
  permissions + snapshot; cross-class/collision/authz-deny tested.
- **P6**: `audit.timeline` resolves `actorName`; `Chatter` renders it (class detail "Nhật ký" tab already
  mounted). `CreateClassModal` → multi-slot wizard + read-only curriculum preview. `ScheduleTab` slot
  edit/remove (permission-gated). New LMS `schedule.sessionsForStudent` (lmsProcedure, ownership-scoped,
  null-safe join) + `CurriculumSessionsTab` added to student & parent shells.

**Known pre-existing (NOT introduced here):** `apps/lms` typecheck + `apps/lms`/`packages/ui` lint have
pre-existing errors (Mantine `SimpleGrid gap`, unused imports in `showcase-view`/`leaderboard`/`login-gate`/
`student-view` IconTrophy) in files this plan did not modify. CI typecheck/lint is not currently gating.

**Thứ tự phụ thuộc:** P1 → P2 → P3 (P3 cần model P1 + read P2); P4 sau P1; **P5 sau P3+P4** (editSlot gọi recompute của P3); P6 sau P2/P3/P4/P5.

## Acceptance (toàn plan)
1. Chọn khung → 1 click tạo lớp vỏ; curriculum khóa cứng (UI không cho sửa unit).
2. Nhập ≥2 thứ/tuần + giờ + GV + phòng + ngày KG → sinh buổi; mỗi buổi có `curriculumUnitId` đúng thứ tự `order_global`.
3. LMS hiển thị chủ đề/nội dung/sách/play-kit/assessment theo từng buổi.
4. `editSlot`/`removeSlot`/`classBatch.update` ghi timeline đầy đủ (field old→new / body).
5. Màn chi tiết lớp hiển thị timeline log riêng của lớp.
6. Seed đủ: UCREA L1-3 + Bright J/T/C/W/Q/U; đúng số unit/buổi; re-run không nhân bản.
7. Kiểm tra trùng phòng/GV vẫn hoạt động sau khi map unit.

## Dependencies

- **Coordinate (red-team #15 — CÓ đụng file):** `plans/260701-1223-lms-climb-session-lock` (DRAFT) thêm
  `Exercise.classSessionId` + back-relation `exercises Exercise[]` trên **cùng block model `ClassSession`**
  mà plan này sửa (thêm `curriculumUnitId` + relation). Migration files tách được, nhưng **`schema.prisma`
  block ClassSession sẽ git-merge-conflict** — plan vào sau phải rebase thủ công block đó. Không phải
  blocker logic (2 cột khác nhau), nhưng cần phối hợp thứ tự sửa file.
- Tận dụng nguyên trạng: `@cmc/audit` (`logEvent`/`diffChanges`/`logStatusChange`/`addFollower`/`getTimeline`),
  `packages/ui/src/activity-log.tsx` (**nhận prop `entries`** — cần wrapper fetch), `audit.timeline`
  (allow-list `NOTE_TARGETS` đã có `class_batch`; trả `actorId` — cần resolve tên),
  `@cmc/domain-academic` (`enumerateSessions`/`detectConflicts`), `services/batch-code`, `assertSlotRefsInFacility`.

## Red Team Review

### Session — 2026-07-01
**Reviewers:** 4 (Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic).
**Findings:** 15 accepted (mọi finding có `file:line` — không loại vì thiếu chứng cứ). Severity: 3 Critical, 5 High, 7 Medium.

| # | Finding | Sev | Disposition | Applied |
|---|---------|-----|-------------|---------|
| 1 | Offset map unit không ổn định khi re-run (chỉ insert, không update cũ) | Critical | Accept | Phase 3 (recompute toàn batch) |
| 2 | Seed Course premise sai (`seed.ts:154` là student; course cũ 1/chương trình) | Critical | Accept | Phase 1 (Course per level + reconcile) |
| 3 | `ActivityLog` nhận `entries` (không entityType/entityId); actorId chưa resolve | Critical | Accept | Phase 6 (wrapper + resolve actorName) |
| 4 | "Mirror RLS policy của course" — course KHÔNG có RLS | High | Accept | Phase 1 (không bật RLS curriculum_unit) |
| 5 | `applyToFuture` thiếu scope `classBatchId` → sửa nhầm lớp khác | High | Accept | Phase 5 (batch-scoped predicate) |
| 6 | editSlot đổi startTime đụng unique-key → P2002 raw 500 | High | Accept | Phase 5 (dual conflict check) |
| 7 | Thiếu test authz-deny cho mutation privileged mới | High | Accept | Phase 4/5 (negative-authz tests) |
| 8 | LMS chưa có màn session-list → Acceptance #3 cần surface mới | High | Accept | Phase 6 (LMS session-list mới) |
| 9 | Timezone: phải `getUTCDay` khớp enumerate | Medium | Accept | Phase 5 |
| 10 | 2 slot trùng (day,startTime) bị `skipDuplicates` bỏ âm thầm | Medium | Accept | Phase 4 (validate + reject) |
| 11 | Test courseId-immutable phantom (`z.object` strip im lặng) | Medium | Accept | Phase 4 (assert kết quả) |
| 12 | `_app.ts` không tồn tại (`index.ts`); `curriculum.courses` trùng `course.list` | Medium | Accept | Phase 2 |
| 13 | Chưa có CSV parser; split ngây thơ vỡ tiếng Việt quote/`\|` | Medium | Accept | Phase 1 (parser quote-aware + test biên) |
| 14 | Cột thừa `durationMonth`/`archivedAt` (YAGNI) | Medium | Accept | Phase 1 (bỏ) |
| 15 | Cross-plan CÓ đụng block `ClassSession` trong schema.prisma | Medium | Accept | plan.md Dependencies |

**Non-issue (verify an toàn, không sửa):** `protectedProcedure` đọc curriculum global (không PII); `audit.timeline` cho `class_batch` tenant-safe; map `Bright I.G→BRIGHT_IG` hợp lệ.

### Whole-Plan Consistency Sweep
- "mirror course policy" đã xóa khắp Phase 1; RLS-off nhất quán plan.md + Phase 1 + Phase 2.
- "Course per level" nhất quán: plan.md decisions + Phase 1 + Phase 2 (`course.list` mở rộng) + Phase 6 wizard.
- Offset "recompute toàn batch" nhất quán Phase 3 ↔ Phase 5 (editSlot gọi lại recompute).
- Bỏ `curriculum.courses`: Phase 2 dùng `course.list`; Phase 6 cũng tham chiếu `course.list`. Không còn `_app.ts`.
- `ActivityLog entries`-based nhất quán Phase 6 + Dependencies.
- Không còn magic-number 48/16/60 độc lập: Phase 1 + Phase 2 test suy count từ CSV.
- Không mâu thuẫn tồn đọng → sẵn sàng cook.
