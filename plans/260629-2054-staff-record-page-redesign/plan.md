---
title: "Plan: Staff Record Page Redesign (Odoo-style single record)"
date: 2026-06-29
status: proposed
lane: high-risk
scope: plan-first-then-implement-after-approval
intake: 26
supersedes_ux_of: ../260629-2000-unified-staff-profile/phase-u1-staff-profile-read.md
inputs:
  - ../reports/researcher-260629-2045-odoo-form-view-openeducat-spec-report.md
  - "persona UX critique (live-driven, super_admin) — trace below"
---

# Plan: Staff Record Page Redesign (Odoo-style single record)

## Why (evidence)

Persona agent drove the LIVE app as super_admin (real screenshots) and confirmed the user's complaint:

- View (`Xem`) and Edit (`Sửa` modal) are two separate surfaces. Changing a phone = **4 clicks + 2 context switches**; the detail page even tells the user to go edit elsewhere (`staff-profile.tsx:145`).
- Edit modal has **3 separate save buttons + 1 auto-save toggle** — no single Save/Cancel; invites "saved name, forgot role".
- Nhật ký tab is an **empty placeholder** → the audit task "who last changed this role" is **impossible** today.
- Heuristic scores (stated rubric): record-unity 2/5, audit-visibility 1/5, efficiency 2/5; aesthetics 4/5, security-by-design 5/5.

Two real bugs found in shipped U1 (must fix):
- Employment block reads only `user.facilities[0]` (`staff-profile.tsx:66`) → multi-facility / facility-#2-only staff falsely show "Chưa có hồ sơ".
- `OrgPanel` calls unscoped `user.list` → a director may see all users (server-side RBAC question, not this UI's bug but flagged).

Reference (Odoo form view, cited in research report): header/statusbar (actions + state) → centered sheet → two-column field groups → notebook tabs for secondary data → **chatter** right column ≥768px, stacks below on mobile; modern Odoo = direct-edit dirty-state; fields readonly-by-permission.

## Target Design (one record page)

```text
┌────────────────────────────────────────────────────────────┐
│ ← Tên nhân viên   [Ngừng]              [Chỉnh sửa] / [Lưu][Hủy]│  header + action zone
├──────────────────────────────────────────┬─────────────────┤
│  SHEET (Grid span 8)                       │  NHẬT KÝ (span 4)│
│  Fieldset "Định danh"  (2-col)             │  Timeline (sticky)│
│   Tên hiển thị · Email(SSO,khóa) · SĐT      │  - đổi vai trò   │
│   Vai trò chính · Trạng thái                │  - đổi cơ sở     │
│  Fieldset "Phân quyền" (super_admin edit)  │  - kích hoạt/ngừng│
│   Vai trò · Vai trò chính · Cơ sở (+cảnh báo session)         │
│  Tabs: [Hồ sơ NS] [Lương & phụ cấp(gated)] │  (mobile: xuống dưới)│
└──────────────────────────────────────────┴─────────────────┘
```

- **One surface.** Delete the separate `UserEditModal` flow for users (and the list `Xem`/`Sửa` split → row click opens the record; a single header "Chỉnh sửa").
- **Edit model:** explicit **"Chỉnh sửa" → "Lưu"/"Hủy"** (not always-on direct edit) because roles/salary are sensitive. One `@mantine/form`, one submit that batches the needed mutations (updateProfile + setRoles/setFacilities/setActive) so partial-save can't happen.
- **Readonly-by-permission:** in edit mode, only fields the role may write become inputs; others stay read text with a small lock affordance (no "go elsewhere" footnote).
  - super_admin: everything except email.
  - hr/ke_toan: employment (position/grade/dependents/Callio) if a payroll-write perm holds; identity contact; roles/facilities read-only.
  - director: all read-only; payroll hidden.
- **Activity log inline** (right column, sticky; stacks below on mobile) — replaces the Nhật ký tab. Populated by the **secure facility-scoped** staff timeline (was U3), NOT the open Chatter path.
- **Lương & phụ cấp** stays a tab (sensitive, table-heavy, gated) — not forced into the column.

## Phases

| Phase | File | Risk | Purpose |
|---|---|---|---|
| R0 | (this plan) | — | DONE — employment lookup unions across ALL user facilities (was `[0]`). |
| R1 | (implemented in staff-profile.tsx + App.tsx) | high-risk | DONE (uncommitted) — single record page, header Chỉnh sửa/Lưu/Hủy, role-gated inline fields, batched save; removed UserEditModal; rows click-to-open. Validation added so a role edit with no primaryRole can't silently drop. |
| R2 | (implemented in audit.ts) | high-risk | DONE (uncommitted) — secure `audit.staffTimeline` (user.viewActivity + facility visibility pre-check) + inline right-column Timeline. Open Chatter untouched. |

Status: implemented, uncommitted, awaiting approval. typecheck auth/api/admin clean; permission-parity 25/25; code review DONE_WITH_CONCERNS → the one real defect (silent dropped setRoles) FIXED; remaining notes cosmetic. Dev app live (admin :5173, api :4000) for visual verification.

Facility edit (U2) stays as-is or folds similarly later; not blocking. The uncommitted U2 work remains valid (backend `user.updateProfile` is reused by R1's batched save).

## Acceptance Criteria

- Change a staff phone in **≤2 clicks on one page** (Chỉnh sửa → edit → Lưu), no surface switch.
- A non-permitted role sees those fields read-only (cannot even submit); backend still re-gates.
- Activity log visible without a tab click (right column / below on mobile); shows role/facility/status changes → audit task succeeds.
- Multi-facility staff show employment correctly (R0 bug fixed).
- No salary/employment over-fetch for unpermitted roles (preserve U1's wire-level gating).
- typecheck clean; permission-parity green; code review no blocking; existing user/facility/payroll tests pass.

## Out of Scope (this round)

- Director-scoped user.list server filtering (separate server RBAC story — flagged).
- Folding facility edit into a facility record page (later).
- Microsoft Graph G-phases (ADR 0015).

## Stop / Risks

- R2 must NOT widen the open Chatter `NOTE_TARGETS`; new gated endpoint with per-target visibility pre-check.
- Batched save must preserve existing session-invalidation semantics (setRoles/setActive bump tokenVersion; updateProfile does not).
- Removing UserEditModal: ensure no other caller depends on it.

## Open Decisions (ask before R1)

1. Edit model: explicit Chỉnh sửa/Lưu/Hủy (recommended) vs always-on direct edit?
2. Build R2 secure activity log NOW (so audit task works) or ship R1 first, R2 next?
3. List → record: clicking a user row opens the record (drop separate Xem/Sửa) — OK?
