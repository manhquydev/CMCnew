---
phase: 1
title: IP Display Fix
status: completed
effort: ''
---

# Phase 1: IP Display Fix

## Overview

`apps/admin/src/checkin-panel.tsx:122` shows the raw client IP address to any staff user
(`Ngoài mạng công ty (162.159.98.92) — cần manager duyệt`). Non-technical staff have no use for
an IP literal — it reads as a bug/debug leftover, not intentional UI. Replace with a plain status
message; keep the IP available only where it's actually useful (the existing admin approval table
already shows IP in a column for managers reviewing manual punches — that stays, this phase only
touches the staff-facing status banner).

## Related Code Files

- Modify: `apps/admin/src/checkin-panel.tsx` (line ~122, the `ipCheck.allowed ? ... : ...` status string)

## Implementation Steps

1. Read `checkin-panel.tsx` lines 100-140 to confirm current structure and any other reads of `ipCheck.ip` in the staff-facing (non-table) UI.
2. Replace the two status strings:
   - Allowed: `WiFi công ty (${ipCheck.ip})` → `Đang ở mạng công ty` (drop the IP).
   - Not allowed: `Ngoài mạng công ty (${ipCheck.ip}) — cần manager duyệt` → `Ngoài mạng công ty — cần quản lý duyệt chấm công`.
3. Leave the admin approval table's IP column untouched (managers reviewing manual punches legitimately need the IP for audit).
4. `gitnexus_impact` on the touched component before editing (target may not resolve by component name — grep-verify no other file imports the specific status-string logic).

## Success Criteria

- [ ] Staff-facing check-in status banner no longer shows a raw IP literal.
- [ ] Admin approval table (manager-facing) still shows IP for audit purposes — unchanged.
- [ ] `pnpm --filter @cmc/admin typecheck` clean.
- [ ] Manual verification: log in as a non-manager staff account, view `/checkin`, confirm the banner reads a plain status with no IP.
