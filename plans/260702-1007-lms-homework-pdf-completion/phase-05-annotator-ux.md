# Phase 05 — Annotator UX (eraser / pen width / pinch-zoom + pan)

Status: completed 2026-07-02 for code + typecheck. Real-tablet manual checklist deferred to Phase 7.

Closes gap #7 (annotator UX for kids 3-11 on tablets).

## Context links
- `packages/ui/src/pdf-annotator.tsx` (annotator component)
- `apps/api/src/annotation.ts:22` (AnnotationData `v:1`; ink `width: 0.1-40` already in schema; caps MAX_ITEMS 500, MAX_INK_POINTS 2000)
- **Regression-risk consumers of this shared component** (do not break): `apps/admin/src/grading.tsx:166-171` (teacher grading, `editable` default true, draws corrections over `readOnlyLayers` student layer), `apps/lms/src/student-view.tsx:239-243`, `apps/lms/src/parent-view.tsx` (P2, read-only). P7 must regression-check grading.tsx after this phase.

## Overview
Add child-friendly editing affordances: eraser / per-stroke delete, pen width selector, and pinch-zoom + pan — while keeping the AnnotationData `v:1` schema byte-compatible with the server validator.

## Key Insights
- Schema stays `v:1`: items are ink|text|highlight, coords normalized 0..1. Eraser and per-stroke delete operate on the items array (remove ink items); they do NOT introduce a new item type — no schema bump needed.
- Pen width: RESOLVED — ink items ALREADY carry `width: 0.1-40` under `v:1` (annotation.ts:22). Reuse the existing field; no schema change. The width UI just needs to set values within that range.
- Server caps unchanged: eraser reduces item count (safe); ensure UI still guards against exceeding MAX_ITEMS/MAX_INK_POINTS before save (server rejects otherwise).
- Pinch-zoom + pan is a view transform only — must not alter stored normalized coords. Keep the normalize/denormalize math anchored to page dimensions, not zoom level.
- This phase and P6 both own pdf-annotator.tsx — SAME OWNER, strictly sequential. P5 first (interaction), then P6 (render). If P2 added a readOnly prop, rebase on it.

## Requirements
- Eraser mode + per-stroke delete (tap/select a stroke to remove).
- Pen width UI (at least 2-3 sizes).
- Pinch-zoom + pan on touch; zoom must not distort stored coordinates.
- AnnotationData output remains valid `v:1` (passes annotation.ts validation).

## Architecture
Interaction flow: tool state (pen|eraser, width) in component state → pointer events produce/modify items → items normalized against page dims (zoom-independent) → on change, propagate up to autosave (P1). Zoom/pan maintained as a separate view transform matrix applied at render, inverted when mapping pointer → normalized coords.

## Related code files
- Modify: `packages/ui/src/pdf-annotator.tsx`
- Read-only: `apps/api/src/annotation.ts` (respect caps + schema)

## Implementation Steps
1. Use the existing ink `width` field (annotation.ts:22, `0.1-40`) — no schema work.
2. Add tool toolbar: pen / eraser / width. Wire eraser to remove hit-tested ink items.
3. Implement pinch-zoom + pan view transform; invert transform for pointer→normalized mapping.
4. Enforce client-side item/point caps with a friendly "quá nhiều nét vẽ" message before save.
5. Confirm change events still trigger P1 autosave.

## Todo list
- [x] eraser + per-stroke delete
- [x] pen width UI
- [x] pinch-zoom + pan (coord-safe)
- [x] client cap guard
- [x] verify autosave still fires on change

## Evidence 2026-07-02
- `pnpm --filter @cmc/ui|@cmc/admin|@cmc/lms typecheck` all PASS.
- Coordinate safety: zoom/pan is a pure CSS transform on a wrapper div; `norm()` reads `getBoundingClientRect()` on the transformed element (post-transform screen space), so normalized 0..1 coords stay zoom-invariant with no change to the normalize math itself.
- Consumer regression check: `grading.tsx` and `student-view.tsx` prop contracts (`pdfRef`/`value`/`onChange`/`editable`/`readOnlyLayers`) read and confirmed unchanged; `parent-view.tsx` does not import PdfAnnotator yet (P2 not landed), so not applicable.
- No existing unit/component test harness for this file; manual/tablet verification remains deferred to Phase 7 per plan.

## Success Criteria
- Kid can erase a stroke, pick pen width, pinch-zoom and pan on a tablet (manual checklist P7).
- Saved layer passes server `v:1` validation.
- Zoom does not shift previously drawn strokes.

## Risk Assessment
- Coordinate distortion under zoom/pan (Med likelihood, HIGH impact): normalize against page dims independent of view transform; add manual test drawing at 1x, zoom, verify stroke stays put.
- **Shared-component regression in grading.tsx (Med likelihood, Med impact)**: eraser/width/zoom changes touch the same PdfAnnotator that `grading.tsx:166-171` uses for teacher corrections. Mitigation: keep changes additive to interaction state; P7 regression-checks the teacher draw/undo/save flow after this phase (see P7 matrix).
- Width is already in the `v:1` schema (annotation.ts:22) — no schema-drift risk; server accepts it.
- Touch gesture conflict (pan vs draw) (Med/Med): mode toggle or two-finger=pan / one-finger=draw convention; test on real tablet.

## Security Considerations
- Server-side annotation validation (annotation.ts caps + schema) is the authoritative guard against malicious oversized payloads — client caps are UX only, never a security boundary. Do not weaken server validation.

## Rollback
- Code-only revert of pdf-annotator.tsx. No schema/data change (width reuses the existing `v:1` field).

## Next steps
Blocks P6 (same file). Feeds P7 tablet checklist.
