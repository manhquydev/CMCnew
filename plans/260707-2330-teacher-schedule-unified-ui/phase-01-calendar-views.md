---
phase: 1
title: "Calendar Views"
status: completed
priority: P1
effort: "L"
dependencies: []
---

# Phase 1: Calendar Views

## Overview

Tạo `teacher-schedule.tsx` — container component với 3 view mode: List, Tháng (month grid), Kanban. Default view = Tháng. Load sessions qua `trpc.schedule.mySessions`. State machine `activeSession` điều khiển drill-down.

## Architecture

**URL routing** (validate decision): sessionId persisted in URL param `?session=<id>` so browser back/refresh works. Read param on mount to restore drill-down state.

```tsx
// State
const [view, setView] = useState<'list' | 'calendar' | 'kanban'>('calendar')
const [currentMonth, setCurrentMonth] = useState(() => dayjs().startOf('month'))
const [facilityId, setFacilityId] = useState<number | null>(null)  // null = all facilities
const [sessions, setSessions] = useState<MySession[]>([])

// URL-driven session drill-down (use useSearchParams or manual URLSearchParams)
const sessionId = new URLSearchParams(location.search).get('session')
const activeSession = sessions.find(s => String(s.id) === sessionId) ?? null

// Navigate to session detail:
const openSession = (s: MySession) => {
  const url = new URL(location.href)
  url.searchParams.set('session', String(s.id))
  history.pushState({}, '', url)   // or use router.navigate if project has router
}
// Back:
const closeSession = () => {
  const url = new URL(location.href)
  url.searchParams.delete('session')
  history.pushState({}, '', url)
}

// Render:
if (activeSession) return <SessionDetail session={activeSession} onBack={closeSession} />
return <CalendarShell view={view} ... />
```

**facilityId = null behavior** (validate decision): if teacher has no facilities assigned, pass `facilityId: null` / `undefined` to `mySessions` query → load all sessions across facilities. Check router input schema: if `facilityId` is required, default to first in `me.facilityIds` or omit when empty (let backend decide).

**facilityIds guard**: if `me.facilityIds.length === 0`, `FacilityPicker` shows "Tất cả cơ sở" as default option, not an error or redirect.

## Design Tokens (Apple-minimal — hiện tại)

```ts
const C = {
  brand: '#0071E3', brandMuted: '#E8F1FC',
  text: '#1D1D1F', muted: '#6E6E73',
  bg: '#F5F5F7', surface: '#FFFFFF', border: '#E5E5EA',
}
```

## View: List

- Header: Tuần X (DD/MM – DD/MM) | nút ← →
- Mỗi ngày có header "Thứ X, DD/MM"
- Mỗi session: card ngang — class code (bold) · giờ · phòng · status badge · nút "Vào buổi học →"
- Empty day: ẩn luôn hoặc show "—" tùy preference
- Scroll theo chiều dọc

## View: Tháng (Calendar grid)

- 7 cột (T2–CN), 5–6 hàng, tiêu đề ngày số
- Mỗi ô ngày: tối đa 3 session cards hiển thị, còn lại "+N buổi"
- Session card: `[● status_dot] CLASS_CODE HH:mm`
- Highlight hôm nay bằng background `#E8F1FC`
- Navigate tháng: < > buttons + "Hôm nay"
- Load range = toàn bộ tháng hiện tại khi navigate

## View: Kanban

- 4 cột: **Sắp dạy** (planned) | **Đang diễn ra** (open+running) | **Đã xong** (closed) | **Đã hủy** (cancelled)
- Mỗi card: class code + ngày + giờ
- Không cần drag-and-drop (YAGNI — chỉ xem)
- Load sessions = 2 tuần gần nhất + 2 tuần tới

## Related Code Files

- Create: `apps/admin/src/teacher-schedule.tsx`
- Reuse type: `MySession` từ `trpc.schedule.mySessions`
- Ref pattern: `schedule-panel.tsx` (date range fetch), `teacher-today-panel.tsx` (Apple tokens)

## Implementation Steps

1. Tạo `teacher-schedule.tsx` với state (`view`, `currentMonth`, `facilityId`, `sessions`, `loading`)
2. **URL routing**: read `?session=<id>` on mount + on `popstate` event → derive `activeSession` from `sessions`
3. `useEffect` fetch sessions khi `facilityId` hoặc tháng thay đổi (calendar) / tuần thay đổi (list) / static 4-week (kanban). If `facilityId === null` → omit/undefined in query.
4. Implement `ViewToggle` component (3 nút List | Tháng | Kanban)
5. Implement `FacilityPicker` header + tháng navigation; default = "Tất cả cơ sở" nếu `me.facilityIds.length === 0`
6. Implement **ListView**: group sessions by date, render CardRow per session
7. Implement **CalendarGrid**: 7×6 grid, distribute sessions by `sessionDate`, render mini cards
8. Implement **KanbanView**: 4 columns by status, render cards
9. Session card click → `history.pushState` với `?session=id`, derive activeSession từ sessions array
10. Placeholder SessionDetail stub (back button + session code) để Phase 1 test được, verify URL back works

## Success Criteria

- [ ] 3 view toggles chuyển đổi được
- [ ] Calendar tháng hiển thị đúng sessions theo ngày
- [ ] List view nhóm đúng theo ngày, sort đúng theo giờ
- [ ] Kanban 4 cột đúng sessions theo status
- [ ] Navigate tháng (< >) reload sessions đúng range
- [ ] Click session card → URL changes to `?session=<id>`, stub SessionDetail hiện ra
- [ ] Browser back button → URL clears `?session`, quay về calendar đúng view + tháng
- [ ] Refresh trang với `?session=<id>` trong URL → load sessions rồi drill-down đúng session
- [ ] `me.facilityIds = []` → FacilityPicker shows "Tất cả cơ sở", sessions load (no crash)
- [ ] `pnpm --filter admin tsc --noEmit` zero error trên file này

## Risk Assessment

- Calendar grid tháng có thể phức tạp với border/responsive → dùng CSS grid thuần, không dùng thư viện lịch bên ngoài (YAGNI)
- `mySessions` có thể trả nhiều session cho tháng → cần limit hiển thị trong cell ("+N buổi")
