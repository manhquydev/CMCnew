# CMCnew Design System

Apple-inspired minimalism adapted for ERP density. Single interactive blue, flat surfaces, extreme whitespace, system typography.

**Stack:** Mantine v7 + CSS custom properties (`@cmc/ui/tokens.css`)  
**Reference:** `packages/ui/src/tokens.css`, `packages/ui/src/theme.ts`

---

## Philosophy

| Apple principle | ERP adaptation |
|----------------|----------------|
| Extreme whitespace | Breathable density — tables readable, not cramped |
| Single blue for all interaction | Same: `#0071E3` for every clickable element |
| Flat surfaces, no card shadow | Subtle border + `xs` shadow, no decorative depth |
| Typography carries hierarchy | Column headers in uppercase 11px, data in 13px |
| Pill CTAs | Pill for primary buttons only; secondary = text link |

---

## Color Tokens

### Brand

| Token | Value | Use |
|-------|-------|-----|
| `--cmc-brand` | `#0071E3` | Links, CTA buttons, active nav, focus rings |
| `--cmc-brand-hover` | `#0055C6` | Hover / pressed state on brand elements |
| `--cmc-brand-muted` | `#E8F1FC` | Selected row bg, tinted section bg |
| `--cmc-brand-ink` | `#003D99` | Text on brand-muted bg (contrast ≥ 4.5:1) |

### Text

| Token | Value | Use |
|-------|-------|-----|
| `--cmc-text` | `#1D1D1F` | Headings, primary body |
| `--cmc-text-2` | `#3C3C43` | Secondary body, form labels |
| `--cmc-text-muted` | `#6E6E73` | Captions, meta, table column headers |
| `--cmc-text-faint` | `#AEAEB2` | Placeholder, disabled text |

### Surfaces

| Token | Value | Use |
|-------|-------|-----|
| `--cmc-bg` | `#F5F5F7` | Page background |
| `--cmc-surface` | `#FFFFFF` | Cards, panels, modals |
| `--cmc-surface-2` | `#F9F9FB` | Alternating table rows, nested sections |
| `--cmc-surface-dark` | `#1D1D1F` | Dark hero areas (rarely used in ERP) |

### Borders

| Token | Value | Use |
|-------|-------|-----|
| `--cmc-border` | `#D2D2D7` | Default input borders, card borders |
| `--cmc-border-focus` | `#0071E3` | Focused input ring |
| `--cmc-border-faint` | `#E8E8ED` | Subtle row dividers inside cards |

### Semantic / Status

| Token | Bg token | Text token | Use |
|-------|----------|------------|-----|
| `#34C759` ok | `--cmc-ok-bg` `#F0FBF3` | `--cmc-ok-text` `#1A6B34` | Success, active |
| `#FF9F0A` warn | `--cmc-warn-bg` `#FFF8EC` | `--cmc-warn-text` `#7A4A00` | Pending, warning |
| `#FF3B30` danger | `--cmc-danger-bg` `#FFF0EF` | `--cmc-danger-text` `#C0160D` | Error, rejected |
| `#0071E3` info | `--cmc-info-bg` `#E8F1FC` | `--cmc-info-text` `#003D99` | Info, draft |

**Rule:** Status always includes icon + color. Never color-only (WCAG 1.4.1).

### Status Dot Colors (kanban, table chips)

```
--cmc-status-active:   #34C759   active / approved
--cmc-status-pending:  #FF9F0A   pending / in-review
--cmc-status-inactive: #AEAEB2   inactive / archived
--cmc-status-rejected: #FF3B30   rejected / error
--cmc-status-draft:    #6E6E73   draft / unknown
```

---

## Typography

