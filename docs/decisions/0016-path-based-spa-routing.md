# 0016 — Path-based SPA routing for the admin app

- Status: accepted
- Date: 2026-06-30
- Deciders: product owner (manhquydev), engineering

## Context

The admin app (`apps/admin`, served at `erp.cmcvn.edu.vn`) drove its whole
navigation from a single-level URL hash (`#crm`, `#schedule`, …) held in
`Dashboard` React state. Record detail views (staff profile, schedule session,
CRM opportunity) were transient component state with no URL of their own.

Consequences of the hash model:

- No deep link to a specific record — a manager cannot copy a link to one
  opportunity and send it to a colleague.
- `#section` reads as a developer toy, not an enterprise ERP, and blocks
  per-page analytics / future SSR.

## Decision

Migrate the admin app from hash navigation to **path-based routing** with
`react-router-dom` v7 (`BrowserRouter`):

- Each top-level section becomes a clean path: `/overview`, `/crm`,
  `/schedule`, `/finance`, … (path segment == existing section key, so the
  nav/permission model is unchanged).
- The CRM opportunity record is deep-linkable at
  `/crm/opportunities/:oppId` — the first record route, and the template for
  future record routes (staff, schedule session) when they are migrated.
- `/` redirects to the persona default section; unknown paths redirect to the
  same default (no dead ends).

## Why this is safe to do now

- Production already serves the admin SPA behind `docker/nginx-spa.conf` with
  `try_files $uri $uri/ /index.html`, served from root `/`. BrowserRouter works
  in prod **with no Docker/nginx/Cloudflare change**. Vite dev has history
  fallback by default.
- Hash usage was contained to `App.tsx` + `main.tsx` only — no other panel
  reads/writes `location.hash`.

## Scope / non-goals

- LMS app (`hoc.cmcvn.edu.vn`) is out of scope this round.
- Staff-profile and schedule-session detail keep their in-place state model for
  now; only the CRM opportunity record gains a URL this round. They can adopt
  record routes later using the CRM route as the pattern.

## Rollback

Revert the `react-router-dom` dependency and restore the hash logic in
`App.tsx`/`main.tsx`. No data or schema is involved.
