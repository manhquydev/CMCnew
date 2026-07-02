# Phase 05 — Annotator UX (eraser / pen width / pinch-zoom + pan)

Closes gap #7 (annotator UX for kids 3-11 on tablets).

## Context links
- `packages/ui/src/pdf-annotator.tsx` (annotator component)
- `apps/api/src/annotation.ts` (AnnotationData `v:1`; caps MAX_ITEMS 500, MAX_INK_POINTS 2000)

## Overview
Add child-friendly editing affordances: eraser / per-stroke delete, pen width selector, and pinch-zoom + pan — while keeping the AnnotationData `v:1` schema byte-compatible with the server validator.

## Key Insights
- Schema stays `v:1`: items are ink|text|highlight, coords normalized 0..1. Eraser and per-stroke delete operate on the items array (remove ink items); they do NOT introduce a new item type — no schema bump needed.
- Pen width: if `AnnotationData` ink items already carry a width field, reuse it; if not, adding a width to ink items IS a schema change. Verify annotation.ts ink shape first. If width not in schema, either (a) keep width client-only visual and store default, or (b) coordinate a `v:1` additive optional field with server validator — prefer (a) unless persistence required. UNRESOLVED — see plan questions.
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
1. Verify annotation.ts ink item shape (does it carry width?). Decide width persistence per Key Insights.
2. Add tool toolbar: pen / eraser / width. Wire eraser to remove hit-tested ink items.
3. Implement pinch-zoom + pan view transform; invert transform for pointer→normalized mapping.
4. Enforce client-side item/point caps with a friendly "quá nhiều nét vẽ" message before save.
5. Confirm change events still trigger P1 autosave.

## Todo list
- [ ] verify ink schema (width?) + decide persistence
- [ ] eraser + per-stroke delete
- [ ] pen width UI
- [ ] pinch-zoom + pan (coord-safe)
- [ ] client cap guard
- [ ] verify autosave still fires on change

## Success Criteria
- Kid can erase a stroke, pick pen width, pinch-zoom and pan on a tablet (manual checklist P7).
- Saved layer passes server `v:1` validation.
- Zoom does not shift previously drawn strokes.

## Risk Assessment
- Coordinate distortion under zoom/pan (Med likelihood, HIGH impact): normalize against page dims independent of view transform; add manual test drawing at 1x, zoom, verify stroke stays put.
- Schema drift if width persisted without validator support (Med/HIGH): verify annotation.ts first; server would reject unknown fields. Do not persist width unless validator explicitly allows.
- Touch gesture conflict (pan vs draw) (Med/Med): mode toggle or two-finger=pan / one-finger=draw convention; test on real tablet.

## Security Considerations
- Server-side annotation validation (annotation.ts caps + schema) is the authoritative guard against malicious oversized payloads — client caps are UX only, never a security boundary. Do not weaken server validation.

## Rollback
- Code-only revert of pdf-annotator.tsx. No schema/data change if width kept client-only. If a schema field was added, revert requires confirming no stored data relies on it (prefer avoiding the schema change).

## Next steps
Blocks P6 (same file). Feeds P7 tablet checklist.