**Font stack:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`  
Renders as SF Pro on Apple devices, Segoe UI on Windows — no Google Fonts dependency.

### Scale

| Token | Size | Weight | Use |
|-------|------|--------|-----|
| `--cmc-text-xs` | 11px | 600 | Table column headers (uppercase), badge labels |
| `--cmc-text-sm` | 13px | 400 | Table cells, captions, metadata |
| `--cmc-text-base` | 15px | 400 | Default body text, form inputs |
| `--cmc-text-md` | 17px | 400–500 | Form labels, list items |
| `--cmc-text-lg` | 20px | 600 | Card titles, section headings |
| `--cmc-text-xl` | 24px | 600 | Page titles |
| `--cmc-text-2xl` | 28px | 700 | Dashboard H1 |
| `--cmc-text-3xl` | 34px | 700 | KPI values, hero numbers |

### Mantine heading map

```
h1 → 28px / 700   page titles
h2 → 22px / 600   section headings
h3 → 18px / 600   card headings
h4 → 15px / 600   sub-sections, form group labels
h5 → 13px / 600   small labels
h6 → 11px / 600   column headers (combine with uppercase + tracking)
```

### Rules

- Max two weight levels per view (400 body + 600 heading)
- Table column headers: `text-xs`, `font-semibold`, `uppercase`, `tracking-[0.04em]`, `text-muted`
- KPI numbers: `text-3xl`, `font-bold`, tabular figures (`font-variant-numeric: tabular-nums`)

---

## Spacing

8px base grid. Tighter tokens for data density, looser for page sections.

| Token | Value | Use |
|-------|-------|-----|
| `--cmc-space-1` | 4px | Icon–label gap, badge padding |
| `--cmc-space-2` | 8px | Button inner pad, compact row pad |
| `--cmc-space-3` | 12px | Table cell padding, input padding |
| `--cmc-space-4` | 16px | Standard gap, card header padding |
| `--cmc-space-5` | 24px | Card padding, sidebar item spacing |
| `--cmc-space-6` | 32px | Large card padding, modal body |
| `--cmc-space-7` | 48px | Section spacing (compact) |
| `--cmc-space-8` | 64px | Section spacing (standard) |
| `--cmc-space-9` | 96px | Page-level separation |

**Mantine spacing map:** `xs=4 sm=8 md=12 lg=16 xl=24`

---

## Border Radius

| Token | Value | Use |
|-------|-------|-----|
| `--cmc-radius-xs` | 4px | Compact badges, code chips |
| `--cmc-radius-sm` | 8px | Small tags, compact cards |
| `--cmc-radius` | 10px | Inputs, secondary buttons |
| `--cmc-radius-md` | 14px | Standard cards, panels |
| `--cmc-radius-lg` | 18px | Feature cards, modals |
| `--cmc-radius-xl` | 24px | Large modal containers |
| `--cmc-radius-pill` | 9999px | Primary CTA buttons, pill badges |

**Mantine key → CSS token mapping** (Mantine's named scale is offset by one step from CSS token names):

| Mantine key | Mantine value | CSS token |
|-------------|---------------|-----------|
| `xs` | 4px | `--cmc-radius-xs` |
| `sm` | 8px | `--cmc-radius-sm` |
| `md` | 10px | `--cmc-radius` (base, no suffix) |
| `lg` | 14px | `--cmc-radius-md` |
| `xl` | 18px | `--cmc-radius-lg` |
| — | 24px | `--cmc-radius-xl` (inline use only) |
| 9999 | 9999px | `--cmc-radius-pill` |

**Rule:** Inputs/compact fields use `radius="md"` (10px). Cards/panels use `radius="lg"` (14px). Modals use `radius="xl"` (18px). Primary CTA buttons use explicit `radius={9999}` for true pill.

---

## Elevation

**Zero Elevation doctrine**: shadows are reserved for content that genuinely
floats above another layer (functional depth-cue). Decorative surfaces
(Card, Paper, Notification) render flat — definition comes from
`border: 1px solid var(--cmc-border)` only, never `box-shadow`.

| Component | Doctrine | Token |
|-----------|----------|-------|
| Card, Paper, Notification | Decorative — flatten fully | `--cmc-shadow-none` |
| Modal, Menu, Select dropdown, Drawer | Functional — floats above content, needs a minimum depth-cue | `--cmc-shadow-sm` (minimum, do not go below) |

Why the split: on the near-white `#F5F5F7` background, a fully flat Modal or
open dropdown would be visually indistinguishable from the page behind it.
Cards and toasts sit *in* the page flow, so a border alone communicates their
boundary.

| Token | Value | Use |
|-------|-------|-----|
| `--cmc-shadow-none` | `none` | Card, Paper, Notification (default) |
| `--cmc-shadow-xs` | `0 1px 2px rgba(29,29,31,0.06)` | Reserved |
| `--cmc-shadow-sm` | `0 1px 4px ... 0 2px 8px ...` | Modal, Menu, Select dropdown, Drawer (functional minimum) |
| `--cmc-shadow-md` | `0 4px 16px ...` | Reserved — opt-in only (e.g. hover-elevated interactive card) |
| `--cmc-shadow-lg` | `0 8px 32px ...` | Reserved, scale reference |
| `--cmc-shadow-xl` | `0 20px 60px ...` | Reserved, scale reference |

**Never use:** `box-shadow` on Card/Paper/Notification. Use
`border: 1px solid var(--cmc-border)` instead. Never drop Modal/Menu/Select/
Drawer below `--cmc-shadow-sm` — they need a depth-cue to stay
distinguishable from the page.

