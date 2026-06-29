# Odoo UX Framework Research for CMCnew ERP

## Executive Summary

Odoo achieves **framework-level consistency** across modules (chatter, filters, view switching) by:
1. **Mail.thread mixin** — every traceable model inherits mail.thread, which auto-logs field changes via `tracking=True` + logs them as `mail.message` + `mail.tracking.value` rows
2. **Search views (XML)** — declare filters, group-by, facets, and defaults centrally in the model definition; applied at view-open
3. **View types (list, kanban, calendar, form)** — declared in model XML; view switcher built into the framework; first view in sequence is default
4. **Consistency by inheritance, not repetition** — no per-module code needed; framework provides the UI

CMCnew already has the **domain foundations** (RecordEvent, logEvent, staffTimeline, audit router) but lacks the **framework-level contracts** that would let EVERY module get logs + filters + views with minimal per-module code.

---

## 1. CHATTER / MAIL.THREAD — Activity Log (Odoo's Gold Standard)

### How Odoo Does It

**Model Definition (Odoo):**
```python
class SaleOrder(models.Model):
    _name = 'sale.order'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    
    status = fields.Selection(tracking=True)  # ANY field with tracking=True logs changes
    name = fields.Char(tracking=True)
    amount_total = fields.Float(tracking=True)
```

**What Gets Logged Automatically:**
- `mail.message` row: timestamps, author, message type (note/comment/system)
- `mail.tracking.value` rows: one per field change (field name, old→new, data type)
- `record_follower` rows: auto-follow when you post a note; @mentions for later
- Subtype system: `mail.message.subtype` classifies messages (e.g., `stock.mt_delivery_updated`)

**Chatter UI Shows:**
- Avatar + author name (resolved at render time, not stored)
- Relative timestamp ("2 hours ago")
- Event type label ("John updated", "Jane posted a note")
- Field changes grouped: "Status: draft → confirmed", "Amount: 100 → 150"
- Follower count + list (can @mention them)

### CMCnew Current State

✅ **Already built:**
- `RecordEvent` model with `type` (created|updated|status_changed|archived|restored|note), `changes[]`, `body`, `actorId`, `createdAt`
- `logEvent()` writer in `@cmc/audit` + `logStatusChange()` convenience
- `getTimeline()` query (newest-first) + follower system (`RecordFollower`)
- `audit.staffTimeline` endpoint (secure, facility-scoped) + `audit.timeline` (open, whitelisted by entity type)
- `ActivityLog` component in staff-profile.tsx (Timeline, field labels, change formatting)

⚠️ **Gaps:**
- **No per-module log display** — only staff.tsx + crm-detail render chatter. Finance/schedule/student don't surface their timelines.
- **No friendly field labels** — FIELD_LABEL is hardcoded in staff-profile.tsx, not derived from module metadata.
- **No value formatters** — changes show raw JSON; no "Mất → Đã duyệt" or money formatting per field.
- **No change grouping** — each change entry is separate; Odoo groups multiple changes in one message.
- **Followers feature exists but not UI-surfaced** — no "follow" / "add follower" buttons on detail pages.

### Translation to CMCnew (Recommended Primitives)

#### 1. **Reusable \<Chatter /> Component**

```typescript
// File: @cmc/ui/src/Chatter/Chatter.tsx
export interface ChatterProps {
  entityType: string;
  entityId: string;
  canPost?: boolean;
  fieldLabels?: Record<string, string>; // e.g., { status: "Trạng thái", amount: "Tổng tiền" }
  valueFormatters?: Record<string, (v: unknown) => string>; // Custom formatters per field
  activityLogStyle?: 'inline' | 'sidebar' | 'modal'; // Layout variant
}

export function Chatter({ entityType, entityId, canPost, fieldLabels = {}, valueFormatters = {} }: ChatterProps) {
  // Returns: Timeline + Note input (if canPost) + Followers list
  // Calls: audit.timeline (if not in NOTE_TARGETS) or audit.postNote/follow
}
```

**Usage in a detail page:**
```typescript
<Chatter
  entityType="opportunity"
  entityId={opportunityId}
  canPost={canReassign}
  fieldLabels={CRM_FIELD_LABELS}
  valueFormatters={CRM_FORMATTERS}
  activityLogStyle="sidebar"
/>
```

#### 2. **Per-Module Metadata (Hooks + Config)**

