# Odoo Form View & OpenEduCat Record-Page Layout Spec

**Purpose:** Ground CMCnew staff record page redesign in Odoo conventions (React+Mantine).  
**Sources:** Odoo 19.0 official docs, Odoo 17.0 docs, Chatter docs, OpenEduCat reference.  
**Scope:** Form anatomy, Edit/Save model, permission-gated readonly, responsive layout.

---

## 1. Odoo Form View Anatomy

### Structure Layers (Standard)

```
┌─────────────────────────────────────────────┐
│ HEADER (with STATUSBAR widget)              │
│ [Action Buttons] | [Status: Draft/Active]   │
├─────────────────────────────────────────────┤
│                                              │
│  SHEET (centered, responsive layout)         │
│  ┌──────────────────────────────────────┐   │
│  │ GROUP 1                   GROUP 2    │   │
│  │ field_a       label_a     field_b    │   │
│  │ field_c       label_c     field_d    │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  NOTEBOOK (tabs for secondary data)          │
│  ├─ Tab 1 (Personnel)                        │
│  │  ├─ Sub-group: Education, Certifications │
│  │  └─ Sub-group: Skills                    │
│  ├─ Tab 2 (Attendance)                       │
│  ├─ Tab 3 (Finance)                          │
│  └─ Tab 4 (Notes)                            │
│                                              │
└─────────────────────────────────────────────┘

WIDE SCREEN (≥768px):
┌──────────────────────────┬──────────────────┐
│      SHEET + NOTEBOOK    │   CHATTER PANE   │
│ (Sheet above, Tabs below)│  (right sidebar) │
│                          │                  │
│                          │ • Followers list │
│                          │ • Message thread │
│                          │ • Activity log   │
│                          │ • Field changes  │
└──────────────────────────┴──────────────────┘

NARROW SCREEN (<768px):
┌──────────────────────────┐
│      SHEET + NOTEBOOK    │
│                          │
│                          │
│                          │
├──────────────────────────┤
│      CHATTER PANE        │
│     (below content)      │
│                          │
└──────────────────────────┘
```

### Component Details

**Header & Statusbar**
- Contains action buttons (Create, Edit, Delete, Custom Actions)
- Statusbar widget displays current state/workflow (Draft → Submitted → Approved)
- Read-only display of state; transitions via buttons

**Sheet**
- Main content container; provides responsive centering and margins
- Acts as boundary for the primary data entry area
- Uses two-column grid layout via `<group>` elements

**Groups (Field Layout)**
- Immediate children of sheet: typically 1–2 visible groups per row
- Each group is ~48% width; fills remaining space responsively
- Nested groups inside a tab provide sub-structure (e.g., Education vs. Skills)
- Fieldnames and labels auto-layout as columns

**Notebook (Tabs)**
- Secondary data sections (not shown on first load)
- Each `<page>` is a labeled tab
- Common pattern: Personnel → Attendance → Finance → Notes
- Lazy-loads content when tab is clicked

**Chatter**
- Mail.thread widget: requires model to inherit `mail.thread` mixin
- Rendered as `<div class="oe_chatter">` containing `message_ids` + `message_follower_ids` fields
- Includes:
  - **Follower list** (top-right of chatter) — users automatically notified of changes
  - **Message thread** — internal notes (staff-only) and customer messages (external)
  - **Activity log** — system-recorded changes (timestamps, field-change history)
  - **Attachment preview** — inline file manager
- Position: right sidebar on wide screens (≥768px); collapses below sheet on narrow screens
- Responsive: chatter width 1/3 on desktop, full-width on mobile

---

## 2. Edit / Save / Discard Model

### Historical Pattern (Odoo ≤14)
- Record opens **read-only** with an "Edit" button in the header
- Click "Edit" → all fields become editable; "Save" and "Discard" appear in header
- "Save" → commits to DB; "Discard" → reverts to last-saved state without committing
- Clear intent: user must explicitly initiate edit mode

### Modern Pattern (Odoo ≥15)
- Record opens **directly editable** (if user has write access)
- Dirty-state detection: Save/Discard breadcrumb appears in top-left or header when form has unsaved changes
- Save → commits to DB; Discard → reverts to last-saved state in-place
- "Edit" button may still exist as a fallback toggle for highly sensitive records

### Recommendation for CMCnew (Internal Permission-Gated Tool)

**Use the Modern Pattern (Direct-Edit) if:**
- Staff record owner or HR manager
- Usage is internal (trusted users)
- Dirty-state UX is acceptable (visual cue when changes exist)

**Use the Historical Pattern (Edit Button) if:**
- Record is sensitive (e.g., salary, SSN, identity data)
- Multiple roles review before committing
- Explicit mode-switch feels safer for compliance

**Decision:** For a permission-gated internal ERP, the direct-edit pattern (Odoo ≥15) is simpler and fits modern UX. Readonly fields enforce granularity; the "Edit" button is unnecessary if the form respects field-level write permissions (see §3).

---

## 3. Permission-Gated Readonly Fields

