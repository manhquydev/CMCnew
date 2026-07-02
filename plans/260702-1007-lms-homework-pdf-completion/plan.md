---
title: "LMS homework draw-on-PDF completion (9 gaps)"
description: "Close 9 verified LMS homework gaps: autosave, parent drawn-work view, optimistic concurrency, MinIO blob store, upload RBAC, annotator UX + perf, cleanup."
status: pending
priority: P1
effort: ~5d
branch: develop
tags: [lms, pdf, annotation, submission, minio, ux]
created: 2026-07-02
---

# LMS homework draw-on-PDF completion

Close all 9 verified gaps in the LMS homework "draw-on-PDF" flow (operator-approved 2026-07-02, full scope).

## Dependency

**Starts AFTER `plans/260702-0929-lms-erp-seam-fixes/` completes.** Shared files: `apps/api/src/routers/submission.ts`, `apps/lms/src/student-view.tsx`, permissions surface (`apps/api/src/permissions.ts`). Assume post-seam-fixes shape:
- `Exercise` keyed by `curriculumUnitId`, global (no facility RLS on curriculum asset), **no `dueAt`**, 1 exercise per unit.
- Teachers keep **read + grade** on exercises; write permission `exercise.upsert` = `['giam_doc_dao_tao','giam_doc_kinh_doanh']`.
- `exercise.listForPrincipal` reshaped. Do not re-verify seam-fixes internals; re-grep affected symbols at implementation time (scout summaries go stale).

## Intake lane: HIGH-RISK

Flags: External systems (MinIO/S3 driver + blob migration), Auth/authorization (upload RBAC gate), Existing behavior (submission.save concurrency, redaction invariant), Public contracts (new parent layer procedure, submission.save version param), Data/blob migration. 4+ flags + hard gates (authorization, external provider, blob-data migration) → high-risk. No schema migration (version column already exists at `packages/db/prisma/schema.prisma:634`); MinIO is infra, not schema. Validation: unit + integration + e2e + manual tablet checklist (Phase 7).

## Phases

| # | Phase | Depends | File ownership (exclusive) | Status |
|---|-------|---------|----------------------------|--------|
| P1 | Autosave + version optimistic concurrency | seam-fixes | submission.ts (save), student-view.tsx | pending |
| P2 | Parent layer API + parent drawn-work UI | P1 | submission.ts (new proc), parent-view.tsx | pending |
| P3 | Hardening: upload RBAC + delete dead PdfViewer | seam-fixes | index.ts (upload), pdf-viewer.tsx (del) | pending |
| P4 | MinIO/S3 driver + blob migration + compose/env | none | pdf-store.ts, compose, env, migrate script | pending |
| P5 | Annotator UX: eraser/width/pinch-zoom+pan | none | pdf-annotator.tsx | pending |
| P6 | Perf: lazy/virtualized page render | P5 | pdf-annotator.tsx | pending |
| P7 | Validation: int tests + e2e + tablet checklist | P1-P6 | submission.test.ts, e2e specs | pending |

Parallelizable after seam-fixes: {P1→P2}, {P3}, {P4}, {P5→P6} are independent tracks. P3 and P1 both touch different regions but P3's `index.ts` upload is disjoint from P1's `submission.ts`. P5→P6 both own `pdf-annotator.tsx` — strictly sequential, same owner. P7 last.

## Acceptance (measurable)

- Autosave fires within debounce window on annotation/answer change; survives modal-close + `beforeunload` (no lost strokes in manual test).
- Parent sees student layer + published teacher-correction layer read-only; sees nothing (score/feedback/teacher layer) pre-publish — integration test asserts redaction.
- Cross-guardian studentId → empty/denied (integration test).
- Stale `version` on save → `CONFLICT` + friendly reload UX (integration test + manual).
- `POST /upload/exercise-pdf` returns 403 for staff lacking `exercise.upsert` (integration test).
- PDF blobs served from MinIO with content-addressing + ref format unchanged; existing blobs migrated; `GET /files/exercise/:ref` auth flow unchanged.
- Annotator: eraser/per-stroke delete, pen width, pinch-zoom+pan work on tablet; AnnotationData `v:1` unchanged (server caps MAX_ITEMS 500 / MAX_INK_POINTS 2000 still hold).
- 20-page / 20MB PDF renders without full-document upfront memory blow-up (lazy render).
- Dead `pdf-viewer.tsx` deleted; no remaining imports.

## Phase files

- [phase-01-autosave-version-concurrency.md](phase-01-autosave-version-concurrency.md)
- [phase-02-parent-layer-and-view.md](phase-02-parent-layer-and-view.md)
- [phase-03-upload-rbac-and-cleanup.md](phase-03-upload-rbac-and-cleanup.md)
- [phase-04-minio-blob-store.md](phase-04-minio-blob-store.md)
- [phase-05-annotator-ux.md](phase-05-annotator-ux.md)
- [phase-06-annotator-perf.md](phase-06-annotator-perf.md)
- [phase-07-validation.md](phase-07-validation.md)

Reports: `plans/260702-1007-lms-homework-pdf-completion/reports/`

## Planner open questions — RESOLVED (orchestrator, 2026-07-02)

1. **Parent base-PDF visibility post-seam-fixes**: OK — exercise becomes global-readable (Decision A); `/files/exercise/:ref` resolves for any authenticated principal. NOTE: this loosens the endpoint's semantics from "enrolled classes" to "any authenticated session" — acceptable (no PII in worksheets) but must be stated in seam-fixes Decision A record, not left implicit.
2. **Teachers attach PDFs?** NO — operator decision D2: only the two directors manage learning materials. Upload gate to `exercise.upsert` roles is correct.
3. **Pen width persistence**: already persisted — `annotation.ts` ink schema has `width: 0.1–40` under `v:1`. P5 width UI needs no schema change.
4. Permission tuple re-grep at implementation time — stands.
