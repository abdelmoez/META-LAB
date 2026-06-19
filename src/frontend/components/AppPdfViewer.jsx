/**
 * AppPdfViewer.jsx — the universal lightweight in-app PDF viewer (prompt39 Task 1).
 *
 * Renders ONE page at a time to a <canvas> via pdf.js (single-page = fast + light),
 * fit-width by default, with a compact toolbar: search · zoom ± · rotate ↺ ↻ ·
 * prev / next page + a "N / total" indicator. It REPLACES the old browser <iframe>
 * preview inside PdfViewer.jsx, so it inherits the authenticated same-origin
 * download URL and the server's HTTP-Range support (pdf.js streams partial
 * content). The auth model is unchanged: pdf.js fetches with credentials so the
 * session cookie rides along — no public/unauthenticated URL is ever exposed.
 *
 * Performance choices (prompt39 Task 1B):
 *  - The pdf worker runs off the main thread, in a SEPARATE chunk that is loaded
 *    only when a PDF actually opens (so it never weighs down app start-up).
 *  - Only the CURRENT page is rendered; other pages render lazily on navigation.
 *  - The document + worker are torn down on unmount / url change (no leaks).
 *  - Re-fits to width on container resize (ResizeObserver), crisp on HiDPI.
 *  - isEvalSupported:false — no eval; the SPA CSP stays strict.
 *
 * Theme-aware (day/night) via the app design tokens. The legacy pdf.js build is
 * used for broader compatibility on older / weaker machines.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.min.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import { pageTextFromContent, collectMatchingPages } from './pdfSearch.js';

// Point pdf.js at the worker emitted by Vite (a hashed, same-origin asset URL).
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const GUTTER = 16;   // breathing room so the page never touches the scroll edge
const ZOOM_MIN = 0.4, ZOOM_MAX = 5, ZOOM_STEP = 0.2;

export default function AppPdfViewer({
  url,
  externalUrl = null,        // "open in new tab" target shown in the error state
  flush = false,             // fill parent height (RoB sidebar) vs fixed previewHeight
  previewHeight = 520,
  withCredentials = true,
}) {
  const [doc, setDoc]         = useState(null);
  const [numPages, setNum]    = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [zoom, setZoom]       = useState(1);      // 1 = fit-width
  const [rotation, setRot]    = useState(0);      // 0 | 90 | 180 | 270
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [progress, setProgress] = useState(0);    // 0..1 download progress

  // Lazy full-text search — scans page text only on submit (never on load).
  const [searchOpen, setSearchOpen] = useState(false);
  const [term, setTerm]       = useState('');
  const [matches, setMatches] = useState(null);   // number[] of 1-based page indices | null
  const [matchIdx, setMatchIdx] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchProg, setSearchProg] = useState(0); // 0..1 page-scan progress
  const textCache = useRef(new Map());            // pageNum -> lowercased text
  const searchToken = useRef(0);                  // bumped to abort an in-flight scan

  const wrapRef   = useRef(null);
  const canvasRef = useRef(null);
  const docRef    = useRef(null);
  const renderRef = useRef(null);
  const [wrapW, setWrapW] = useState(0);

  const openExternal = externalUrl || url;

  /* ── Load the document whenever the url changes (Retry bumps reloadKey so the
   *    retry goes through the SAME effect → proper cancellation + teardown) ──── */
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!url) { setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true); setError(''); setDoc(null); setNum(0); setProgress(0);
    setMatches(null); setTerm(''); setSearching(false); textCache.current = new Map();
    searchToken.current++; // abort any in-flight search from the previous document
    const task = pdfjsLib.getDocument({ url, withCredentials, isEvalSupported: false });
    task.onProgress = (p) => { if (!cancelled && p && p.total) setProgress(Math.min(1, p.loaded / p.total)); };
    task.promise.then((d) => {
      if (cancelled) { try { d.destroy(); } catch { /* noop */ } return; }
      docRef.current = d; setDoc(d); setNum(d.numPages);
      setPageNum(1); setZoom(1); setRot(0); setLoading(false);
    }).catch(() => { if (!cancelled) { setError('Could not load PDF'); setLoading(false); } });
    return () => {
      cancelled = true;
      try { task.destroy(); } catch { /* noop */ }
      try { docRef.current?.destroy(); } catch { /* noop */ }
      docRef.current = null;
    };
  }, [url, withCredentials, reloadKey]);

  /* ── Track container width so the page fits-to-width and re-fits on resize ── */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') { if (el) setWrapW(el.clientWidth); return undefined; }
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setWrapW(Math.round(w));
    });
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, [doc]);

  /* ── Render the current page (cancels any in-flight render) ──────────────── */
  useEffect(() => {
    if (!doc || !wrapW || !canvasRef.current) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1, rotation });
        const fit = Math.max(0.1, (wrapW - GUTTER) / base.width);
        const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap DPR — memory-light on weak machines
        const scale = fit * zoom;
        const viewport = page.getViewport({ scale: scale * dpr, rotation });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: false });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        if (renderRef.current) { try { renderRef.current.cancel(); } catch { /* noop */ } }
        const rt = page.render({ canvasContext: ctx, viewport });
        renderRef.current = rt;
        await rt.promise;
      } catch (e) {
        if (!cancelled && e && e.name !== 'RenderingCancelledException') { /* keep last frame; non-fatal */ }
      }
    })();
    return () => { cancelled = true; };
  }, [doc, pageNum, zoom, rotation, wrapW]);

  /* ── Navigation + transform helpers ──────────────────────────────────────── */
  const goPage = useCallback((n) => setPageNum((p) => Math.min(numPages || 1, Math.max(1, n || p))), [numPages]);
  const prev = () => goPage(pageNum - 1);
  const next = () => goPage(pageNum + 1);
  const zoomIn  = () => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
  const rotateLeft  = () => setRot((r) => (r + 270) % 360);
  const rotateRight = () => setRot((r) => (r + 90) % 360);

  function onKeyDown(e) {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { prev(); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { next(); e.preventDefault(); }
  }

  /* ── Lazy search: scan page text on submit, collect matching pages.
   *    Abortable (a new search / url change bumps searchToken) and resilient (a
   *    failed page → empty text, never aborts the whole scan); shows progress. ── */
  async function runSearch(e) {
    e?.preventDefault?.();
    const q = term.trim();
    const d = docRef.current;
    if (!q || !d) { setMatches(null); return; }
    const token = ++searchToken.current;
    setSearching(true); setSearchProg(0);
    const getPageText = async (i) => {
      const cached = textCache.current.get(i);
      if (cached != null) return cached;
      const page = await d.getPage(i);
      const txt = pageTextFromContent(await page.getTextContent());
      textCache.current.set(i, txt);
      return txt;
    };
    try {
      const hits = await collectMatchingPages({
        numPages: d.numPages, getPageText, term: q,
        isAborted: () => token !== searchToken.current,
        onProgress: (done, total) => { if (token === searchToken.current) setSearchProg(done / total); },
      });
      if (hits == null || token !== searchToken.current) return; // aborted — discard
      setMatches(hits); setMatchIdx(0);
      if (hits.length) goPage(hits[0]);
    } finally {
      if (token === searchToken.current) setSearching(false);
    }
  }
  function cycleMatch(dir) {
    if (!matches || !matches.length) return;
    const i = (matchIdx + dir + matches.length) % matches.length;
    setMatchIdx(i); goPage(matches[i]);
  }

  /* ── Render ──────────────────────────────────────────────────────────────── */
  const shellStyle = flush
    ? { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: C.card2 }
    : { display: 'flex', flexDirection: 'column', height: previewHeight, background: C.card2 };

  return (
    <div style={shellStyle} role="group" aria-label="PDF viewer" onKeyDown={onKeyDown} tabIndex={0}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', flexWrap: 'wrap',
        borderBottom: `1px solid ${C.brd}`, background: C.surf, flexShrink: 0,
      }}>
        <TbIcon label={searchOpen ? 'Hide search' : 'Search in document'} active={searchOpen} onClick={() => setSearchOpen((s) => !s)}>
          <PathSearch />
        </TbIcon>
        <Sep />
        <TbIcon label="Zoom out" onClick={zoomOut} disabled={loading || !!error || zoom <= ZOOM_MIN}><PathMinus /></TbIcon>
        <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted, minWidth: 38, textAlign: 'center' }} aria-live="off">{Math.round(zoom * 100)}%</span>
        <TbIcon label="Zoom in" onClick={zoomIn} disabled={loading || !!error || zoom >= ZOOM_MAX}><PathPlus /></TbIcon>
        <Sep />
        <TbIcon label="Rotate left" onClick={rotateLeft} disabled={loading || !!error}><PathRotateLeft /></TbIcon>
        <TbIcon label="Rotate right" onClick={rotateRight} disabled={loading || !!error}><PathRotateRight /></TbIcon>
        <div style={{ flex: 1 }} />
        <TbIcon label="Previous page" onClick={prev} disabled={loading || !!error || pageNum <= 1}><PathChevronLeft /></TbIcon>
        <span style={{ fontSize: 11, fontFamily: MONO, color: C.txt2, minWidth: 56, textAlign: 'center' }}>
          {loading || !numPages ? '— / —' : `${pageNum} / ${numPages}`}
        </span>
        <TbIcon label="Next page" onClick={next} disabled={loading || !!error || pageNum >= numPages}><PathChevronRight /></TbIcon>
      </div>

      {/* Search panel (lazy) */}
      {searchOpen && (
        <form onSubmit={runSearch} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: `1px solid ${C.brd}`, background: C.card, flexShrink: 0 }}>
          <input
            autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Find in document…"
            aria-label="Find in document"
            style={{ flex: 1, minWidth: 120, padding: '6px 10px', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt, fontSize: 12.5, fontFamily: FONT }}
          />
          <button type="submit" disabled={searching || !term.trim()} style={tbTextBtn(C, searching || !term.trim())}>{searching ? `Searching… ${Math.round(searchProg * 100)}%` : 'Find'}</button>
          {matches != null && !searching && (
            <span style={{ fontSize: 11, fontFamily: MONO, color: matches.length ? C.txt2 : C.muted, whiteSpace: 'nowrap' }}>
              {matches.length ? `${matchIdx + 1} / ${matches.length} page${matches.length === 1 ? '' : 's'}` : 'No matches'}
            </span>
          )}
          {matches && matches.length > 0 && (
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <TbIcon label="Previous match" onClick={() => cycleMatch(-1)}><PathChevronLeft /></TbIcon>
              <TbIcon label="Next match" onClick={() => cycleMatch(1)}><PathChevronRight /></TbIcon>
            </span>
          )}
        </form>
      )}

      {/* Canvas / state area */}
      <div ref={wrapRef} style={{ flex: 1, minHeight: flush ? 0 : undefined, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: GUTTER / 2, background: C.card2 }}>
        {error ? (
          <div style={{ margin: 'auto', textAlign: 'center', padding: '28px 18px', fontSize: 12.5, color: C.txt2 }}>
            <div style={{ fontSize: 26, marginBottom: 8 }}>📄</div>
            <div style={{ fontWeight: 600, color: C.txt, marginBottom: 4 }}>Could not load PDF</div>
            <div style={{ marginBottom: 12, color: C.muted }}>The document could not be displayed here.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={reload} style={tbTextBtn(C, false)}>Retry</button>
              {openExternal && <a href={openExternal} target="_blank" rel="noopener noreferrer" style={{ ...tbTextBtn(C, false), color: C.acc, textDecoration: 'none' }}>Open in new tab ↗</a>}
            </div>
          </div>
        ) : loading ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: C.muted }}>
            <Spinner />
            <div style={{ fontSize: 11.5, fontFamily: MONO, marginTop: 10 }}>{progress > 0 ? `Loading ${Math.round(progress * 100)}%` : 'Loading PDF…'}</div>
          </div>
        ) : (
          <canvas ref={canvasRef} style={{ display: 'block', borderRadius: 4, boxShadow: `0 1px 8px ${C.shadow}`, maxWidth: '100%' }} />
        )}
      </div>
    </div>
  );
}

