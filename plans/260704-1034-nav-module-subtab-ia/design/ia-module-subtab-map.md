# IA Design — Nav Module + Sub-Tab Restructure

Status: DRAFT — this is the P0 gate. Requires user/red-team sign-off on the two open
decisions (§7) before Phase 1 starts.
Created: 2026-07-04

---

## 1. Current state (verified in code, cited)

Today's nav is a **flat 2-level presentation**: a group label + N independent leaf
`NavLink`s, each doing a full-screen swap.

- Sidebar render: `apps/admin/src/shell.tsx:549-565` — `navGroups.map(group => GroupLabel + group.items.filter(visible).map(SidebarItem))`. A group with zero visible items returns `null` (`shell.tsx:551`).
- Group definition: `shell.tsx:625-714` — `buildNavGroups({roles, isSuperAdmin})` returns `NavGroup[]`, each `{groupLabel, items: NavItem[]}`; `NavItem = {key: SectionKey, label, icon, visible}` (`shell.tsx:96-106`).
- Per-leaf visibility: `visible(key)` at `shell.tsx:595-600` reads `NAV_GATES[key]` (`nav-permissions.ts:25-142`) → `open` / `superAdmin` / `can(roles,isSuperAdmin,module,action)`.
- Click → `onSectionChange(key)` (`shell.tsx:560`) → `handleSectionChange` (`App.tsx:593-599`) → `navigate('/'+key)`.
- Active section is derived from URL: `App.tsx:560-566` (`params.section`, or `'crm'` when `params.oppId` present, else `defaultSection(me)`).
- View wiring: the ~35-case `switch(activeSection)` at `App.tsx:620-883`.
- Section registry: `SectionKey` union `shell.tsx:47-92`; `ALL_SECTION_KEYS` set `App.tsx:520-531`; `SECTION_TITLES` `shell.tsx:720-761`.
- Routes: `App.tsx:908-921` — `/design`, `/crm/opportunities/:oppId`, `/:section`, `/`, `*`.
- Search deep-link contract: `SEARCH_GROUPS` `shell.tsx:231-241` (entity→section, plus `path(id)` for CRM opp); `handleSelectSearchResult` `shell.tsx:369-382`; `handleSearchNavigate` `App.tsx:604-616` (students→`/students`, staff→`/org`, classBatches→`goToClass`).
- Route metadata: `ADMIN_ROUTE_METADATA` `link-preview-metadata.ts:102-124` (build-time static dir per section, `vite.config.ts:42-59`); runtime `applyAdminMetadata(getAdminMetadata(activeSection, …))` `App.tsx:577-579`.
- Precedent for horizontal sub-tabs already in-repo: `student-management-panel.tsx:16-33` (Mantine `Tabs` consolidating Lớp học / Khóa học / Học bạ for `giao_vien`-only). The themed `Tabs` (underline, brand-active) lives at `packages/ui/src/theme.ts:332-355`. **We consume this, invent no new visual language.** **Caveat (M2):** that precedent uses `defaultValue`+`keepMounted={false}` — an *uncontrolled*, in-page panel switcher. It proves the themed `Tabs` renders horizontal tabs **visually**, but does NOT demonstrate the **router-synced controlled** mechanism the SubTabBar needs (`value`+`onChange` derived from the URL, staying in sync on browser back/forward). That controlled mechanism is genuinely new work (see §6), not proven by the precedent.

Nav-structure tests — the per-role parity gate. Three of the four
(`nav-teacher-consolidation.test.ts`, `nav-director-dt-cockpit-consolidation.test.ts`,
`nav-director-kd-cockpit-consolidation.test.ts`) reach visibility via
`keysOf() = groups.flatMap(g => g.items.filter(i=>i.visible).map(i=>i.key))` — **agnostic to
module grouping**. The fourth, `__tests__/nav-consistency.test.ts`, doesn't call
`buildNavGroups`/`keysOf()` at all — it asserts `NAV_GATES`↔`PERMISSIONS` parity directly, so it
is independent of `NavGroup` entirely (even more insulated from this change than the other
three). Because `buildNavGroups` keeps returning `NavGroup[]` with `items[].visible` (we only
ADD `key`+`icon` per group, §6.2), all four suites MUST pass **byte-for-byte unchanged** — that
unchanged-green state is the strongest evidence per-role visibility is preserved. Do NOT rewrite
them to match new behavior (rewriting would mask regressions). The only test we ADD is the new
one-module-per-section derivation guard (§6.1 / phase-01).