### Pattern: Odoo Access Rights + Readonly Attrs

Odoo gates field editability through two layers:

1. **Access Rights (Group-Level)**
   - Admin → Settings > Users & Companies > Groups
   - Each group gets "read" and "write" access to a model
   - If user lacks "write" access to `hr.employee`, **entire form becomes readonly**
   - Example: `hr.group_hr_user` can read employee records; only `hr.group_hr_manager` can write

2. **Field-Level Readonly (Via Form View Attrs)**
   - Within a form view, a `<field>` can set `readonly="1"` unconditionally
   - Conditional readonly via `attrs`: `<field name="salary" attrs="{'readonly': [('state', '!=', 'draft')]}"/>`
   - Groups can also gate visibility: `<field name="ssn" groups="hr.group_hr_manager"/>`

### Recommended Implementation for CMCnew

```xml
<!-- Staff record form view -->
<form>
  <header>
    <button string="Archive" name="action_archive" type="object"/>
    <statusbar widget="statusbar" statusbar_visible="active,inactive"/>
  </header>
  <sheet>
    <group>
      <!-- Name and basic info: editable by any HR user -->
      <field name="name"/>
      <field name="email"/>
      
      <!-- Sensitive fields: readonly unless HR manager -->
      <field name="ssn" groups="hr.group_hr_manager"/>
      <field name="identity_type" groups="hr.group_hr_manager"/>
    </group>
    
    <!-- Salary tab: hidden from non-managers -->
    <notebook>
      <page string="Finance" groups="hr.group_hr_manager">
        <group>
          <field name="salary_base"/>
          <field name="salary_variable"/>
        </group>
      </page>
    </notebook>
  </sheet>
  
  <!-- Chatter: visible to all, logged changes visible to managers only via record rules -->
  <div class="oe_chatter">
    <field name="message_ids" widget="mail_thread" options="{'post_refresh': 'recipients'}"/>
    <field name="message_follower_ids" widget="mail_followers"/>
  </div>
</form>
```

### Key Points
- **Form-level:** If user has no write access, entire form is readonly (no Save button appears)
- **Field-level:** `readonly="1"` or `attrs` prevent editing a specific field (visual grayout)
- **Group visibility:** `groups="..."` hides entire field/section from unauthorized users
- **Chatter access:** Followers and messages are always visible; record rules can hide activity logs for non-managers

---

## 4. OpenEduCat (Education Vertical) — Staff Record

OpenEduCat reuses Odoo's standard form + chatter; no custom layout. Staff records include:

- **Base fields:** Name, email, phone, identity, address (inherited from `res.partner`)
- **HR link:** `employee_id` field pointing to `hr.employee` (allows payroll, attendance tracking)
- **Faculty-specific:** Department, qualification, certifications, skills (via notebook tabs)
- **Chatter:** Standard mail.thread; logs grade uploads, course assignments, performance notes
- **Permission model:** Faculty manager can edit; teaching staff can view own record and update profile picture only

**Notable:** OpenEduCat does not introduce custom form patterns; it extends Odoo's HR module with education-specific fields (e.g., `subject_ids`, `class_ids`) in the same sheet/notebook/chatter structure. A staff record page in OpenEduCat looks identical to an Odoo HR Employee form, with added education tabs.

---

## 5. Responsive Behavior

### Desktop (≥768px, ~1200px typical)
- **Layout:** Two-column grid
  - **Left column (2/3 width):** Sheet + Notebook
  - **Right column (1/3 width):** Chatter pane (sticky sidebar)
- **Chatter:** Always visible; scrolls independently
- **Buttons:** Header buttons in top row; statusbar on same line (or below buttons on narrow headers)

### Tablet (768px–1024px)
- **Layout:** Single column, chatter below content
- **Chatter:** Full-width, below sheet + notebook
- **Buttons:** Stack or wrap based on header width
- **Groups:** Two columns per group (same as desktop)

### Mobile (<768px)
- **Layout:** Single column
- **Groups:** Single column per group (stacked fields)
- **Chatter:** Below content, full-width, compact message list
- **Buttons:** Vertical stack in header
- **Statusbar:** Wraps onto next line if needed

### CSS Breakpoints (Odoo Standard)
- Chatter: Media query `@media (max-width: 768px)` switches `position: absolute; right: 0;` to `position: static; width: 100%;`
- Groups: `grid-template-columns: auto auto;` (desktop) → `grid-template-columns: auto;` (mobile)
- Header: `flex-wrap: wrap;` on smaller screens

---

## Mantine Translation Guide

For a React+Mantine implementation:

