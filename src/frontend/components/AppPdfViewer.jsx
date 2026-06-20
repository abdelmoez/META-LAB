/**
 * AppPdfViewer.jsx — the universal in-app PDF viewer.
 *
 * prompt42 rewrite (Tasks 4-6): a CONTINUOUS, virtualized, browser-quality viewer.
 *  - Task 4 — CONTINUOUS SCROLL: every page lives in a vertical scroll column; you
 *    scroll naturally. Pages are lazily rendered only when near the viewport
 *    (IntersectionObserver) and unrendered when far away, so even a 500-page PDF
 *    stays light on weak machines. Prev/Next + the page indicator are driven by the
 *    most-visible page; the buttons SCROLL to the target page.
 *  - Task 5 — SHARP FIT-WIDTH ON OPEN: the first page renders fit-to-width and crisp
 *    immediately. Root cause of the old "small/fuzzy until zoomed" bug was the first
 *    canvas painting at a stale/too-small container width and then being CSS-stretched
 *    by `maxWidth:100%`. Fixed by (a) a skeleton until the container width is really
 *    measured, (b) rendering each page at the correct HiDPI backing-store scale, and
 *    (c) removing the CSS stretch entirely. Re-fits (and re-renders) on container
 *    resize (RoB panel drag, menu collapse, window resize) via a ResizeObserver.
 *  - Task 6 — CHROME-LIKE LIVE SEARCH: typing finds matches as you type (no Enter
 *    needed), highlights every occurrence in a real pdf.js text layer, shows
 *    "n / total", up/down (Enter / Shift+Enter) navigate and scroll to the selected
 *    match, with Match-case and Whole-words toggles. Escape closes and clears.
 *
 * Auth/loading is unchanged from prompt41: we fetch the PDF bytes ourselves with the
 * session cookie, validate them, and hand pdf.js {data}. The worker runs off-thread
 * via Vite's `?worker` (a real bundled .js worker — fixes the prod .mjs MIME bug).
 *
 * Theme-aware (day/night) via the app design tokens. SSR/test-safe: all browser-only
 * APIs (ResizeObserver, IntersectionObserver, devicePixelRatio, TextLayer) are used
 * only inside effects (which never run during renderToStaticMarkup) and guarded.
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.min.mjs';
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import { findMatchesInText } from './pdfSearch.js';

if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
  try { pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker(); } catch { /* falls back to fake worker */ }
}

// First bytes of a PDF are "%PDF-" — detects an HTML/JSON error body returned 200.
function isPdfBytes(buf) {
  try {
    const a = new Uint8Array(buf.slice(0, 5));
    return a[0] === 0x25 && a[1] === 0x50 && a[2] === 0x44 && a[3] === 0x46 && a[4] === 0x2d;
  } catch { return false; }
}

const GUTTER = 16;          // breathing room so a page never touches the scroll edge
const PAGE_GAP = 14;        // vertical gap between continuous pages
const ZOOM_MIN = 0.4, ZOOM_MAX = 5, ZOOM_STEP = 0.2;
const RENDER_BUFFER = 1;    // also render this many pages above/below the visible ones
const FALLBACK_DIMS = { w: 612, h: 792 }; // US-Letter @72dpi until a page's real dims load

// Highlight colors are intentionally fixed (PDF canvases are white): they read well
// on both themes and never leak a CSS var into a canvas-rasterized context.
const HL = 'rgba(255,213,0,0.42)';
const HL_CURRENT = 'rgba(255,138,0,0.75)';

// Minimal, SCOPED text-layer CSS (mirrors pdfjs-dist/web/pdf_viewer.css, class-scoped
// to avoid leaking global `.textLayer` rules into the token theme). Injected once.
const TEXTLAYER_STYLE_ID = 'mlpdf-textlayer-style';
const TEXTLAYER_CSS = `
.mlpdf-tl{position:absolute;inset:0;overflow:clip;line-height:1;text-align:initial;
  transform-origin:0 0;forced-color-adjust:none;z-index:2;text-size-adjust:none;}
.mlpdf-tl :is(span,br){color:transparent;position:absolute;white-space:pre;transform-origin:0% 0%;}
.mlpdf-tl[data-main-rotation="90"]{transform:rotate(90deg) translateY(-100%);}
.mlpdf-tl[data-main-rotation="180"]{transform:rotate(180deg) translate(-100%,-100%);}
.mlpdf-tl[data-main-rotation="270"]{transform:rotate(270deg) translateX(-100%);}
.mlpdf-tl mark{color:transparent;background:${HL};border-radius:2px;padding:0;margin:0;}
.mlpdf-tl mark.cur{background:${HL_CURRENT};box-shadow:0 0 0 1px rgba(255,120,0,0.95);}
`;
function ensureTextLayerStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(TEXTLAYER_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = TEXTLAYER_STYLE_ID;
  el.textContent = TEXTLAYER_CSS;
  document.head.appendChild(el);
}