---

## 2. The 8 modules → sub-tab map (verified against `buildNavGroups`, `shell.tsx:625-714`)

Each existing group becomes one **module** (left-rail icon+label). Its visible leaves
become the **horizontal sub-tabs**. Membership + gates are **read from `buildNavGroups`, not
re-declared** (§6.1 — the derivation avoids a second source of truth) — no
business/permission boundary moves.

| # | Module (slug) | Label | Sub-tabs (sectionKey → label) | Gate source (unchanged) |
|---|---|---|---|---|
| 1 | `giang-day` | Giảng dạy | `schedule`→Lịch dạy · `attendance`→Điểm danh¹ · `attendance-report`→Báo cáo điểm danh · `grading`→Chấm bài¹ · `assessment`→Học bạ¹ | NAV_GATES + `!isTeacherOnly` on attendance/grading/assessment (`shell.tsx:632-635`) |
| 2 | `lop-hoc` | Lớp học | `classes`→Lớp học¹ · `courses`→Khóa học¹ · `student-mgmt`→Quản lý học sinh² · `meetings`→Họp PH¹ · `levelup`→Duyệt cấp độ · `certificate`→Chứng chỉ (visible:false, `shell.tsx:651`) | NAV_GATES + isTeacherOnly split (`shell.tsx:641-651`) |
| 3 | `hoc-sinh` | Học sinh | `students`→Học sinh · `guardians`→Phụ huynh | NAV_GATES (`shell.tsx:657-658`) |
| 4 | `crm-kinh-doanh` | CRM & Kinh doanh | `crm`→CRM · `cskh`→Chăm sóc KH · `rewards`→Đổi quà · `badges`→Huy hiệu | NAV_GATES (`shell.tsx:664-667`) |
| 5 | `tai-chinh` | Tài chính | `finance`→Tài chính · `email-outbox`→Hộp thư gửi đi · `revenue-report`→Báo cáo doanh thu · `reconcile-worklist`→Đối soát theo kỳ | NAV_GATES (`shell.tsx:673-676`) |
| 6 | `nhan-su` | Nhân sự | `hr`→Nhân sự & Lương · `kpi`→Đánh giá KPI · `compensation`→Cơ cấu lương · `my-payslips`→Phiếu lương của tôi¹ · `payroll-checkin`→Chấm công & lương² | NAV_GATES + isTeacherOnly split (`shell.tsx:682-689`) |
| 7 | `cong-ca` | Công ca | `checkin`→Chấm công¹ · `shift-registration`→Đăng ký ca | NAV_GATES (`shell.tsx:695-696`) |
| 8 | `quan-tri` | Quản trị | `overview`→Tổng quan³ · `biz-director-cockpit`→Cockpit điều hành² · `edu-director-cockpit`→Cockpit điều hành² · `org`→Cơ sở & Người dùng · `facility-network`→IP WiFi chấm công · `shift-config`→Danh mục ca | NAV_GATES + isXDirectorOnly split (`shell.tsx:702-711`) |

¹ hidden when `isTeacherOnly` (single-role `giao_vien`).
² aggregate/replacement screen shown **only** to a single-role account (`isTeacherOnly` / `isBizDirectorOnly` / `isEduDirectorOnly`, `shell.tsx:606-623`).
³ hidden when a single-role director (replaced by the cockpit sub-tab).

**Not a module:** `profile` (`SectionKey`, reached via the avatar menu `shell.tsx:524-529`, gate `open`). It stays outside the module rail exactly as today.

