# Phase 5 — CRM hygiene: contact directory + dup-phone warning + sale afterSale perm

## Context links
- Brainstorm §2 CSKH/Danh bạ, D3/D6; plan.md serialization (permissions.ts edit #3, LAST).
- Anchors: `apps/api/src/routers/crm.ts:160` (contactList — 0 callers), `:71-100` (server-side dedupe on createLead — silent); `apps/admin/src/crm-panel.tsx` (createLead flow); `packages/auth/src/permissions.ts:28-34` (afterSale.* = cskh/gd_kd; sale excluded).

## Overview
Surface the existing (unused) contact directory, make phone-dedupe visible before opportunity creation, and grant sale the afterSale.* permissions (facility-scoped) so cases stop piling on the business director.

## Key Insights
- `crm.contactList` (`:160`) already exists with 0 callers — this is a pure UI-surfacing task, no new API.
- Dedupe logic already runs server-side (`:71-100`) but SILENTLY → duplicate opportunities slip through. Fix is to surface the match: before create, show existing OPEN opportunities on that phone so the user decides. Reuse the existing dedupe query rather than adding a new one.
- role `cskh` is currently unassigned to anyone (brainstorm §2) → all afterSale cases route to gd_kd. D3: grant sale afterSale.* (facility-scoped). Authorization change → decision 0027… (actually 0027 is delegated-approver; afterSale grant is covered under decision scope in P6 — record it as part of the authorization decision set).

## Requirements
- `permissions.ts:28-34` afterSale.{list,create,transition,assign} += `'sale'` (keep setStudentLifecycle director-only).
- **M7:** `user.listAssignableForAfterSale` (`permissions.ts:241`, currently cskh/gd_kd) += `'sale'`. The assign dropdown calls it (`cskh-panel.tsx:97-99`); without this grant sale's assign flow throws FORBIDDEN in the UI. Its own comment says it must track the afterSale.assign role set. This makes the P6 snapshot diff 4 modules, not 3 — see P6.
- Contact directory UI: search by phone/name, calls `crm.contactList`.
- createLead flow (crm-panel): on phone entry matching existing contact, surface open opportunities (warning, non-blocking) before create.

## Architecture
- Data in: phone/name query → contactList; new-lead phone → dedupe lookup.
- Data out: contact directory list; pre-create warning with existing open opps.
- Facility scope: afterSale grant to sale is facility-scoped by existing RLS/handler — verify sale cannot act cross-facility.

## Related code files
- `packages/auth/src/permissions.ts:28-34` (modify — SERIALIZE edit #3, LAST; regen snapshot after this in P6).
- `apps/admin/src/crm-panel.tsx` (modify — surface dup warning in createLead).
- new contact-directory panel (create) calling `crm.contactList`.

## Implementation Steps
1. permissions.ts: afterSale list/create/transition/assign += 'sale' AND user.listAssignableForAfterSale += 'sale' (serialized #3, M7).
2. Contact directory panel: search input → contactList; render results.
3. createLead: reuse dedupe (`:71-100`) to fetch open opps for entered phone; render non-blocking warning listing them; user confirms to proceed.
4. Tests: sale can list/create/transition/assign afterSale within facility, denied cross-facility + setStudentLifecycle; dup-phone warning shows existing open opps.

## Todo list
- [x] permissions afterSale += sale AND listAssignableForAfterSale += sale (serialized #3, M7)
- [x] contact directory panel (contactList)
- [x] createLead dup-phone warning (reuse server dedupe)
- [x] tests: afterSale scope + dup warning

## Success Criteria
- §6.6 directory searchable by phone/name; creating opp on existing phone warns with open opps.
- Sale handles afterSale cases within own facility; setStudentLifecycle stays director-only.

## Evidence
- `packages/auth/src/permissions.ts`: `afterSale.{list,create,transition,assign}` and
  `user.listAssignableForAfterSale` include `sale`; `setStudentLifecycle` remains director-only.
- `apps/admin/src/contact-directory-panel.tsx`: searchable contact directory backed by
  `crm.contactList`.
- `apps/admin/src/crm-panel.tsx`: non-blocking duplicate-phone warning lists open opportunities
  from the already-loaded pipeline before create.
- `pnpm --filter @cmc/admin typecheck` PASS.
- `pnpm --filter @cmc/api typecheck` PASS.
- `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts test/cskh-assignable-staff.int.test.ts test/role-flows-crm-hygiene.int.test.ts test/aftersale-student-lifecycle.int.test.ts test/crm-sales-ops.int.test.ts`
  PASS, 5 files / 42 tests.

## Risk Assessment
- afterSale grant lets sale over-reach into other facilities' cases — Med×Med. afterSale handlers are facility-scoped; add cross-facility denial test.
- Dup warning too noisy / blocks legitimate re-leads — Low×Low. Non-blocking warning (info), user proceeds.

## Security Considerations
- No new sensitive data; afterSale writes already audited by existing handlers.

## Rollback
- Permission: remove 'sale' from afterSale (snapshot regen). UI directory/warning are additive; safe to leave or remove.

## Next steps
- P6 regenerates the single parity snapshot capturing all 3 permissions edits (P3+P4+P5).