Export per module:
```typescript
// File: apps/admin/src/config/chatter-config.ts (or per-panel file)

export const CRM_FIELD_LABELS: Record<string, string> = {
  stage: 'Bước',
  lostReason: 'Lý do mất',
  closedAt: 'Đóng lúc',
  ownerId: 'Người phụ trách',
};

export const CRM_FORMATTERS: Record<string, (v: unknown) => string> = {
  stage: (v) => STAGES.find(s => s.value === v)?.label ?? String(v),
  closedAt: (v) => v ? new Date(v).toLocaleDateString('vi-VN') : 'Chưa',
  ownerId: (v) => v ? `ID: ${String(v).slice(0, 8)}…` : 'Chưa gán',
};

export const RECEIPT_FIELD_LABELS: Record<string, string> = {
  status: 'Trạng thái',
  studentId: 'Học sinh',
  approvedAt: 'Đã duyệt',
  amount: 'Tổng tiền',
};

export const RECEIPT_FORMATTERS: Record<string, (v: unknown) => string> = {
  amount: (v) => `${Number(v).toLocaleString('vi-VN')}đ`,
  status: (v) => RECEIPT_STATUS[v as string]?.label ?? String(v),
};
```

#### 3. **Contract for logEvent Callers**

Every module mutation should log with friendly field names (not raw DB columns):

```typescript
// In crm router, when marking lost:
await logEvent(tx, {
  facilityId: opp.facilityId,
  entityType: 'opportunity',
  entityId: opp.id,
  type: 'status_changed',
  changes: [{
    field: 'lostReason', // ← Use business field name, not column name
    old: null,
    new: input.reason
  }],
  body: input.note, // Optional note body
  actorId: ctx.session.userId,
});
```

**Consistency rule:** Field names in `changes[].field` must match the keys in that entity's FIELD_LABELS config.

---

## 2. SEARCH VIEW / FILTERS — Default Filter + Facets + Saved Views

### How Odoo Does It

**XML Model Definition:**
```xml
<record id="sale_order_view_search" model="ir.ui.view">
  <field name="model">sale.order</field>
  <field name="arch" type="xml">
    <search>
      <field name="name" string="Customer / Order #" />
      <field name="state" />
      <filter name="filter_draft" string="Draft" domain="[('state', '=', 'draft')]" />
      <filter name="filter_confirmed" string="Confirmed" domain="[('state', '=', 'confirmed')]" />
      <separator />
      <filter name="filter_unfulfilled" string="Not Shipped" domain="[('delivery_count', '=', 0)]" />
      <group expand="0" string="Group By">
        <filter name="group_by_state" string="Status" context="{'group_by': 'state'}" />
        <filter name="group_by_partner" string="Customer" context="{'group_by': 'partner_id'}" />
      </group>
    </search>
  </field>
</record>

<!-- Set default filter on open: -->
<field name="context">{'search_default_filter_draft': 1, 'group_by': 'state'}</field>
```

**What Happens:**
- User opens the list → default filter (draft) is applied
- Facets (filter buttons) appear at top: "Draft (5)", "Confirmed (3)", etc.
- "Group By" dropdown shows preset groupings
- User can save custom filter + name it ("My Overdue")
- Next time they open, "My Overdue" is one of the Favorites

**State in URL:** Odoo syncs filter state to URL so filters are sharable, bookmarkable, and browser-back-compatible.

### CMCnew Current State

⚠️ **Minimal / Ad-hoc Filters:**
- CRM panel: hardcoded `fullName`, `phone`, `program` as text inputs; no saved filters
- Finance panel: `selectedCourseId` for price history; no facets
- No search default context; no URL sync; no saved filter persistence
- Each panel re-implements filtering logic independently

### Translation to CMCnew (Recommended Primitives)

#### 1. **FilterBar Hook + Config**

```typescript
// File: @cmc/ui/src/FilterBar/useFilterBar.ts

export interface FilterConfig {
  searchFields?: { key: string; label: string; type: 'text' | 'select' | 'date' | 'number' }[];
  facets?: { 
    key: string; 
    label: string; 
    value: string | number; // The domain/where clause value
    countKey?: string; // If server returns counts per facet
  }[];
  savedFiltersKey?: string; // localStorage key for "Favorites"
  defaultFilter?: Record<string, unknown>; // Applied on mount
}

export interface FilterState {
  search?: Record<string, unknown>;  // Text inputs
  facets: string[];                   // Active facet keys
  groupBy?: string;
  savedViewName?: string | null;
  isModified: boolean;
}

export function useFilterBar(config: FilterConfig) {
  return {
    state: FilterState,
    apply: (newFilter: Partial<FilterState>) => void,
    clear: () => void,
    saveView: (name: string) => void,
    savedViews: { name: string; filter: FilterState }[],
    urlSync: boolean, // Auto-encode to URL
  };
}
```

