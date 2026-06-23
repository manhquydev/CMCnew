import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { API_URL } from './client.js';

// Worker resolved through the bundler (Vite rewrites this URL at build). pdfjs needs its worker
// to parse PDFs off the main thread.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

const RENDER_WIDTH = 720; // CSS px the page is fitted to; canvas backing scales by DPR for sharpness.

/**
 * Read-only renderer for an exercise base PDF served at /files/exercise/:ref. Fetches with
 * credentials (the session cookie gates the file), then paints every page to its own canvas.
 * S1.7 is view-only; the annotation overlay lands in S1.8 on top of these same canvases.
 */
export function PdfViewer({ pdfRef }: { pdfRef: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;
    const host = hostRef.current;
    setLoading(true);
    setError('');

    (async () => {
      try {
        const res = await fetch(`${API_URL}/files/exercise/${pdfRef}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`tải PDF thất bại (${res.status})`);
        const data = await res.arrayBuffer();
        if (cancelled) return;
        loadingTask = pdfjs.getDocument({ data });
        const doc: PDFDocumentProxy = await loadingTask.promise;
        if (cancelled || !host) return;
        host.replaceChildren();
        const dpr = window.devicePixelRatio || 1;
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const scale = RENDER_WIDTH / base.width;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          canvas.style.display = 'block';
          canvas.style.margin = '0 auto 12px';
          canvas.style.border = '1px solid #e9ecef';
          const ctx = canvas.getContext('2d')!;
          ctx.scale(dpr, dpr);
          host.appendChild(canvas);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }
        if (!cancelled) setLoading(false);
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
      host?.replaceChildren();
    };
  }, [pdfRef]);

  return (
    <div>
      {loading && <div style={{ color: '#868e96', fontSize: 13 }}>Đang tải đề PDF…</div>}
      {error && <div style={{ color: '#e03131', fontSize: 13 }}>Không mở được đề: {error}</div>}
      <div ref={hostRef} />
    </div>
  );
}
