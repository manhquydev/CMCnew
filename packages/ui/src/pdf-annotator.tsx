import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { AnnotationData, AnnotationItem } from '@cmc/api/annotation';
import { API_URL } from './client.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

const RENDER_WIDTH = 720;
export type Tool = 'ink' | 'text' | 'highlight' | 'eraser';
const COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#212529'];
const WIDTHS: { label: string; value: number }[] = [
  { label: 'Mảnh', value: 2 },
  { label: 'Vừa', value: 6 },
  { label: 'Đậm', value: 12 },
];
const ERASE_RADIUS_PX = 14;
// Mirrors the server caps in apps/api/src/annotation.ts — client-side UX guard only, not a security boundary.
const MAX_ITEMS = 500;
const MAX_INK_POINTS = 2000;
const MAX_SCALE = 4;
// Bounds simultaneously-rasterized page bitmaps in memory regardless of document length.
const MAX_RENDERED_PAGES = 6;
// Rasterize pages a bit before they scroll into view so there's no visible pop-in.
const PREFETCH_MARGIN = '800px 0px 800px 0px';

/** Page geometry, known cheaply upfront (no raster) — layout and annotation alignment derive from this alone. */
type PageDim = { w: number; h: number };
const empty: AnnotationData = { v: 1, items: [] };

/** Shortest distance (px) from a point to a polyline, in the page's rendered pixel space. */
function distToPolyline(px: number, py: number, points: { x: number; y: number }[], page: PageDim) {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = { x: points[i]!.x * page.w, y: points[i]!.y * page.h };
    const b = i + 1 < points.length ? { x: points[i + 1]!.x * page.w, y: points[i + 1]!.y * page.h } : a;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best) best = d;
  }
  return best;
}

/** Page image + every annotation layer drawn over it (read-only layers under the editable one). */
function PageLayer({
  page,
  editableItems,
  readOnlyLayers,
  pageIndex,
}: {
  page: PageDim;
  editableItems: AnnotationItem[];
  readOnlyLayers: { items: AnnotationItem[]; opacity?: number }[];
  pageIndex: number;
}) {
  const all = [
    ...readOnlyLayers.map((l) => ({ items: l.items, opacity: l.opacity ?? 0.85 })),
    { items: editableItems, opacity: 1 },
  ];
  return (
    <>
      {all.flatMap((layer, li) =>
        layer.items
          .filter((it) => it.page === pageIndex)
          .map((it, idx) => renderItem(it, `${li}-${idx}`, layer.opacity, page)),
      )}
    </>
  );
}

