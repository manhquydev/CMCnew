import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { AnnotationData, AnnotationItem } from '@cmc/api/annotation';
import { API_URL } from './client.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

const RENDER_WIDTH = 720;
export type Tool = 'ink' | 'text' | 'highlight';
const COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#212529'];

type PageImg = { url: string; w: number; h: number };
const empty: AnnotationData = { v: 1, items: [] };

/** Page image + every annotation layer drawn over it (read-only layers under the editable one). */
function PageLayer({
  page,
  editableItems,
  readOnlyLayers,
  pageIndex,
}: {
  page: PageImg;
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

function renderItem(it: AnnotationItem, key: string, opacity: number, page: PageImg) {
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
}: {
  pdfRef: string;
  value: AnnotationData | null;
  onChange?: (v: AnnotationData) => void;
  editable?: boolean;
  readOnlyLayers?: { items: AnnotationItem[]; opacity?: number }[];
}) {
  const [pages, setPages] = useState<PageImg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tool, setTool] = useState<Tool>('ink');
  const [color, setColor] = useState<string>(COLORS[0]!);
  const drawing = useRef<AnnotationItem | null>(null);
  const [, force] = useState(0);

  const data = value ?? empty;
  const items = data.items;
  const emit = useCallback(
    (next: AnnotationItem[]) => onChange?.({ v: 1, items: next }),
    [onChange],
  );

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await fetch(`${API_URL}/files/exercise/${pdfRef}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`tải PDF thất bại (${res.status})`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        loadingTask = pdfjs.getDocument({ data: buf });
        const doc = await loadingTask.promise;
        const out: PageImg[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const pg = await doc.getPage(n);
          if (cancelled) return;
          const scale = RENDER_WIDTH / pg.getViewport({ scale: 1 }).width;
          const viewport = pg.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext('2d')!;
          await pg.render({ canvas, canvasContext: ctx, viewport }).promise;
          out.push({ url: canvas.toDataURL('image/png'), w: viewport.width, h: viewport.height });
        }
        if (!cancelled) {
          setPages(out);
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
    };
  }, [pdfRef]);

  // Pointer → normalised page coordinate.
  function norm(e: React.PointerEvent, page: PageImg) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  function onDown(e: React.PointerEvent, pageIndex: number, page: PageImg) {
    if (!editable) return;
    const p = norm(e, page);
    if (tool === 'text') {
      const text = window.prompt('Nội dung ghi chú:');
      if (text && text.trim()) emit([...items, { type: 'text', page: pageIndex, color, size: 16, pos: p, text: text.trim() }]);
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drawing.current =
      tool === 'ink'
        ? { type: 'ink', page: pageIndex, color, width: 2, points: [p] }
        : { type: 'highlight', page: pageIndex, color, rect: { x: p.x, y: p.y, w: 0, h: 0 } };
    force((n) => n + 1);
  }

  function onMove(e: React.PointerEvent, page: PageImg) {
    const cur = drawing.current;
    if (!cur) return;
    const p = norm(e, page);
    if (cur.type === 'ink') cur.points.push(p);
    else if (cur.type === 'highlight') cur.rect = { x: Math.min(cur.rect.x, p.x), y: Math.min(cur.rect.y, p.y), w: Math.abs(p.x - cur.rect.x), h: Math.abs(p.y - cur.rect.y) };
    force((n) => n + 1);
  }

  function onUp() {
    const cur = drawing.current;
    drawing.current = null;
    if (!cur) return;
    if (cur.type === 'ink' && cur.points.length < 2) return; // ignore a stray dot
    if (cur.type === 'highlight' && (cur.rect.w < 0.01 || cur.rect.h < 0.01)) return;
    emit([...items, cur]);
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
    <div>
      {editable && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          {(['ink', 'highlight', 'text'] as Tool[]).map((t) => (
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
              {t === 'ink' ? 'Bút' : t === 'highlight' ? 'Tô sáng' : 'Chữ'}
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
          <button type="button" onClick={undo} disabled={items.length === 0} style={btn}>
            Hoàn tác
          </button>
          <button type="button" onClick={clearAll} disabled={items.length === 0} style={btn}>
            Xóa hết
          </button>
        </div>
      )}

      {pages.map((page, i) => (
        <div
          key={i}
          style={{ position: 'relative', width: page.w, height: page.h, margin: '0 auto 12px', border: '1px solid #e9ecef', touchAction: 'none' }}
        >
          <img src={page.url} width={page.w} height={page.h} alt={`Trang ${i + 1}`} draggable={false} style={{ display: 'block' }} />
          <PageLayer page={page} pageIndex={i} editableItems={live} readOnlyLayers={readOnlyLayers} />
          {editable && (
            <div
              onPointerDown={(e) => onDown(e, i, page)}
              onPointerMove={(e) => onMove(e, page)}
              onPointerUp={onUp}
              style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}
            />
          )}
        </div>
      ))}
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