Module icons: the left rail now shows one icon per module (groups have no icon today).
Reuse the current lead-leaf icon per group: `giang-day`→IconCalendar, `lop-hoc`→IconDoor,
`hoc-sinh`→IconSchool, `crm-kinh-doanh`→IconTrendingUp, `tai-chinh`→IconReceipt,
`nhan-su`→IconId, `cong-ca`→IconClipboardCheck, `quan-tri`→IconLayoutDashboard. (All already
imported in `shell.tsx:12-43`.)

---

## 3. URL / routing scheme — the #1 risk

Requirement: module+subtab presentation MUST NOT break the search deep-link contract
(`SEARCH_GROUPS`/`handleSearchNavigate`), the `/crm/opportunities/:oppId` route, or the
build-time route-metadata dirs. Two candidate schemes:

### Option C — Keep flat `/{sectionKey}` URL, DERIVE module from section (RECOMMENDED)

The URL contract is **unchanged**. The module is a pure presentation grouping computed by a
static `SECTION_TO_MODULE` lookup. Clicking a module navigates to its first visible subtab's
existing section key; clicking a subtab navigates to that section key (`navigate('/'+key)`,
unchanged). Active module = the module whose visible subtabs include `activeSection`.

- Backward-compat / redirect strategy: **none needed.** Every old `/{sectionKey}` link,
  every `SEARCH_GROUPS` target (`shell.tsx:231-241`), `/crm/opportunities/:oppId`
  (`App.tsx:914`), and every `ADMIN_ROUTE_METADATA` dir (`link-preview-metadata.ts:102-124`)
  keep working byte-for-byte because the section key IS still the URL.
- Blast radius: `shell.tsx` sidebar render + new SubTabBar; a `SECTION_TO_MODULE` map;
  `App.tsx` passes active-module info to `Shell`. `App.tsx` routing block untouched.
- Trade-off: URL does not encode the module (`/schedule`, not `/giang-day/schedule`).
  Bookmarks are per-screen, not per-module — which is exactly today's behavior and loses
  nothing users have.
- Verdict: honors YAGNI/KISS/DRY. Eliminates the #1 regression risk by construction. The
  user's ask is a **presentation** change ("parent module → horizontal sub-tabs"); the URL
  never needed to change to deliver it.

### Option A — Two-segment `/{module}/{subtab}` path

`navigate('/giang-day/schedule')`. Requires: nested route `/:module/:subtab` in
`App.tsx:908-921`; a resolver mapping segment→sectionKey; and a **redirect/alias layer** so
every legacy `/{sectionKey}` 301s to `/{module}/{sectionKey}` — including the search targets
and any external bookmark. `/crm/opportunities/:oppId` must be re-parented or specially
excluded. `ADMIN_ROUTE_METADATA` dirs must be regenerated at two-segment paths
(`link-preview-metadata.ts` + `vite.config.ts` change).

- Backward-compat: an explicit `LEGACY_SECTION_REDIRECTS` map (35 entries) + a catch route
  that rewrites old paths. Search/`handleSearchNavigate` must be updated to emit two-segment
  paths (or rely on the redirect).
- Trade-off: richer, self-describing URLs and module-level bookmarking — at the cost of a
  real redirect layer, a metadata-dir migration, and touching the routing block that the
  just-shipped search deep-links depend on (the exact thing the brainstorm flagged as the top
  risk, brainstorm report line 123).
- Verdict: more "correct-looking" URLs, materially higher risk and cost, near-zero user
  benefit over C (the section key already deep-links each screen precisely).

**Recommendation: Option C.** Present A as the alternative the user may pick if module-level
URLs are a hard product requirement. If A is chosen, Phase 1 grows a redirect-layer sub-task
and Phases 2-4 grow per-module route wiring (see §6 note).

---

## 4. Role-gating preservation (requirement #2)

Gating moves from per-leaf to per-subtab with **identical semantics** — the same `visible`
flag already computed by `buildNavGroups` is reused:

- A **sub-tab** is shown iff its existing `visible` flag is true (NAV_GATES + isXOnly logic,
  `shell.tsx:595-600, 606-711`). No gate logic is rewritten; it is re-read.
