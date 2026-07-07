---
phase: 3
title: "Nav Cleanup + Wire-up"
status: completed
priority: P1
effort: "M"
dependencies: [1, 2]
---

# Phase 3: Nav Cleanup + Wire-up

## Overview

Gỡ các section rời thừa khỏi teacher surface nav, wire `schedule` section trong `App.tsx` để render `TeacherSchedule`, và đơn giản hóa sidebar xuống ≤5 items. Không thay đổi ERP surface hay admin nav.

## Files to Modify

| File | Change |
|------|--------|
| `apps/admin/src/app-surface.ts` | Remove `attendance`, `grading`, `assessment` from `TEACHER_SURFACE_SECTIONS` |
| `apps/admin/src/shell.tsx` | Simplify teacherSurfaceLabels + filter |
| `apps/admin/src/App.tsx` | Wire `schedule` section → `<TeacherSchedule>` |

## app-surface.ts Changes — RED-TEAM CORRECTED (IMPLEMENTED, commit f18a319)

**Giữ nguyên `TEACHER_SURFACE_SECTIONS` (bao gồm attendance/grading/assessment).**

Lý do (red-team Finding 5): `giam_doc_dao_tao` là teacher surface actor và vẫn cần navigate trực tiếp tới các section này. `isReachableSection()` trong `App.tsx:640-660` dùng Set này làm gate — xóa section sẽ bounce `giam_doc_dao_tao` về default và break bookmarked URLs.

**Đã triển khai**: Set giữ nguyên. Ẩn 2 tab thao tác trùng calendar (`attendance` = Điểm danh, `grading` = Chấm bài) khỏi thanh nav teacher cho MỌI role bằng `teacherNavMergedIntoCalendar` set trong `shell.tsx` (không phải chỉ `giao_vien`). `attendance-report` (Báo cáo điểm danh) + `assessment` (Học bạ = AssessmentPanel report cards) là báo cáo, không trùng calendar → giữ hiển thị cho giám đốc, `giao_vien`-only đã bị lọc sẵn bởi `!isTeacherOnly`.

Live-verified trên devteacher.cmcvn.edu.vn: 10/10 nghiệp vụ pass (calendar 3 view, URL drill-down, điểm danh optimistic, auto-save nhận xét, chấm điểm 8.5, refresh persist).

## shell.tsx Changes

Cập nhật `teacherSurfaceLabels` để map teacher-facing labels:

```ts
const teacherSurfaceLabels: Partial<Record<SectionKey, string>> = {
  overview: 'Hôm nay',
  schedule: 'Lịch dạy',          // renamed từ "Lịch dạy hôm nay"
  'attendance-report': 'Báo cáo', // rút gọn label
  classes: 'Lớp học',
  profile: 'Hồ sơ',
}
```

Teacher surface nav mục tiêu (≤5 items hiển thị với `giao_vien`):
1. Hôm nay (overview)
2. Lịch dạy (schedule)
3. Báo cáo (attendance-report)
4. Lớp học (classes)
5. Hồ sơ (profile)

Director-specific items (`edu-director-cockpit`, `family-intake`) vẫn giữ nguyên permission gate của chúng — chỉ xuất hiện với đúng role.

## App.tsx Changes — RED-TEAM CORRECTED

**CRITICAL**: Phải branch theo `surface` — không replace toàn bộ case (red-team Finding 4 + Finding 7).

Actual code tại `App.tsx:797-811` là:
```tsx
case 'schedule':
  return (
    <Stack>
      <Text size="xl" fw={600}>Lịch dạy</Text>
      {selectedSession ? (
        <ScheduleDetailPanel session={selectedSession} goToClass={goToClass} onBack={() => setSelectedSession(null)} />
      ) : (
        <SchedulePanel goToClass={goToClass} onOpenSession={setSelectedSession} />
      )}
    </Stack>
  );
```

