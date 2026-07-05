---
title: "Brainstorm — 4-plan decomposition: UX hardening + student-account auth + nav IA restructure"
date: 2026-07-04
type: brainstorm-report
status: design-approved (user-confirmed decisions), plans to be authored next
branch: feat/phase-d-facility-picker-and-stitch-wireframes
scout_agents:
  - misleading-edit-affordance sweep (found 1 real bug)
  - class-detail deep scout (confirmed the bug location)
  - uncontrolled Select/Input system sweep (confirmed single instance)
  - date/time input system sweep (found ~25 gaps)
---

## Problem statement

User raised 4 distinct improvement areas after the 8-phase Core-3 re-skin
(`plans/260703-2351-erp-admin-reskin-core3/`) completed. Session output = a set of
**plans only** (no implementation), each plan sized to one concern and split into phases
(explicit user constraint: "tránh gộp 1 plan to"). Downstream flow requested:
Brainstorm → Plan → plan:Red-team → plan:validate → normalized final plans.

## Scout ground truth (verified in code, not assumed)

**#1 Misleading edit-affordance** — codebase is largely disciplined here (shared
`record-detail.tsx` + `profile-settings-panel.tsx` carry explicit "no fake UI" design
comments; `data-table.tsx` only sets `cursor:pointer` when `onRowClick` is supplied). One
real bug confirmed, matching the exact page the user recalled (class detail):
`apps/admin/src/class-workspace.tsx:1260-1264` — the "Đổi trạng thái" `Select` has
`data`+`onChange` but **no `value` prop** → uncontrolled, never reflects the class's real
status, sits next to a `StatusBadge status={batch.status}` that shows the true value, so the
two visibly disagree until the admin clicks. A full system sweep (27 files, every
Select/SegmentedControl/Checkbox/Switch) confirmed this is the **only** instance of the
uncontrolled-reflect-field bug. Secondary minor item: `shift-reg-list-panel.tsx:89-105`
whole-row `cursor:pointer` but the last "Thao tác" cell has no row-level `onClick` (dead-click
around the buttons).

**#2 Date/time inputs — manual typing where a picker is expected.** `DateInput` already used
correctly in 12 spots. Gaps: **no `TimeInput` anywhere** (~5 `HH:mm` manual fields:
class-workspace session start/end, meetings-panel time, shift-config start/end — several sit
directly beside an existing `DateInput`, the clearest "half-done" pickerization); ~14
`YYYY-MM-DD` manual `TextInput` fields (student DOB appears in **3 different UX treatments**
across class-workspace(picker)/students-panel(manual)/finance-panel(manual); pricing/voucher
effective dates; revenue/reconcile report range filters); ~3 `YYYY-MM` "kỳ" fields
(payroll/KPI/attendance-report) that want `MonthPickerInput`; `shift-reg-detail-panel.tsx`
uses raw `<input type="date">` (not even Mantine) — the most primitive, worth normalizing.

**#3 Student account default identity + password.** Current `loginCode` =
`{facility.code}-{studentCode}` (`finance.ts:935`), unrelated to phone. Password = **random
6-byte hex** per provision/reset (`genTempPassword`, `student.resetLmsPassword`), not fixed.
A `normalizePhone` helper exists (`crm.ts:62`) but outputs `+84…` (with `+`, for CRM dedupe)
and is **not** applied to `ParentAccount.phone` in the receipt-approve flow. **No parent/
student LMS password-change UI exists at all** — this is net-new, not a modification.

**#4 Nav IA.** Current structure is flat 2-level: a group label (e.g. "GIẢNG DẠY") holds N
independent leaf items, each a full-screen swap via a ~35-case switch in `App.tsx`. No
"module parent → horizontal sub-tabs" concept. Changing it touches `shell.tsx` (nav render) +
`App.tsx` (section model + routing) broadly.

## User-confirmed decisions (2026-07-04, via AskUserQuestion)

- **#1**: fix the confirmed class-status dropdown bug + the deep-scout already ran (no broader
  hidden instances). Bundle with small UX fixes.
- **#3 phone format**: student login identity = `84xxxxxxxxx` **without** leading `+`
  (do NOT reuse `crm.ts` normalizePhone which emits `+84`; write a dedicated login-normalize
  helper so the display/CRM phone format is untouched). Default password = `Cmc2026@`.
  Two password-change flows: (a) Parent-portal self-service change — no old-password required,
  set new directly (simplified); (b) ERP-side "reset" = force back to `Cmc2026@` (no input).
