# Phase 05 — Annotator UX completion report

## What was added (packages/ui/src/pdf-annotator.tsx only)
- **Eraser tool**: new `Tool` union member `'eraser'`; toolbar button "Tẩy". Hit-tests ink items via
  point-to-segment distance (`distToPolyline`, pixel space using `page.w`/`page.h`) within a
  14px radius (`ERASE_RADIUS_PX`), removes the nearest matching ink item by index. Works on
  tap and on drag (continuous erase while pointer is down via `erasing` ref).
- **Pen width UI**: 3-size selector (Mảnh 2 / Vừa 6 / Đậm 12) driving a `width` state, wired into
  new ink items. Reuses the existing `width: 0.1–40` field already in the `v:1` ink schema
  (apps/api/src/annotation.ts:22) — no schema change.
- **Pinch-zoom + pan**: outer wrapper div around the page list tracks up to 2 active pointers
  (`pointers` ref/Map). On 2 simultaneous pointers, computes distance ratio → `scale` (clamped
  1–4) and midpoint delta → `offset`, applied as a CSS `transform: translate() scale()` on the
  wrapper (`transformOrigin: '0 0'`). No coordinate math changed in `norm()` — since
  `getBoundingClientRect()` on the transformed element already reflects the rendered (scaled/panned)
  box, the existing normalize-by-boundingrect logic stays zoom/pan-safe automatically. A second
  finger touching mid-stroke cancels any in-progress draw/erase (`drawing.current = null`,
  `erasing.current = false`) so gestures don't fight. Added a "Thu nhỏ lại" reset button, shown
  only when `scale !== 1`, so a child can't get stuck zoomed in on a touch-only device.
- **Client-side caps**: local `MAX_ITEMS = 500` / `MAX_INK_POINTS = 2000` constants mirroring
  apps/api/src/annotation.ts (not exported there, so mirrored — the module comment notes these
  are a UX guard only, server validation remains authoritative). Blocks starting a new
  ink/highlight/text item once `items.length >= MAX_ITEMS`, and stops appending points to an
  in-progress ink stroke at `MAX_INK_POINTS`, surfacing a Vietnamese banner ("Đã quá nhiều nét
  vẽ...", "Nét vẽ quá dài, đã tự dừng lại.").
- Autosave/change contract unchanged: eraser deletions and all new draw paths still funnel
  through the same `emit()` → `onChange?.({ v: 1, items: next })` call used by the pre-existing
  ink/highlight/text paths, so `student-view.tsx`'s autosave (P1) keeps firing on every edit
  including erases.

## Typecheck results
- `pnpm --filter @cmc/ui typecheck` → pass (tsc --noEmit, clean)
- `pnpm --filter @cmc/admin typecheck` → pass (tsc --noEmit, clean)
- `pnpm --filter @cmc/lms typecheck` → pass (tsc --noEmit, clean)

## Tests
No existing unit/component tests for `pdf-annotator.tsx` (confirmed via glob for
`**/pdf-annotator*.test.*` and grep for `PdfAnnotator` usages — only `index.tsx` re-export and
the component itself). Per the plan, manual/tablet verification is deferred to Phase 7; no new
test harness was added (YAGNI — this is UI-interaction code, a heavy new harness wasn't
warranted for this phase).

## Consumer regression check (read-only, not modified)
- `apps/admin/src/grading.tsx:166-172` — teacher grading call site (`editable` implicit true,
  `readOnlyLayers={studentLayer...}`). Read, not edited. Prop contract preserved
  (`pdfRef`/`value`/`onChange`/`editable`/`readOnlyLayers` signature unchanged).
- `apps/lms/src/student-view.tsx:424-430` — student call site
  (`editable={!isGraded && autosaveState !== 'forbidden'}`, `readOnlyLayers={teacherLayer...}`).
  Read, not edited. Same contract, confirmed autosave path (submission.save.mutate via onChange)
  untouched.
- `apps/lms/src/parent-view.tsx` — grepped for `PdfAnnotator`, no match found. Parent-view does
  not import this component yet (P2 parent-layer UI has not landed), so per orchestrator
  instruction this regression check was skipped as inapplicable, not silently ignored.

## Files modified
- `D:\project\CMCnew\packages\ui\src\pdf-annotator.tsx`

## Files read, not modified
- `D:\project\CMCnew\apps\api\src\annotation.ts`
- `D:\project\CMCnew\apps\admin\src\grading.tsx`
- `D:\project\CMCnew\apps\lms\src\student-view.tsx`
- `D:\project\CMCnew\apps\lms\src\parent-view.tsx` (grep only, no PdfAnnotator import present)

Status: DONE
Summary: Eraser, 3-size pen width, and pinch-zoom+pan added to the shared PdfAnnotator; coords stay normalized/zoom-independent, client caps mirror server, all three consumer typechecks pass clean.
Concerns/Blockers: None. Note for P6 (same-file owner next): the page list is now wrapped in an extra transform `<div>` for pinch/pan — factor that into any lazy/virtualized render restructuring.