**Usage in a list panel:**

```typescript
const filterConfig: FilterConfig = {
  searchFields: [
    { key: 'fullName', label: 'Tên liên hệ', type: 'text' },
    { key: 'phone', label: 'SĐT', type: 'text' },
    { key: 'studentName', label: 'Tên học sinh', type: 'text' },
  ],
  facets: [
    { key: 'stage_O1', label: 'Lead', value: 'O1_LEAD' },
    { key: 'stage_O2', label: 'Đã liên hệ', value: 'O2_CONTACTED' },
    { key: 'stage_O3', label: 'Đặt test', value: 'O3_TEST_SCHEDULED' },
  ],
  defaultFilter: { stage: 'O1_LEAD' }, // Applied on mount
  savedFiltersKey: 'crm_opp_views',
};

function CrmPanel() {
  const filter = useFilterBar(filterConfig);
  const facilityId = useFacilityId();
  
  useEffect(() => {
    // Translate filter state into tRPC input
    trpc.crm.opportunityList.query({
      facilityId,
      ...filter.state.search,
      stage: filter.state.facets.length ? filter.state.facets[0]?.split('_')[1] : undefined,
    }).then(setOpps);
  }, [filter.state, facilityId]);

  return (
    <>
      <FilterBar config={filterConfig} state={filter.state} onApply={filter.apply} />
      <DataTable data={opps} columns={oppColumns} />
    </>
  );
}
```

#### 2. **tRPC Input Convention (Pagination + Filtering)**

Standardize across all `list` procedures:

```typescript
// Schema: shared across modules
const ListInputBase = z.object({
  facilityId: z.number().int().positive(),
  skip: z.number().int().nonnegative().default(0),
  take: z.number().int().positive().max(100).default(20),
  search?: z.record(z.unknown()).optional(), // { fullName, phone, ... } — module-specific
  filters?: z.record(z.unknown()).optional(), // { stage, status, ... }
  groupBy?: z.string().optional(),
  sortBy?: z.string().default('-createdAt'), // "-" prefix = desc
});

// Per-module list procedures:
opportunityList: requirePermission('crm', 'opportunityList')
  .input(ListInputBase.extend({ 
    stage: z.string().optional(), 
    lostOnly: z.boolean().optional() 
  }))
  .query(({ ctx, input }) => /* ... */)

receiptList: requirePermission('finance', 'receiptList')
  .input(ListInputBase.extend({ 
    status: z.nativeEnum(ReceiptStatus).optional(),
    studentId: z.string().uuid().optional(),
  }))
  .query(({ ctx, input }) => /* ... */)
```

#### 3. **FilterBar UI Component**

```typescript
// File: @cmc/ui/src/FilterBar/FilterBar.tsx
export function FilterBar({ 
  config: FilterConfig, 
  state: FilterState, 
  onApply: (newState: FilterState) => void 
}) {
  return (
    <Group mb="md">
      {/* Search inputs */}
      {config.searchFields?.map(field => (
        <SearchInput key={field.key} {...field} />
      ))}
      
      {/* Facet buttons */}
      <Group gap="xs">
        {config.facets?.map(facet => (
          <Button 
            key={facet.key}
            variant={state.facets.includes(facet.key) ? 'filled' : 'light'}
            onClick={() => onApply({ ...state, facets: [facet.key] })}
          >
            {facet.label}
          </Button>
        ))}
      </Group>

      {/* Saved views / Favorites */}
      <Select 
        placeholder="Lưu chế độ xem"
        data={savedViews}
        onChange={(name) => onApply(savedViews.find(v => v.name === name)?.filter)}
      />
      
      {/* Group By */}
      <Select 
        placeholder="Nhóm theo"
        data={config.facets.map(f => ({ label: f.label, value: f.key }))}
        value={state.groupBy}
        onChange={(v) => onApply({ ...state, groupBy: v })}
      />

      {/* Clear / Reset */}
      {state.isModified && <Button variant="subtle" onClick={() => onApply(config.defaultFilter)}>Đặt lại</Button>}
    </Group>
  );
}
```

---

