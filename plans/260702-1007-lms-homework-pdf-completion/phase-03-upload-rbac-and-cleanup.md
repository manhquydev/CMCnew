# Phase 03 — Upload RBAC gate + delete dead PdfViewer

Status: completed 2026-07-02.

Closes gaps #6 (no RBAC on PDF upload) and #9 (dead PdfViewer). Bundled: both are small hardening/cleanup edits with disjoint file ownership.

## Context links
- `apps/api/src/index.ts:59-72` (POST /upload/exercise-pdf — currently any staff session)
- `apps/api/src/index.ts:74-95` (session-photo upload — the `can(...)` gating pattern to mirror)
- `packages/ui/src/pdf-viewer.tsx` (dead — superseded by PdfAnnotator, exported but unused)

## Overview
Gate exercise-PDF upload to the same roles that own exercise writes (`exercise.upsert` = giam_doc_dao_tao, giam_doc_kinh_doanh post-seam-fixes), and remove the dead PdfViewer component.

## Key Insights
- session-photo upload at index.ts:83 already uses `can(session.roles, session.isSuperAdmin, 'sessionEvidence', 'upsertDraft')`. Reuse identical pattern with `('exercise','upsert')`.
- Comment at index.ts:74-78 documents the OLD looser stance (worksheet less sensitive than student photo). This plan supersedes it: post-seam-fixes only two director roles author exercises, so upload must match write authority. Update the comment to state the new invariant (no phase/plan IDs in comment — describe the rule).
- `exercise.upsert` permission must exist post-seam-fixes. Re-grep `permissions.ts` at implementation time to confirm the exact resource/action tuple before wiring.
- PdfViewer: confirm zero imports before delete (grep `pdf-viewer`, `PdfViewer` across apps + packages, and remove its export from the package index).

## Requirements
- `POST /upload/exercise-pdf`: after session check, `if (!can(session.roles, session.isSuperAdmin, 'exercise', 'upsert')) return 403`.
- Delete `packages/ui/src/pdf-viewer.tsx` and its barrel export; ensure build passes with no dangling import.

## Architecture
Upload flow unchanged except an added authorization check between session resolution and body read (fail fast before reading arraybuffer to avoid wasting bandwidth on unauthorized callers).

## Related code files
- Modify: `apps/api/src/index.ts` (upload gate + comment)
- Delete: `packages/ui/src/pdf-viewer.tsx`
- Modify: `packages/ui/src/index.ts` (or barrel) — remove PdfViewer export

## Implementation Steps
1. Grep `permissions.ts` to confirm `exercise.upsert` tuple + role list post-seam-fixes.
2. Add `can(...)` 403 gate to /upload/exercise-pdf before body read; update comment to new invariant.
3. Grep for PdfViewer/pdf-viewer usages repo-wide; confirm zero (only the export).
4. Delete file + remove export; run typecheck/build.

## Todo list
- [x] confirm exercise.upsert permission tuple
- [x] add 403 gate to exercise-pdf upload
- [x] update superseded comment
- [x] confirm zero PdfViewer imports
- [x] delete pdf-viewer.tsx + export
- [x] typecheck/build green

## Evidence 2026-07-02
- `pnpm --filter @cmc/api typecheck` PASS. New `apps/api/test/upload-exercise-pdf-rbac.int.test.ts`: 3/3 pass (403 non-director, 200 director, 401 unauthenticated before RBAC).
- `exercise.upsert` confirmed `['giam_doc_kinh_doanh','giam_doc_dao_tao']` (permissions.ts) — no drift from plan assumption.
- Code review fix: `PdfStoreError` from server misconfiguration (missing S3_BUCKET) no longer echoed to the client as a 400 — split into `PdfStoreConfigError`, re-thrown to the global error boundary as a generic 500 instead.

## Success Criteria
- Staff without exercise.upsert → 403 on upload (integration test P7).
- Directors with exercise.upsert → upload succeeds.
- Build passes; no reference to PdfViewer remains.

## Risk Assessment
- Blocking a legitimate uploader (Med likelihood, Med impact): the two director roles are the intended authors post-seam-fixes; if teachers were expected to attach PDFs, this breaks them. Confirm with seam-fixes decision that teachers do NOT author exercises (they keep read+grade only — per plan dependency note). If a teacher-attach workflow exists, escalate. UNRESOLVED — see plan questions.
- Deleting PdfViewer breaks a lazy/dynamic import not caught by static grep (Low/Med): grep string literals too; build + e2e (P7) catch runtime.

## Security Considerations
- This phase closes an authorization gap (unauthenticated-authorized write of blobs). Positive security change. Ensure 403 is returned before body consumption.
- No secrets involved.

## Rollback
- Code-only. Revert the `can` gate to restore prior behavior. Restoring PdfViewer requires un-deleting from git — trivial revert. No data/infra change.

## Next steps
Independent track; can run parallel to P1/P2/P4/P5. Feeds P7 upload-RBAC integration test.
