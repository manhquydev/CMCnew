---
phase: 4
title: "Typecheck + Deploy"
status: completed
priority: P1
effort: "S"
dependencies: [1, 2, 3]
---

# Phase 4: Typecheck + Deploy

## Overview

Chạy full typecheck trên `apps/admin`, fix bất kỳ TypeScript error nào còn sót, commit, và deploy qua Jenkins CI pipeline (develop → PR → main → prod).

## Implementation Steps

### 1. Pre-commit typecheck

```bash
pnpm --filter admin tsc --noEmit
```

Dự kiến lỗi thường gặp:
- `MySession` type không match nếu `trpc.schedule.mySessions` trả về shape khác — fix bằng cách sử dụng `inferRouterOutputs` từ `@trpc/server`
- Missing prop types trên `TeacherSchedule` nếu `facilityId` chưa khớp kiểu
- `uploadSessionPhoto` signature mismatch — kiểm tra export từ `@cmc/ui`
- Implicit `any` trong event handlers — thêm explicit type annotations

### 2. Fix all type errors

- Không dùng `// @ts-ignore` hay `as any` để workaround — fix real types
- Nếu `trpc.sessionEvidence.publish` không tồn tại trong router → remove mutation call, chỉ dùng `upsertDraft` với status field nếu schema có, hoặc comment out publish button
- Verify `trpc.exercise.listByClass` và `trpc.submission.listByExercise` input types match usage

### 3. Lint check

```bash
pnpm --filter admin lint
```

Fix lint warnings trên các file mới trước khi commit.

### 4. Commit

```bash
git add apps/admin/src/teacher-schedule.tsx
git add apps/admin/src/teacher-schedule-session-detail.tsx
git add apps/admin/src/app-surface.ts
git add apps/admin/src/shell.tsx
git add apps/admin/src/App.tsx
git commit -m "feat(teacher-lite): unified calendar + session detail drill-down

Replace fragmented attendance/grading/assessment sections with:
- TeacherSchedule: 3-view calendar (List/Month/Kanban) with month default
- SessionDetail: push-navigation drill-down with 4 tabs (điểm danh,
  ảnh & nhận xét, chấm bài, nhật ký)
- Sidebar simplified to ≤5 teacher items"
```

### 5. Push + PR

```bash
git push origin develop
gh pr create \
  --title "feat(teacher-lite): unified calendar + session detail UI" \
  --body "Closes teacher surface UI fragmentation. See plans/260707-2330-teacher-schedule-unified-ui/plan.md" \
  --base main
```

### 6. Jenkins verification

- Monitor `ci.cmcvn.edu.vn` — develop pipeline should trigger on push
- Confirm: build passes, migrations (nếu có) run clean
- PR merge chỉ khi develop pipeline green

### 7. Prod smoke test (browser)

Sau khi deploy lên prod (`teacher.cmcvn.edu.vn`):

- [ ] Login với `giao_vien` account → land on `/overview` (TeacherTodayPanel)
- [ ] Click "Lịch dạy" → TeacherSchedule calendar tháng hiển thị
- [ ] Toggle List / Kanban → hoạt động
- [ ] Navigate tháng < > → sessions load đúng range
- [ ] Click session card → SessionDetail chiếm content area
- [ ] Tab Điểm danh → student list load, mark student
- [ ] Nút ← → quay lại calendar, giữ view + tháng
- [ ] Sidebar: đếm items, confirm ≤5 với `giao_vien`

## Success Criteria

- [ ] `pnpm --filter admin tsc --noEmit` exits 0 (zero errors)
- [ ] `pnpm --filter admin lint` exits 0
- [ ] Commit đúng conventional format, không có `--no-verify`
- [ ] Jenkins develop pipeline: GREEN
- [ ] PR merged to main
- [ ] Prod smoke test 7 items all pass

## Risk Assessment

- ~~`trpc.sessionEvidence.publish` absence~~ **CONFIRMED EXISTS** (`session-evidence-panel.tsx:181`) — implement publish button unconditionally, no fallback needed
- Type inference lag: nếu `@cmc/ui` export types không được build fresh, typecheck sẽ dùng stale `.d.ts` — chạy `pnpm --filter @cmc/ui build` trước nếu gặp lỗi từ package
- Jenkins cache: nếu pipeline dùng cache cũ của `node_modules`, có thể cần trigger fresh build manually
