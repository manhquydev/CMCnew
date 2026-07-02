---
title: "P4 — Học bạ + certificate PDF (shared render) + LMS parent visibility"
phase: 4
status: pending
risk: high
owns: [apps/api/src/services/transcript-html.ts, apps/api/src/index.ts, apps/api/src/routers/certificate.ts, apps/lms/src/parent-view.tsx]
---

# P4 — Học bạ + certificate PDF + parent visibility

## Context
- Source: brainstorm §PLAN5.4. Học bạ exists on-screen only (`parent-view.tsx` gradebook `:408`); certificate is staff-only printable HTML (`index.ts:202`), LMS has no view endpoint.
- Anchors (verified): `renderCertificateHtml(c)` `apps/api/src/services/certificate-html.ts:21`; staff cert route `app.get('/files/certificate/:id')` `index.ts:202` (loads `tx.certificate.findUnique` `:209`); `assessment.gradebook` lmsProcedure `assessment.ts:300` (returns `finalGrades` `:328`); parent gradebook tab `parent-view.tsx:408`.

## Requirements
- Shared print-render infra: certificate already uses print-to-PDF HTML. Add `renderTranscriptHtml(view)` sibling in `certificate-html.ts` (or new `transcript-html.ts`) reusing the same print CSS — DRY, no new PDF lib (browser print). Confirm whether server-side PDF (Playwright/puppeteer) is required or client print-to-PDF suffices → **default: print-to-PDF HTML (KISS), same as certificate**.
- LMS-accessible download endpoints for BOTH học bạ and certificate, authorized to the owning parent/student (not staff-only).
- Staff path keeps working (existing `:202` unchanged or generalized with authz branch).
- Parent UI: download buttons on gradebook tab.

## Files
- Create: `apps/api/src/services/transcript-html.ts` (`renderTranscriptHtml`) — or extend `certificate-html.ts`.
- Modify: `apps/api/src/index.ts` (add LMS-authorized `/files/transcript/:studentId` + LMS-authorized certificate access; verify LMS session via `resolveLmsSession`).
- Modify: `apps/api/src/routers/certificate.ts` if a data-fetch helper is needed for LMS.
- Modify: `apps/lms/src/parent-view.tsx` (download buttons).
- No schema change → **no migration**.

## Implementation steps
1. Extract shared print CSS/header into a helper reused by cert + transcript.
2. `renderTranscriptHtml`: pull `finalGrades` + qualitative from same source as `assessment.gradebook`.
3. New file route: authenticate LMS session (parent/student), assert requested student is owned (`session.studentIds`), then render HTML.
4. Certificate LMS access: assert cert belongs to an owned student before serving.
5. Parent UI: "Tải học bạ (PDF)" + "Tải chứng chỉ (PDF)" opening the file route.

## Tests / validation
- Int: parent can fetch own child transcript/cert; cannot fetch other student (403).
- Int: staff path still serves certificate.
- Manual: print-to-PDF renders Vietnamese cleanly (fonts already self-hosted per prior work).

## Risks / rollback
- Risk (high): IDOR — parent downloading another child → enforce ownership from LMS session, never trust query param alone.
- Risk (low): font/print regression → reuse certificate CSS.
- Rollback: revert code + delete new service file; no migration.

## Blockers
- Independent of P1/P2/P3/P5/P6 files. Can run parallel.
