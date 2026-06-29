# Session journal — CRM form view + admin path routing

Date: 2026-06-30 · Branch: develop · Lane: high-risk · Intake #30 · Story CRM-FORMVIEW-ROUTING · Decision 0016

## What shipped

Four user-reported CRM problems, plus the URL-structure question, resolved end-to-end.

1. **Kanban → Odoo-style record page.** New `apps/admin/src/opportunity-detail.tsx`:
   forward-only clickable O1→O5 statusbar (reuses `crm.opportunityTransition`), inline header
   actions (reassign / schedule test / mark-lost / reopen), lead+attribution info, assignment
   ledger, activity log (Chatter). Kanban cards trimmed to name / program / phone / owner /
   days-in-pipeline.
2. **Reassign picker.** New read-only `crm.assignableOwners({facilityId})` → searchable staff
   `Select` (name · role). UUID paste box removed. Server `assertValidOwner` unchanged.
3. **Click-through.** List `onRowClick` + kanban card click → `/crm/opportunities/:id`.
4. **Hash → path routing.** `react-router-dom` v7 `BrowserRouter`; sections are clean paths
   (`/crm`, `/schedule`, …); opportunities deep-link at `/crm/opportunities/:id`. `/` + unknown
   → persona default.

Also added `crm.opportunityGet({id})` so deep links resolve independent of the facility selector.
Shared CRM constants extracted to `crm-shared.ts` (DRY across panel + detail).

## Why it was low-friction

- Prod already serves the admin SPA via `docker/nginx-spa.conf` (`try_files … /index.html`) at
  root `/` → BrowserRouter works in prod with **zero infra change**.
- Hash usage was contained to `App.tsx` + `main.tsx` only.
- `DataTable` already had an unused `onRowClick` prop.
- The two new endpoints are pure reads, RLS-scoped like every sibling CRM query → no new trust
  boundary, no schema migration (owner names resolved client-side from `assignableOwners`).

## Decisions made mid-flight

- **Full path migration** (user chose over deep-link-only) → decision 0016.
- **Statusbar forward-only** (review M1): past stages disabled so an accidental click can't
  silently regress a lead / wipe `lostReason`.
- **`ctv_mkt` kept on `assignableOwners`** (review M2): consistent with its existing full CRM read;
  staff names are low-sensitivity and it cannot reassign.

## Verification

admin typecheck/lint/build ✓ · auth+api typecheck ✓ · permission-parity 25/25 ✓ ·
crm integration 9/9 ✓ · GitNexus change-scope confined to expected files · code-review
DONE_WITH_CONCERNS (no Critical/High; nits L1 key + L3 comment fixed).

## Follow-ups / unresolved

- Browser persona-QC (real Chrome, deep-link hard-refresh + statusbar) not yet run — recommended
  before merge to main.
- LMS app (`hoc`) still uses hash routing — out of scope (separate SPA); migrate later using this
  CRM route as the pattern.
- Staff-profile / schedule-session detail still use in-place state (no URL) — can adopt record
  routes later.