---

## Component Patterns

### Button

```tsx
// Primary — pill, filled blue
<Button variant="filled" radius="xl">Tạo mới</Button>

// Secondary — ghost, no border (Apple text-link style)
<Button variant="subtle" color="cmc">Xem chi tiết</Button>

// Destructive
<Button variant="filled" color="red">Xóa</Button>

// Icon button — must have aria-label
<ActionIcon aria-label="Chỉnh sửa" variant="subtle" radius="md">
  <IconPencil size={16} />
</ActionIcon>
```

**Do not:** use `variant="outline"` for primary actions — it reads as secondary.  
**Do not:** use emojis as button content. Use `@tabler/icons-react`.

---

### Status Badge

```tsx
// Active
<Badge color="cmcGreen" variant="light" radius="xl">Hoạt động</Badge>

// Pending
<Badge color="cmcAmber" variant="light" radius="xl">Chờ duyệt</Badge>

// Rejected / Error
<Badge color="cmcRed" variant="light" radius="xl">Từ chối</Badge>

// Inactive
<Badge color="cmcGray" variant="light" radius="xl">Không hoạt động</Badge>
```

Always pair badge with icon in table cells for color-independent meaning:
```tsx
<Group gap={4}>
  <IconCircleCheck size={12} color="var(--cmc-status-active)" />
  <Badge color="cmcGreen" variant="light" radius="xl">Hoạt động</Badge>
</Group>
```

---

### Table

```tsx
<Table striped highlightOnHover withTableBorder={false}>
  <Table.Thead>
    <Table.Tr>
      <Table.Th>Họ tên</Table.Th>
      <Table.Th>Trạng thái</Table.Th>
      <Table.Th style={{ width: 80 }}>Thao tác</Table.Th>
    </Table.Tr>
  </Table.Thead>
  <Table.Tbody>
    {rows.map(row => (
      <Table.Tr key={row.id}>
        <Table.Td>{row.name}</Table.Td>
        <Table.Td><StatusBadge status={row.status} /></Table.Td>
        <Table.Td>…</Table.Td>
      </Table.Tr>
    ))}
  </Table.Tbody>
</Table>
```

**Table density rules:**
- Cell padding: `10px 12px` (token `--cmc-space-3`)
- Column header: `uppercase`, `11px`, `#6E6E73`, `letter-spacing: 0.04em`
- Max columns visible without scroll: 6–8
- Action column always last, fixed width 80–120px
- Numbers: right-align, `font-variant-numeric: tabular-nums`

---

### Form Section

Group related fields with a `Card` container using `radius="lg"`:

```tsx
<Card radius="lg" p="xl" withBorder>
  <Text size="lg" fw={600} mb="lg">Thông tin cá nhân</Text>
  <Stack gap="md">
    <TextInput label="Họ tên" required />
    <TextInput label="Email" type="email" required />
    <Select label="Phòng ban" data={departments} />
  </Stack>
</Card>
```

**Form rules:**
- Every input must have a visible `label` — no placeholder-only
- Required fields: add `required` prop (Mantine renders `*` indicator)
- Error message appears below the field, not at the form top
- `Stack gap="md"` (12px) between fields within a section
- `Stack gap="xl"` (24px) between form sections

---

### Sidebar Navigation

```tsx
// Active item example
<NavLink
  label="Bảng lương"
  leftSection={<IconCurrencyDong size={18} />}
  active={isActive}
  styles={{
    root: {
      borderRadius: '10px',
      color: isActive ? 'var(--cmc-brand)' : 'var(--cmc-text)',
      backgroundColor: isActive ? 'var(--cmc-brand-muted)' : 'transparent',
      fontWeight: isActive ? 500 : 400,
    },
  }}
/>
```

**Sidebar rules:**
- Active state: `--cmc-brand-muted` bg + `--cmc-brand` text, **not** a left border stripe
- Inactive hover: `--cmc-surface-2` bg
- Icon size: 18px, `@tabler/icons-react`, stroke 1.5
- Section labels: `11px`, uppercase, `--cmc-text-faint`, no interaction

---

### Card

```tsx
// Standard data card
<Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
  <Text size="sm" c="dimmed" mb={4}>Tổng thu nhập</Text>
  <Text size="xl" fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
    24,500,000 ₫
  </Text>
</Card>

// Hover-interactive card (kanban, list item) — Zero Elevation: hover
// communicates via border color, not shadow (Card is decorative-flat).
<Card
  radius="lg"
  p="lg"
  style={{
    border: '1px solid var(--cmc-border)',
    cursor: 'pointer',
    transition: 'border-color var(--cmc-transition)',
  }}
  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--cmc-brand)'}
  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--cmc-border)'}
>
  …
</Card>
```

