# CRM form-view UX + path-based routing

- Lane: high-risk (cross-cutting routing migration + existing-behavior change)
- Branch: develop
- Decision: docs/decisions/0016-path-based-spa-routing.md
- Status: done — all 3 phases implemented + verified; code-review DONE_WITH_CONCERNS (no Critical/High).
  Product decisions applied: statusbar forward-only (M1); ctv_mkt kept on assignableOwners (M2).

## Problem (from user)

1. Kanban cards open only a thin modal — need an Odoo-style **record detail page**
   with a clickable stage statusbar and inline actions. Trim card content to essentials.
2. "Đổi người phụ trách" forces pasting a UUID — needs a **staff picker**.
3. List (and any view) rows must **click through to the detail page**.
4. URL is `/#crm` hash — migrate to clean `/crm/...` paths with shareable record links.

## Phases

### Phase 1 — Server: assignable-owner picker + single-opp fetch
- `crm.assignableOwners({ facilityId })` → active staff at facility with CRM roles
  (`{ id, displayName, primaryRole }`). Reuses `assertValidOwner` rule.
- `crm.opportunityGet({ id })` → one opp + contact, for robust deep-linking
  independent of the facility selector.
- `permissions.ts`: add `crm.assignableOwners` + `crm.opportunityGet` entries.
- Additive only — no change to existing endpoints. Files: `apps/api/src/routers/crm.ts`,
  `packages/auth/src/permissions.ts`.

### Phase 2 — Routing migration (hash → path)
- `apps/admin/src/main.tsx`: wrap in `<BrowserRouter>`.
- `apps/admin/src/App.tsx`: `<Routes>` — `/design`, `/`, `/:section`,
  `/crm/opportunities/:oppId`, `*`. `Dashboard` reads `useParams`/`useNavigate`
  instead of `window.location.hash`; `/` and unknown → redirect to persona default.
- Path segment == section key (nav + permissions unchanged).

### Phase 3 — CRM form view + picker + clickable rows
- New `apps/admin/src/opportunity-detail.tsx` (`OpportunityDetailPanel`):
  back header, clickable O1→O5 statusbar (→ transition), inline actions
  (reassign picker / schedule test / mark-lost / reopen), lead+owner info,
  assignment history, Chatter.
- `crm-panel.tsx`: row click + kanban card click → `navigate('/crm/opportunities/:id)`;
  render detail when route has `oppId`; reassign uses the staff `Select`;
  trim kanban cards (name, program, owner, phone, time-in-stage). List becomes a
  clean clickable table (record actions relocate to the detail page — intended UX change).

## Acceptance
- `/crm/opportunities/<id>` loads that opportunity's detail directly (hard refresh OK).
- Stage change from the statusbar persists and logs (reuses `opportunityTransition`).
- Reassign is a name dropdown; no UUID typing; server validation unchanged.
- List + kanban rows/cards open the detail page.
- All sections reachable by clean path; `/` redirects to persona default.
- admin typecheck + build green; api typecheck green; CRM int tests pass; no new lint errors.

## Risks / rollback
- Routing touches the app shell — mitigated: prod SPA fallback already exists; hash usage was contained to 2 files.
- Behavior change: list inline actions move to detail page (intended, user-requested).
- Rollback per decision 0016 (revert dep + App/main).
