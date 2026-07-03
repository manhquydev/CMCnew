---
title: "P5 — Re-skin: Staff profile onto record-detail primitive"
description: "Refactor staff-profile.tsx to consume packages/ui/src/record-detail.tsx (P2) — first real consumer, proves the primitive."
status: pending
priority: P3
effort: TBD
branch: TBD (create from P1's merge point)
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
