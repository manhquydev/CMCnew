---
title: "UX Audit Action Plan — persona-QA findings + form-to-Modal sweep"
description: "Resolve remaining live persona-QA UX findings + convert 8 admin create-forms from fixed Card to Modal, using existing students/courses-panel pattern."
status: implemented
lane: normal
priority: P2
effort: 10h
branch: fix/ux-audit-action-plan-260703
tags: [ux, admin, crm, i18n, navigation, modal, polish]
created: 2026-07-03
updated: 2026-07-03
---

## Rebase note (2026-07-03, post red-team)

Branch fast-forwarded from `develop` to `main` tip (`84ff0d2`) after red-team found `main` already
shipped PR #26 (`ec6d1c4`) resolving 4 of this plan's original findings (#4, #5, #10, #15) in the
exact files this plan targets. Re-verified against post-rebase code (not assumed) — all 4 confirmed
fixed, dropped from scope below (see each phase file for evidence: grep results, line numbers).
Effort reduced 14h → 10h; Phase 2 dropped entirely (fully superseded).

## Overview

Two co-produced source reports this session drive this plan:

1. `plans/reports/ui-ux-designer-260703-persona-qa-master-findings-report.md` — 33 deduped UX findings from live persona QA (severity-ranked, file/module hints per finding).
2. `plans/reports/brainstorm-260703-1341-ui-rebuild-stitch-wireframe-scope-report.md` — follow-up scope brainstorm that widened finding #25 from 1 panel to **8 admin panels** sharing the same anti-pattern: a multi-field create form rendered as a **fixed `Card` above the list/table** instead of inside a `Modal`. It decided (approach A) to fix the 8-panel Modal issue **now** as this `normal`-lane plan, copying the existing pattern from `apps/admin/src/students-panel.tsx` / `apps/admin/src/courses-panel.tsx` — **do not redesign**.

This plan does **exactly two things**: (a) resolve the actionable persona-QA findings, and (b) modal-ize the 8 offending create-forms. It is grounded in the current code (files read + greped, not just the report hints).

### The house Modal idiom (single shared pattern — DRY)

Both `students-panel.tsx` and `courses-panel.tsx` already implement the target. `courses-panel.tsx` is the canonical reference (`useDisclosure`):

```tsx
const [opened, { open, close }] = useDisclosure(false);
const form = useForm({ initialValues: {…}, validate: {…} });
async function create(values) { … await mutate(values); close(); form.reset(); load(); }
// header: <Button leftSection={<IconPlus/>} onClick={open}>Tạo …</Button>
// <Modal opened={opened} onClose={close} title="…" radius="xl" centered><form onSubmit={form.onSubmit(create)}>…</form></Modal>
```

**Phase 1 (CRM) and Phase 6 (7 panels) MUST both adopt this same idiom — do not invent a variant.** CRM's create form currently uses loose `useState` fields (not `useForm`); migrate it to the same shape so the two phases stay consistent. No new shared abstraction/component is introduced (YAGNI) — the pattern is a copy, not a library.

### Scope boundaries (read before adding anything)

