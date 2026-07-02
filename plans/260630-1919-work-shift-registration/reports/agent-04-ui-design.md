# UI/UX Design -- Work Shift Registration + Attendance

**Plan:** Work Shift Registration & Attendance
**Date:** 2026-06-30
**Status:** Draft

---

## 1. Design Context & Constraints

### Tech Stack

- **Framework:** React + Mantine UI v7
- **Date handling:** `@mantine/dates` (DateInput)
- **Icons:** `@tabler/icons-react`
- **Shared package:** `@cmc/ui` (trpc, notifyError, notifySuccess, useSession, DataTable, StatusBadge, PageHeader, FilterBar, StatCard)
- **Pattern:** Panel components (`function XxxPanel() { ... }`)
- **CSS variables:** `--cmc-text-muted`, `--cmc-border`, `--cmc-surface`, `--cmc-brand`, etc.

### Role Groups (critical for Shift Registration design)

| Group | Shift type | Selection mode | Hours per shift |
|-------|-----------|----------------|-----------------|
| KINH DOANH (Sales) | Ca 1 (8h30-18h), Ca 2 (10h-20h), Ca 3 (13h-21h) | **Radio** -- exactly 1 per day | 8h |
| GIAO VIEN (Teacher) | Ca 1 (8h-12h), Ca 2 (13h-17h), Ca 3 (17h-21h) | **Checkbox** -- 0-3 per day | 4h each |

---

## 2. Screen 1: Check-in / Check-out

### Component: apps/admin/src/checkin-panel.tsx

State: currentTime (updated every 1s), todayRecord, recentRecords, ipValid, loading.

- Clock tick via setInterval, cleanup on unmount
- CHECK-IN / CHECK-OUT buttons disabled when loading or ipValid is false
- When ipValid false: Alert with red color, buttons disabled
- After check-in: notifySuccess, refetch todayRecord
- Recent history: Table with 5 most recent records

### Layout (text description)

Card centered at max-w 480px. Contains:
1. Live clock (HH:MM:SS)
2. Current date
3. Status badge: checked in time or "not checked in"
4. IP alert (conditional, red)
5. Two buttons: CHECK-IN (green, lg) and CHECK-OUT (red, lg) side by side
6. Below: history card with Table (Date | Check-in | Check-out | Status)

---

## 3. Screen 2: Shift Registration (MOST IMPORTANT)

### 3.1 Full Layout Description

PageHeader with title and two action buttons. Below:

1. FilterBar showing: DateInput Tu ngay, DateInput Den ngay, readonly fields for
   Nhan vien, Quan ly, Quan ly cap tren, Co so. Badge showing
   "Ca da dang ky trong thang: X ngay".

2. Alert box (info variant): Business rule warning about full-replacement
   logic (new schedule replaces old when approved).

3. Card containing the SHIFT GRID TABLE:
   - 5 columns: Ngay | Ca 1 | Ca 2 | Ca 3 | Tong gio
   - Header row shows shift names and hours (8h for Sales, 4h for Teacher)
   - Each row = one day, with Radio (Sales) or Checkbox (Teacher) in shift columns
   - Last column: total hours for that day
   - Last row: TONG gio across all days
   - Pagination: 31 days per page

### 3.2 KINH DOANH (Sales) - Radio Mode

Each day row has 3 Radio buttons sharing the same name prop.
Only ONE shift can be selected per day. Each shift = 8 hours.

```tsx
<Table.Tr key={date}>
  <Table.Td><Text>{fmtDate(date)}</Text><Text size="xs" c="dimmed">{weekday}</Text></Table.Td>
  <Table.Td align="center">
    <Radio name={`shift-${date}`} checked={sel[date]===1} onChange={()=>select(date,1)} />
  </Table.Td>
  <Table.Td align="center">
    <Radio name={`shift-${date}`} checked={sel[date]===2} onChange={()=>select(date,2)} />
  </Table.Td>
  <Table.Td align="center">
    <Radio name={`shift-${date}`} checked={sel[date]===3} onChange={()=>select(date,3)} />
  </Table.Td>
  <Table.Td align="center">
    <Badge color={sel[date]?'cmc':'gray'}>{sel[date]?'8h':'-'}</Badge>
  </Table.Td>
</Table.Tr>
```

