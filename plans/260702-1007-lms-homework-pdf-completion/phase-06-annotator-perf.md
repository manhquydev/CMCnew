# Phase 06 — Annotator perf (lazy / virtualized page render)

Status: completed 2026-07-02 for code + typecheck. Empirical DevTools memory profile deferred to Phase 7 (no browser available in this environment).

Closes gap #8 (many-page / large-PDF perf).

## Context links
- `packages/ui/src/pdf-annotator.tsx:139-153` (renders EVERY page to full data-URL PNG at `RENDER_WIDTH=720`)
- 20MB PDF cap (`MAX_PDF_BYTES`, index.ts) — a 20-page doc renders 20 full canvases → data-URLs held in memory
- **Regression-risk consumers of this shared component**: `apps/admin/src/grading.tsx:166-171` (teacher grading), `apps/lms/src/student-view.tsx:239-243`, `apps/lms/src/parent-view.tsx`. Lazy-render changes must not break their overlay alignment; P7 regression-checks grading.tsx.

## Overview
Replace eager full-document render (all pages → PNG data-URLs upfront) with lazy/virtualized rendering so only visible (and near-visible) pages are rasterized, bounding memory for large/many-page PDFs.

## Key Insights
- Current loop (`for n=1..numPages`) rasterizes every page and stores `canvas.toDataURL('image/png')` — this holds N full-resolution PNG strings in memory simultaneously; the killer at 20MB / many pages.
- Annotation coords are normalized 0..1 per page → rendering a page on demand does not affect stored annotations (coord math is page-relative, zoom/pan handled in P5). Lazy render is a pure view optimization.
- Must preserve annotation overlay correctness: each page's annotation layer must align when a page is rendered late (page dimensions known from `getViewport` without full raster — can pre-measure dims cheaply, defer pixel render).
- Depends on P5 (same file, sequential). Rebase on P5's zoom/pan transform.

## Requirements
- Only render pages in/near viewport (windowing); release off-screen page bitmaps.
- Keep page dimensions known upfront (cheap `getViewport`) so scroll height + annotation alignment are correct before pixels load.
- No regression to annotation placement or `v:1` output.

## Architecture
Data flow: load PDF doc → for each page compute viewport dims only (no raster) → build scroll container sized to total → IntersectionObserver (or scroll window) triggers raster of pages entering the near-viewport band → cache a small LRU of rendered pages → evict distant pages. Annotation layer per page renders using known dims regardless of raster state.

## Related code files
- Modify: `packages/ui/src/pdf-annotator.tsx`

## Implementation Steps
1. Split "measure dims" (all pages, cheap) from "rasterize" (on-demand).
2. Introduce IntersectionObserver-driven page rasterization with a near-viewport prefetch band.
3. Add small LRU eviction of rendered page bitmaps; revoke object URLs / drop data-URLs on evict.
4. Ensure annotation overlays position from measured dims, not from raster availability.
5. Verify with a 20-page / ~20MB PDF: memory bounded, scroll smooth, strokes aligned.

## Todo list
- [x] separate measure vs rasterize
- [x] IntersectionObserver windowing + prefetch band
- [x] LRU evict + URL revoke (data-URL Map entry drop, no blob URLs used — nothing to revoke)
- [x] annotation alignment from measured dims
- [ ] 20-page/20MB memory + alignment test (manual/real-browser, deferred to P7)

## Evidence 2026-07-02
- `pnpm --filter @cmc/ui|@cmc/admin|@cmc/lms typecheck` all PASS.
- Layout/scroll-height derives solely from eagerly-measured `PageDim` (getViewport, no raster); raster state never affects sizing — verified via code review.
- Code review fixes: (1) LRU eviction no longer evicts a page that's currently on-screen (`visiblePages` set tracked from IntersectionObserver enter/leave) — previously a still-visible page could be silently evicted to a blank placeholder if more than `MAX_RENDERED_PAGES` pages were simultaneously in the viewport+prefetch band; (2) moved `lruOrder`/`renderedRef` ref mutation out of the `setRendered` functional updater into a synchronous step before calling `setRendered` — React 18 StrictMode double-invokes updater functions in dev, which was silently double-mutating the LRU ref order.
- No real browser available to take an actual DevTools memory profile or confirm zoom-interaction visually — deferred to Phase 7 per plan.

## Success Criteria
- 20-page / 20MB PDF opens without rasterizing all pages upfront; memory bounded (spot-check dev tools).
- Scrolling renders pages on demand; annotations stay aligned.
- No `v:1` output regression.

## Risk Assessment
- Annotation misalignment on late-rendered pages (Med likelihood, HIGH impact): drive layout from measured viewport dims computed eagerly; raster only affects pixels, not geometry. Manual alignment test mandatory.
- Scroll jank / flicker on raster (Med/Med): prefetch band + placeholder at known dims prevents layout shift.
- Interaction with P5 zoom/pan (Med/Med): recompute visible set on zoom; test combined.
- Shared-component regression in grading.tsx (Med/Med): lazy render alters when pages rasterize; teacher grading view depends on the same component. Mitigation: overlays position from eagerly-measured dims (not raster state); P7 regression-checks the teacher grading flow after this phase.

## Security Considerations
- None new — pure client rendering optimization. Server caps/validation unchanged.

## Rollback
- Code-only revert to eager render loop. No data/schema/infra change.

## Next steps
Last annotator phase. Feeds P7 perf + tablet checklist.
