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

## Browser QC (done after the above)

Real Chrome against the new code (admin dev → dev API :4100, dev DB, seed `quanly`):
clean paths `/crm` `/overview` ✓; kanban card + list row → `/crm/opportunities/:id` ✓;
detail page renders (forward-only statusbar O1 disabled / O2–O5 enabled, owner *name*, actions,
chatter) ✓; reassign = populated searchable staff picker (no UUID) ✓; **hard refresh on the record
URL loads the detail directly** (SPA fallback) ✓. Caught + fixed a real `<p><div>` nesting bug
(`Field` value rendered as `<p>`, owner `<Badge>` is a `<div>`) → value now `component="div"`.
Three `Unsupported style property` warnings confirmed pre-existing (appear on untouched pages too).

## Quality pass (post-commit simplify)

4 cleanup-review agents (reuse / simplification / efficiency / altitude). Consensus was the code is
at the right altitude; applied three behavior-preserving fixes:
- `ownerName` resolver (duplicated verbatim in both panels) → `makeOwnerName(owners)` in `crm-shared.ts`.
- Hand-kept `REASSIGN_ROLES` mirror → existing `can(roles, isSuperAdmin, 'crm', 'opportunityReassign')`
  helper. Also **fixed a latent mismatch**: the list had `bgd`, but the server grants reassign only to
  `quan_ly`/`giam_doc_kinh_doanh` — `bgd` no longer sees a button the server would 403.
- `App.tsx`: one `knownSection` const reused by the active-section pick and the redirect guard.
Deferred (cross-stream / YAGNI): promote the `Field` row to `@cmc/ui` (also in schedule/staff detail),
a shared `vi-VN` date formatter, and a generic record-route pattern (wait for a 2nd record route).

## Follow-ups / unresolved

- `develop` has a concurrent harness/session-loop commit stream; CRM work committed selectively
  (own files only) — `df24c6b` (feature) + a follow-up refactor commit.
- LMS app (`hoc`) still uses hash routing — out of scope (separate SPA); migrate later using this
  CRM route as the pattern.
- Staff-profile / schedule-session detail still use in-place state (no URL) — can adopt record
  routes later (must move to id-fetch, not prop-passing, to be deep-linkable).