Key: Each day uses Radio with same name prop for mutual exclusion.
Do NOT use Radio.Group for the whole table.

### 3.3 GIAO VIEN (Teacher) - Checkbox Mode

Each day row has 3 independent Checkboxes.
Teacher can select 0-3 shifts per day. Each shift = 4 hours.

```tsx
<Table.Tr key={date}>
  <Table.Td><Text>{fmtDate(date)}</Text><Text size="xs" c="dimmed">{weekday}</Text></Table.Td>
  <Table.Td align="center">
    <Checkbox checked={sel[date]?.includes(1)} onChange={(e)=>toggle(date,1,e.checked)} />
  </Table.Td>
  <Table.Td align="center">
    <Checkbox checked={sel[date]?.includes(2)} onChange={(e)=>toggle(date,2,e.checked)} />
  </Table.Td>
  <Table.Td align="center">
    <Checkbox checked={sel[date]?.includes(3)} onChange={(e)=>toggle(date,3,e.checked)} />
  </Table.Td>
  <Table.Td align="center">
    <Badge color={hours>0?'cmc':'gray'}>{hours>0?hours+'h':'-'}</Badge>
  </Table.Td>
</Table.Tr>
```

### 3.4 State Management Design

#### 3.4.1 Form State Shape

Types:
- ShiftGroup = KINH_DOANH or GIAO_VIEN
- SalesSelection = Record of dateString to shiftNumber (1, 2, or 3)
- TeacherSelection = Record of dateString to number array (list of checked shifts)

ShiftFormState interface:
- fromDate, toDate: Date or null
- user: id, name, group
- manager, nextLevelManager: id + name or null
- facility: id + name or null
- shifts: SalesSelection or TeacherSelection (conditional on group)
- existingRegistrationId: string or null
- existingStatus: DRAFT / SUBMITTED / APPROVED / REJECTED / null
- page: number for table pagination

#### 3.4.2 Strategy: useReducer (RECOMMENDED)

Single reducer for entire form. Actions: SET_RANGE, SELECT_SHIFT (Sales),
TOGGLE_SHIFT (Teacher), LOAD_EXISTING, SET_PAGE, RESET.

SET_RANGE: generates new date list from fromDate to toDate, preserves
overlapping existing selections, resets page to 1.

SELECT_SHIFT: only for Sales. Sets shift number for a specific date.
Each call replaces previous selection for that day (radio behavior).

TOGGLE_SHIFT: only for Teacher. Adds or removes a shift number from
the array for a specific date. Uses .sort() for consistent order.

Why useReducer over useState:
- Atomic updates avoid stale closure bugs
- Logic centralized in one place
- Pure function, easy to unit test
- Avoids cascading re-renders from sequential setState calls

#### 3.4.3 Derived Values (NOT stored in state)

dayHours(shifts, date, group): returns hours for a single day
- Sales: 8 if shift selected, 0 otherwise
- Teacher: number of checked shifts * 4

totalHours(state): sum of dayHours across all dates -- shown in grand total row

registeredDaysInMonth(state): count of days with at least 1 shift in current month

#### 3.4.4 Validation Rules

validateShiftForm returns Record of field to error message:
- Range check: fromDate and toDate must be set, toDate after fromDate
- Sales: every day must have exactly 1 shift (list empty days with preview)
- Teacher: at least 1 shift overall (totalHours > 0)

### 3.5 Action Buttons Logic

Button visibility based on existingStatus:
- New/DRAFT/REJECTED: Luu nhap enabled, Gui duyet enabled, Huy gui hidden
- SUBMITTED: Luu nhap disabled, Gui duyet disabled, Huy gui enabled
- APPROVED: all disabled, Huy gui hidden

Luu nhap: saveDraft mutation, no validation
Gui duyet: validate first, show errors if any, then submit mutation
Huy gui: confirm dialog, unsubmit mutation, switch form to edit mode

---

## 4. Screen 3: Registration List

PageHeader with [+ Dang ky moi] button. FilterBar with Select for Trang thai, Nhan vien, and DateInput for Thang.

DataTable with columns: Ma phieu, Nhan vien, Tu ngay, Den ngay, Trang thai (using StatusBadge), Ngay tao. Built-in search, sort, pagination from DataTable.

