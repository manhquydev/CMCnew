# Phase 06 — Annotator perf (lazy / virtualized page render)

Closes gap #8 (many-page / large-PDF perf).

## Context links
- `packages/ui/src/pdf-annotator.tsx:139-153` (renders EVERY page to full data-URL PNG at `RENDER_WIDTH=720`)
- 20MB PDF cap (`MAX_PDF_BYTES`, index.ts) — a 20-page doc renders 20 full canvases → data-URLs held in memory

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
- [ ] separate measure vs rasterize
- [ ] IntersectionObserver windowing + prefetch band
- [ ] LRU evict + URL revoke
- [ ] annotation alignment from measured dims
- [ ] 20-page/20MB memory + alignment test

## Success Criteria
- 20-page / 20MB PDF opens without rasterizing all pages upfront; memory bounded (spot-check dev tools).
- Scrolling renders pages on demand; annotations stay aligned.
- No `v:1` output regression.

## Risk Assessment
- Annotation misalignment on late-rendered pages (Med likelihood, HIGH impact): drive layout from measured viewport dims computed eagerly; raster only affects pixels, not geometry. Manual alignment test mandatory.
- Scroll jank / flicker on raster (Med/Med): prefetch band + placeholder at known dims prevents layout shift.
- Interaction with P5 zoom/pan (Med/Med): recompute visible set on zoom; test combined.

## Security Considerations
- None new — pure client rendering optimization. Server caps/validation unchanged.

## Rollback
- Code-only revert to eager render loop. No data/schema/infra change.

## Next steps
Last annotator phase. Feeds P7 perf + tablet checklist.