| Odoo Component | Mantine Equivalent | Notes |
|---|---|---|
| `<header>` + statusbar | `<Group pos="relative" p="md">` + custom Status Badge | Use `Grid.Col` for layout |
| `<sheet>` | `<Container size="lg" p="md">` or `<Stack>` | Provides centered, max-width container |
| `<group>` (2-col layout) | `<Grid cols={2}>` or `<SimpleGrid cols={2}>` | Responsive: `cols={{base: 1, sm: 2}}` |
| `<notebook>` | `<Tabs>` component | Lazy-load content per tab |
| `<field>` | `<TextInput>`, `<Select>`, etc. | Apply `readOnly` prop based on permission |
| `<div class="oe_chatter">` | `<Stack>` with custom Message/Activity components | Render follower list, message thread, activity log |
| Responsive chatter placement | Use `<Grid>` with `span={{base: 12, md: 8}}` (content) + `span={{base: 12, md: 4}}` (chatter) | Breaks to full-width on mobile |

### Header/Statusbar Example (Mantine)
```tsx
<Group pos="relative" justify="space-between" p="md" bg="gray.0" border="1px solid" borderColor="gray.2">
  <Group>
    <Button>Edit</Button>
    <Button color="red" variant="subtle">Delete</Button>
  </Group>
  <Badge color={status === 'active' ? 'green' : 'gray'}>{status}</Badge>
</Group>
```

### Sheet Layout (Mantine)
```tsx
<Container size="lg" p="lg">
  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
    <TextInput label="Name" readOnly={!canEdit} />
    <TextInput label="Email" readOnly={!canEdit} />
  </SimpleGrid>
  
  <Tabs mt="lg">
    <Tabs.Tab label="Personnel">
      {/* content */}
    </Tabs.Tab>
    <Tabs.Tab label="Finance">
      {/* content */}
    </Tabs.Tab>
  </Tabs>
</Container>
```

### Responsive Chatter (Mantine)
```tsx
<Grid mt="lg">
  <Grid.Col span={{ base: 12, md: 8 }}>
    {/* Sheet + Notebook */}
  </Grid.Col>
  <Grid.Col span={{ base: 12, md: 4 }}>
    {/* Chatter: Message Thread, Followers, Activity */}
  </Grid.Col>
</Grid>
```

---

## Summary: Concrete Spec for Frontend Dev

### Required Zones
1. **Header** (sticky): Action buttons + Status badge
2. **Sheet** (centered max-width): Two-column field layout
3. **Notebook** (below sheet): Tabbed secondary data
4. **Chatter** (right sidebar on desktop, below on mobile): Followers + Messages + Activity
5. **Dirty-state UI** (top-left or breadcrumb): "Save" / "Discard" when form has unsaved changes

### Permission Rules
- **Form-level:** If user has no `write` ACL on model → entire form `readOnly` (no save button)
- **Field-level:** Field with `readonly="1"` attr or restricted by `groups` → disabled UI (grayed out)
- **Chatter:** Always visible; activity log filtered by record rules (staff see own changes, managers see all)

### Responsive Breakpoints
- Desktop (≥768px): 2/3 content col + 1/3 chatter sidebar
- Mobile (<768px): Full-width content, chatter below

### Validation Gate: Not Covered in This Research
- Form validation rules, custom validators, computed fields (deferred to CMCnew spec docs)
- Data persistence layer (API contract, mutation pattern)
- Notification/refresh on follower comment (assume WebSocket or polling)

---

## Sources Consulted

1. [Odoo 19.0 View Architectures](https://www.odoo.com/documentation/19.0/developer/reference/user_interface/view_architectures.html) — Form structure, sheet, groups, notebook, chatter placement
2. [Odoo 19.0 Chatter Documentation](https://www.odoo.com/documentation/19.0/applications/productivity/discuss/chatter.html) — Followers, messages, activity tracking, mail.thread
3. [Odoo Forum: Access Rights & Readonly Fields](https://www.odoo.com/forum/help-1/readonly-field-238430) — Group-based field readonly pattern
4. [Odoo Forum: Edit/Save/Discard Button Control](https://www.odoo.com/forum/help-1/cant-remove-save-and-discard-button-in-form-view-119445) — Button visibility and form modes
5. [OpenEduCat Documentation (Odoo 18.0)](https://doc.openeducat.org/) — Education vertical reference; employee/staff record structure
6. [Odoo Forum: Chatter Positioning](https://www.odoo.com/forum/help-1/how-to-hide-or-re-position-the-chatter-pane-170829) — Responsive chatter layout (sidebar vs. below)

---

## Unresolved Questions

1. **Chatter-only access rules:** Can a follower be restricted (e.g., "Staff A can see messages on Staff B's record only if they share a class")? Not documented; likely requires custom record rules + Chatter access filtering via API.
2. **Edit/Save paradigm in CMCnew:** Should staff records use "Edit" button (historical, safer) or direct-edit (modern, simpler)? Recommend direct-edit with field-level readonly, but user preference needed.
3. **Offline-first form state:** Should CMCnew cache unsaved changes (PWA pattern) or require live connection? Out of scope; Odoo does not offer offline form state.
4. **OpenEduCat staff custom fields:** Does OpenEduCat add education-specific fields to the staff record (e.g., teacher certifications) or does it live in a separate Faculty module? Documentation references "Faculty" but examples show HR Employee. Recommend auditing OpenEduCat GitHub repo directly if this boundary matters.