Click row navigates to edit (if DRAFT/REJECTED) or view-only (if SUBMITTED/APPROVED).

Status map: DRAFT=Nhap (draft), SUBMITTED=Cho duyet (pending), APPROVED=Da duyet (active), REJECTED=Tu choi (rejected).

---

## 5. Screen 4: Manager Approval

PageHeader with subtitle showing pending count. FilterBar with status, staff, and facility selects.

DataTable of submitted registrations. Click row opens Modal containing:
1. Readonly info: NV, Manager, Facility, Date range
2. Readonly shift grid (same visual, checkmarks instead of controls)
3. Textarea for approval note (required for rejection)
4. Tu choi (red) and Phe duyet (green) buttons
5. Collapsible approval history sub-table

Approve API call -> close modal -> refresh list -> notifySuccess.
Reject: note required first, same flow.
Manager self-approval blocked: API 403, filtered from UI list.

---

## 6. Screen 5: Attendance Report

PageHeader. FilterBar with month, facility, department selects.
SimpleGrid cols=3 with StatCards: Tong NV, Tong ngay cong, So lan di muon.
DataTable: Nhan vien, So ngay lam, So lan di muon, Tong gio, Chi tiet button.
Chi tiet button opens Modal with daily breakdown table:
Ngay | Ca dang ky | Check-in | Check-out | Di muon | Gio thuc te.
Di muon = check-in > shift start + threshold (default 5 phut).
Export CSV deferred to later phase.

---

## 7. Component Tree

```
apps/admin/src/
  checkin-panel.tsx                    # Man 1: Check-in/Check-out
  shift-registration-panel.tsx         # Man 2: Dang ky ca (ORCHESTRATOR)
    -> ShiftGridTable.tsx              # Bang dang ky (radio/checkbox)
  shift-registration-list-panel.tsx    # Man 3: Danh sach phieu
  shift-approval-panel.tsx             # Man 4: Duyet phieu (Manager)
    -> ShiftDetailModal.tsx            # Modal chi tiet phieu
  attendance-report-panel.tsx          # Man 5: Bao cao cham cong
    -> AttendanceDetailModal.tsx       # Modal chi tiet nhan vien
```

No new components needed in packages/ui/src. DataTable, StatusBadge, PageHeader, FilterBar, StatCard cover all needs.

### Component Responsibility Matrix

| Component | Responsibility | Complexity |
|-----------|---------------|------------|
| checkin-panel | Clock, IP check, check-in/out, history | LOW |
| shift-registration-panel | useReducer orchestrator, validation, API | HIGH |
| ShiftGridTable | Radio/Checkbox grid, derived values | HIGH |
| shift-registration-list-panel | DataTable list, status filter, nav | MEDIUM |
| shift-approval-panel | Approval queue, approve/reject | MEDIUM |
| ShiftDetailModal | Readonly grid, note, approve/reject, history | MEDIUM |
| attendance-report-panel | Summary stats, DataTable, daily detail | MEDIUM |

### Data Flow

trpc API -> shift-registration-panel (useReducer) -> ShiftGridTable (props)
Props: shifts, group, onSelectShift/onToggleShift, page, onPageChange.
Derived values: dayHours(), totalHours() computed from shifts state.
Action buttons call trpc mutations directly from orchestrator panel.
validateShiftForm() is a pure function invoked before submit.

---

## 8. Responsive Behavior

### Check-in Panel
Desktop: Card centered, max-w 480px, buttons side by side.
Mobile: Full width, buttons stacked vertically, clock font smaller.

### Shift Registration Panel
Desktop (>=1024px): FilterBar inline, 5 table columns, cells min-w 60px.
Tablet (768-1023px): FilterBar wraps, narrower columns, hide weekday text.
Mobile (<768px): Card-based list. Each day becomes a Card with shift options.
  Cards scroll vertically. Action buttons full-width, stacked.
  Decision: Card-based (Option A) over horizontal scroll (Option B).

### List / Approval / Report Panels
DataTable auto-switches compact/comfortable at 48em.
FilterBar wraps naturally. Modal fullscreen on mobile.

---

## 9. Interaction Flows

