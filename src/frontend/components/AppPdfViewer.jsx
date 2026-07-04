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
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
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
const COL_PAD = GUTTER / 2; // padding around the page column (must match the render)
// prompt44 item 7 — the viewer has two modes: FIT-WIDTH (userScale === null → each
// page exactly fits the container width, recomputed on resize) and CUSTOM-SCALE
// (userScale is an ABSOLUTE scale where 1.0 = 100% of the PDF's native size). The
// toolbar shows "Fit width" in fit mode and the real percentage in custom mode — so
// "100%" never lies. A fixed ladder makes zoom in/out predictable; the bounds stop the
// page exploding (over-zoom) or vanishing (sub-pixel), which were the reported bugs.
const SCALE_MIN = 0.25, SCALE_MAX = 5;
const ZOOM_LADDER = [0.25, 0.5, 0.67, 0.8, 1.0, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const clampScale = (s) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, Number(s) || SCALE_MIN));
const ladderUp = (s) => ZOOM_LADDER.find((v) => v > s + 1e-4) ?? SCALE_MAX;
const ladderDown = (s) => [...ZOOM_LADDER].reverse().find((v) => v < s - 1e-4) ?? SCALE_MIN;
const RENDER_BUFFER_PX = 900; // render pages within this many px above/below the viewport
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
  // ── Optional interactivity (RoadMap/1.md extraction workspace) ──────────────
  // All default to inert, so existing callers (RoB, screening) are byte-for-byte
  // unchanged. `onDocLoaded(doc)` hands the pdf.js document to a host that wants to
  // extract text or re-render a region. `interaction` opts a page into click-to-
  // assign or drag-a-region selection; `pageOverlay(page)` renders host content over
  // a page (e.g. a draft highlight). Coordinates reported to the host are in PDF
  // USER SPACE at scale 1 (x right from left, y UP from the page bottom) so they
  // compose with the pure pdfTextGrid/gridFromRegion engine.
  onDocLoaded = null,
  interaction = null,        // null | { mode:'click'|'region', onTextClick, onRegion }
  pageOverlay = null,        // null | (page:number) => ReactNode
}) {
  const [doc, setDoc]         = useState(null);
  const [numPages, setNum]    = useState(0);
  const [pageNum, setPageNum] = useState(1);   // most-visible page (the indicator)
  const [userScale, setUserScale] = useState(null); // null = fit-width mode; else absolute scale
  const [rotation, setRot]    = useState(0);   // 0 | 90 | 180 | 270
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  // Per-page intrinsic (unrotated, scale-1) dimensions, discovered lazily.
  const [dims, setDims] = useState({});        // { [pageNum]: {w,h} }
  const dimsRef = useRef({});
  dimsRef.current = dims;

  // Continuous-scroll virtualization window: the inclusive page range currently
  // mounted as canvases. Driven DETERMINISTICALLY by scroll position + measured page
  // offsets (not an IntersectionObserver), so pages never stay blank and search/nav
  // never lands on an unrendered page.
  const [renderRange, setRenderRange] = useState({ lo: 1, hi: 1 });
  const anchorRef = useRef(null);              // { page, frac, y } captured before a zoom → keeps scroll stable
  const scrollRaf = useRef(0);
  // Always-fresh mirrors so the zoom/anchor helpers stay referentially stable.
  const userScaleRef = useRef(null); userScaleRef.current = userScale;
  const rotationRef = useRef(0);     rotationRef.current = rotation;
  const pageNumRef = useRef(1);      pageNumRef.current = pageNum;

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
  const [wrapW, setWrapW] = useState(0);
  const wrapWRef = useRef(0); wrapWRef.current = wrapW;
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
    setDims({}); setRenderRange({ lo: 1, hi: 1 }); setPageNum(1); setUserScale(null); setRot(0);
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
        try { onDocLoaded && onDocLoaded(d); } catch { /* host callback is best-effort */ }
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
  // Intrinsic (rotation-applied) dims; a page falls back to page-1's dims until its
  // own are discovered, so the column has a sensible height before every page renders.
  const displayDims = useCallback((p) => {
    const base = dimsRef.current[p] || dimsRef.current[1] || FALLBACK_DIMS;
    return rotation % 180 === 0 ? { w: base.w, h: base.h } : { w: base.h, h: base.w };
  }, [rotation]);
  // Fit-to-width scale for a page (guarded against a zero/negative measured width).
  const fitScaleFor = useCallback((p) => {
    const { w } = displayDims(p);
    return Math.max(0.05, (wrapW - GUTTER) / Math.max(1, w));
  }, [displayDims, wrapW]);
  // Effective render scale: the absolute userScale when set, else fit-to-width.
  const scaleFor = useCallback((p) => (
    userScale == null ? fitScaleFor(p) : userScale
  ), [fitScaleFor, userScale]);
  const boxFor = useCallback((p) => {
    const { w, h } = displayDims(p);
    const s = scaleFor(p);
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scale: s };
  }, [displayDims, scaleFor]);

  // Cumulative page tops (px from the scroll-content origin), recomputed whenever the
  // scale/rotation/dims change. This is the single source of truth for both the
  // virtualization window and scroll-to-page — no DOM measurement, no IO timing races.
  const pageTops = useMemo(() => {
    const tops = new Array((numPages || 0) + 2).fill(COL_PAD);
    let y = COL_PAD;
    for (let p = 1; p <= (numPages || 0); p++) { tops[p] = y; y += boxFor(p).h + PAGE_GAP; }
    if (numPages) tops[numPages + 1] = y;
    return tops;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, boxFor, dims]);

  // Which page (and the fractional offset within it) sits at a given content Y.
  const pageAtOffset = useCallback((contentY) => {
    let p = 1;
    for (let i = 1; i <= (numPages || 0); i++) { if (pageTops[i] <= contentY) p = i; else break; }
    const top = pageTops[p] || 0;
    const h = Math.max(1, boxFor(p).h);
    return { page: p, frac: Math.min(1, Math.max(0, (contentY - top) / h)) };
  }, [numPages, pageTops, boxFor]);

  const onPageDims = useCallback((p, d) => {
    setDims((prev) => (prev[p] && Math.abs(prev[p].w - d.w) < 0.5 ? prev : { ...prev, [p]: d }));
  }, []);

  // Always-fresh mirrors so the zoom/anchor helpers can stay referentially STABLE
  // (no re-creation as pages report dims) — this keeps the native wheel listener
  // bound once instead of re-binding on every scroll-driven layout change.
  const numPagesRef = useRef(0);       numPagesRef.current = numPages;
  const pageAtOffsetRef = useRef(null); pageAtOffsetRef.current = pageAtOffset;

  /* ── Scroll-driven virtualization window + page indicator ────────────────── */
  // Compute the inclusive page range whose boxes fall within the viewport (± a px
  // buffer) and update the indicator to the page nearest the viewport centre.
  const recomputeWindow = useCallback(() => {
    const el = wrapRef.current;
    if (!el || !numPages) return;
    const top = el.scrollTop;
    const vh = el.clientHeight || 0;
    const lo = top - RENDER_BUFFER_PX;
    const hi = top + vh + RENDER_BUFFER_PX;
    let a = numPages;
    for (let p = 1; p <= numPages; p++) { if (pageTops[p] + boxFor(p).h >= lo) { a = p; break; } }
    let b = a;
    for (let p = a; p <= numPages; p++) { if (pageTops[p] <= hi) b = p; else break; }
    setRenderRange((cur) => (cur.lo === a && cur.hi === b ? cur : { lo: a, hi: b }));
    if (Date.now() - programmaticScroll.current > 250) {
      const { page } = pageAtOffset(top + vh / 2);
      setPageNum((cur) => (cur === page ? cur : page));
    }
  }, [numPages, pageTops, boxFor, pageAtOffset]);

  const onScroll = useCallback(() => {
    cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(recomputeWindow);
  }, [recomputeWindow]);

  // Recompute the window after the document loads and after any layout change
  // (zoom, rotation, width, page-dims) shifts the page offsets.
  useEffect(() => { recomputeWindow(); }, [recomputeWindow]);
  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), []);

  // Keep the scroll position stable across a zoom: restore the content point that
  // was under the zoom anchor (viewport centre for buttons, the cursor for wheel).
  useLayoutEffect(() => {
    const a = anchorRef.current; anchorRef.current = null;
    const el = wrapRef.current;
    if (!a || !el) return;
    const top = pageTops[a.page] || 0;
    const h = Math.max(1, boxFor(a.page).h);
    el.scrollTop = Math.max(0, (top + a.frac * h) - a.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userScale, rotation, wrapW]);

  /* ── Navigation: scroll the container to a page ──────────────────────────── */
  const scrollToPage = useCallback((n) => {
    const el = wrapRef.current;
    if (!el || !numPages) return;
    const target = Math.min(numPages, Math.max(1, n));
    programmaticScroll.current = Date.now();
    setPageNum(target);
    // Mount the target (± a neighbour) immediately so it is never blank on arrival,
    // even before the scroll handler fires.
    setRenderRange((cur) => {
      const lo = Math.max(1, target - 1), hi = Math.min(numPages, target + 1);
      return (cur.lo <= lo && cur.hi >= hi) ? cur : { lo: Math.min(cur.lo, lo), hi: Math.max(cur.hi, hi) };
    });
    el.scrollTo({ top: Math.max(0, (pageTops[target] || 0) - COL_PAD), behavior: 'smooth' });
  }, [numPages, pageTops]);
  const prev = () => scrollToPage(pageNum - 1);
  const next = () => scrollToPage(pageNum + 1);

  // Capture the content point under `anchorClientY` (or the viewport centre) so the
  // scroll-anchor layout effect can keep it visually pinned across a scale/rotation
  // change. Reads DOM + state via refs at EVENT time (not inside a reducer), so it is
  // referentially stable and StrictMode-safe.
  const captureAnchor = useCallback((anchorClientY) => {
    const el = wrapRef.current;
    if (!el || !numPagesRef.current || !pageAtOffsetRef.current) return;
    const rect = el.getBoundingClientRect();
    const y = anchorClientY == null ? rect.height / 2 : (anchorClientY - rect.top);
    anchorRef.current = { ...pageAtOffsetRef.current(el.scrollTop + y), y };
  }, []);
  // The current effective ABSOLUTE scale, whether in fit-width or custom mode. Reads
  // refs so it (and applyZoom) stay stable. In fit mode it derives the fit scale from
  // page-1's dims + the measured width — the same number the pages actually render at.
  const effScaleNow = () => {
    if (userScaleRef.current != null) return userScaleRef.current;
    // Fit scale of the page currently in view (so a zoom click starts from what the
    // user sees — matters only for mixed-size PDFs; identical for uniform ones).
    const base = dimsRef.current[pageNumRef.current] || dimsRef.current[1] || FALLBACK_DIMS;
    const w = rotationRef.current % 180 === 0 ? base.w : base.h;
    return Math.max(0.05, (wrapWRef.current - GUTTER) / Math.max(1, w));
  };
  const applyZoom = useCallback((compute, anchorClientY) => {
    const cur = effScaleNow();
    const next = clampScale(typeof compute === 'function' ? compute(cur) : compute);
    // No-op only when already at this exact custom scale (in fit mode we always commit,
    // so the first zoom click leaves fit mode even if the numbers coincide).
    if (Math.abs(next - cur) < 1e-4 && userScaleRef.current != null) return;
    captureAnchor(anchorClientY);
    setUserScale(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureAnchor]);
  const zoomIn  = () => applyZoom((s) => ladderUp(s));
  const zoomOut = () => applyZoom((s) => ladderDown(s));
  // Reset to fit-width mode (the toolbar's "Fit width" control).
  const fitWidth = () => { captureAnchor(null); setUserScale(null); };
  // Rotate keeps the centred page in view by capturing the same anchor first.
  const rotateLeft  = () => { captureAnchor(null); setRot((r) => (r + 270) % 360); };
  const rotateRight = () => { captureAnchor(null); setRot((r) => (r + 90) % 360); };

  // Ctrl/⌘ + wheel zooms smoothly around the cursor; a plain wheel scrolls normally.
  // Bound as a non-passive native listener so preventDefault suppresses the browser
  // zoom. applyZoom is stable, so this binds once per document (no per-scroll churn).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const handler = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      applyZoom((s) => s * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientY);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [applyZoom, doc]);

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
  // prompt45 — the shell MUST fill its parent's width. In flush mode the host wraps it
  // in a `display:flex` ROW, where a child with no width/flex shrinks to its content —
  // that made the viewer (and `wrapW`) collapse to a tiny page hugging the left with
  // dead space on the right, and the toolbar appeared to "move" because the whole
  // viewer resized with the page on zoom. `flex:1 1 0% + width:100% + minWidth:0` makes
  // it grow to the full panel in a flex parent and stay full-width in a block parent.
  const shellStyle = flush
    ? { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', minWidth: 0, flex: '1 1 0%', minHeight: 0, background: C.card2 }
    : { display: 'flex', flexDirection: 'column', height: previewHeight, width: '100%', minWidth: 0, background: C.card2 };

  const ready = !loading && !error && doc;
  const widthKnown = wrapW > 0;
  const pages = ready ? Array.from({ length: numPages }, (_, i) => i + 1) : [];

  // prompt44 item 7 — the toolbar shows "Fit width" in fit mode and the REAL percentage
  // in custom mode; effScale is the absolute scale the pages actually render at, so the
  // in/out buttons disable correctly at the scale bounds (not a phantom multiplier).
  const inFit = userScale == null;
  const effScale = inFit ? fitScaleFor(pageNum) : userScale;
  const zoomLabel = inFit ? 'Fit width' : `${Math.round(effScale * 100)}%`;
  const canZoomOut = !loading && !error && effScale > SCALE_MIN + 1e-3;
  const canZoomIn  = !loading && !error && effScale < SCALE_MAX - 1e-3;

  return (
    <div style={shellStyle} role="group" aria-label="PDF viewer" onKeyDown={onKeyDown} tabIndex={0}>
      {/* Toolbar — prompt45: a FIXED bar separate from the scrolling/zoomable document
          area. flexShrink:0 keeps it out of the scroll area; zIndex + shadow make it sit
          above the content; it never resizes on zoom because the viewer is now full-width
          and the zoom label has a fixed width. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', flexWrap: 'wrap',
        borderBottom: `1px solid ${C.brd}`, background: C.surf, flexShrink: 0,
        position: 'relative', zIndex: 2, boxShadow: `0 1px 4px -2px ${C.shadow}`,
      }}>
        <TbIcon label={searchOpen ? 'Hide search' : 'Search in document'} active={searchOpen} onClick={() => (searchOpen ? closeSearch() : openSearch())}>
          <PathSearch />
        </TbIcon>
        <Sep />
        <TbIcon label="Zoom out" onClick={zoomOut} disabled={!canZoomOut}><PathMinus /></TbIcon>
        <button type="button" onClick={fitWidth} disabled={loading || !!error}
          title={inFit ? 'Pages fit the width' : 'Reset to fit width'}
          aria-label={inFit ? 'Fit width (current)' : 'Reset to fit width'} aria-pressed={inFit}
          style={{
            width: 76, height: 26, padding: '0 8px', fontSize: 10.5, fontFamily: MONO, fontWeight: 700, textAlign: 'center',
            background: inFit ? alpha(C.acc, '18') : 'none',
            border: `1px solid ${inFit ? alpha(C.acc, '45') : C.brd2}`, borderRadius: 6,
            color: inFit ? C.acc : C.txt2, cursor: (loading || error) ? 'default' : 'pointer',
            opacity: (loading || error) ? 0.4 : 1, flexShrink: 0, whiteSpace: 'nowrap',
          }}>{zoomLabel}</button>
        <TbIcon label="Zoom in" onClick={zoomIn} disabled={!canZoomIn}><PathPlus /></TbIcon>
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
      <div ref={wrapRef} onScroll={onScroll} style={{ flex: 1, minHeight: flush ? 0 : undefined, overflow: 'auto', background: C.card2 }}>
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
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: PAGE_GAP, padding: COL_PAD, minHeight: '100%',
            // prompt44 item 7 — the column is at LEAST the container width (so narrow pages
            // sit centred) but grows to fit a zoomed-in page (`fit-content`) and centres via
            // auto margins. Without this, a page wider than the container overflowed to the
            // LEFT under `align-items:center` and the left edge became unreachable — that was
            // the "cramped to the left" symptom on zoom-in.
            width: 'fit-content', minWidth: '100%', margin: '0 auto', boxSizing: 'border-box',
          }}>
            {pages.map((p) => {
              const box = boxFor(p);
              return (
                <div
                  key={p}
                  data-page={p}
                  style={{ position: 'relative', width: box.w, height: box.h, background: '#fff', borderRadius: 4, boxShadow: `0 1px 8px ${C.shadow}`, flexShrink: 0 }}
                >
                  {(p >= renderRange.lo && p <= renderRange.hi) ? (
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
                      interaction={interaction}
                      overlay={pageOverlay ? pageOverlay(p) : null}
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
function PdfPageView({ doc, pageNumber, scale, rotation, dpr, term, searchOptions, currentLocal, onDims, interaction = null, overlay = null }) {
  const canvasRef = useRef(null);
  const textRef   = useRef(null);
  const renderRef = useRef(null);
  const lastScrolledRef = useRef(null);          // last currentLocal we scrolled to (avoid per-keystroke jitter)
  const [textReady, setTextReady] = useState(0); // bumps after each text-layer (re)build
  const [drag, setDrag] = useState(null);        // region rubber-band {x0,y0,x1,y1} in CSS px
  const [pageDims, setPageDims] = useState(null); // {w,h} intrinsic (scale 1), for coord mapping

  const iMode = interaction && interaction.mode;
  const clickable = iMode === 'click';
  const regionMode = iMode === 'region';

  // Render the canvas + build the text layer at the current scale/rotation.
  useEffect(() => {
    if (!doc) return undefined;
    let cancelled = false;
    (async () => {
      let page;
      try { page = await doc.getPage(pageNumber); } catch { return; }
      if (cancelled) return;
      // Report intrinsic (unrotated) dims so the parent sizes the wrapper precisely.
      try {
        const v0 = page.getViewport({ scale: 1, rotation: 0 });
        onDims && onDims(pageNumber, { w: v0.width, h: v0.height });
        setPageDims({ w: v0.width, h: v0.height });
      } catch { /* noop */ }

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
      // prompt45 — detect a previously-highlighted span by its <mark> child ELEMENTS, not
      // by comparing textContent to orig: a highlighted span's textContent ALREADY equals
      // orig (tags stripped), so the old check never cleared stale marks when the query
      // changed to one with no match here — leaving highlights from the previous search.
      if (!term) { if (span.firstElementChild) span.textContent = orig; return; }
      const found = findMatchesInText(orig, term, searchOptions);
      if (!found.length) { if (span.firstElementChild) span.textContent = orig; return; }
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

  // Map a page-local CSS-px point to PDF USER SPACE at scale 1 (x right, y UP from
  // the page bottom). rotation is not applied to region coords (region tools run in
  // fit/no-rotation mode); guarded by pageDims presence.
  const cssToUser = useCallback((cx, cy) => {
    const H = pageDims ? pageDims.h : 0;
    return { x: cx / scale, y: H - cy / scale };
  }, [pageDims, scale]);

  function localPoint(e) {
    const host = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - host.left, y: e.clientY - host.top };
  }

  function onTextClickCapture(e) {
    if (!clickable || !interaction.onTextClick) return;
    // Only react to a click that lands on a text span (has text), not empty gaps.
    const span = e.target.closest && e.target.closest('span');
    const str = span ? (span.dataset.t != null ? span.dataset.t : span.textContent) : '';
    if (!str || !str.trim()) return;
    e.preventDefault(); e.stopPropagation();
    interaction.onTextClick({ page: pageNumber, str: String(str).trim() });
  }

  function onRegionDown(e) {
    if (!regionMode) return;
    e.preventDefault();
    const p = localPoint(e);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }
  function onRegionMove(e) {
    if (!regionMode || !drag) return;
    const p = localPoint(e);
    setDrag((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
  }
  function onRegionUp(e) {
    if (!regionMode || !drag) return;
    const p = localPoint(e);
    const cx0 = Math.min(drag.x0, p.x), cx1 = Math.max(drag.x0, p.x);
    const cy0 = Math.min(drag.y0, p.y), cy1 = Math.max(drag.y0, p.y);
    setDrag(null);
    if (Math.abs(cx1 - cx0) < 6 || Math.abs(cy1 - cy0) < 6) return; // ignore tiny drags
    // PDF user space (y up): top CSS edge → larger user-y.
    const uTL = cssToUser(cx0, cy0), uBR = cssToUser(cx1, cy1);
    const region = { x0: Math.min(uTL.x, uBR.x), y0: Math.min(uTL.y, uBR.y), x1: Math.max(uTL.x, uBR.x), y1: Math.max(uTL.y, uBR.y) };
    if (interaction.onRegion) {
      interaction.onRegion({
        page: pageNumber, region,
        cssRect: { x0: cx0, y0: cy0, x1: cx1, y1: cy1 },
        scale, pageW: pageDims ? pageDims.w : null, pageH: pageDims ? pageDims.h : null,
      });
    }
  }

  const rubber = drag ? {
    left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0),
  } : null;

  return (
    <>
      {/* Canvas size is set in px by the render effect (= the CSS-px viewport), so it
          aligns exactly with the text layer (which setLayerDimensions sizes the same way). */}
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, display: 'block' }} />
      <div
        ref={textRef}
        className="mlpdf-tl"
        aria-hidden={!clickable}
        onClickCapture={clickable ? onTextClickCapture : undefined}
        style={clickable ? { pointerEvents: 'auto', cursor: 'copy' } : undefined}
      />
      {overlay ? <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}>{overlay}</div> : null}
      {regionMode && (
        <div
          onMouseDown={onRegionDown} onMouseMove={onRegionMove} onMouseUp={onRegionUp}
          onMouseLeave={() => drag && setDrag(null)}
          style={{ position: 'absolute', inset: 0, zIndex: 4, cursor: 'crosshair', pointerEvents: 'auto' }}
        >
          {rubber && (
            <div style={{ position: 'absolute', left: rubber.left, top: rubber.top, width: rubber.width, height: rubber.height,
              border: '2px dashed #6d28d9', background: 'rgba(109,40,217,0.14)', pointerEvents: 'none' }} />
          )}
        </div>
      )}
    </>
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
const PathChevronUp = () => (<svg {...sv}><path d="m5 15 7-7 7 7" /></svg>);
const PathChevronDown = () => (<svg {...sv}><path d="m5 9 7 7 7-7" /></svg>);
const PathClose = () => (<svg {...sv}><path d="M6 6l12 12M18 6 6 18" /></svg>);
const PathRotateLeft = () => (<svg {...sv}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>);
const PathRotateRight = () => (<svg {...sv}><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>);
// "Aa" = match case, "ab|" = whole words — compact text glyphs rendered as SVG text.
const TextAa = () => (<svg {...sv} viewBox="0 0 24 24"><text x="12" y="16" textAnchor="middle" fontSize="12" fontFamily="sans-serif" fill="currentColor" stroke="none" fontWeight="700">Aa</text></svg>);
const TextWord = () => (<svg {...sv} viewBox="0 0 24 24"><text x="10" y="16" textAnchor="middle" fontSize="11" fontFamily="sans-serif" fill="currentColor" stroke="none" fontWeight="700">ab</text><path d="M20 6v12" /></svg>);
