---
phase: 2
title: "Session Detail Drill-down"
status: completed
priority: P1
effort: "XL"
dependencies: [1]
---

# Phase 2: Session Detail Drill-down

## Overview

Tạo `teacher-schedule-session-detail.tsx` — full-page session detail với 4 tabs. Khi `activeSession` non-null trong `teacher-schedule.tsx`, component này chiếm toàn bộ content area. Không modal, không drawer — push state pattern.

## Component Interface

```tsx
interface SessionDetailProps {
  session: MySession           // session row từ mySessions
  onBack: () => void           // callback → history.pushState removes ?session param
}
export function SessionDetail({ session, onBack }: SessionDetailProps)
// Note: URL routing handled in parent (TeacherSchedule).
// SessionDetail is a pure render component — no URL awareness needed.
```

## Layout

```
┌─ Header (sticky) ──────────────────────────────────────┐
│ ← Lịch dạy   CLASS_CODE · DD/MM · HH:mm–HH:mm  [Status] │
│                                          X/Y điểm danh │
├─ Tab bar ──────────────────────────────────────────────┤
│ [Điểm danh]  [Ảnh & Nhận xét]  [Chấm bài]  [Nhật ký] │
├─ Tab content area ─────────────────────────────────────┤
│ (scroll nếu cần)                                       │
└────────────────────────────────────────────────────────┘
```

## Tab 1 — Điểm danh

**Data**: `trpc.enrollment.listByBatch({ classBatchId })` + `trpc.attendance.listBySession({ classSessionId })`

**UI**:
- Counter badge "X/Y đã điểm danh" trong header
- Bulk button "Có mặt tất cả" → `trpc.attendance.markAll`
- Mỗi student row: InitialsAvatar + tên + 3 chips (Có mặt | Muộn | Vắng)
- Optimistic update + rollback on error (pattern từ `session-workspace.tsx`)
- Disabled khi `session.status === 'cancelled'`
- **Empty state** (validate decision): nếu `listByBatch` trả về 0 students → hiện "Lớp chưa có học sinh đăng ký" + bulk button disabled

**API**:
```ts
trpc.attendance.mark.mutate({ classSessionId, enrollmentId, status, excused: false })
trpc.attendance.markAll.mutate({ classSessionId, defaultStatus: 'present', overrides: [] })
```

## Shared State (CRITICAL — prevent race condition)

Tab 2 và Tab 4 đều dùng `trpc.sessionEvidence.upsertDraft`. Backend xử lý đây là full-replace của record (kể cả photos list). Nếu hai tab save độc lập sẽ race và overwrite nhau.

**Giải pháp**: Lift evidence state lên `SessionDetail` parent, merge tất cả trước khi gửi:

```ts
// Trong SessionDetail (parent):
const [evidenceDraft, setEvidenceDraft] = useState<{
  summary: string
  internalNote: string
  photos: Array<{ ref: string; sortOrder: number }>
  comments: Array<{ enrollmentId: number; note: string }>
}>({ summary: '', internalNote: '', photos: [], comments: [] })

// Tab 2 gọi: setEvidenceDraft(prev => ({ ...prev, summary: text, photos: newPhotos }))
// Tab 4 gọi: setEvidenceDraft(prev => ({ ...prev, internalNote: text }))

// Debounce unified save (1s):
useEffect(() => {
  const t = setTimeout(() => {
    trpc.sessionEvidence.upsertDraft.mutate({ classSessionId, ...evidenceDraft })
  }, 1000)
  return () => clearTimeout(t)
}, [evidenceDraft])
```

Cũng cần pass `enabled = session.status !== 'cancelled'` vào evidence logic (guard từ `session-evidence-panel.tsx:59` pattern).

## Tab 2 — Ảnh & Nhận xét

**Data**: `trpc.sessionEvidence.detailForStaff({ classSessionId })`

**UI**:
- Section "Nhận xét buổi học": textarea (placeholder "Ghi nhận xét..."), gọi `setEvidenceDraft(p => ({...p, summary}))` → unified debounce save → "Đã lưu ✓"
- Section "Ảnh lớp học": photo grid 3 cột, mỗi ảnh có nút X xóa
- "+ Thêm ảnh" button → `<input type="file" accept="image/*" multiple>` → `uploadSessionPhoto(file)` → nhận về `ref` string → append vào `photos[]`
- Upload progress indicator per ảnh (spinner overlay)

**API** (corrected — red-team Finding 1 + Finding 3):
```ts
// uploadSessionPhoto nhận file only — classSessionId KHÔNG phải argument
const ref = await uploadSessionPhoto(file)  // from @cmc/ui, returns string ref
// Sau đó:
setEvidenceDraft(prev => ({
  ...prev,
  photos: [...prev.photos, { ref, sortOrder: prev.photos.length }],
}))
// Unified save trong parent:
trpc.sessionEvidence.upsertDraft.mutate({
  classSessionId,
  summary,
  internalNote,
  photos,      // ← NOT teacherNotes
  comments,
})
```

