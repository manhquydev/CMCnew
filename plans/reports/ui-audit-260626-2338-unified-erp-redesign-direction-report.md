# Unified ERP — UI Audit & Redesign Direction

Date: 2026-06-26 23:38
Author: ui-ux-designer (advisory, read-only)
Scope: Merge `apps/admin` + `apps/teaching` into ONE role-filtered staff workspace. LMS (student/parent) out of scope.
Inputs reviewed: 11 screenshots + `packages/ui/src/{tokens.css, theme.ts, components.tsx}` + both `shell.tsx` files + panel inventory.

---

## 0. Headline finding

The **design system is good; the screens waste it.** `tokens.css` and `theme.ts` are a coherent, professional Apple-inspired system (10-stop brand scale, semantic status colors, 8px spacing grid, density-tuned type scale, flat elevation, full Mantine component overrides). The "sơ sài / thiếu chuyên nghiệp" complaint is **not** a token problem — it is that screens use ~30% of the canvas, lean on raw Mantine defaults, render empty states as bare grey text, and lack visual hierarchy/data density. So this is a **screen-composition + IA fix, not a design-system rewrite.** That is the cheapest possible path to "professional."

Also note: `packages/ui/src/components.tsx` ships a second, inferior `Button`/`Card`/`Field` set using `var(--cmc-shadow)` (a token that does NOT exist in tokens.css — only `--cmc-shadow-xs/sm/md...`). These are unused legacy primitives. Flag for deletion; everything real goes through Mantine + theme.ts.

---

## 1. Heuristic audit (concrete, per-screen)

### Cross-cutting problems (all screens)
- **Canvas underuse.** Content capped at `maxWidth:1280` but centered/left with huge empty right gutters (dashboard, HR, CRM, class-detail). On a 1520px screen ~40% is dead space. Reads as "unfinished."
- **No persistent context.** Topbar shows only `CMC · <SectionTitle>`. No breadcrumb, no current-facility chip, no user role, no page-level action zone. Every screen reinvents where its primary action lives (CRM button mid-card, classes "+ Tạo lớp" top-right, dashboard none).
- **Weak page headers.** Page title is a lone `<h?>` with no subtitle, no divider, no action alignment, no stat strip. Title floats with inconsistent left padding vs the cards below it (dashboard "Tổng quan" indents differently than the KPI grid).
- **Empty states = grey sentence.** "Chưa có cơ hội đang mở.", "Pipeline cơ hội — Chưa có cơ hội nào.", "Chọn một lớp để xem chi tiết." All are bare muted text with no icon, no illustration, no CTA. This single thing makes the product feel like a prototype.
- **Loading states unseen** in any screenshot — likely raw spinner or nothing. Needs skeletons.
- **Helper text styled as a banner.** HR screen's blue info bar ("...HR / kế toán only.") is dev-facing copy promoted to hero position. Reads as a warning, not guidance.

### admin-dashboard
- Six KPI cards are visually flat and identical-weight: tiny uppercase label + big number, no icon, no trend/delta, no sparkline, no color accent. A revenue figure (90.5M) and "Cơ hội chốt: 0" carry equal visual weight — no prioritization.
- KPI numbers use default near-black; no use of brand/semantic color to signal good/bad. "0" values look like errors, not states.
- "Pipeline đang mở" is a full-width card holding one grey sentence — 200px of emptiness. Worst offender for "sơ sài."
- No date range, no facility filter, no "what changed since yesterday." A dashboard with zero interactivity.

### admin-hr
- Entire screen = one info banner + one empty `Select`. ~85% blank. This is the most unprofessional screen in the set. No master list of staff, no table, no summary. The whole page is a dropdown.

### teaching-full (the 233-class list)
- The class list renders **all 233 rows** in an unvirtualized scroll with NO search, NO filter, NO pagination, NO status filter chips. A wall of `CB-S4_62372_3100`-style codes — codes, not human labels. Unusable at scale and visually monotonous.
- Right detail pane is empty placeholder for the whole length.

