'use client';
import { useEffect, useRef, useState } from 'react';
export default function DocumentPDFPreview({ url }) {
  const canvas = useRef(null);
  const [page, setPage] = useState(1), [pages, setPages] = useState(1), [busy, setBusy] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false, loading, rendering;
    setBusy(true); setError('');
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
        if (cancelled) return;
        loading = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true });
        const pdf = await loading.promise;
        if (cancelled) return;
        setPages(pdf.numPages);
        const current = await pdf.getPage(page);
        if (cancelled) return;
        const base = current.getViewport({ scale: 1 });
        const viewport = current.getViewport({ scale: Math.min(1.5, 1600 / Math.max(base.width, base.height)) });
        canvas.current.width = viewport.width; canvas.current.height = viewport.height;
        rendering = current.render({ canvasContext: canvas.current.getContext('2d'), viewport });
        await rendering.promise;
      } catch (e) { if (!cancelled) setError('Preview unavailable. Download the document to open it.'); }
      finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; rendering?.cancel(); loading?.destroy(); };
  }, [url, page]);
  return <div className="space-y-2"><div className="flex items-center gap-4">
    <button type="button" disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}>Previous page</button>
    <span>{page} / {pages}</span><button type="button" disabled={busy || page >= pages} onClick={() => setPage(p => p + 1)}>Next page</button>
  </div>{busy && <p>Loading preview…</p>}{error && <p role="alert">{error}</p>}<canvas ref={canvas} aria-label="PDF document preview" className="max-w-full border" /></div>;
}