## 3. VIEW TYPES + SWITCHER — List, Kanban, Calendar, Form

### How Odoo Does It

**Model Definition (Odoo):**
```python
class SaleOrder(models.Model):
    _name = 'sale.order'
    
    @api.model
    def action_get_form_view_id(self):
        # Optionally return a specific form view ID
        return self.env.ref('sale.view_order_form').id

# In action (ir.actions.act_window):
<field name="view_ids" 
        eval="[(5, 0, 0),
               (0, 0, {'view_mode': 'kanban', 'view_id': ref('view_sale_kanban')}),
               (0, 0, {'view_mode': 'list', 'view_id': ref('view_sale_list')}),
               (0, 0, {'view_mode': 'form', 'view_id': ref('view_sale_form')})]" />
```

**What Happens:**
- First view in sequence is default (kanban here)
- View switcher appears at top-right: buttons to toggle list/kanban/form
- Clicking a record opens form
- Form "Back" button returns to active view type (not list)

### CMCnew Current State

⚠️ **Per-Panel UI Shapes:**
- CRM panel: DataTable (list view) + modals for form detail
- Finance panel: Table + modal for price/voucher form
- Payroll panel: Table
- Schedule panel: Possibly calendar-like (not reviewed here)
- **No view switcher concept** — each panel is a single fixed view type

### Translation to CMCnew (Recommended Primitives)

#### 1. **ViewSwitcher Component + Hook**

```typescript
// File: @cmc/ui/src/ViewSwitcher/useViewSwitcher.ts

export type ViewMode = 'list' | 'kanban' | 'calendar' | 'form';

export interface ViewConfig {
  availableModes: ViewMode[];
  defaultMode: ViewMode;
  persistKey?: string; // localStorage to remember user's last choice
}

export function useViewSwitcher(config: ViewConfig) {
  const [activeMode, setActiveMode] = useState<ViewMode>(config.defaultMode);
  
  useEffect(() => {
    // Load from localStorage if available
    if (config.persistKey) {
      const saved = localStorage.getItem(config.persistKey) as ViewMode | null;
      if (saved && config.availableModes.includes(saved)) {
        setActiveMode(saved);
      }
    }
  }, []);

  const switchTo = (mode: ViewMode) => {
    if (config.availableModes.includes(mode)) {
      setActiveMode(mode);
      if (config.persistKey) localStorage.setItem(config.persistKey, mode);
    }
  };

  return { activeMode, switchTo };
}
```

**Usage:**
```typescript
function CrmPanel() {
  const view = useViewSwitcher({
    availableModes: ['kanban', 'list', 'form'],
    defaultMode: 'kanban',
    persistKey: 'crm_opp_view_mode',
  });

  return (
    <>
      <ViewSwitcher 
        modes={['kanban', 'list']} 
        active={view.activeMode} 
        onChange={view.switchTo}
      />
      {view.activeMode === 'kanban' && <KanbanBoard {...} />}
      {view.activeMode === 'list' && <OpportunityTable {...} />}
      {view.activeMode === 'form' && <OpportunityForm {...} />}
    </>
  );
}
```

#### 2. **ViewSwitcher UI Component**

```typescript
// File: @cmc/ui/src/ViewSwitcher/ViewSwitcher.tsx
export function ViewSwitcher({ 
  modes: ViewMode[], 
  active: ViewMode, 
  onChange: (mode: ViewMode) => void,
  icons?: Record<ViewMode, ReactNode>,
}) {
  const defaultIcons = {
    list: <IconList />,
    kanban: <IconLayout />,
    calendar: <IconCalendar />,
    form: <IconForm />,
  };

  return (
    <Group gap="xs">
      {modes.map(mode => (
        <Button 
          key={mode}
          variant={active === mode ? 'filled' : 'light'}
          size="sm"
          leftSection={icons?.[mode] ?? defaultIcons[mode]}
          onClick={() => onChange(mode)}
        >
          {mode.charAt(0).toUpperCase() + mode.slice(1)}
        </Button>
      ))}
    </Group>
  );
}
```

#### 3. **Per-Module View Configuration**

