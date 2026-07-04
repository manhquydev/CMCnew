---
title: "P5 — Re-skin: Staff profile onto record-detail primitive"
description: "Refactor staff-profile.tsx to consume packages/ui/src/record-detail.tsx (P2) — first real consumer, proves the primitive."
status: implemented
priority: P3
effort: high-risk lane (Authorization hard gate, see high-risk/)
branch: feat/phase-d-facility-picker-and-stitch-wireframes
tags: [ux, ui-rebuild, staff]
created: 2026-07-03
---

## Overview

Plan 5 of 7. First real consumer of P2's `record-detail.tsx` — this plan validates the primitive's generality (or reveals gaps P2 missed).

## Scope (detail when P1+P2 land)

Refactor `apps/admin/src/staff-profile.tsx` to consume `record-detail.tsx` instead of its own hand-rolled Tabs+Chatter. Zero visual/behavior change expected (this is a re-implementation, not a redesign — staff-profile.tsx was already the reference pattern P2 was extracted from).

## Dependencies

- Depends on: P1, P2
- Independent of: P3, P4, P6, P7

## Implementation Summary (2026-07-03)

Red-team found 2 architectural gaps in P2's already-committed interface (ref reads aren't reactive;
`roles→primaryRole` auto-clear has no hook) plus an Authorization hard-gate + zero test coverage —
elevated to high-risk lane (see `high-risk/`), decision [0032](../../docs/decisions/0032-record-detail-primitive-reactive-extension.md).

P2 extended with 3 backward-compatible additions: `RecordDetailHandle.data`, `RecordDetailPanelProps.onStateChange`,
`RecordDetailField.onFieldChange` (+ exported `applyFieldChange` pure helper, 4 new unit tests).

`staff-profile.tsx` migrated: header (back/title/badge/edit/save/cancel/reset-password) stays
caller-owned; sheet+tabs+activity-rail delegated to `RecordDetailPanel` via a ref handle. Notable
implementation choices (documented, not silent):
- `isActive` represented as two `RecordDetailField`s sharing one form key (`isActive`) — a read-only
  display row in "Định danh" + an editable Switch in "Phân quyền" (different sections, no React-key collision).
- `roles`/`facilityIds` read-mode keep their pill-badge look via `field.render` returning `<Badge>`
  fragments (span-level, safe to nest inside the primitive's `<Text>` row) instead of a `<Group>` div.
- `EmploymentTab`/`PayrollTab` (unchanged) wrapped in adapters that rebuild `StaffProfileUser` from
  the primitive's live form data, memoized on only the fields each tab reads so its fetch-effect
  doesn't re-fire on every unrelated keystroke while editing.
- Cancel ("Hủy") remounts `RecordDetailPanel` via a bumped `key` (not just `editing=false`) — the
  primitive only auto-resets form state on `entityId` change, and read-mode reads the same live
  form data as edit-mode, so an unsaved draft would otherwise leak into the read view post-cancel.
- Section note + validation banner (no note slot on `RecordDetailSection`) render in the caller's
  own wrapper region above the panel, per P2's FIX #4 chrome boundary.

Verification: `pnpm --filter @cmc/ui exec vitest run` 40/40 pass; `tsc --noEmit` clean for `@cmc/ui`,
`@cmc/admin`, and `pnpm -w typecheck` (12/12 packages); ESLint clean (0 errors, 0 warnings) on both
touched files; `gitnexus_detect_changes({scope:'all'})` — low risk, 0 affected processes, changed
symbols match the expected file set. No jsdom/RTL infra exists for component-render tests (repo-wide
gap, not introduced by this change) — manual before/after verification on the running admin app is
the acknowledged proof gate for the UI-level migration (not yet executed this session; flagged below).