---

### Modal

```tsx
<Modal
  opened={opened}
  onClose={close}
  title="Xác nhận duyệt"
  radius="xl"
  centered
>
  <Text size="sm" c="dimmed">…</Text>
  <Group justify="flex-end" mt="xl" gap="sm">
    <Button variant="subtle" onClick={close}>Hủy</Button>
    <Button variant="filled" onClick={confirm}>Duyệt</Button>
  </Group>
</Modal>
```

**Modal rules:**
- Destructive confirmation: danger button on the right, cancel on the left
- Always provide keyboard-accessible close (Mantine default ✓)
- Max width `480px` for confirmations, `640px` for forms
- Overlay uses `backdropFilter: blur(4px)` — already set in theme

---

## Layout

```
┌─ Topbar (56px, sticky) ──────────────────────────────────────────┐
│ Logo    Breadcrumbs                    Search  Notifications  User│
└───────────────────────────────────────────────────────────────────┘
┌─ Sidebar (240px) ──┬─ Main content (flex-1, max 1280px) ──────────┐
│ Nav group          │ <Stack gap="xl" p="xl">                      │
│   Item (active)    │   <PageHeader title actions />               │
│   Item             │   <DataCard | Table | KanbanBoard />         │
│ Nav group          │ </Stack>                                     │
│   Item             │                                              │
└────────────────────┴──────────────────────────────────────────────┘
```

**Page layout token usage:**
- Sidebar: `--cmc-sidebar-w: 240px`; mini mode: `--cmc-sidebar-w-mini: 60px`
- Topbar: `--cmc-topbar-h: 56px`; use `position: sticky; top: 0; z-index: var(--cmc-z-sticky)`
- Content area: `padding: var(--cmc-space-6)` (32px), `max-width: var(--cmc-content-max)` (1280px)
- Form pages: `max-width: var(--cmc-form-max)` (640px), centered

---

## Anti-Patterns

| ❌ Avoid | ✅ Do instead |
|----------|--------------|
| Gradient backgrounds on cards | Flat `#FFFFFF` surface with `1px solid --cmc-border` |
| Multiple accent colors (purple, teal, orange CTAs) | Single `--cmc-brand` blue for all interaction |
| Heavy card shadows | `--cmc-shadow-none` + `border: 1px solid var(--cmc-border)` for resting cards |
| Shadow below `--cmc-shadow-sm` on Modal/Menu/Select/Drawer | Keep `--cmc-shadow-sm` minimum — these float above content and need a depth-cue |
| Mixed date formats (`DD/MM/YYYY` in one screen, raw `YYYY-MM-DD` in another) | Display dates as `DD/MM/YYYY` (Vietnamese convention) everywhere user-facing; keep ISO `YYYY-MM-DD` only at the API/storage boundary, never rendered raw to users |
| Color-only status (no icon/text) | Badge + icon always paired |
| Placeholder-only form labels | Visible `<label>` above every input |
| Custom hex values in components | Always use `var(--cmc-*)` tokens |
| `font-weight: 400` on column headers | `600` + uppercase + `--cmc-text-muted` |
| Emoji as icons (`✅ 🔔 ⚙️`) | `@tabler/icons-react` SVG icons |
| Radius inconsistency (random px) | Use `--cmc-radius-*` scale or Mantine `radius` props |
| Animations > 300ms | `--cmc-transition` (200ms) max for UI state changes |

---

## Accessibility Baseline

- Text contrast: `--cmc-text` on `--cmc-surface` = 16.7:1 ✓
- Muted text: `--cmc-text-muted` on `--cmc-surface` = 5.07:1 ✓ (AA)
- Brand on white: `--cmc-brand` on `#FFFFFF` = 4.6:1 ✓ (AA)
- Status text tokens verified ≥ 4.5:1 on their bg tokens
- All interactive elements: visible focus ring via Mantine defaults
- `prefers-reduced-motion` handled in `tokens.css` base reset
- Touch targets: Mantine Button default height 36px — use `size="md"` minimum
- Active nav label: use `--cmc-brand-hover` (`#0055C6`) not `--cmc-brand` on `--cmc-brand-muted` bg — `#0071E3` on `#E8F1FC` = 4.12:1 (fail); `#0055C6` on `#E8F1FC` = 5.4:1 ✓
- Status dot colors (`--cmc-ok`, `--cmc-warn`, `--cmc-status-*`) are indicator-only — do NOT use as text color; use the paired `*-text` token instead