## Tab 3 — Chấm bài

**Scope** (validate decision): exercises của `session.classBatchId` only — KHÔNG cross-class.

**Data**: `trpc.exercise.listByClass({ classBatchId: session.classBatchId })` → chọn exercise → `trpc.submission.listByExercise({ exerciseId })`

**UI**:
- Left panel (40%): list exercises của lớp, click để load submissions
- Right panel (60%):
  - Nếu chưa chọn exercise: "Chọn bài tập để xem bài nộp"
  - Nếu exercise đã chọn + có submissions: list students đã nộp
    - Click student → grade panel: Score (0–10) + Feedback textarea + "Lưu điểm"
    - Stars **không phải** caller field — server tính từ `grade.publish`, không truyền từ client
  - Empty state: "Chưa có bài nào được nộp"

**API** (corrected — red-team Finding 2):
```ts
// 'stars' và 'comment' KHÔNG tồn tại. Field thật là 'feedback'
trpc.grade.grade.mutate({ submissionId, score, feedback })
```

## Tab 4 — Nhật ký

**Data**: `trpc.sessionEvidence.detailForStaff({ classSessionId })`

**UI**:
- Textarea lớn "Ghi chú nội dung buổi học..."
- Gọi `setEvidenceDraft(p => ({...p, internalNote: text}))` → unified debounce save → "Đã lưu ✓"
- Status badge: Draft | Đã đăng
- "Đăng nhật ký" button (green) → publish mutation (confirmed exists — red-team Finding 9)
- Disabled khi đã published hoặc session cancelled

**API** (corrected — red-team Finding 3 + Finding 9):
```ts
// Tab 4 chỉ gọi setEvidenceDraft (unified save handles upsertDraft)
// Publish: mutation đã được confirm tồn tại trong router
trpc.sessionEvidence.publish.mutate({ classSessionId })
// KHÔNG cần fallback upsertDraft với status field (field đó không tồn tại)
```

## Related Code Files

- Create: `apps/admin/src/teacher-schedule-session-detail.tsx`
- Reuse logic from: `session-workspace.tsx` (attendance), `session-evidence-panel.tsx` (photos/notes)
- Import: `uploadSessionPhoto`, `notifyError`, `notifySuccess` from `@cmc/ui`

## Implementation Steps

1. Scaffold `teacher-schedule-session-detail.tsx` với Header + 4 tab state
2. Implement Header: back button, class info, status badge, attendance counter
3. Implement Tab 1 (Điểm danh): load enrollments + existing marks, render StudentRow chips, bulk action
4. Implement Tab 2 (Ảnh & NX): load evidence, textarea auto-save, photo grid + upload
5. Implement Tab 3 (Chấm bài): exercise picker + submission list + grade panel
6. Implement Tab 4 (Nhật ký): notes textarea auto-save + publish
7. Wire vào `teacher-schedule.tsx`: khi `activeSession` set → render `<SessionDetail>`
8. Test full drill-down flow: click session → 4 tabs → back → calendar

## Success Criteria

- [ ] Header hiển thị đúng class code, ngày, giờ, status
- [ ] Tab Điểm danh: mark + bulk + rollback on error; empty enrollment → "Lớp chưa có học sinh" + bulk disabled
- [ ] Tab Ảnh & NX: upload ảnh, textarea debounce save "Đã lưu"
- [ ] Tab Chấm bài: list exercises, list submissions, save grade
- [ ] Tab Nhật ký: save notes, publish
- [ ] Nút ← quay lại calendar, giữ view mode và tháng
- [ ] Cancelled session: disable điểm danh + upload
- [ ] Zero TypeScript error

## Risk Assessment

- ~~`trpc.sessionEvidence.publish` có thể chưa có~~ **CONFIRMED EXISTS** (`session-evidence-panel.tsx:181`) — không cần fallback
- ~~Photo upload nhận `(classSessionId, file)`~~ **CORRECTED**: `uploadSessionPhoto(file)` — single arg (red-team Finding 1)
- ~~`trpc.grade.grade` nhận `{ stars, comment }`~~ **CORRECTED**: field thật là `{ feedback }`, stars không phải caller field (red-team Finding 2)
- ~~`upsertDraft` fields là `teacherNotes`/`sessionNotes`~~ **CORRECTED**: real fields = `{ summary, internalNote, photos, comments }` (red-team Finding 3)
- Tab 2+4 concurrent save race: **RESOLVED** bằng unified state + single debounce trong parent (red-team Finding 6)
- Photo upload CORS: test trên prod domain (đã hoạt động ở `session-workspace` trước)
- `trpc.submission.listByExercise` input schema: cần verify tại implementation time (exerciseId là likely)