export default function AppPdfViewer({
  url,
  externalUrl = null,        // "open in new tab" target shown in the error state
  flush = false,             // fill parent height (RoB sidebar) vs fixed previewHeight
  previewHeight = 520,
  withCredentials = true,
}) {
  const [doc, setDoc]         = useState(null);
  const [numPages, setNum]    = useState(0);
  const [pageNum, setPageNum] = useState(1);   // most-visible page (the indicator)
  const [zoom, setZoom]       = useState(1);   // 1 = fit-width
  const [rotation, setRot]    = useState(0);   // 0 | 90 | 180 | 270
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  // Per-page intrinsic (unrotated, scale-1) dimensions, discovered lazily.
  const [dims, setDims] = useState({});        // { [pageNum]: {w,h} }
  const dimsRef = useRef({});
  dimsRef.current = dims;

  // Which pages are currently mounted as canvases (virtualization window).
  const [renderSet, setRenderSet] = useState(() => new Set([1]));
  const ratiosRef = useRef(new Map());         // page -> intersectionRatio (for the indicator)

  // Search state (Task 6).
  const [searchOpen, setSearchOpen] = useState(false);
  const [term, setTerm]         = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matches, setMatches]   = useState([]); // flat ordered [{page, local}]
  const [matchIdx, setMatchIdx] = useState(0);
  const [scanning, setScanning] = useState(false);
  const textCache = useRef(new Map());          // page -> pdf.js textContent object
  const scanToken = useRef(0);

  const wrapRef   = useRef(null);
  const docRef    = useRef(null);
  const pageEls   = useRef(new Map());          // page -> wrapper DOM node
  const [wrapW, setWrapW] = useState(0);
  const programmaticScroll = useRef(0);         // timestamp guard: ignore indicator updates right after a programmatic scroll

  const openExternal = externalUrl || url;
  const dpr = useMemo(() => (typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1), []);
  useEffect(() => { ensureTextLayerStyle(); }, []);

  /* ── Load the document whenever the url changes (Retry bumps reloadKey) ───── */
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!url) { setLoading(false); return undefined; }
    let cancelled = false;
    let task = null;
    setLoading(true); setError(''); setDoc(null); setNum(0);
    setDims({}); setRenderSet(new Set([1])); setPageNum(1); setZoom(1); setRot(0);
    setMatches([]); setTerm(''); setScanning(false);
    textCache.current = new Map(); scanToken.current++;
    (async () => {
      let buf;
      try {
        const res = await fetch(url, { credentials: withCredentials ? 'include' : 'same-origin', headers: { Accept: 'application/pdf' } });
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 401 || res.status === 403
            ? 'You are not signed in, or you do not have access to this PDF.'
            : `The PDF could not be fetched (HTTP ${res.status}).`);
          setLoading(false); return;
        }
        buf = await res.arrayBuffer();
        if (cancelled) return;
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('application/pdf') && !isPdfBytes(buf)) {
          setError('The server did not return a PDF (your session may have expired). Try "Open in new tab".');
          setLoading(false); return;
        }
      } catch {
        if (!cancelled) { setError('Could not reach the PDF (network error). Check your connection and retry.'); setLoading(false); }
        return;
      }
      task = pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false });
      try {
        const d = await task.promise;
        if (cancelled) { try { d.destroy(); } catch { /* noop */ } return; }
        docRef.current = d; setDoc(d); setNum(d.numPages);
        // Seed page-1 dims up-front so the first wrapper is correctly sized → sharp first paint.
        try {
          const p1 = await d.getPage(1);
          if (!cancelled) {
            const vp = p1.getViewport({ scale: 1, rotation: 0 });
            setDims({ 1: { w: vp.width, h: vp.height } });
          }
        } catch { /* fall back to FALLBACK_DIMS */ }
        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) { setError('Could not load PDF — the file may be corrupted or not a valid PDF.'); setLoading(false); }
      }
    })();
    return () => {
      cancelled = true;
      try { task && task.destroy(); } catch { /* noop */ }
      try { docRef.current?.destroy(); } catch { /* noop */ }
      docRef.current = null;
    };
  }, [url, withCredentials, reloadKey]);

  /* ── Track the scroll-container width so pages fit-to-width and re-fit on resize ─ */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    if (typeof ResizeObserver === 'undefined') { setWrapW(el.clientWidth); return undefined; }
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (!w) return;
      cancelAnimationFrame(raf);                       // coalesce rapid resizes (RoB drag) → 1 update/frame
      raf = requestAnimationFrame(() => setWrapW((prev) => (Math.abs(prev - w) >= 1 ? Math.round(w) : prev)));
    });
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [doc, error, loading]);

  /* ── Per-page display geometry (fit-width × zoom, rotation-aware) ─────────── */
  const dimsFor = useCallback((p) => dimsRef.current[p] || dimsRef.current[1] || FALLBACK_DIMS, []);
  const pageScale = useCallback((p) => {
    const base = dimsFor(p);
    const displayW = rotation % 180 === 0 ? base.w : base.h;
    const fit = Math.max(0.1, (wrapW - GUTTER) / displayW);
    return fit * zoom;
  }, [dimsFor, rotation, wrapW, zoom]);
  const pageBox = useCallback((p) => {
    const base = dimsFor(p);
    const s = pageScale(p);
    const displayW = rotation % 180 === 0 ? base.w : base.h;
    const displayH = rotation % 180 === 0 ? base.h : base.w;
    return { w: Math.max(1, Math.round(displayW * s)), h: Math.max(1, Math.round(displayH * s)), scale: s };
  }, [dimsFor, pageScale, rotation]);

  const onPageDims = useCallback((p, d) => {
    setDims((prev) => (prev[p] && Math.abs(prev[p].w - d.w) < 0.5 ? prev : { ...prev, [p]: d }));
  }, []);

  /* ── Virtualization + page indicator: observe each page wrapper ──────────── */
  useEffect(() => {
    const root = wrapRef.current;
    if (!doc || !root || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const p = Number(e.target.getAttribute('data-page'));
        if (!p) continue;
        if (e.isIntersecting) ratiosRef.current.set(p, e.intersectionRatio);
        else ratiosRef.current.delete(p);
      }
      const visible = [...ratiosRef.current.keys()];
      if (visible.length) {
        const lo = Math.max(1, Math.min(...visible) - RENDER_BUFFER);
        const hi = Math.min(numPages || 1, Math.max(...visible) + RENDER_BUFFER);
        const next = new Set();
        for (let i = lo; i <= hi; i++) next.add(i);
        setRenderSet((cur) => (sameSet(cur, next) ? cur : next));
        // Most-visible page → indicator (unless we just programmatically scrolled).
        if (Date.now() - programmaticScroll.current > 350) {
          let best = visible[0], bestR = -1;
          for (const p of visible) { const r = ratiosRef.current.get(p) || 0; if (r > bestR) { bestR = r; best = p; } }
          setPageNum((cur) => (cur === best ? cur : best));
        }
      }
    }, { root, rootMargin: '200px 0px', threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    for (const el of pageEls.current.values()) if (el) io.observe(el);
    return () => io.disconnect();
    // `wrapW > 0` (a one-shot flip) re-runs this AFTER the page wrappers actually mount
    // — they render only once the width is known, which is a later commit than doc-load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, numPages, wrapW > 0]);

  const registerPageEl = useCallback((p, el) => {
    if (el) pageEls.current.set(p, el); else pageEls.current.delete(p);
  }, []);

  /* ── Navigation: scroll the container to a page ──────────────────────────── */
  const scrollToPage = useCallback((n) => {
    const target = Math.min(numPages || 1, Math.max(1, n));
    const el = pageEls.current.get(target);
    if (el && wrapRef.current) {
      programmaticScroll.current = Date.now();
      setPageNum(target);
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [numPages]);
  const prev = () => scrollToPage(pageNum - 1);
  const next = () => scrollToPage(pageNum + 1);
  const zoomIn  = () => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
  const rotateLeft  = () => setRot((r) => (r + 270) % 360);
  const rotateRight = () => setRot((r) => (r + 90) % 360);

  function onKeyDown(e) {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { prev(); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { next(); e.preventDefault(); }
  }

  /* ── Live search scan: find every match across ALL pages (rendered or not) ── */
  const getPageItems = useCallback(async (p) => {
    const cached = textCache.current.get(p);
    if (cached) return cached;
    const d = docRef.current; if (!d) return { items: [] };
    const page = await d.getPage(p);
    const content = await page.getTextContent();
    textCache.current.set(p, content);
    return content;
  }, []);

  const searchOptions = useMemo(() => ({ matchCase, wholeWord }), [matchCase, wholeWord]);

  useEffect(() => {
    if (!doc || !searchOpen) return undefined;
    const q = term.trim();
    if (!q) { setMatches([]); setMatchIdx(0); setScanning(false); return undefined; }
    const token = ++scanToken.current;
    setScanning(true);
    const handle = setTimeout(async () => {
      const flat = [];
      for (let p = 1; p <= (numPages || 0); p++) {
        if (token !== scanToken.current) return;           // superseded — discard
        let content;
        try { content = await getPageItems(p); } catch { content = { items: [] }; }
        const items = (content && content.items) || [];
        let local = 0;
        for (const it of items) {
          const found = findMatchesInText((it && it.str) || '', q, searchOptions);
          for (let k = 0; k < found.length; k++) { flat.push({ page: p, local }); local++; }
        }
      }
      if (token !== scanToken.current) return;
      setMatches(flat); setMatchIdx(0); setScanning(false);
      if (flat.length) scrollToPage(flat[0].page);
    }, 160); // light debounce so it feels immediate without a request/keystroke storm
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, searchOptions, doc, searchOpen, numPages]);

  const current = matches[matchIdx] || null;
  const cycleMatch = useCallback((dir) => {
    setMatchIdx((i) => {
      if (!matches.length) return 0;
      const n = (i + dir + matches.length) % matches.length;
      const m = matches[n];
      if (m) scrollToPage(m.page);
      return n;
    });
  }, [matches, scrollToPage]);

  function onSearchKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); cycleMatch(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  }
  const openSearch = () => setSearchOpen(true);
  const closeSearch = () => { setSearchOpen(false); setTerm(''); setMatches([]); setMatchIdx(0); scanToken.current++; };

  /* ── Render ──────────────────────────────────────────────────────────────── */
  const shellStyle = flush
    ? { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: C.card2 }
    : { display: 'flex', flexDirection: 'column', height: previewHeight, background: C.card2 };

  const ready = !loading && !error && doc;
  const widthKnown = wrapW > 0;
  const pages = ready ? Array.from({ length: numPages }, (_, i) => i + 1) : [];

  return (
    <div style={shellStyle} role="group" aria-label="PDF viewer" onKeyDown={onKeyDown} tabIndex={0}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', flexWrap: 'wrap',
        borderBottom: `1px solid ${C.brd}`, background: C.surf, flexShrink: 0,
      }}>
        <TbIcon label={searchOpen ? 'Hide search' : 'Search in document'} active={searchOpen} onClick={() => (searchOpen ? closeSearch() : openSearch())}>
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
        <TbIcon label="Previous page" onClick={prev} disabled={loading || !!error || pageNum <= 1}><PathChevronUp /></TbIcon>
        <span style={{ fontSize: 11, fontFamily: MONO, color: C.txt2, minWidth: 56, textAlign: 'center' }}>
          {loading || !numPages ? '— / —' : `${pageNum} / ${numPages}`}
        </span>
        <TbIcon label="Next page" onClick={next} disabled={loading || !!error || pageNum >= numPages}><PathChevronDown /></TbIcon>
      </div>

      {/* Live search panel (Task 6) */}
      {searchOpen && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: `1px solid ${C.brd}`, background: C.card, flexShrink: 0, flexWrap: 'wrap' }}>
          <input
            autoFocus value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={onSearchKey}
            placeholder="Find in document…" aria-label="Find in document"
            style={{ flex: 1, minWidth: 120, padding: '6px 10px', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt, fontSize: 12.5, fontFamily: FONT }}
          />
          <span style={{ fontSize: 11, fontFamily: MONO, color: matches.length ? C.txt2 : C.muted, whiteSpace: 'nowrap', minWidth: 56, textAlign: 'center' }} aria-live="polite">
            {scanning && !matches.length ? 'Searching…' : term.trim() ? (matches.length ? `${matchIdx + 1} / ${matches.length}` : 'No results') : ''}
          </span>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <TbIcon label="Previous match" onClick={() => cycleMatch(-1)} disabled={!matches.length}><PathChevronUp /></TbIcon>
            <TbIcon label="Next match" onClick={() => cycleMatch(1)} disabled={!matches.length}><PathChevronDown /></TbIcon>
          </span>
          <Sep />
          <TbIcon label="Match case" active={matchCase} onClick={() => setMatchCase((v) => !v)}><TextAa /></TbIcon>
          <TbIcon label="Whole words" active={wholeWord} onClick={() => setWholeWord((v) => !v)}><TextWord /></TbIcon>
          <TbIcon label="Close search" onClick={closeSearch}><PathClose /></TbIcon>
        </div>
      )}

      {/* Scroll area: continuous pages / state */}
      <div ref={wrapRef} style={{ flex: 1, minHeight: flush ? 0 : undefined, overflow: 'auto', background: C.card2 }}>
        {error ? (
          <div style={{ margin: 'auto', maxWidth: 360, textAlign: 'center', padding: '28px 18px', fontSize: 12.5, color: C.txt2 }}>
            <div style={{ fontSize: 26, marginBottom: 8 }}>📄</div>
            <div style={{ fontWeight: 600, color: C.txt, marginBottom: 4 }}>Could not load PDF</div>
            <div style={{ marginBottom: 12, color: C.muted }}>The document could not be displayed here.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={reload} style={tbTextBtn(C, false)}>Retry</button>
              {openExternal && <a href={openExternal} target="_blank" rel="noopener noreferrer" style={{ ...tbTextBtn(C, false), color: C.acc, textDecoration: 'none' }}>Open in new tab ↗</a>}
            </div>
          </div>
        ) : loading || !widthKnown ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: C.muted, paddingTop: 60 }}>
            <Spinner />
            <div style={{ fontSize: 11.5, fontFamily: MONO, marginTop: 10 }}>Loading PDF…</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: PAGE_GAP, padding: GUTTER / 2, minHeight: '100%' }}>
            {pages.map((p) => {
              const box = pageBox(p);
              return (
                <div
                  key={p}
                  data-page={p}
                  ref={(el) => registerPageEl(p, el)}
                  style={{ position: 'relative', width: box.w, height: box.h, background: '#fff', borderRadius: 4, boxShadow: `0 1px 8px ${C.shadow}`, flexShrink: 0 }}
                >
                  {renderSet.has(p) ? (
                    <PdfPageView
                      doc={doc}
                      pageNumber={p}
                      scale={box.scale}
                      rotation={rotation}
                      dpr={dpr}
                      term={searchOpen ? term.trim() : ''}
                      searchOptions={searchOptions}
                      currentLocal={current && current.page === p ? current.local : null}
                      onDims={onPageDims}
                    />
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim, fontFamily: MONO, fontSize: 11 }}>
                      {p}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── A single continuous page: canvas + real text layer + match highlighting ─── */
function PdfPageView({ doc, pageNumber, scale, rotation, dpr, term, searchOptions, currentLocal, onDims }) {
  const canvasRef = useRef(null);
  const textRef   = useRef(null);
  const renderRef = useRef(null);
  const lastScrolledRef = useRef(null);          // last currentLocal we scrolled to (avoid per-keystroke jitter)
  const [textReady, setTextReady] = useState(0); // bumps after each text-layer (re)build

  // Render the canvas + build the text layer at the current scale/rotation.
  useEffect(() => {
    if (!doc) return undefined;
    let cancelled = false;
    (async () => {
      let page;
      try { page = await doc.getPage(pageNumber); } catch { return; }
      if (cancelled) return;
      // Report intrinsic (unrotated) dims so the parent sizes the wrapper precisely.
      try { const v0 = page.getViewport({ scale: 1, rotation: 0 }); onDims && onDims(pageNumber, { w: v0.width, h: v0.height }); } catch { /* noop */ }

      const viewport = page.getViewport({ scale, rotation }); // CSS-px geometry
      const canvas = canvasRef.current; if (!canvas) return;
      const ctx = canvas.getContext('2d', { alpha: false });
      canvas.width = Math.floor(viewport.width * dpr);        // HiDPI backing store
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`; // CSS size (no stretch → sharp)
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      if (renderRef.current) { try { renderRef.current.cancel(); } catch { /* noop */ } }
      const rt = page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
      renderRef.current = rt;
      try { await rt.promise; } catch (e) { if (e && e.name !== 'RenderingCancelledException') return; }
      if (cancelled) return;

      // Real pdf.js text layer (transparent, positioned over the canvas) for search.
      const tl = textRef.current;
      if (tl) {
        try {
          tl.innerHTML = '';
          tl.style.setProperty('--scale-factor', String(scale));
          tl.setAttribute('data-main-rotation', String(rotation));
          const content = await page.getTextContent();
          if (cancelled) return;
          const textLayer = new pdfjsLib.TextLayer({ textContentSource: content, container: tl, viewport: page.getViewport({ scale, rotation }) });
          await textLayer.render();
          if (cancelled) return;
          // Snapshot each span's original text so highlight passes are idempotent.
          tl.querySelectorAll(':scope > span').forEach((s) => { s.dataset.t = s.textContent; });
          setTextReady((n) => n + 1);
        } catch { /* text layer is best-effort; canvas still shows */ }
      }
    })();
    return () => { cancelled = true; try { renderRef.current && renderRef.current.cancel(); } catch { /* noop */ } };
  }, [doc, pageNumber, scale, rotation, dpr, onDims]);

  // (Re)apply highlights when the term/options/current-match change or text rebuilds.
  useEffect(() => {
    const tl = textRef.current;
    if (!tl) return;
    const spans = tl.querySelectorAll(':scope > span');
    let occ = 0; let curEl = null;
    spans.forEach((span) => {
      const orig = span.dataset.t != null ? span.dataset.t : span.textContent;
      if (!term) { if (span.dataset.t != null && span.innerHTML !== orig) span.textContent = orig; return; }
      const found = findMatchesInText(orig, term, searchOptions);
      if (!found.length) { if (span.textContent !== orig) span.textContent = orig; return; }
      const frag = document.createDocumentFragment();
      let pos = 0;
      for (const m of found) {
        if (m.index > pos) frag.appendChild(document.createTextNode(orig.slice(pos, m.index)));
        const mark = document.createElement('mark');
        mark.textContent = orig.slice(m.index, m.index + m.length);
        if (occ === currentLocal) { mark.className = 'cur'; curEl = mark; }
        frag.appendChild(mark);
        pos = m.index + m.length;
        occ++;
      }
      if (pos < orig.length) frag.appendChild(document.createTextNode(orig.slice(pos)));
      span.textContent = '';
      span.appendChild(frag);
    });
    // Scroll to the current match ONLY when it actually changed (a navigation), not on
    // every keystroke/text-rebuild — otherwise refining an existing search self-scrolls
    // on each character. `currentLocal` only changes via match navigation / scan settle.
    if (currentLocal == null) { lastScrolledRef.current = null; }
    else if (curEl && lastScrolledRef.current !== currentLocal) {
      lastScrolledRef.current = currentLocal;
      try { curEl.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* noop */ }
    }
  }, [term, searchOptions, currentLocal, textReady]);

  return (
    <>
      {/* Canvas size is set in px by the render effect (= the CSS-px viewport), so it
          aligns exactly with the text layer (which setLayerDimensions sizes the same way). */}
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, display: 'block' }} />
      <div ref={textRef} className="mlpdf-tl" aria-hidden="true" />
    </>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────────────── */
function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
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
const PathChevronUp = () => (<svg {...sv}><path d="m5 15 7-7 7 7" /></svg>);
const PathChevronDown = () => (<svg {...sv}><path d="m5 9 7 7 7-7" /></svg>);
const PathClose = () => (<svg {...sv}><path d="M6 6l12 12M18 6 6 18" /></svg>);
const PathRotateLeft = () => (<svg {...sv}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>);
const PathRotateRight = () => (<svg {...sv}><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>);
// "Aa" = match case, "ab|" = whole words — compact text glyphs rendered as SVG text.
const TextAa = () => (<svg {...sv} viewBox="0 0 24 24"><text x="12" y="16" textAnchor="middle" fontSize="12" fontFamily="sans-serif" fill="currentColor" stroke="none" fontWeight="700">Aa</text></svg>);
const TextWord = () => (<svg {...sv} viewBox="0 0 24 24"><text x="10" y="16" textAnchor="middle" fontSize="11" fontFamily="sans-serif" fill="currentColor" stroke="none" fontWeight="700">ab</text><path d="M20 6v12" /></svg>);
