# Record-Detail & Calendar-View Primitives — Groundwork Report

**Status:** DONE  
**Scope:** Exact component shapes & dependencies for `record-detail.tsx` and `calendar-view.tsx`

---

## 1. StaffProfilePanel — Ideal Detail-Page Pattern

**File:** `apps/admin/src/staff-profile.tsx` (lines 300–528)

### Tabs Structure (Lines 474–481)
```tsx
<Tabs defaultValue="employment" variant="outline">
  <Tabs.List>
    <Tabs.Tab value="employment">Hồ sơ nhân sự</Tabs.Tab>
    {canPayroll && <Tabs.Tab value="payroll">Lương & phụ cấp</Tabs.Tab>}
  </Tabs.List>
  <Tabs.Panel value="employment" pt="md"><EmploymentTab user={view} /></Tabs.Panel>
  {canPayroll && <Tabs.Panel value="payroll" pt="md"><PayrollTab user={view} /></Tabs.Panel>}
</Tabs>
```
- **Gate tabs behind permissions:** `canPayroll` controls tab visibility, lazy-load data.
- **No accordion:** explicit choice per decision history (Tabs won over accordion; this file already ships it).
- **Tab panels lazy-render only when active** (built into Mantine Tabs).

### ActivityLog Wiring (Lines 262–297, 518–521)
```tsx
// In StaffActivityLog component:
<ActivityLog 
  entries={rows}
  loading={loading}
  fieldLabels={STAFF_FIELD_LABELS}
  formatValue={staffFormatValue}
/>

// Mounted in main panel right rail:
<Grid.Col span={{ base: 12, md: 4 }}>
  <StaffActivityLog userId={view.id} refreshKey={activityKey} />
</Grid.Col>
```
- **ActivityLog is entity-agnostic:** only takes entries, fieldLabels, formatValue.
- **Entity-specific fetch:** `StaffActivityLog` wrapper calls `trpc.audit.staffTimeline` (secure, facility-scoped).
- **Dedup via refreshKey:** when mutations save, `setActivityKey((k) => k + 1)` re-fetches.

### Hardcoded Staff Coupling (What Must Parameterize)

| Hardcoded | Needs Parameterizing |
|-----------|---------------------|
| `STAFF_FIELD_LABELS` (line 264) | → generic `fieldLabels` prop |
| `staffFormatValue()` (line 272) | → generic `formatValue` prop |
| `EmploymentTab`, `PayrollTab` components | → generic tab config array |
| Two Fieldsets: "Định danh", "Phân quyền" (lines 417–472) | → generic section config |
| Entity type for audit fetch (`'staff'` hardcoded in component name) | → pass `entityType: 'staff' \| 'student' \| ...` |
| Field visibility checks (`canEdit`, `canPayroll`, `canActivity`) | → per-entity permission rules in config |

### Layout Blueprint
```
Grid:
  Col span={8} (md breakpoint):
    Fieldset(custom fields)
    Fieldset(custom fields)
    Tabs(custom tab config)
  Col span={4}:
    ActivityLog (sticky, top: 12)
```

---

## 2. ActivityLog — Prop Contract (Canonical)

**File:** `packages/ui/src/activity-log.tsx` (lines 21–32)

```tsx
export interface ActivityLogProps {
  entries: ActivityEntry[];
  loading?: boolean;
  fieldLabels?: Record<string, string>;      // e.g. { 'displayName': 'Tên hiển thị' }
  formatValue?: (field: string, value: unknown) => string;
  eventLabels?: Record<string, string>;      // e.g. { 'created': 'đã tạo' }
  title?: string;                            // default: 'Nhật ký hoạt động'
  maxHeight?: number;                        // default: 420
}

export interface ActivityEntry {
  id: string;
  type: string;                              // 'created' | 'updated' | 'status_changed' | …
  body?: string | null;
  changes?: unknown;                         // Array<{ field, old, new }>
  actorName?: string | null;
  createdAt: string | Date;
}
```

**Key detail:** `changes` is server-side JSON; component filters no-op rows (X → X) automatically.

---

## 3. @mantine/dates — Calendar Capability Verdict

**Installed version:** `@mantine/dates@^7.15.2` (from `apps/admin/package.json` line 19)