- **#3 legacy accounts**: project is pre-launch → old `HQ-HS-xxx` loginCode accounts are
  irrelevant, **no backfill/migration needed**.
- **#4 nav**: full nav conversion in **one** plan (user chose the higher-risk all-at-once over
  a POC-first staged approach). Module grouping = the **existing 8 nav groups** become the 8
  modules (GIẢNG DẠY / LỚP HỌC / HỌC SINH / CRM & KINH DOANH / TÀI CHÍNH / NHÂN SỰ / CÔNG CA /
  QUẢN TRỊ) — keep business/permission boundaries, only change presentation (parent module →
  horizontal sub-tab bar instead of N flat leaf items).
- **#2 structure**: single plan, phases split by screen-group (like the re-skin batch split),
  not 3 separate plans.

## The 4 plans (decomposition)

| Plan | Scope | Lane / risk | Phase shape (proposed) |
|---|---|---|---|
| **A — UX correctness quick-fixes** | #1 class-status dropdown `value` fix + `shift-reg-list-panel` dead-click + normalize `shift-reg-detail-panel` raw `<input type=date>` to Mantine | tiny/normal, low risk | 1-2 phases (they're small, independent edits with real-behavior verification) |
| **B — Date/time picker system rollout** | #2 — add TimeInput + MonthPickerInput usage, pickerize ~14 manual date fields; unify the 3-way student-DOB UX | normal, medium (broad but presentation-only, no business logic) | P0 shared picker wrappers/conventions → P1..Pn by screen-group (finance, class/schedule, HR/payroll, reports) |
| **C — Student account phone-identity + password flows** | #3 — login=84xxx, default pw `Cmc2026@`, parent self-service change (no old pw), ERP reset-to-default | **high-risk (Auth hard-gate per FEATURE_INTAKE.md)** | P0 decision doc + phone-normalize helper + schema/provision change → P1 ERP reset flow → P2 parent-portal change UI → P3 backend contract tests (RLS, dedupe, idempotency) |
| **D — Nav module + sub-tab IA restructure** | #4 — 8 modules, parent click → horizontal sub-tab bar; convert full nav + routing | **high-risk (cross-cutting IA, all ~35 sections + shell + routing)** | P0 IA design + routing model (URL scheme for module/subtab, deep-link compat with C's search deep-links) → P1 shell/nav component → P2..Pn migrate section groups module-by-module → Pn final: retire old flat nav |

**Build-order dependency note**: D (nav routing) and the existing search-deep-link
(`onSearchNavigate` in shell.tsx) + C (if it adds any student-account admin screens) all touch
routing/section model. D should either land before C's UI bits or explicitly coordinate the
routing contract. B and A are independent of C/D and can proceed anytime. Recommend sequence:
**A → B → C → D** (ascending risk; D last so its routing rewrite absorbs the final state of
everything else), but A/B/C are independently shippable.

## Cross-cutting constraints (apply to all 4 plans)

- Full-stack completeness: API + backend + UI must all be present and usable per feature —
  no UI wired to a missing endpoint, no endpoint with no UI (explicit user requirement).
- Test rigor: deep/adversarial, not shallow — catch operational-breakage risks. Each plan's
  validation section must specify unit + integration (+ E2E where a real flow exists), and
  the harness loop (implement → code-review → gitnexus audit → live-verify → commit) applies
  per phase as in the re-skin plan.
- Harness discipline: each plan authored, then `plan:red-team`, then `plan:validate`, then
  normalized — before any implementation (implementation is OUT of scope this session).
- Expert-grounded: where design needs current best-practice (nav IA patterns, Mantine dates
  API, VN phone-auth conventions), verify against live sources to avoid stale/hallucinated
  guidance.

## Out of scope this session

- All implementation (this session outputs plans only).
- Legacy student-account migration (#3) — pre-launch, not needed.
- Any nav grouping change beyond the existing 8 groups.

## Unresolved questions (to resolve during per-plan authoring, not blocking)

1. Plan C — parent self-service password change: which surface hosts it (existing LMS parent
   portal `apps/lms` parent view vs a new screen)? Needs a scout of the LMS parent app during
   Plan C authoring.
2. Plan C — is student login identity = the parent's phone shared across siblings? If one
   parent has 2 children, the `84xxx` login collides. Must resolve during Plan C authoring
   (picker-after-login vs per-child suffix vs one-account-per-parent). Flagged as the top
   red-team target for Plan C.
3. Plan D — URL/routing scheme for module+subtab must stay compatible with the search
   deep-link contract (`onSearchNavigate`) shipped this session. Resolve in Plan D P0.