- A **module** renders in the rail iff it has ≥1 visible sub-tab — the direct analogue of the
  current `if (visible.length === 0) return null` (`shell.tsx:551`). Zero-visible module =
  not rendered.
- **Default landing** = `defaultSection(me)` (`App.tsx:103-121`), unchanged. It returns a
  sectionKey; that key's module becomes the active module automatically. Every persona branch
  (super_admin→overview, giao_vien→schedule, sale/ctv_mkt→crm, ke_toan→finance, hr→hr,
  cskh→cskh, biz-director-only→biz-director-cockpit, edu-director-only→edu-director-cockpit)
  resolves to a **module** that renders.
  **Pre-existing quirk (not introduced here):** the `hr` branch (`App.tsx:108`) lands the `hr`
  role on section `hr`, but the `hr` section gate is `payroll.roster=[giam_doc_kinh_doanh,
  giam_doc_dao_tao]` (`permissions.ts:217`) — which does NOT include the `hr` role. So the hr
  role lands on a subtab it cannot see (module `nhan-su` renders via `my-payslips`, but the
  landed `hr` subtab is hidden). This is a latent `defaultSection` issue in today's flat nav
  too (it 403s the landing), out of scope for this presentation-only plan. **Consequence for the
  SubTabBar:** it MUST tolerate an `activeSection` that is not in the active module's visible
  set — render the strip over the visible subtabs and highlight none (do not crash, do not
  invent a tab). Verify this hr-role edge live in P3.
- The nav-consistency invariant (test: `nav-consistency.test.ts`) is **unaffected** — it
  asserts NAV_GATES↔PERMISSIONS parity, which we do not touch. The teacher/director
  consolidation tests assert `buildNavGroups` output per role via `keysOf()`; because
  `buildNavGroups` still returns `NavGroup[]` with `items[].visible` (we only add `key`+`icon`),
  they pass **unchanged** — do NOT rewrite them. They are the per-role parity gate (see §1).

Role edge cases that become the **test matrix backbone** (§5):
| Persona | Module behavior to verify |
|---|---|
| `giao_vien`-only | `giang-day` shows `schedule` **+ `attendance-report`** (2 subtabs — `attendance.report=[giao_vien,giam_doc_dao_tao]` is NOT `!isTeacherOnly`-gated, `shell.tsx:633`; bar shown); `lop-hoc` shows only `student-mgmt`; `crm-kinh-doanh` shows only `badges` (`badge.list=[giao_vien,giam_doc_dao_tao]`, `shell.tsx:667`); `nhan-su` shows only `payroll-checkin`; `cong-ca` shows only `shift-registration` (checkin hidden). The single-subtab modules (`lop-hoc`/`crm-kinh-doanh`/`nhan-su`/`cong-ca`) suppress the bar per §5.4; `giang-day` keeps its 2-tab bar. |
| `giam_doc_kinh_doanh`-only | `quan-tri` shows `biz-director-cockpit` (not overview); default lands there. |
| `giam_doc_dao_tao`-only | `quan-tri` shows `edu-director-cockpit`; default lands there. |
| `super_admin` | all modules, all subtabs; `quan-tri` shows overview (not cockpit). |
| `ke_toan` | `tai-chinh` module active by default (`finance`); `giang-day`/`lop-hoc` etc. hidden or partial. |
| multi-role (e.g. `giao_vien`+`giam_doc_dao_tao`) | NOT collapsed (isTeacherOnly false) — full sub-tab sets per gate. |

---

## 5. Default / empty / active state rules

1. **Active module** = module containing `activeSection` (lookup via `SECTION_TO_MODULE`). If
   `activeSection` is `profile` (avatar menu), no module is active (rail shows no highlight),
   matching that profile is not a rail item today.
2. **Click a module** → navigate to `firstVisibleSubtab(module)` = the module's first
   `visible` subtab in declaration order. (For a persona seeing 1 subtab, that's the only
   screen.)
3. **Active sub-tab** = `activeSection`. SubTabBar `value={activeSection}`,
   `onChange={section => onSectionChange(section)}` (controlled — see §6 gotcha).