### Available Components
- ✅ `Calendar` (base, for custom pickers)
- ✅ `DatePicker`, `DatePickerInput`
- ✅ `MiniCalendar`
- ✅ `TimePicker`, `TimeGrid`
- ❌ NO native `WeekView`, `MonthView`, `DayView`, `YearView` in v7

### Verdict: **Hand-Build Week/Month Grid**
- @mantine/dates lacks scheduling view components (MonthView/WeekView available only in separate Schedule extension, not in core v7).
- Matches original odoo-parity-ux-framework plan recommendation: "hand-built light grid over heavy dep."
- **Implementation scope:** `calendar-view.tsx` must compose Grid/Stack + date math (dayjs utility) to render week/month grids.
- **Reuse:** Mantine's `Grid`, `SimpleGrid`, `Badge`, `Group`, `ActionIcon` sufficient for navigation & cell layout.

---

## 4. Entity → Calendar Registry (First Consumers)

**File:** `apps/admin/src/view-defaults.ts` (lines 16–25)

| Entity | Default View | Allowed | Calendar? |
|--------|--------------|---------|-----------|
| `testAppointment` | calendar | [calendar, list] | ✅ |
| `scheduleSession` | calendar | [calendar, list] | ✅ |
| `parentMeeting` | calendar | [calendar, list] | ✅ |
| `attendance` | calendar | [calendar, list] | ✅ |
| `opportunity` | kanban | [kanban, list] | ❌ |
| `receipt` | list | [list, kanban] | ❌ |
| `payslip` | list | [list, kanban] | ❌ |
| `student` | list | [list, kanban] | ❌ |

**First 4 entities need `calendar-view.tsx`** once built.

---

## Summary: `record-detail.tsx` Interface Shape

```tsx
interface RecordDetailConfig {
  entityType: string;                         // 'staff' | 'student' | 'testAppointment' | …
  entityId: string | number;
  
  // Section configuration (replaces hardcoded Fieldsets)
  sections: {
    name: string;                             // 'Định danh' | 'Phân quyền'
    fields: Array<{
      key: string;                           // backend field name
      label: string;                         // human label
      type: 'text' | 'email' | 'select' | 'multiselect' | 'switch' | 'date';
      readOnly?: boolean;
      render?: (value: unknown) => React.ReactNode;
      validate?: (value: unknown) => string | null;
    }>;
    permission?: (session: Session) => boolean;
  }[];
  
  // Tab configuration (replaces hardcoded EmploymentTab/PayrollTab)
  tabs: Array<{
    value: string;
    label: string;
    permission?: (session: Session) => boolean;
    component: React.ComponentType<{ data: unknown }>;
  }>;
  
  // Activity log wiring
  activityLog?: {
    fetchEndpoint: (entityId: string) => Promise<ActivityEntry[]>;
    fieldLabels: Record<string, string>;
    formatValue?: (field: string, value: unknown) => string;
    title?: string;
  };
  
  // Batch mutations (replaces hardcoded save logic)
  onSave?: (changes: Record<string, unknown>) => Promise<void>;
  
  // Permission guards
  canRead?: (session: Session) => boolean;
  canEdit?: (session: Session) => boolean;
}

export function RecordDetailPanel({
  config: RecordDetailConfig,
  onBack: () => void,
}: {
  config: RecordDetailConfig;
  onBack: () => void;
}) { … }
```

---

## Unresolved Questions

1. **Batch mutation pattern:** Should `record-detail.tsx` handle mutation batching internally (like staff-profile's save() fn which gates on `rolesChanged`, `isActive !== view.isActive`, etc.), or assume caller manages?
   - *Impact:* Affects partial-save prevention design.

2. **Field rendering extensibility:** Beyond `type: 'text' | 'select' | …`, should sections allow custom `render()` for complex fields (e.g., facility MultiSelect with labels)?
   - *Impact:* Determines if EmploymentTab/PayrollTab stay as custom tabs or fold into sections.

3. **Calendar locale/week-start:** Should `calendar-view.tsx` accept `localeCode: 'en' | 'vi'` + `weekStartDay: 0 | 1` as props?
   - *Impact:* Affects dayjs usage & grid rendering.

4. **ActivityLog refresh strategy:** Auto-poll, WebSocket, or manual refetch-key (like staff-profile's refreshKey)?
   - *Impact:* Performance + real-time UX for multi-user scenarios.