### teaching-lichday / classes (master-detail)
- Left list items: code as title, `Class-Q` as subtitle, a grey `planned` pill far-right. The pill is low-contrast grey-on-grey; status is not scannable. All items identical → no hierarchy.
- "Lịch dạy" nav item actually shows a **class list titled "Lớp học"** — nav label ≠ page content. Confusing routing.
- Facility selector + "Quản lý phòng (3)" + "+ Tạo lớp" floats top-right disconnected from the "Lớp học" title top-left → split attention, no real page header bar.

### teaching-class-detail
- Decent bones (tabs: Lịch/Buổi học/Ghi danh/Điểm danh/Họp PH/Nhật ký). But: "Khung lịch tuần" form sits in a card with an empty table below (THỨ/GIỜ/PHÒNG/GIÁO VIÊN headers, no rows, no empty message). Form labels good; table looks broken when empty.
- "Đổi trạng thái" + "Hủy lớp" top-right are visually heavier (Hủy lớp = red) than they should be for a default view; destructive action over-emphasized.

### teaching-crm
- "Tạo cơ hội mới" form is fine, but "Pipeline cơ hội — Chưa có cơ hội nào." is the centerpiece and it's empty text. A CRM with no visible pipeline/kanban is the screen that most needs a real visual.
- "Lịch test" table is clean and is actually the best table in the set (good status badge `Đã test` green) — use it as the table reference pattern.

### Login screens (admin / teaching / lms)
- Functional, centered card, fine. But generic — no logo, no brand moment, no product name beyond "CMC · Admin". Floating card on pure white = stock-template feel. Lowest priority to fix but a 20-min brand win.

### Nav (both shells)
- Grouping exists and is reasonable, but **the two apps have different group taxonomies** (teaching: HÔM NAY/QUẢN LÝ LỚP/GIẢNG DẠY/CSKH/KINH DOANH/NHÂN SỰ; admin: Quản trị/Vận hành/Kinh doanh/Nhân sự). Merging requires one canonical taxonomy (see §2).
- Sidebar icons are 18px stroke-1.5 (good, consistent). Active state uses brand-muted fill (good). This part is already professional — keep it.

---

## 2. Information architecture — unified workspace

### 2.1 One canonical nav taxonomy
Collapse both apps' section keys into a single grouped model. Groups ordered by daily-use frequency, not org-chart. Each group hides entirely when the role has zero visible items (admin shell already does `visible.length===0 → return null`; teaching builds conditionally — unify on the admin pattern: every item carries a `visible` boolean).

| Group (label) | Items (section key → label) | Source today |
|---|---|---|
| **Hôm nay** | `schedule` Lịch dạy · `attendance` Điểm danh · `meetings` Họp PH | teaching |
| **Giảng dạy** | `grading` Chấm bài · `assessment` Học bạ | teaching |
| **Quản lý lớp** | `classes` Lớp học · `enrollment` Ghi danh · `classlog` Nhật ký lớp · `levelup` Duyệt cấp độ · `certificate` Chứng chỉ · `courses` Khóa học | teaching + admin(courses) |
| **Học sinh & PH** | `students` Học sinh · `guardians` Phụ huynh | admin |
| **CRM / Tuyển sinh** | `crm` CRM · `cskh` Chăm sóc KH | both |
| **Tài chính** | `finance` Phiếu thu/Tài chính | both |
| **Nhân sự & Lương** | `my-payslips` Phiếu lương của tôi · `payroll` Bảng lương · `hr` Nhân sự & Lương · `kpi` Đánh giá KPI · `compensation` Cơ cấu lương | both |
| **Khen thưởng** | `rewards` Đổi quà | admin |
| **Quản trị** | `overview` Tổng quan · `org` Cơ sở & Users | admin |
| **Cài đặt** | `settings` (new, optional) | new |