### Flow 1: Create New Registration
1. Click + Dang ky moi
2. System loads user profile, auto-selects current month
3. User adjusts date range -> table regenerates
4. User selects shifts (Radio for Sales, Checkbox for Teacher)
5. Total hours update in real-time
6. Luu nhap: saveDraft mutation, notifySuccess, status = DRAFT
7. Gui duyet: validate, show errors or submit, redirect to List

### Flow 2: Edit Draft
Click DRAFT row -> form pre-populated -> modify -> Luu nhap or Gui duyet

### Flow 3: Unsubmit
Click SUBMITTED row -> readonly view -> Huy gui -> confirm dialog -> API call -> form editable

### Flow 4: Manager Approval
Open Approval -> click SUBMITTED row -> Modal with readonly grid -> add note -> Approve or Reject -> close, refresh

### Flow 5: Check-in/Check-out
Open panel -> IP check -> invalid: alert + disabled / valid: button available -> click -> API -> notifySuccess

---

## 10. Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| Date range loses selections | Preserved in state, only current range rendered |
| No manager assigned | Show warning, Submit disabled with tooltip |
| Network error during save | notifyError, form state preserved |
| Double-click submit | Button disabled during API call via isPending |
| Manager self-approval | API 403, filtered from UI list |
| Holiday/leave day in range | Alert during validation |
| Teacher 0 shifts total | Validation error: chon it nhat 1 ca |
| Sales empty day | Validation error: ngay X chua chon ca, row highlighted |
| Past date registration | minDate on DateInput |
| Concurrent edit (two tabs) | HTTP 409, notifyError + refresh suggestion |
| IP check fails | Alert + buttons disabled |
| Empty date range | EmptyState component |
| Range > 60 days | Pagination at 31 days/page |
| Unsaved changes on navigate | beforeunload event warning |

---

## 11. Accessibility Notes

- Radio buttons: aria-label for each shift-day combination
- Check-in/Check-out: descriptive aria-labels
- Shift grid table: role=grid, scope=col on headers
- Status info: StatusBadge uses dot + text + color, not color alone
- Modal: focus trap handled by Mantine
- Keyboard: Tab through days, Arrow keys for Radio selection
- Confirm dialogs: clear focus management
- Loading states: aria-busy on tables and buttons

---

## 12. Performance Considerations

- Shift grid: 31 days/page = ~155 rows, lightweight Mantine controls
- Clock timer: setInterval at 1s, cleanup on unmount
- DataTable: client-side pagination, efficient for large lists
- trpc: staleTime 30s for list queries to reduce refetching
- Derived values: computed on render; useMemo for ranges > 60 days
- Virtualization: react-window deferred until proven necessary

---

## 13. Unresolved Questions (for product owner)

1. Giao vien co bat buoc chon it nhat 1 ca moi ngay khong? (Spec: 0-3 ca/ngay)
2. Kinh doanh co duoc chon 0 ca trong 1 ngay khong? (Ngay nghi khong luong)
3. Ngay nghi le/phep: module rieng (Leave) hay config trong shift registration?
4. Check-in/check-out: chi can IP hay can them GPS geolocation?
5. Ai co quyen duyet phieu? Manager truc tiep hay ca Next Level Manager?
6. Sau khi duyet, co tinh nang xin sua + duyet lai khong?
7. Shift registration thay the toan bo lich cu hay chi la bo sung?
8. Export bao cao cham cong: CSV, Excel, hay PDF?
9. Facility co the co nhieu dia chi IP khong?
10. Co phan biet ca co dinh (fixed schedule) va dang ky linh hoat khong?

---

## 14. Summary of Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Form state management | useReducer | Centralized, testable, no stale closure |
| Shift Grid rendering | Custom ShiftGridTable | DataTable cannot host form controls |
| Mobile shift grid | Card-based list | Better UX than horizontal scroll |
| Date range pagination | 31 days/page | Natural month boundary, small DOM |
| Approval view | Modal with readonly grid | Reuses layout, contextual |
| Manager self-approval | Blocked at API + UI | Standard business rule |
| IP check | Client API on mount | Server enforces on mutation |
| Status display | StatusBadge from @cmc/ui | App-wide consistency |
| Filter + Search | FilterBar + DataTable | Reuses shared components |
| Hours calculation | Derived values (not in state) | Single source of truth |
| Readonly view | Same component, readonly prop | DRY principle |