function renderItem(it: AnnotationItem, key: string, opacity: number, page: PageDim) {
  if (it.type === 'text') {
    return (
      <div
        key={key}
        style={{
          position: 'absolute',
          left: `${it.pos.x * 100}%`,
          top: `${it.pos.y * 100}%`,
          color: it.color,
          fontSize: it.size,
          fontWeight: 600,
          opacity,
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          whiteSpace: 'pre',
        }}
      >
        {it.text}
      </div>
    );
  }
  // ink + highlight live in one SVG overlay per item (cheap; counts are capped).
  return (
    <svg
      key={key}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      width={page.w}
      height={page.h}
      style={{ position: 'absolute', left: 0, top: 0, opacity, pointerEvents: 'none' }}
    >
      {it.type === 'ink' ? (
        <polyline
          points={it.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={it.color}
          strokeWidth={it.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        <rect x={it.rect.x} y={it.rect.y} width={it.rect.w} height={it.rect.h} fill={it.color} fillOpacity={0.3} />
      )}
    </svg>
  );
}

/**
 * Annotate the exercise base PDF. Editable mode lets a principal draw ink / drop text / highlight;
 * coordinates are normalised to the page (0..1) so the layer is resolution-independent. `value` is
 * the editable layer; `readOnlyLayers` render beneath it (e.g. the student's marks while a teacher
 * grades, or the teacher's marks for the student after publish).
 */
export function PdfAnnotator({
  pdfRef,
  value,
  onChange,
  editable = true,
  readOnlyLayers = [],
  maxHeight,
}: {
  pdfRef: string;
  value: AnnotationData | null;
  onChange?: (v: AnnotationData) => void;
  editable?: boolean;
  readOnlyLayers?: { items: AnnotationItem[]; opacity?: number }[];
  /** Bounds the scrollable page area so the toolbar can stay sticky and reachable on a long
   *  multi-page document, instead of scrolling away with page 1. Unset = old unbounded behavior
   *  (grows to fit content; caller's own container scrolls) — existing callers are unaffected. */
  maxHeight?: string;
}) {
  // Measured eagerly for every page (cheap — no raster); drives layout + annotation alignment.
  const [dims, setDims] = useState<PageDim[]>([]);
  // Rasterized bitmaps, windowed: only pages in/near the viewport get an entry.
  const [rendered, setRendered] = useState<Map<number, string>>(new Map());
  const renderedRef = useRef<Map<number, string>>(new Map());
  const lruOrder = useRef<number[]>([]);
  const visiblePages = useRef<Set<number>>(new Set());
  const rasterizing = useRef<Set<number>>(new Set());
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const pageNodes = useRef<Map<number, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tool, setTool] = useState<Tool>('ink');
  const [color, setColor] = useState<string>(COLORS[0]!);
  const [width, setWidth] = useState<number>(WIDTHS[0]!.value);
  const [capMsg, setCapMsg] = useState('');
  const drawing = useRef<AnnotationItem | null>(null);
  const erasing = useRef(false);
  const [, force] = useState(0);

  // View transform (pinch-zoom + pan) — display-only, never baked into stored normalised coords.
  // fitScale = the page shrunk to fit the container's width (≤1 on narrow/mobile viewports, 1 on
  // desktop where the container is already ≥ RENDER_WIDTH) — the floor for pinch zoom-out and the
  // default view, so a phone shows the whole page instead of a 720px-wide slice cut off by overflow.
  // outerRef clips (its own layout width never changes) and is what fitScale is measured
  // against; containerRef carries the pinch-zoom/pan transform. They must be different elements —
  // overflow:hidden and transform on the SAME element clips in PRE-transform coordinates, so a
  // 720px-wide page inside a 390px-wide mobile container gets cropped to its left ~54% before
  // the shrink-to-fit scale ever gets a chance to bring the full page into view (reproduced live:
  // a landscape PDF opened on a phone showed only its left portion, the rest cut off — RENDER_WIDTH
  // is a fixed 720 for every page regardless of orientation, so this hit every mobile document,
  // just most visibly on wide/landscape ones).
  const outerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const fitAppliedRef = useRef(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    startDist: number;
    startScale: number;
    startMid: { x: number; y: number };
    startOffset: { x: number; y: number };
  } | null>(null);

  const data = value ?? empty;
  const items = data.items;
  const emit = useCallback(
    (next: AnnotationItem[]) => onChange?.({ v: 1, items: next }),
    [onChange],
  );

  // Load the doc and measure every page's viewport dims upfront (cheap — no raster). Pixels are
  // rasterized lazily below, on demand, as pages enter the viewport.
  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;
    setLoading(true);
    setError('');
    setDims([]);
    setRendered(new Map());
    renderedRef.current = new Map();
    lruOrder.current = [];
    visiblePages.current = new Set();
    rasterizing.current = new Set();
    docRef.current = null;
    fitAppliedRef.current = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/files/exercise/${pdfRef}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`tải PDF thất bại (${res.status})`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        loadingTask = pdfjs.getDocument({ data: buf });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        docRef.current = doc;
        const out: PageDim[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const pg = await doc.getPage(n);
          if (cancelled) return;
          const scale = RENDER_WIDTH / pg.getViewport({ scale: 1 }).width;
          const viewport = pg.getViewport({ scale });
          out.push({ w: viewport.width, h: viewport.height });
        }
        if (!cancelled) {
          setDims(out);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'lỗi PDF');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      loadingTask?.destroy();
      docRef.current = null;
    };
  }, [pdfRef]);

  // Fit the page to the container's width once it's known (mobile: shrink below RENDER_WIDTH so
  // the whole page is visible instead of cropped by the pinch-container's overflow:hidden; desktop:
  // container is already ≥ RENDER_WIDTH so this is a no-op, scale stays 1). Applied once per document
  // load — does not fight a user who has since pinch-zoomed.
  useEffect(() => {
    if (dims.length === 0 || fitAppliedRef.current || !outerRef.current) return;
    const containerWidth = outerRef.current.clientWidth;
    if (containerWidth <= 0) return;
    const fit = Math.min(1, containerWidth / RENDER_WIDTH);
    fitAppliedRef.current = true;
    setFitScale(fit);
    setScale(fit);
  }, [dims]);

  // Bumps a page to most-recently-used and evicts least-recently-used bitmaps past the cap.
  // Never evicts a page currently on screen (visiblePages) — a still-visible page must not go
  // blank; if every rendered page is visible, the cap is temporarily exceeded rather than evict
  // one. Mutates `map` in place — callers pass a fresh copy staged for setRendered.
  function touchLruAndEvict(map: Map<number, string>, index: number) {
    lruOrder.current = lruOrder.current.filter((i) => i !== index);
    lruOrder.current.push(index);
    if (lruOrder.current.length <= MAX_RENDERED_PAGES) return;
    const evictable = lruOrder.current.filter((i) => !visiblePages.current.has(i));
    const evict = evictable[0];
    if (evict === undefined) return;
    lruOrder.current = lruOrder.current.filter((i) => i !== evict);
    map.delete(evict);
  }

  // Rasterizes one page on demand; a no-op if already rendered or already in flight. Ref
  // bookkeeping (lruOrder/renderedRef) happens synchronously here, outside any setState
  // updater — React 18 StrictMode double-invokes updater functions in dev, which would
  // otherwise double-mutate these refs.
  const rasterizePage = useCallback(async (index: number) => {
    if (rasterizing.current.has(index) || renderedRef.current.has(index)) return;
    const doc = docRef.current;
    if (!doc) return;
    rasterizing.current.add(index);
    try {
      const pg = await doc.getPage(index + 1);
      const scale = RENDER_WIDTH / pg.getViewport({ scale: 1 }).width;
      const viewport = pg.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d')!;
      await pg.render({ canvas, canvasContext: ctx, viewport }).promise;
      const url = canvas.toDataURL('image/png');
      const next = new Map(renderedRef.current);
      next.set(index, url);
      touchLruAndEvict(next, index);
      renderedRef.current = next;
      setRendered(next);
    } catch {
      // Leave the placeholder; the IntersectionObserver retries on the next visibility change.
    } finally {
      rasterizing.current.delete(index);
    }
  }, []);

  // Registers/unregisters each page's DOM node with the shared IntersectionObserver as it mounts/unmounts.
  const setPageNode = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) {
      pageNodes.current.set(index, el);
      observerRef.current?.observe(el);
    } else {
      const prev = pageNodes.current.get(index);
      if (prev) observerRef.current?.unobserve(prev);
      pageNodes.current.delete(index);
    }
  }, []);

  // Windowed rasterization: only pages in/near the viewport render pixels; the rest stay as
  // measured-dims placeholders. Works inside the P5 zoom/pan transform because IntersectionObserver
  // measures actual rendered geometry (CSS transforms included), not untransformed layout boxes.
  useEffect(() => {
    if (dims.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = Number((entry.target as HTMLElement).dataset.pageIndex);
          if (Number.isNaN(idx)) continue;
          if (!entry.isIntersecting) {
            visiblePages.current.delete(idx);
            continue;
          }
          visiblePages.current.add(idx);
          if (renderedRef.current.has(idx)) {
            lruOrder.current = lruOrder.current.filter((i) => i !== idx);
            lruOrder.current.push(idx);
          } else {
            void rasterizePage(idx);
          }
        }
      },
      { rootMargin: PREFETCH_MARGIN, threshold: 0 },
    );
    observerRef.current = observer;
    pageNodes.current.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [dims.length, rasterizePage]);

  // Pointer → normalised page coordinate.
  function norm(e: React.PointerEvent, _page: PageDim) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  function eraseAt(pageIndex: number, page: PageDim, p: { x: number; y: number }) {
    const px = p.x * page.w;
    const py = p.y * page.h;
    let bestIdx = -1;
    let bestDist = Infinity;
    items.forEach((it, idx) => {
      if (it.type !== 'ink' || it.page !== pageIndex) return;
      const d = distToPolyline(px, py, it.points, page);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0 && bestDist <= ERASE_RADIUS_PX) {
      emit(items.filter((_, i) => i !== bestIdx));
    }
  }

  function onDown(e: React.PointerEvent, pageIndex: number, page: PageDim) {
    if (!editable) return;
    if (pointers.current.size >= 1) return; // a second finger is a pinch gesture, not a draw
    const p = norm(e, page);
    if (tool === 'eraser') {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      erasing.current = true;
      eraseAt(pageIndex, page, p);
      return;
    }
    if (tool === 'text') {
      if (items.length >= MAX_ITEMS) {
        setCapMsg('Đã quá nhiều nét vẽ/ghi chú, hãy xóa bớt trước khi thêm.');
        return;
      }
      const text = window.prompt('Nội dung ghi chú:');
      if (text && text.trim()) emit([...items, { type: 'text', page: pageIndex, color, size: 16, pos: p, text: text.trim() }]);
      return;
    }
    if (items.length >= MAX_ITEMS) {
      setCapMsg('Đã quá nhiều nét vẽ, hãy xóa bớt trước khi vẽ thêm.');
      return;
    }
    setCapMsg('');
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drawing.current =
      tool === 'ink'
        ? { type: 'ink', page: pageIndex, color, width, points: [p] }
        : { type: 'highlight', page: pageIndex, color, rect: { x: p.x, y: p.y, w: 0, h: 0 } };
    force((n) => n + 1);
  }

  function onMove(e: React.PointerEvent, pageIndex: number, page: PageDim) {
    if (erasing.current && tool === 'eraser') {
      eraseAt(pageIndex, page, norm(e, page));
      return;
    }
    const cur = drawing.current;
    if (!cur) return;
    const p = norm(e, page);
    if (cur.type === 'ink') {
      if (cur.points.length >= MAX_INK_POINTS) {
        setCapMsg('Nét vẽ quá dài, đã tự dừng lại.');
        return;
      }
      cur.points.push(p);
    } else if (cur.type === 'highlight') {
      cur.rect = { x: Math.min(cur.rect.x, p.x), y: Math.min(cur.rect.y, p.y), w: Math.abs(p.x - cur.rect.x), h: Math.abs(p.y - cur.rect.y) };
    }
    force((n) => n + 1);
  }

  function onUp() {
    erasing.current = false;
    const cur = drawing.current;
    drawing.current = null;
    if (!cur) return;
    if (cur.type === 'ink' && cur.points.length < 2) return; // ignore a stray dot
    if (cur.type === 'highlight' && (cur.rect.w < 0.01 || cur.rect.h < 0.01)) return;
    emit([...items, cur]);
  }

  // Two simultaneous pointers = pinch-zoom + pan; a view transform only, coords stay normalised.
  function pinchDown(e: React.PointerEvent) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      drawing.current = null;
      erasing.current = false;
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        startDist: Math.hypot(b!.x - a!.x, b!.y - a!.y),
        startScale: scale,
        startMid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
        startOffset: offset,
      };
    }
  }

  function pinchMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(b!.x - a!.x, b!.y - a!.y);
      const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      const ratio = pinch.current.startDist === 0 ? 1 : dist / pinch.current.startDist;
      const nextScale = Math.min(MAX_SCALE, Math.max(fitScale, pinch.current.startScale * ratio));
      setScale(nextScale);
      setOffset({
        x: pinch.current.startOffset.x + (mid.x - pinch.current.startMid.x),
        y: pinch.current.startOffset.y + (mid.y - pinch.current.startMid.y),
      });
    }
  }

  function pinchUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function resetZoom() {
    setScale(fitScale);
    setOffset({ x: 0, y: 0 });
  }

  function undo() {
    emit(items.slice(0, -1));
  }
  function clearAll() {
    emit([]);
  }

  if (loading) return <div style={{ color: '#868e96', fontSize: 13 }}>Đang tải đề PDF…</div>;
  if (error) return <div style={{ color: '#e03131', fontSize: 13 }}>Không mở được đề: {error}</div>;

  // Show the in-progress stroke alongside the committed editable items.
  const live = drawing.current ? [...items, drawing.current] : items;

  return (
    <div style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
      {editable && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 8,
            // Sticky only when the caller bounds our height (i.e. WE scroll internally) — otherwise
            // the caller's own container scrolls and a sticky toolbar here would have nothing to
            // stick to, or worse, pin itself against unrelated content.
            ...(maxHeight
              ? { position: 'sticky' as const, top: 0, zIndex: 1, background: '#fff', paddingTop: 4, paddingBottom: 8 }
              : {}),
          }}
        >
          {(['ink', 'highlight', 'text', 'eraser'] as Tool[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTool(t)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid #ced4da',
                background: tool === t ? '#228be6' : '#fff',
                color: tool === t ? '#fff' : '#212529',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {t === 'ink' ? 'Bút' : t === 'highlight' ? 'Tô sáng' : t === 'text' ? 'Chữ' : 'Tẩy'}
            </button>
          ))}
          <span style={{ width: 1, height: 20, background: '#dee2e6' }} />
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`màu ${c}`}
              onClick={() => setColor(c)}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: c,
                border: color === c ? '2px solid #212529' : '2px solid #fff',
                boxShadow: '0 0 0 1px #ced4da',
                cursor: 'pointer',
              }}
            />
          ))}
          <span style={{ width: 1, height: 20, background: '#dee2e6' }} />
          {WIDTHS.map((w) => (
            <button
              key={w.value}
              type="button"
              onClick={() => setWidth(w.value)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid #ced4da',
                background: width === w.value ? '#228be6' : '#fff',
                color: width === w.value ? '#fff' : '#212529',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {w.label}
            </button>
          ))}
          <span style={{ width: 1, height: 20, background: '#dee2e6' }} />
          <button type="button" onClick={undo} disabled={items.length === 0} style={btn}>
            Hoàn tác
          </button>
          <button type="button" onClick={clearAll} disabled={items.length === 0} style={btn}>
            Xóa hết
          </button>
          {scale !== fitScale && (
            <button type="button" onClick={resetZoom} style={btn}>
              Thu nhỏ lại
            </button>
          )}
        </div>
      )}

      {capMsg && (
        <div style={{ color: '#e8590c', fontSize: 12, marginBottom: 8 }}>{capMsg}</div>
      )}

      <div ref={outerRef} style={{ width: '100%', overflow: 'hidden' }}>
      <div
        ref={containerRef}
        onPointerDown={pinchDown}
        onPointerMove={pinchMove}
        onPointerUp={pinchUp}
        onPointerCancel={pinchUp}
        style={{
          touchAction: 'none',
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        {dims.map((page, i) => {
          const url = rendered.get(i);
          return (
            <div
              key={i}
              ref={(el) => setPageNode(i, el)}
              data-page-index={i}
              style={{ position: 'relative', width: page.w, height: page.h, margin: '0 auto 12px', border: '1px solid #e9ecef', touchAction: 'none' }}
            >
              {url ? (
                <img src={url} width={page.w} height={page.h} alt={`Trang ${i + 1}`} draggable={false} style={{ display: 'block' }} />
              ) : (
                <div style={{ width: page.w, height: page.h, background: '#f1f3f5' }} aria-label={`Trang ${i + 1} đang tải`} />
              )}
              <PageLayer page={page} pageIndex={i} editableItems={live} readOnlyLayers={readOnlyLayers} />
              {editable && (
                <div
                  onPointerDown={(e) => onDown(e, i, page)}
                  onPointerMove={(e) => onMove(e, i, page)}
                  onPointerUp={onUp}
                  style={{ position: 'absolute', inset: 0, cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
                />
              )}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid #ced4da',
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
};