```typescript
// File: apps/admin/src/config/view-defaults.ts

export const VIEW_DEFAULTS: Record<string, ViewMode> = {
  // CRM: kanban is best for pipeline visibility (drag-drop stage movement)
  'crm.opportunity': 'kanban',
  'crm.contact': 'list',
  'crm.test_appointment': 'calendar', // Show scheduled tests on calendar
  
  // Finance: list for ledgers, kanban for receipts (grouped by status)
  'finance.receipt': 'kanban',
  'finance.income_ledger': 'list',
  
  // Schedule: calendar is primary
  'schedule.session': 'calendar',
  'schedule.slot': 'list',
  
  // HR / Payroll: list
  'payroll.payslip': 'list',
  'payroll.employment_profile': 'list',
  
  // Students: list (searchable) or kanban (by program)
  'student.record': 'list',
  'student.account': 'list',
};
```

---

## 4. REUSABILITY + CONSISTENCY — Making Modules Low-Code

### The Odoo Pattern: Framework Does the Work

**Odoo's approach:**
- Define model with `_inherit = ['mail.thread']` → get chatter for free
- Add `tracking=True` to fields → auto-log to chatter
- Define search view XML → filters appear for free
- Set `view_ids` in action → view switcher works for free

**Per-module code:** ~10 lines XML. Chatter + filters + views are framework-provided.

### CMCnew's Challenge

Currently, chatter/filters/views are **hand-rolled per panel.** To reach Odoo parity, CMCnew should:

#### Phase 1: Establish Primitives (Next Sprint)

1. **Extract ActivityLog → Chatter component** (already mostly done)
   - Make it reusable with `fieldLabels` + `valueFormatters` props
   - Surface on all detail pages (opportunity, receipt, student, schedule, etc.)
   - Add follow/post UI

2. **Create FilterBar + Config system**
   - Standard tRPC input shape (search, filters, groupBy, pagination)
   - useFilterBar hook + UI component
   - Per-module filter configs (facets, search fields, defaults)

3. **Add ViewSwitcher** (smallest lift)
   - useViewSwitcher hook + UI component
   - View mode persistence (localStorage)
   - Per-module default view table

#### Phase 2: Adopt Across Modules (2–3 sprints)

For each module (CRM, Finance, Schedule, Payroll, Students):
- Add module filter config (5 min)
- Add Chatter to detail page (2 min, copy-paste from another panel)
- Switch list → ViewSwitcher + conditional renders (10 min)
- Standardize tRPC list inputs (per-router, 10 min)

**Effort: ~1 hour per module, once primitives are built.**

---

## 5. Recommended Primitive Set (Component/Hook/Server Contracts)

### Summary Table

| Layer | Primitive | File Location | Responsibility |
|-------|-----------|---|---|
| **Component** | `<Chatter />` | `@cmc/ui/Chatter/Chatter.tsx` | Timeline + note input + followers, configurable labels/formatters |
| **Hook** | `useTimeline()` | `@cmc/ui/Chatter/useTimeline.ts` | Fetch & refetch timeline, manage followers |
| **Hook** | `useFilterBar()` | `@cmc/ui/FilterBar/useFilterBar.ts` | Manage filter state, URL sync, saved views (localStorage) |
| **Component** | `<FilterBar />` | `@cmc/ui/FilterBar/FilterBar.tsx` | Render search inputs + facet buttons + group-by + save view |
| **Hook** | `useViewSwitcher()` | `@cmc/ui/ViewSwitcher/useViewSwitcher.ts` | Manage active view mode, persistence |
| **Component** | `<ViewSwitcher />` | `@cmc/ui/ViewSwitcher/ViewSwitcher.tsx` | Render view mode buttons (list/kanban/calendar/form) |
| **Config** | Module filter configs | Per-module (e.g., `crm-config.ts`) | Field labels, value formatters, facet defs, defaults |
| **Config** | Module view defaults | `apps/admin/src/config/view-defaults.ts` | Which view is default per entity type |
| **Server** | Standard list input | All routers (via Zod schema) | `{ facilityId, skip, take, search?, filters?, groupBy?, sortBy? }` |
| **Server** | Timeline endpoint | `audit.timeline` (whitelist by entity type) | Already exists; just needs Chatter component to call it |
| **Server** | Followers endpoint | `audit.followers` + `audit.follow` | Already exists; just needs Chatter component UI |

---

## 6. Per-Module Defaults (Proposed)

Based on CMCnew's known modules:

| Module | Entity Type | Default View | Secondary Views | Facets / Default Filter |
|--------|------------|---|---|---|
| **CRM** | `opportunity` | kanban | list, form | Stage facets (O1–O5), default to O1_LEAD or open only |
| **CRM** | `contact` | list | kanban, form | None / search by name+phone |
| **CRM** | `test_appointment` | calendar | list, form | Status facets (scheduled, done, no_show) |
| **Finance** | `receipt` | kanban | list, form | Status facets (draft, approved, sent, reconciled, cancelled) |
| **Finance** | `income_ledger` | list | kanban | Category facets, date range filter |
| **Schedule** | `session` (class meeting) | calendar | list, form | Day-of-week grouping, default to this week |
| **Payroll** | `payslip` | list | kanban (by period) | Period facets (current month, prev, etc.) |
| **Payroll** | `employment_profile` | list | form | Status facets (active, inactive) |
| **Student** | `student` (record) | list | kanban (by program/level), form | Lifecycle facets (active, completed, withdrawn) |
| **KPI** | `kpi_evaluation` | list | form | Period facets, status facets |

---

## 7. Implementation Workflow

### Sprint 1: Primitives

**PR 1 — Chatter Component:**
- Extract ActivityLog → reusable Chatter in @cmc/ui
- Add `fieldLabels`, `valueFormatters`, `canPost` props
- Surface on staff-profile.tsx (no breaking changes)
- Test with audit.staffTimeline

**PR 2 — FilterBar Primitives:**
- Create useFilterBar hook + FilterBar UI component in @cmc/ui
- Standardize tRPC list input schema (copy to each router that needs it)
- Test with CRM opportunity list (swap out manual filter state)

**PR 3 — ViewSwitcher + Defaults:**
- Create useViewSwitcher hook + ViewSwitcher component in @cmc/ui
- Create view-defaults config
- Test with CRM panel (kanban + list + form)

### Sprint 2+: Rollout per Module

For each of CRM, Finance, Schedule, Payroll, Students:
- Add module filter config (5 min)
- Add Chatter to detail page + whitelist entity in NOTE_TARGETS (5 min)
- Swap list view → ViewSwitcher + conditional renders (10 min)
- Test and PR

---

## 8. Flagged Unverified Questions

1. **Odoo Discuss/Follower visibility** — how does @mention work? Is it part of the core mail.message or a separate feature? *Not researched.*

2. **Kanban view implementation in React** — Odoo uses Owl (custom framework) with drag-drop built-in. What's CMCnew's kanban strategy (Mantine Sortable, dnd-kit, etc.)? *Not researched.*

3. **Calendar view for schedule** — Should sessions/meetings be draggable to reschedule? Odoo allows this. *Not researched.*

4. **Search context merging** — If a user opens CRM filtered to stage O1, then switches view to kanban, does the filter persist? Odoo does. Need URL sync or state preservation strategy. *Assumed useFilterBar handles this.*

5. **Facet counts** — Odoo shows counts next to facets ("Draft (5)"). Should CMCnew compute these server-side or client-side? *Not researched.*

6. **View-specific filtering** — Should list and kanban views have different filter defaults? (E.g., kanban only shows open opportunities, list shows all.) *Not researched.*

7. **Permission gating per view** — Can a user have "read list view but not kanban view"? *Not researched; assumed all views have same permissions as parent entity.*

8. **Saved filter persistence layer** — Should saved filters be user-scoped in the DB or just localStorage? Odoo stores in DB. *Assumed localStorage for MVP.*

---

## Sources

- [Odoo mail.thread & tracking — Official docs](https://www.odoo.com/documentation/19.0/developer/reference/backend/models.html) (tested via forum + source inspection)
- [Odoo views architecture — Official docs](https://www.odoo.com/documentation/19.0/developer/reference/user_interface/view_architectures.html)
- [Odoo search/filter/group defaults — Official docs](https://www.odoo.com/documentation/19.0/applications/essentials/search.html)
- [Odoo Owl components — Official tutorial](https://www.odoo.com/documentation/19.0/developer/reference/frontend/owl_components.html)
- [CMCnew audit module](file:///D:/project/CMCnew/packages/audit/src/index.ts)
- [CMCnew audit router](file:///D:/project/CMCnew/apps/api/src/routers/audit.ts)
- [CMCnew staff-profile.tsx (ActivityLog example)](file:///D:/project/CMCnew/apps/admin/src/staff-profile.tsx)
- [CMCnew crm-panel.tsx (list/modal pattern)](file:///D:/project/CMCnew/apps/admin/src/crm-panel.tsx)
- [React design patterns 2025 — TelerikBlogs, HarnessBlog](https://www.telerik.com/blogs/react-design-patterns-best-practices)