Note `finance` collides across apps (teaching=Phiếu thu, admin=Tài chính). Merge into one `finance` section with sub-tabs (Phiếu thu / Công nợ / Báo cáo) rather than two keys.

### 2.2 Role → visible groups (permission map)
Reuse the existing `can*` booleans — they already encode this. Consolidated:

| Role | Sees groups |
|---|---|
| `super_admin` | all |
| `quan_ly` (manager) | all except `compensation` (super-admin only today) |
| `teacher` / `head_teacher` | Hôm nay, Giảng dạy, Quản lý lớp (head_teacher adds levelup/certificate), Nhân sự(my-payslips only) |
| `sale` | Hôm nay, Quản lý lớp(classes+enrollment), CRM/Tuyển sinh, Tài chính(read), Nhân sự(my-payslips) |
| `cskh` | Hôm nay, CRM/Tuyển sinh(cskh), Nhân sự(my-payslips) |
| `ke_toan` | Tài chính, Nhân sự & Lương(payroll+hr), Quản trị(overview), my-payslips |
| `hr` | Nhân sự & Lương(hr+payroll+kpi), my-payslips |

### 2.3 Persona → landing route (login redirect)
Add a `defaultSection(me)` resolver run once after auth. First matching rule wins:

| Persona | Lands on | Rationale |
|---|---|---|
| teacher / head_teacher | `schedule` (Lịch dạy) | their daily driver |
| sale | `crm` | pipeline is their job |
| cskh | `cskh` | ticket queue |
| ke_toan | `finance` | receipts/AR |
| hr | `hr` | staff roster |
| quan_ly | `overview` (dashboard) | needs the cross-domain view |
| super_admin | `overview` | same |

Fallback: first visible section in nav order. Persist last-visited section per user (localStorage) and prefer it over default on return.

---

## 3. Design system direction

**Keep the token foundation.** It is already professional. Below = what to *add/standardize*, building on existing tokens. No new color system.

### 3.1 Color usage rules (tokens already exist — enforce them)
- **Brand blue `--cmc-brand` is for interaction only** (CTA, links, active nav, focus). Stop using it for decorative headings on white (login "CMC · Admin" blue title reads like a link).
- **KPI/metric semantics:** positive deltas `--cmc-ok-text`, negative `--cmc-danger-text`, neutral `--cmc-text`. Zero-states get `--cmc-text-muted`, never plain black (so "0" stops looking like an error).
- **Status chips:** map every domain status to the existing `--cmc-status-*` dots + tinted bg badges (planned→draft grey, active→green, pending→amber, rejected→red). Class `planned` pill must use the badge pattern, not bare grey text.
- Add ONE token: `--cmc-surface-sunken: #EFEFF2` for table header rows / sunken empty-state panels (currently improvising with `--cmc-bg`).

### 3.2 Typography (scale exists — apply consistently)
- Page title = `--cmc-text-2xl` (28) / weight 700, always paired with a `--cmc-text-sm` muted subtitle line.
- Section/card title = `--cmc-text-lg` (20) / 600.
- KPI value = `--cmc-text-3xl` (34) / 700; KPI label = `--cmc-text-xs` (11) uppercase muted (already the pattern — just add an icon + delta line).
- Table: keep `th` 11px uppercase muted, `td` 13px. Good as-is in theme.ts.
- Vietnamese: system stack (`-apple-system/Segoe UI`) renders diacritics correctly on Win/Mac — no web font needed. If a brand font is ever wanted, require Vietnamese subset (Be Vietnam Pro, Inter w/ vi, or Lexend). Not a priority.