4. **Single-subtab module**: the left rail always shows the **module's** icon+label (uniform —
   never the single screen's own label); clicking it navigates directly to that one screen; and
   the **SubTabBar is suppressed** (no sibling to switch to). The screen's existing
   `<Text size="xl">` title carries in-page context. **Accepted tradeoff (user decision,
   2026-07-04):** a persona whose module resolves to one visible screen sees the *module* name
   in the rail, not the screen name — e.g. a `giao_vien`-only user sees **"CRM & Kinh doanh"**
   in the rail (not **"Huy hiệu"** directly) and must click into it to reach the badges screen.
   This is a **deliberate, user-confirmed** discoverability change vs today's flat nav (uniform
   rail chosen over per-screen discoverability); it is NOT a regression and should not be
   re-flagged as one.
5. **Zero-visible module**: not rendered in the rail (mirrors `shell.tsx:551`).
6. **Unknown / "/" URL**: existing normalize logic (`App.tsx:570-574`) redirects to
   `defaultSection(me)` — unchanged; the derived module follows.

---

## 6. Component architecture

New/changed pieces (Option C):

1. **`SECTION_TO_MODULE` + module order — DERIVED from `buildNavGroups`, not hand-authored
   (B2).** `buildNavGroups` (`shell.tsx:625-714`) ALREADY encodes the section→group membership,
   order, icons and labels. Declaring a standalone `MODULES` with its own
   `subtabs: SectionKey[]` list would create a **second source of truth**: a guard that "every
   section is in exactly one module" only catches a MISSING section, not a section placed in the
   WRONG module. So `nav-modules.ts` does NOT declare a hand-written `subtabs` list. Instead:
   (a) `buildNavGroups` attaches `key`+`icon` per group (§6.2; `groupLabel` is already the
   label); (b) `SECTION_TO_MODULE` / `moduleOf(section)` are computed by scanning
   `buildNavGroups` group membership (`items[].key` — membership is **role-invariant**, so build
   the map once); (c) module order = group declaration order. Grouping thus lives in exactly ONE
   place (`buildNavGroups`) — the **DRY win** — consumed by the sidebar rail, the SubTabBar, and
   active-module resolution.
2. **`buildNavGroups` → keep, adapt** — it still computes per-leaf `visible`. Add a `key`
   (module slug) + `icon` to each returned group (extend `NavGroup`, `shell.tsx:103-106`), so
   the sidebar can render modules without a second source of truth. Groups already map 1:1 to
   modules; declaration order = module order.
3. **Sidebar rail (in `Shell`, `shell.tsx:549-565`)** — render one `ModuleItem`
   (icon+label, `active = activeModuleKey === group.key`) per group with ≥1 visible subtab.
   Click → `onSectionChange(firstVisibleSubtab)`. Replaces the GroupLabel+leaf loop.