`SchedulePanel` KHÔNG nhận `facilityId` prop — interface của nó là `{ goToClass, onOpenSession }`.

**Correct implementation**:
```tsx
import { TeacherSchedule } from './teacher-schedule'

// App.tsx — case 'schedule':
case 'schedule':
  // Teacher surface: unified calendar component
  if (surface === 'teacher') {
    return <TeacherSchedule />  // component tự quản FacilityPicker state nội bộ
  }
  // ERP surface: existing behavior unchanged
  return (
    <Stack>
      <Text size="xl" fw={600}>Lịch dạy</Text>
      {selectedSession ? (
        <ScheduleDetailPanel session={selectedSession} goToClass={goToClass} onBack={() => setSelectedSession(null)} />
      ) : (
        <SchedulePanel goToClass={goToClass} onOpenSession={setSelectedSession} />
      )}
    </Stack>
  );
```

**`facilityId` prop**: `TeacherSchedule` KHÔNG nhận facilityId từ App.tsx — component tự quản FacilityPicker state nội bộ (red-team Finding 8). App.tsx không có `facilityId` variable trong `renderContent()` scope. Nếu cần seed từ `me.facilityIds[0]`, pass `defaultFacilityId={me.facilityIds[0] ?? null}` thay vì `facilityId`.

Kiểm tra `overview` section render vẫn đúng sau cleanup:

```tsx
case 'overview':
  return isTeacherSurfaceActor
    ? <TeacherTodayPanel />   // đã có từ session trước
    : <DashboardSummary />
```

## Implementation Steps

1. **Read** `app-surface.ts` → verify `'schedule'` already in Set (no removal needed)
2. **Read** `shell.tsx` → update `teacherSurfaceLabels` (schedule label rename only)
3. **Read** `App.tsx` → locate the actual `case 'schedule'` block (lines ~797–811), note `goToClass` + `setSelectedSession` refs needed for ERP branch
4. **Add** import `TeacherSchedule` from `'./teacher-schedule'`
5. **Add** `if (surface === 'teacher') return <TeacherSchedule />` BEFORE the existing Stack return, keeping ERP path intact
6. **Verify** `defaultSection()` logic still correct (returns `'overview'` or `'schedule'` appropriately)
7. **Do NOT** pass `facilityId` as prop — `TeacherSchedule` handles FacilityPicker internally

## Success Criteria

- [ ] Teacher nav sidebar hiển thị ≤5 items với `giao_vien` role (Điểm danh/Chấm bài/Assessment không hiện trong nav vì visibility filter, không phải vì xóa khỏi Set)
- [ ] Click "Lịch dạy" trong sidebar → render `TeacherSchedule` component (calendar view) cho teacher surface
- [ ] ERP users clicking "Lịch dạy" → vẫn thấy `SchedulePanel` + `ScheduleDetailPanel` (no regression)
- [ ] `giam_doc_dao_tao` trên teacher surface vẫn có thể navigate `/attendance` nếu cần
- [ ] `pnpm --filter admin tsc --noEmit` zero error sau changes này

## Risk Assessment

- ~~xóa attendance/grading/assessment khỏi TEACHER_SURFACE_SECTIONS~~ **RESOLVED**: không xóa Set, chỉ dùng nav visibility (red-team Finding 5)
- ~~replace case 'schedule' toàn bộ~~ **RESOLVED**: branch bằng `if (surface === 'teacher')` guard (red-team Finding 4)
- ~~`facilityId` prop từ App.tsx~~ **RESOLVED**: `TeacherSchedule` tự quản nội bộ, không nhận prop (red-team Finding 8)
- Còn lại: `attendance-report` section — giữ nguyên trong Set, không cần thay đổi; `giao_vien` đã bị filter bởi `item.visible` logic nếu không có permission
- Calendar month boundary: sessions ở cuối tháng trước / đầu tháng sau hiển thị trong grid nhưng ngoài fetch range → sẽ show empty. Acceptable UX — note in PR.