- **RETRACTED — do NOT create phases:** findings **#2, #3** are false positives per the master report's CORRECTION section.
- **ALREADY FIXED on `main` (PR #26 / `ec6d1c4`) — do NOT re-implement:** findings **#4, #5, #10, #15**. Verified post-rebase against live code; evidence in each phase file (Phase 1, Phase 2 [dropped], Phase 3, Phase 5).
- **OUT OF SCOPE — deferred to Phase D framework/wireframe initiative** (`plans/260629-2127-odoo-parity-ux-framework/plan.md`): "Bucket B — redesign decision" findings **#11, #12, #19, #22, #26, #29, #32** (and the broader list-page/detail-page mold work). They are intentionally not dropped — they belong to the wireframe track, not this fix track. #25 (CRM form-above-pipeline) is folded into Phase 1 here; the generalized "no fixed form on any list" design rule stays in Phase D.
- No schema, auth, or authorization changes.

## Phases

| # | Phase | Findings resolved | Files (owner — no overlap) | Effort | Status | File |
|---|-------|-------------------|----------------------------|--------|--------|------|
| 1 | CRM module + Modal-ize "Tạo cơ hội" | #6, #13, #18, #20, #25 (~~#4~~ dropped) | `crm-panel.tsx`, `opportunity-detail.tsx`, `contact-directory-panel.tsx`, `crm-shared.ts` (read-only ref) | 2.5h | **implemented, reviewed (APPROVE)** | [phase-01-crm-module.md](phase-01-crm-module.md) |
| 2 | ~~Auth/Users & Roles~~ | ~~#5~~ | — | — | **dropped** (already fixed on `main`) | [phase-02-role-labels.md](phase-02-role-labels.md) |
| 3 | Navigation & routing | #7 (~~#10~~ dropped) | `shell.tsx`, `payroll-panel.tsx` (root-cause was here, not the nav gate — see phase file) | 0.5h | **implemented, typecheck clean** | [phase-03-nav-routing.md](phase-03-nav-routing.md) |
| 4 | Attendance & teaching schedule | #8, #9, #27, #28 | `attendance-panel.tsx`/`attendance-roster.tsx`, `schedule-panel.tsx` | 2.5h | **implemented, reviewed (APPROVE)** | [phase-04-attendance-schedule.md](phase-04-attendance-schedule.md) |
| 5 | Misc UI/copy polish (grab-bag) | #14, #16, #17, #21, #23, #24, #30, #31, #33 (~~#15~~ dropped, #27/#28 moved to Phase 4) | scattered, each file-local | 2h | **implemented, reviewed (APPROVE)** | [phase-05-misc-polish.md](phase-05-misc-polish.md) |
| 6 | Modal-ize remaining 7 create-forms | #25 (extended) | `certificate-panel.tsx`, `compensation-panel.tsx`, `email-outbox-panel.tsx`, `facility-network-panel.tsx`, `kpi-evaluation-panel.tsx`, `shift-config-panel.tsx` (~~`session-evidence-panel.tsx`~~ excluded — not a list+form pattern, see phase file) | 4h | **implemented, reviewed (APPROVE)** | [phase-06-modalize-7-panels.md](phase-06-modalize-7-panels.md) |

Total effort: ~10h. Final consolidated code review (`plans/260703-1354-ux-audit-action-plan/reports/`, if written) verdict: **APPROVE WITH MINOR NOTES**, no blocking issues. `pnpm --filter @cmc/admin/@cmc/lms/@cmc/ui exec tsc --noEmit` all exit 0; full `@cmc/admin` vitest suite 27/27 passing; `gitnexus_detect_changes` confirms changed-symbol footprint matches declared phase scope exactly (21 files, no unexpected touches).

## Implementation notes (post-hoc, 2026-07-03)

- **#6 root cause**: not an index-logic bug — the stage-stepper's "current stage" button used the app's reserved DANGER color (`cmcRed`, same token as error toasts/rejected-status badges) instead of brand blue (`cmc`), so a director glancing at the pipeline read "current stage" as an alarm. One-line color fix in `opportunity-detail.tsx`, no logic change.
- **#7 root cause**: not a nav-gate mismatch — `NAV_GATES.hr` already correctly used `payroll.roster` (grants `giam_doc_kinh_doanh`+`giam_doc_dao_tao`). The actual bug was inside `payroll-panel.tsx`: a hardcoded `!roles.includes('hr') && !roles.includes('ke_toan')` guard that predated those two director roles being granted `payroll.roster` in the permission registry, and was never updated — a second, stale source of truth the shell.tsx comment explicitly warns against. Fixed by replacing it with `can(roles, isSuperAdmin, 'payroll', 'roster')`, the same check the nav already uses.
- **#8**: server (`apps/api/src/routers/attendance.ts`) enforces zero date/teacher-assignment rule on attendance marking — only role permission + data integrity. So "mirror the server gate" literally means there is no gate to mirror; implemented a warn+confirm pattern (not a hard block) so the client never rejects something the server would accept.
- Session-evidence-panel.tsx (Phase 6) is a per-session inline editor, not a list-with-create-form — correctly left as-is rather than force-fit into a Modal.

## Dependencies

- **Phase 1 → Phase 6**: both apply the same Modal idiom. Phase 1 lands first and defines the exact copy target (CRM form migrated to `useForm` + `useDisclosure`, including the `duplicateOpenOpps` dependency fix). Phase 6 follows the same shape; no divergence. Phases 1 and 6 touch **disjoint files**, so after Phase 1 lands they may run in parallel.
- **Phase 4 owns `schedule-panel.tsx` outright** — confirmed by reading the file: both #27 (empty-state) and #28 (facility-flash) live there. Phase 5 does not touch this file.
- Phases 3, 4, 5 are mutually independent (disjoint files) and may run in any order / parallel; Phase 1 and Phase 6 should sequence after Phase 1 settles the idiom (see above) but are otherwise independent of 3/4/5.
- All phases depend on the two source reports + `docs/design-system.md` (Modal section + Anti-Patterns table) as the house-style contract.
- Branch: work on `fix/ux-audit-action-plan-260703` (rebased onto `main` tip `84ff0d2`, per red-team); PR into `develop` per `AGENTS.md`. **Do not PR into `main` directly.**

## Acceptance criteria (plan-level)

- All 8 offending panels: create form no longer renders as a fixed Card above the list; it opens from a "Tạo …" button into a `Modal` (radius `xl`, centered), success closes + resets + reloads the list.
- No raw enum / uuid / English status string is visible to an end user in the surfaces touched (stages, activity log — roles and class/enrollment status already fixed upstream).
- Every finding number above is either resolved in-phase, already-fixed, retracted, or explicitly deferred — nothing silently dropped.
- `pnpm -w typecheck` and `pnpm -w lint` clean; touched panels smoke-tested in the running admin/LMS app.

## Unresolved questions

1. ~~Master findings report missing on disk~~ — RESOLVED, see Rebase note above.
2. ~~#10 relabel vs re-point~~ — RESOLVED, already fixed on `main` (relabeled to "Thông báo").
3. #9 / #27: widen the "Lịch dạy" default range vs. only improve empty-state copy — Phase 4 recommends the smaller copy+range fix; confirm no server-side range cap forces a backend change.
4. **New (repo hygiene, out of scope for this plan but flagged):** `main` and `develop` have no sync mechanism — every PR merges into `main`, nothing merges back into `develop`, so every new feature branch cut from `develop` starts stale. Recommend a follow-up: open a `develop`-sync PR now (fast-forward, trivial) and decide a standing policy (e.g. sync after every merge, or retarget PRs at `develop` first).