4. **`SubTabBar`** — new component (in `shell.tsx` or `apps/admin/src`), rendered at the top
   of `AppShell.Main` content (`shell.tsx:569-573`) above `{children}`. Consumes the themed
   Mantine `Tabs` (`packages/ui/src/theme.ts:332-355`), one `Tabs.Tab` per visible subtab of
   the active module, `value={activeSection}`, `onChange`. Suppressed for single-subtab
   modules (§5.4). It renders only the tab STRIP — panel content stays `{children}` from the
   existing `renderContent` switch (we do NOT move panels into `Tabs.Panel`; see decision #2).
   **Responsive (S3):** the themed `Tabs.List` (`theme.ts:332-355`) has NO overflow handling and
   does not auto-scroll; modules with many subtabs (`giang-day` up to 5, `lop-hoc` up to 5,
   `quan-tri` up to 6) will wrap/overflow on narrow screens. Requirement: on the `< sm`
   breakpoint the `Tabs.List` MUST be horizontally scrollable (or explicitly wrap) so no subtab
   becomes unreachable — specify the `Tabs.List` scroll/wrap behavior when building `SubTabBar`.
5. **`App.tsx` wiring** — compute `activeModuleKey` from `activeSection` and pass it +
   the active module's visible subtabs to `Shell`. `renderContent` switch, `handleSectionChange`,
   `handleSearchNavigate`, routing block, `ALL_SECTION_KEYS`, `defaultSection` — all unchanged.

**Mantine v7 gotcha (grounded) — this controlled mechanism is NEW work, not proven by the
`student-management-panel` precedent (which is uncontrolled `defaultValue`; see §1 M2 caveat):**
`SubTabBar` must be a **controlled** `Tabs` (`value`+`onChange`), not `defaultValue`, so it
stays in sync with URL-derived `activeSection` — otherwise back/forward and search deep-links
desync the strip. This URL↔strip sync (including back/forward behavior) is the genuinely new
part to build and verify. We render
only the tab strip (no `Tabs.Panel`), so the `keepMounted` state-reset caveat (inactive
`Tabs.Panel` unmount on switch) does **not** apply — panel lifecycle stays governed by the
existing switch, which already fully remounts on section change. (Refs:
https://v7.mantine.dev/core/tabs/ , https://mantine.dev/guides/react-router/ )

---

## 7. The ~35-case switch — keep vs. registry (open decision #2)

The switch at `App.tsx:620-883` maps each sectionKey → a panel, but many cases pass
**per-screen closures/props** that are not data: `goToClass`, `navAction`, `selectedSession`
/`setSelectedSession` (schedule, `App.tsx:670-684`), `oppId` (crm, `App.tsx:789-790`),
`initialStaffNav` (org, `App.tsx:654-655`), `studentNav` (students, `App.tsx:658-659`),
`facilityId` derivations (attendance-report/courses/hr). A pure data registry cannot hold
these closures cleanly.

- **Recommended (hybrid):** add a thin nav-only module layer **derived from `buildNavGroups`**
  (which already owns module→subtab grouping, labels via `groupLabel`, and — after §6.2 —
  `key`+`icon`). The rail + SubTabBar consume that derived grouping; we do NOT hand-author a
  parallel `MODULES.subtabs` registry, which would be a second source of truth that a
  presence-guard cannot fully police (B2). **Keep the `renderContent` switch as-is** — it is the
  view layer with heterogeneous props, not duplication. YAGNI: don't convert working, prop-rich
  wiring into a render-fn registry for no functional gain and real regression risk.
- **Alternative (full registry):** a `Record<SectionKey, {render: (ctx) => ReactNode}>` where
  `ctx` bundles every closure. Cleaner in theory, but forces a `ctx` object threading every
  handler through every panel — a large, risky refactor touching all 35 wirings at once.
  (Facility-id derivations that support this point live inline in the switch for
  `attendance-report`/`courses`; the `hr` case itself passes no props — its facilityId is
  derived inside `HrPayrollSection`, not the switch.)

Recommendation: **hybrid.** Surface for user/red-team as decision #2.

---

## 8. Open decisions for sign-off (the P0 gate)

1. **URL scheme:** Option C (keep flat `/{sectionKey}`, derive module — RECOMMENDED, zero
   redirect risk) vs. Option A (two-segment `/{module}/{subtab}` + redirect layer).
2. **Switch vs. registry:** hybrid (nav-only registry, keep view switch — RECOMMENDED) vs.
   full render registry.

Both plan phases below assume the recommended answers (C + hybrid). If A is chosen, Phase 1
gains a `LEGACY_SECTION_REDIRECTS` sub-task + metadata-dir migration, and Phases 2-4 gain
per-module route wiring.

## Sources
- [Mantine Tabs v7](https://v7.mantine.dev/core/tabs/) · [Usage with React Router](https://mantine.dev/guides/react-router/)
- [SaaS sidebar + nested-tab IA best practices (Lollypop, 2025)](https://lollypop.design/blog/2025/december/tabs-design/) · [Nested tab guidelines (DesignMonks)](https://www.designmonks.co/blog/nested-tab-ui) — two-level depth max; keep parent visible while scrolling nested content; active tab must not rely on color alone.
