# Phase 06 completion — annotator lazy/windowed render

## Status: DONE

## What changed
`packages/ui/src/pdf-annotator.tsx` — replaced eager full-document rasterization with lazy, windowed rendering. Only file modified; no other files touched.

- Split "measure" from "rasterize":
  - `PageImg` (had `url`) renamed to `PageDim` (`{ w, h }` only) — geometry-only type, used by `PageLayer`, `renderItem`, `distToPolyline`, `eraseAt`, `onDown`, `onMove`, `norm`.
  - The load effect now only calls `doc.getPage(n)` + `getViewport` per page to build `dims: PageDim[]` (cheap, no canvas/render/toDataURL). `docRef` keeps the loaded `PDFDocumentProxy` alive for on-demand `getPage` calls later.
- Added `rasterizePage(index)` (useCallback): fetches the page via `docRef.current.getPage(index+1)`, renders to canvas at the existing `RENDER_WIDTH` scale, `toDataURL`, then merges into `rendered: Map<number,string>` state via `setRendered`. Guarded by `rasterizing: Set<number>` (in-flight) and `renderedRef` (already-done) refs to avoid duplicate work.
- LRU eviction: `touchLruAndEvict` bumps a page index to MRU and, once `lruOrder.current.length > MAX_RENDERED_PAGES` (6), shifts the LRU index and `map.delete()`s its data-URL entry — bounds simultaneously-held bitmaps regardless of document length. No object URLs are used (still `canvas.toDataURL`), so eviction is a plain map-delete (nothing to revoke).
- Windowing: one `IntersectionObserver` (rootMargin `800px` prefetch band, threshold 0) observes each page's container div (registered/unregistered via `setPageNode` ref callback as pages mount/unmount in the `dims.map`). On intersect: rasterize if not yet rendered, else just bump LRU recency.
- Render: `dims.map(...)` (was `pages.map(...)`) — page container is sized from `page.w/page.h` (measured dims) unconditionally; renders `<img src={url}>` only when `rendered.get(i)` has a value, else a placeholder `<div>` of the same measured dimensions. `PageLayer` (annotation overlay) always renders from `page` (the measured `PageDim`), never gated on raster availability — satisfies the "alignment from measured dims, not raster state" requirement.
- Effect cleanup: on `pdfRef` change / unmount, resets `dims`, `rendered`, `renderedRef`, `lruOrder`, `rasterizing`, `docRef` and disconnects the `IntersectionObserver` (its own effect cleanup, keyed on `dims.length`).

## Zoom/pan (P5) interaction
No changes needed to the P5 transform wrapper (`transform: translate(...) scale(...)` div wrapping the page list) — the `IntersectionObserver` targets are the real page container DOM nodes inside that wrapper, and `IntersectionObserver` computes intersection against actual rendered (post-transform) geometry per spec, so it works correctly at any zoom level without special-casing. Confirmed by reading the spec behavior; not verified in a live browser (see below).

## Typecheck results (all pass clean)
```
pnpm --filter @cmc/ui typecheck    → tsc --noEmit, no errors
pnpm --filter @cmc/admin typecheck → tsc --noEmit, no errors
pnpm --filter @cmc/lms typecheck   → tsc --noEmit, no errors
```

## Consumer files
Read only, not modified, confirming prop-contract stability:
- `apps/admin/src/grading.tsx:166-171` — `<PdfAnnotator pdfRef value onChange editable readOnlyLayers />`, unchanged usage.
- `apps/lms/src/student-view.tsx:423-433` — same prop shape, unchanged usage.
- `apps/lms/src/parent-view.tsx` — greped, does not import `PdfAnnotator` (confirmed no regression surface there; matches plan's note that P2's parent layer may not have landed the import yet).

Public props (`pdfRef`, `value`, `onChange`, `editable`, `readOnlyLayers`) and their types are untouched — only internal state/rendering strategy changed.

## Annotation geometry
Untouched. `AnnotationItem` coordinates remain normalized 0..1 per page (`it.pos.x/y`, `it.rect`, `it.points[].x/y`), scaled against `page.w`/`page.h` (now `PageDim`, same numeric values as before — `viewport.width`/`viewport.height` from the same `RENDER_WIDTH`-scaled `getViewport` call). `v:1` output shape (`{ v: 1, items: [...] }`) unchanged; `emit`/`onChange` logic untouched.

## Memory-boundedness + alignment validation (no browser available)
No real browser/DevTools was used — this is code-level reasoning, not a measured profile:
- **Memory bound**: `rendered` map size is capped at `MAX_RENDERED_PAGES = 6` by `touchLruAndEvict`, enforced on every successful rasterize inside the `setRendered` updater (atomic with the map mutation, so the cap holds even under rapid concurrent `rasterizePage` calls). A 20-page doc therefore holds at most 6 full-resolution PNG data-URLs at once instead of 20, regardless of scroll position, since `rasterizePage` and eviction only run in response to `IntersectionObserver` entries for pages that entered the ~800px prefetch band.
- **Alignment invariant**: every page's container `div` (`width: page.w, height: page.h`) and its `PageLayer` overlay are driven purely by `dims[i]` (`PageDim`), computed once at load from `getViewport` and never touched by rasterization. The `<img>`/placeholder swap only changes what's painted inside a div whose size was already fixed by `dims[i]` — so a late-rasterizing page never causes reflow/shift, and overlay math (`page.w`/`page.h` in `renderItem`, `distToPolyline`, `norm`, `eraseAt`) is identical whether or not `rendered.get(i)` is set. This was the explicit design goal per the phase's risk note and is enforced structurally (no raster-derived value feeds layout or overlay math).
- Not validated: actual DevTools heap snapshot on a real 20-page/20MB PDF, real-device scroll smoothness/jank, and IntersectionObserver behavior at non-1x zoom in an actual browser. Recommend a manual pass in P7 (tablet checklist / regression pass already scoped there) to confirm this empirically.

## Status: DONE
Summary: Lazy/windowed rasterization implemented in `packages/ui/src/pdf-annotator.tsx` with IntersectionObserver-driven prefetch and LRU eviction (cap 6 rendered pages); annotation overlays remain driven by eagerly-measured page dims, never by raster state. All three consumer packages typecheck clean; consumers unmodified.
Concerns/Blockers: No real-browser verification was possible in this environment — memory-boundedness and zoom-interaction claims rest on code-level invariants (LRU cap enforced atomically, layout driven only by measured dims) rather than an observed DevTools profile. Recommend confirming empirically during P7.