### 3.3 Spacing / density
- Adopt a fixed **page scaffold**: `PageHeader` (title+subtitle+actions+optional stat strip) → 24px gap → content. Content uses `--cmc-space-5` (24) card padding, `--cmc-space-4` (16) between cards.
- Raise `--cmc-content-max` usage: **list/table screens go full-width** (no 1280 cap); only forms keep `--cmc-form-max` 640. The 1280 center-cap is a main cause of "empty canvas." Tables should breathe edge-to-edge with `--cmc-space-6` page gutters.
- Default table row = comfortable (the theme's 10px/12px). Offer a `compact` density toggle for power users on big lists (233 classes).

### 3.4 Sidebar pattern (mostly keep)
- Keep grouped NavLink + brand-muted active fill. Add: collapsible mini-rail at `--cmc-sidebar-w-mini` (60px) for ≥233-row work sessions; persist collapsed state. Add a facility switcher pinned at sidebar top (today it's scattered into page bodies). Add user/role block pinned at sidebar bottom (replaces the bare topbar avatar).

### 3.5 Reusable patterns to add to `packages/ui` (the actual fix)
These are the missing primitives that make every screen look finished:
1. `PageHeader` — title, subtitle, breadcrumb slot, actions slot, optional KPI/stat strip.
2. `EmptyState` — icon + headline + one-line guidance + primary CTA. **Single highest-ROI component**; replaces every grey sentence.
3. `StatCard` — label + value + icon + delta(+color) + optional sparkline. Replaces dashboard's flat cards.
4. `DataTable` wrapper — search box, filter chips, column-driven, sticky header, skeleton rows, empty slot, pagination/virtualization. Replaces the 233-row wall and every raw `<Table>`.
5. `Skeleton` presets (table-rows, card, form) for loading.
6. `StatusBadge` — maps domain status string → semantic color+dot+label. One source of truth.
7. `MasterDetail` layout — list pane + detail pane + shared empty/selected states (class screen, students).
8. `FilterBar` — facility + search + status chips, the recurring top-of-list control cluster.

All composed from existing Mantine + theme.ts; zero new color/spacing primitives except `--cmc-surface-sunken`.

---

## 4. Key screen redesign notes (layout direction, no code)

### Dashboard (`overview`)
- `PageHeader`: "Tổng quan" + subtitle "Cơ sở HQ · cập nhật 23:38" + facility switcher + date-range control (Hôm nay / 7 ngày / Tháng).
- Replace 6 flat cards with `StatCard` grid: each gets an icon, the value, a delta vs previous period (green/red), and a faint sparkline. Order by importance (Doanh thu, Học sinh đang học, Lớp đang mở first; zero-value opportunity stats grouped/secondary).
- Replace empty "Pipeline đang mở" sentence with a real mini-pipeline: horizontal stage bar (New→Test→Won) with counts, or an `EmptyState` ("Chưa có cơ hội — Tạo cơ hội đầu tiên" + CTA) when truly zero.
- Add a second row: "Hôm nay" agenda (buổi học sắp tới, điểm danh chưa chốt, họp PH) + "Cần xử lý" task list. Turns a vanity dashboard into a work surface.

### Class detail / scheduling (`classes` master-detail)
- Full-width `MasterDetail`. Left = `DataTable`-lite list with **search + status filter chips + facility** at top, virtualized for 233 rows, human label (program + level + schedule summary) as primary, code as monospace secondary, `StatusBadge` right-aligned.
- Detail pane `PageHeader`: class name + status badge + secondary "Đổi trạng thái" and a de-emphasized (text/ghost, not red-filled) "Hủy lớp" moved into an overflow `⋯` menu.
- "Khung lịch tuần": keep the form; when the schedule table is empty show an inline `EmptyState` row ("Chưa có khung giờ — thêm khung đầu tiên") instead of a headers-only broken-looking table.
- Empty selection state (no class chosen) = friendly `EmptyState` with icon, not the current grey sentence.

### Students list (`students`)
- Full-width `DataTable`: `FilterBar` (facility, search by name/phone, status chips: đang học / nghỉ / chờ xếp lớp). Columns: avatar+name, mã HS, lớp hiện tại, phụ huynh, trạng thái(badge), hành động. Sticky header, skeleton on load, pagination. Row click → detail drawer (profile, enrollment history, payments, attendance) rather than full nav — keeps context.

### CRM pipeline (`crm`)
- Replace the empty "Pipeline cơ hội" text with a **kanban board**: columns = stages (Mới → Đã liên hệ → Đặt lịch test → Đã test → Chốt/Nhập học → Mất). Cards = contact name, phone, program, owner, age-in-stage. Drag to move stage. Counts + value per column header.
- "Tạo cơ hội mới" form → move into a right-side drawer triggered by a `PageHeader` primary button ("+ Tạo cơ hội"), freeing the board to be the page.
- Keep "Lịch test" table (it's the cleanest table) as a tab or lower section. Empty board state = `EmptyState` with CTA.

### HR (`hr`)
- Full rebuild: `DataTable` staff roster (name, role, cơ sở, lương cơ bản, quota, trạng thái) as the page. The current `Select`-only screen becomes a row click → staff detail drawer (hồ sơ, mức lương, hoa hồng lookup). Demote the blue dev-banner to a small muted helper under the page title.

---

## 5. Rollout — incremental, no big-bang

Foundation already shared (both apps import `@cmc/ui` theme + tokens), so ship primitives centrally and adopt screen-by-screen.

**Phase A — primitives (packages/ui), zero screen risk.** Add `PageHeader`, `EmptyState`, `StatCard`, `StatusBadge`, `Skeleton`, `FilterBar`, `DataTable`, `MasterDetail`. Delete dead `components.tsx` (broken `--cmc-shadow`). Add `--cmc-surface-sunken`. Export from `index.tsx`. No app changes yet → nothing breaks.

**Phase B — unify the shell.** Merge `admin/shell.tsx` + `teaching/shell.tsx` into one `@cmc/ui` `StaffShell` with the §2.1 taxonomy, a single `SectionKey` union, `visible`-flag nav model (admin pattern), sidebar facility switcher + bottom user block, and `defaultSection(me)` landing resolver. Both apps render it; routing keys merged. This is the "merge into one workspace" deliverable.

**Phase C — adopt primitives highest-impact-first.** Order by ROI: (1) every `EmptyState` (kills the prototype feel instantly), (2) dashboard `StatCard`s, (3) `DataTable` on the 233-class list + students + HR, (4) CRM kanban, (5) class-detail polish. Each screen is an isolated PR; old screens keep working until migrated.

**Phase D — brand polish (optional).** Login lockup + logo, facility chip, breadcrumbs, density toggle, mini-rail sidebar.

Risk: low. Primitives are additive; shell merge is the only cross-cutting change and it's mechanical (two nav builders → one). No backend/contract changes. No token color changes (one additive var).

---

## Unresolved questions
1. Is there a single `me.roles` + `can*` permission source we can centralize the §2.2 map onto, or do the two apps compute perms differently? (Both shells compute inline — confirm they agree.)
2. `finance` means Phiếu thu (teaching) vs Tài chính (admin) — confirm they're the same domain to merge into one section with sub-tabs.
3. Does CRM data model already support discrete pipeline stages (for kanban columns), or is it currently flat (opportunity + Lịch test only)?
4. Is virtualization acceptable for the 233-class list, or is server-side pagination/search preferred (affects DataTable design)?
5. Any brand assets (logo, primary brand color beyond #0071E3) to anchor login + sidebar, or stay system-default?

---
Status: DONE
Summary: Audited 11 screens + packages/ui; the token/theme foundation is professional but screens underuse it (empty canvas, grey empty-states, flat KPIs, unfiltered 233-row lists). Report delivers a unified role-filtered IA, persona→landing map, 8 missing UI primitives to add to packages/ui, per-screen redesign direction, and a low-risk additive 4-phase rollout.