/* ── Compact toolbar primitives ─────────────────────────────────────────────── */
function TbIcon({ children, label, onClick, disabled, active }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} aria-pressed={active || undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 26,
        background: active ? alpha(C.acc, '18') : 'none',
        border: `1px solid ${active ? alpha(C.acc, '45') : C.brd2}`, borderRadius: 6,
        color: active ? C.acc : C.txt2, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1, padding: 0, flexShrink: 0,
      }}>
      {children}
    </button>
  );
}
function Sep() { return <span style={{ width: 1, height: 16, background: C.brd, flexShrink: 0 }} />; }
const tbTextBtn = (c, disabled) => ({
  background: 'none', border: `1px solid ${c.brd2}`, color: c.txt2, fontSize: 11.5, fontFamily: FONT,
  padding: '6px 11px', borderRadius: 6, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
});
function Spinner() {
  return (
    <span style={{ display: 'inline-block', width: 22, height: 22, border: `2.5px solid ${alpha(C.acc, '30')}`, borderTopColor: C.acc, borderRadius: '50%', animation: 'mlpdfspin 0.7s linear infinite' }}>
      <style>{'@keyframes mlpdfspin{to{transform:rotate(360deg)}}'}</style>
    </span>
  );
}

/* ── Inline 15px stroke icons (self-contained; no icon-set dependency) ───────── */
const sv = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const PathSearch = () => (<svg {...sv}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>);
const PathPlus = () => (<svg {...sv}><path d="M12 5v14M5 12h14" /></svg>);
const PathMinus = () => (<svg {...sv}><path d="M5 12h14" /></svg>);
const PathChevronLeft = () => (<svg {...sv}><path d="m15 5-7 7 7 7" /></svg>);
const PathChevronRight = () => (<svg {...sv}><path d="m9 5 7 7-7 7" /></svg>);
const PathRotateLeft = () => (<svg {...sv}><path d="M3 8a9 9 0 1 1-2 5.6" /><path d="M3 3v5h5" /></svg>);
const PathRotateRight = () => (<svg {...sv}><path d="M21 8a9 9 0 1 0 2 5.6" transform="scale(-1,1) translate(-24,0)" /><path d="M21 3v5h-5" /></svg>);
