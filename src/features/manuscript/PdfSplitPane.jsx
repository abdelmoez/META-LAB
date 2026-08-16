/**
 * features/manuscript/PdfSplitPane.jsx — 119.md §4.
 *
 * The Editor + included-article PDF split workspace: the accessible separator, the
 * article/report selector, and the PDF pane itself. The EDITOR half is not in this
 * file — the workspace keeps the existing panel host exactly where it already was and
 * only changes the box around it, because §4's reliability list ("must not reload the
 * manuscript, reset the cursor, discard unsaved changes, break autosave") is really
 * one rule: opening, closing or resizing the split must never remount the editor.
 *
 * WHAT IS REUSED, NOT REBUILT (§4 "Reuse the same article/document identity and
 * shared PDF infrastructure already used by Screening, Extraction, and Risk of Bias"):
 *   · the screening <PdfViewer> wrapper for screening-linked reports — the SAME file,
 *     the same annotations, addressed by (screening project, record) exactly as the
 *     Title&Abstract, Conflicts and RoB surfaces address it (the RobPdfPanel shape);
 *   · <AppPdfViewer> for study documents, with pinPdfBytesVersion so a collaborator's
 *     replace can never be served from the session byte cache (116.md §74/§95);
 *   · referencePdfLinks / m.resolveReferencePdfs for "is there a PDF", and
 *     studyDocApi.list for the multi-report axis.
 * No new endpoint, no new attachment model, no second copy of any binary.
 *
 * Styling: LEGACY tokens only (C/btnS/tagS + var(--t-*)) — this renders in both shells.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C, btnS, tagS } from '../../frontend/workspace/ui/styles.js';
import { Icon } from '../../frontend/components/icons.jsx';
import { alpha } from '../../frontend/theme/tokens.js';
// 117.md §44 — an overlay that consumes Escape must CLAIM the fullscreen exit Escape
// also causes, or dismissing the article list would drop the whole maximized layout.
import { markOverlayEscape } from '../../frontend/focus/overlayEscapeLatch.js';
import { pinPdfBytesVersion } from '../../frontend/components/pdfBytesCache.js';
import { studyDocApi } from '../extraction/unified/studyDocApi.js';
import {
  SPLIT_MIN, SPLIT_MAX, SPLIT_DEFAULT, SPLIT_PRESETS, SPLIT_DIVIDER_PX, SPLIT_STEP,
  clampSplitRatio, activeSplitPreset, splitLayoutFor,
  readStoredRatio, writeStoredRatio,
  articleSubtitle, filterSplitArticles, articlePdfAvailability, AVAILABILITY_LABEL,
  buildArticleReports, pickReport,
} from './manuscriptSplit.js';

/* pdf.js and the annotation layer stay OUT of the manuscript chunk until a
   researcher actually opens a PDF — the ReferencePdfDialog precedent, kept. */
const ScreeningPdfViewer = lazy(() => import('../../frontend/screening/components/PdfViewer.jsx'));
const AppPdfViewer = lazy(() => import('../../frontend/components/AppPdfViewer.jsx'));

/**
 * §4 — "Preserve independently for each PDF … page, zoom, rotation, search state,
 * scroll position". AppPdfViewer keeps all of that in component state with no seed
 * props and no change callback, and this wave does not widen that seam, so the state
 * is preserved the only other way there is: the recently-viewed reports stay MOUNTED
 * (hidden, not unmounted) and switching back reveals the viewer exactly as it was.
 * Bounded, because each mounted viewer holds rendered canvases: three is two switches
 * of history, which is what "compare this paper with the one before it" needs.
 */
export const SPLIT_KEEPALIVE = 3;

const paneCard = {
  border: `1px solid ${C.brd}`, borderRadius: 12, background: C.card,
  display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden',
};

/**
 * §4 responsive floor — the layout switch is driven by the SPLIT ROW's own width, not
 * the viewport: the rails, the focus drawer and the browser window all change the row's
 * real width without changing the viewport, exactly as they do for the toolbar's
 * density (118.md §41). Returns 'split' | 'stacked'.
 */
export function useSplitLayout(rowRef, active) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = rowRef.current;
    if (!active || !el) return undefined;
    const set = () => setWidth(Math.max(0, Math.round(el.clientWidth || 0)));
    set();
    if (typeof ResizeObserver === 'undefined') {
      if (typeof window === 'undefined') return undefined;
      window.addEventListener('resize', set);
      return () => window.removeEventListener('resize', set);
    }
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(0, Math.round(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [rowRef, active]);
  return splitLayoutFor(active ? width : 0);
}

/* ── the resizable split ────────────────────────────────────────────────────── */

/**
 * The draggable ratio, ported from the proven RoB/Extraction hook: the drag writes a
 * CSS CUSTOM PROPERTY through rAF, so moving the divider never re-renders React (and
 * therefore never touches the editor subtree or the mounted viewers), and only the
 * pointer-up commits + persists. `cssVar` is set on `rowRef`.
 */
export function useManuscriptSplit(rowRef, prefKey, cssVar = '--ms-editor-pct') {
  const [ratio, setRatio] = useState(() => readStoredRatio(prefKey) || SPLIT_DEFAULT);
  const [dragging, setDragging] = useState(false);
  const rafRef = useRef(0);
  const teardownRef = useRef(null);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;

  const applyVar = useCallback((v) => {
    const el = rowRef.current;
    if (el && el.style) el.style.setProperty(cssVar, `${(v * 100).toFixed(3)}%`);
  }, [rowRef, cssVar]);
  useEffect(() => { applyVar(ratio); }, [ratio, applyVar]);

  /* The signed-in user arrives asynchronously, exactly like the view preference: the
     initializer above can run before there is a key. Hydrate once, never over a ratio
     this session already chose (the ManuscriptWorkspace hydration precedent). */
  const touched = useRef(false);
  const hydrated = useRef(null);
  useEffect(() => {
    if (!prefKey || touched.current || hydrated.current === prefKey) return;
    hydrated.current = prefKey;
    const stored = readStoredRatio(prefKey);
    if (stored) setRatio(stored);
  }, [prefKey]);

  const commit = useCallback((v) => {
    touched.current = true;
    setRatio(v);
    writeStoredRatio(prefKey, v);
  }, [prefKey]);

  const onPointerDown = useCallback((e) => {
    const el = rowRef.current;
    if (!el) return;
    e.preventDefault();
    try { if (e.currentTarget && e.currentTarget.focus) e.currentTarget.focus(); } catch { /* ignore */ }
    const rect = el.getBoundingClientRect();
    let last = ratioRef.current;
    setDragging(true);
    const move = (ev) => {
      last = clampSplitRatio((ev.clientX - rect.left - SPLIT_DIVIDER_PX / 2) / Math.max(1, rect.width));
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => applyVar(last));
    };
    const end = () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      teardownRef.current = null;
      setDragging(false);
      commit(last);
    };
    teardownRef.current = () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, [applyVar, commit, rowRef]);

  useEffect(() => () => { if (teardownRef.current) teardownRef.current(); }, []);

  const reset = useCallback(() => commit(SPLIT_DEFAULT), [commit]);
  const nudge = useCallback((delta) => commit(clampSplitRatio(ratioRef.current + delta)), [commit]);
  const setPreset = useCallback((v) => commit(clampSplitRatio(v)), [commit]);
  return { ratio, dragging, onPointerDown, reset, nudge, setPreset, min: SPLIT_MIN, max: SPLIT_MAX };
}

/**
 * §4 — "Support keyboard resizing and an accessible separator". Copied in behaviour
 * from the RoB divider (role=separator + aria-value* + ←/→/Home), which is the pattern
 * this app has already shipped and tested; the labels name THIS pair of panes.
 */
export function SplitResizeDivider({ split, reduced }) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = hover || focused || split.dragging;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      data-testid="stitch-manuscript-split-divider"
      aria-label="Resize the manuscript and PDF panes"
      aria-valuemin={Math.round(SPLIT_MIN * 100)}
      aria-valuemax={Math.round(SPLIT_MAX * 100)}
      aria-valuenow={Math.round(split.ratio * 100)}
      aria-valuetext={`Manuscript ${Math.round(split.ratio * 100)}%, PDF ${100 - Math.round(split.ratio * 100)}%`}
      onPointerDown={split.onPointerDown}
      onDoubleClick={split.reset}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === 'ArrowLeft') { split.nudge(-SPLIT_STEP); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { split.nudge(SPLIT_STEP); e.preventDefault(); }
        else if (e.key === 'Home') { split.reset(); e.preventDefault(); }
      }}
      title="Drag to resize panes · double-click for 50/50 · ←/→ to nudge"
      style={{
        alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'col-resize', touchAction: 'none', outline: 'none',
      }}
    >
      <span style={{
        width: active ? 5 : 3, height: active ? 64 : 44, borderRadius: 5,
        background: split.dragging ? C.acc : active ? alpha(C.acc, '80') : C.brd2,
        boxShadow: (split.dragging || focused) ? `0 0 0 3px ${alpha(C.acc, '22')}` : 'none',
        transition: reduced ? 'none' : 'all 0.15s ease',
      }} />
    </div>
  );
}

/* ── the toolbar toggle (118.md §41 slot) ───────────────────────────────────── */

/** §4 — "a clear toggle in the Manuscript Editor". One control, two states. */
export function ManuscriptSplitToggle({ open, onToggle, condensed = false }) {
  return (
    <button
      type="button"
      data-testid="stitch-manuscript-split-toggle"
      aria-pressed={open ? 'true' : 'false'}
      title={open ? 'Close the PDF pane and restore the workspace' : 'Open an included article beside the manuscript'}
      onClick={onToggle}
      className="ms-tb-action"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', flexShrink: 0,
        background: open ? alpha(C.acc, '14') : 'transparent',
        border: `1px solid ${open ? alpha(C.acc, '38') : C.brd}`,
        color: open ? C.acc : C.txt2,
        borderRadius: 8, padding: '0 10px', height: 28,
        fontSize: 11.5, fontWeight: 600, fontFamily: "'IBM Plex Sans',sans-serif",
        cursor: 'pointer', letterSpacing: 0.1,
      }}
    >
      <Icon name="fileText" size={12} />{condensed ? 'PDF' : 'PDF view'}
    </button>
  );
}

/* ── the article selector ───────────────────────────────────────────────────── */

function AvailabilityChip({ state }) {
  const tone = state === 'available' ? 'green' : state === 'none' ? 'grey' : 'blue';
  return (
    <span style={{ ...tagS(tone), fontSize: 9.5, padding: '0 6px' }} data-availability={state}>
      {AVAILABILITY_LABEL[state] || AVAILABILITY_LABEL.unknown}
    </span>
  );
}

/**
 * §4 — the selector over INCLUDED articles. A popover with one search field and one
 * list: the search covers title / author / year / DOI / PMID / study label, each row
 * states its PDF availability honestly, and the empty states say what is actually
 * true rather than "no results".
 */
export function ArticleSelector({
  articles, activeId, onPick, resolved, screenProjectId, onOpenRecord, condensed,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      markOverlayEscape();
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  useEffect(() => {
    if (open && inputRef.current && inputRef.current.focus) inputRef.current.focus();
    if (!open) setQ('');
  }, [open]);

  const rows = useMemo(() => filterSplitArticles(articles, q), [articles, q]);
  const active = useMemo(() => (articles || []).find((a) => a.id === activeId) || null, [articles, activeId]);

  return (
    <span style={{ position: 'relative', display: 'inline-flex', minWidth: 0, flex: '1 1 auto' }}>
      <button
        type="button"
        data-testid="stitch-manuscript-split-article"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={active ? `${active.title}${articleSubtitle(active) ? ` — ${articleSubtitle(active)}` : ''}` : 'Choose an included article'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0, maxWidth: '100%',
          height: 28, padding: '0 9px', borderRadius: 8,
          background: C.card2, border: `1px solid ${open ? alpha(C.acc, '55') : C.brd}`,
          color: C.txt, fontFamily: "'IBM Plex Sans',sans-serif", fontSize: 11.5, fontWeight: 600,
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <Icon name="bookOpen" size={12} style={{ flexShrink: 0, color: C.muted }} />
        <span
          data-testid="stitch-manuscript-split-identity"
          style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {active ? active.title : 'Choose an included article'}
        </span>
        {!condensed && active && articleSubtitle(active) && (
          <span style={{ color: C.muted, fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {articleSubtitle(active)}
          </span>
        )}
        <Icon name="chevronDown" size={11} style={{ flexShrink: 0, color: C.muted }} />
      </button>

      {open && (
        <>
          <div
            data-testid="stitch-manuscript-split-article-catcher"
            onClick={close}
            style={{ position: 'fixed', inset: 0, zIndex: 5, background: 'transparent' }}
          />
          <div
            role="dialog"
            aria-label="Included articles"
            data-testid="stitch-manuscript-split-article-menu"
            style={{
              position: 'absolute', zIndex: 6, top: 'calc(100% + 6px)', left: 0,
              width: 'min(460px, 88vw)', maxHeight: 400, overflow: 'auto',
              background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10,
              boxShadow: '0 10px 30px var(--t-shadow)', padding: 10,
            }}
          >
            <input
              ref={inputRef}
              type="search"
              data-testid="stitch-manuscript-split-article-search"
              aria-label="Search included articles by title, author, year, DOI, PMID or study label"
              placeholder="Search title, author, year, DOI, PMID or label…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box', height: 30, padding: '0 9px', marginBottom: 8,
                background: C.card2, border: `1px solid ${C.brd}`, borderRadius: 8,
                color: C.txt, fontFamily: "'IBM Plex Sans',sans-serif", fontSize: 11.5,
              }}
            />
            {!articles.length && (
              <p data-testid="stitch-manuscript-split-article-empty"
                style={{ margin: '8px 4px', fontSize: 11.5, lineHeight: 1.6, color: C.txt2 }}>
                No included studies yet. Articles appear here once studies are included in
                this review — the PDFs stay the ones Screening and Extraction already hold.
              </p>
            )}
            {!!articles.length && !rows.length && (
              <p data-testid="stitch-manuscript-split-article-empty"
                style={{ margin: '8px 4px', fontSize: 11.5, lineHeight: 1.6, color: C.txt2 }}>
                No included article matches “{q}”.
              </p>
            )}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {rows.map((a) => {
                const state = articlePdfAvailability(a, resolved, screenProjectId);
                const isActive = a.id === activeId;
                return (
                  <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      data-testid={`stitch-manuscript-split-article-option-${a.id}`}
                      data-active={isActive ? 'true' : undefined}
                      onClick={() => { close(); onPick(a); }}
                      style={{
                        flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer',
                        background: isActive ? alpha(C.acc, '10') : 'transparent',
                        border: `1px solid ${isActive ? alpha(C.acc, '38') : 'transparent'}`,
                        borderRadius: 8, padding: '6px 8px',
                        fontFamily: "'IBM Plex Sans',sans-serif",
                      }}
                    >
                      <span style={{
                        display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700,
                        color: isActive ? C.acc : C.txt,
                      }}>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
                        <AvailabilityChip state={state} />
                      </span>
                      <span style={{ display: 'block', fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                        {[articleSubtitle(a), a.label && `Label: ${a.label}`, a.doi && `DOI ${a.doi}`, a.pmid && `PMID ${a.pmid}`]
                          .filter(Boolean).join(' · ')}
                      </span>
                    </button>
                    {onOpenRecord && (
                      <button
                        type="button"
                        data-testid={`stitch-manuscript-split-article-record-${a.id}`}
                        title="Open this article's record in the References library"
                        aria-label={`Open the record for ${a.title}`}
                        onClick={() => { close(); onOpenRecord(a); }}
                        style={{ ...btnS('ghost'), fontSize: 10.5, padding: '4px 8px', flexShrink: 0 }}
                      >Record</button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </span>
  );
}

/* ── one mounted report ─────────────────────────────────────────────────────── */

function ReportViewer({ entry, projectId }) {
  const { article, report } = entry;
  const url = useMemo(() => {
    if (!report || report.kind === 'screening' || !projectId || !article.studyId) return '';
    if (report.kind === 'study') return studyDocApi.downloadUrl(projectId, article.studyId);
    return studyDocApi.extraDownloadUrl(projectId, article.studyId, report.docId);
  }, [report, projectId, article.studyId]);

  /* 116.md §74/§95 — a study-document URL is STABLE across a replace, so the session
     byte cache would happily serve a superseded file. Pinned in the RENDER phase (an
     effect here would run AFTER the child viewer had already asked the cache). */
  useMemo(() => { if (url) pinPdfBytesVersion(url, report && report.fileHash); }, [url, report]);

  const fallback = (
    <div style={{ padding: 14, fontSize: 11.5, color: C.muted }}>Opening the PDF…</div>
  );
  if (report && report.kind === 'screening') {
    return (
      <Suspense fallback={fallback}>
        {/* Read-only on purpose (the ReferencePdfDialog doctrine): attaching and
            replacing belong to the surfaces that own the record. Annotations made in
            Screening/RoB come along, because this IS that viewer. */}
        <ScreeningPdfViewer pid={report.screenProjectId} recordId={report.recordId}
          canManage={false} defaultOpen flush />
      </Suspense>
    );
  }
  if (!url) return null;
  return (
    <Suspense fallback={fallback}>
      <AppPdfViewer url={url} flush />
    </Suspense>
  );
}

/* ── the PDF pane ───────────────────────────────────────────────────────────── */

/**
 * The right-hand pane: the compact workspace toolbar §4 asks for (exit · article
 * selector · current-article identity · report selector · width presets) over the
 * shared viewer. The PDF's OWN controls (page, zoom, rotation, search) are the
 * viewer's toolbar — this pane does not build a second set.
 */
export function PdfSplitPane({
  projectId, articles, activeArticle, activeReportId, onPickArticle, onPickReport,
  resolved, screenProjectId, onOpenRecord, onExit, split, layout, condensed = false, height,
  hidden = false,
}) {
  /* The multi-report axis (§4 "Multiple reports associated with one study") is
     resolved LAZILY for the SELECTED article only: listing documents for every
     included study on open would be a request per study for information nobody has
     asked for yet. Soft-fails to "just the screening attachment". */
  const [docs, setDocs] = useState(null);
  const studyId = activeArticle && activeArticle.studyId;
  useEffect(() => {
    setDocs(null);
    if (!projectId || !studyId) return undefined;
    let alive = true;
    studyDocApi.list(projectId, studyId)
      .then((d) => { if (alive) setDocs(d || null); })
      .catch(() => { if (alive) setDocs(null); });
    return () => { alive = false; };
  }, [projectId, studyId]);

  const attachmentId = useMemo(() => {
    if (!activeArticle || !activeArticle.screeningRecordId) return '';
    const pid = activeArticle.screeningProjectId || screenProjectId || '';
    const map = resolved || {};
    return String(map[`${pid}::${activeArticle.screeningRecordId}`] || '');
  }, [activeArticle, resolved, screenProjectId]);

  const reports = useMemo(
    () => buildArticleReports(
      activeArticle && { ...activeArticle, screeningProjectId: activeArticle.screeningProjectId || screenProjectId },
      attachmentId, docs,
    ),
    [activeArticle, attachmentId, docs, screenProjectId],
  );
  const report = useMemo(() => pickReport(reports, activeReportId), [reports, activeReportId]);

  /* The keep-alive pool (see SPLIT_KEEPALIVE): the viewer for a report that was open
     stays MOUNTED and hidden, so coming back to it restores page/zoom/rotation/search/
     scroll exactly. Hidden with `visibility` rather than `display`, so the hidden
     viewer keeps a real box and its own ResizeObserver never sees a 0-width layout. */
  const [pool, setPool] = useState([]);
  const entryKey = activeArticle && report ? `${activeArticle.id}::${report.id}` : '';
  useEffect(() => {
    if (!entryKey || !activeArticle || !report) return;
    setPool((prev) => {
      const kept = prev.filter((e) => e.key !== entryKey);
      const existing = prev.find((e) => e.key === entryKey);
      const next = [existing || { key: entryKey, article: activeArticle, report }, ...kept];
      return next.slice(0, SPLIT_KEEPALIVE);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryKey]);

  const presetActive = activeSplitPreset(split.ratio);

  return (
    <section
      data-testid="stitch-manuscript-split-pdf"
      aria-label="Included article PDF"
      style={{
        ...paneCard,
        // The stacked layout HIDES this pane rather than unmounting it, so the open
        // document (and the viewer's own page/zoom/search) survives a pane switch.
        display: hidden ? 'none' : 'flex',
        position: layout === 'split' ? 'sticky' : 'static',
        top: layout === 'split' ? 8 : undefined,
        alignSelf: 'start',
        height: height || 'calc(100vh - 150px)',
        minHeight: 380,
      }}
    >
      {/* §4 — the compact, dedicated workspace toolbar. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '7px 8px', minWidth: 0,
        borderBottom: `1px solid ${C.brd}`, background: C.card2, flexWrap: 'wrap',
      }}>
        <ArticleSelector articles={articles} activeId={activeArticle ? activeArticle.id : ''}
          onPick={onPickArticle} resolved={resolved} screenProjectId={screenProjectId}
          onOpenRecord={onOpenRecord} condensed={condensed} />

        {reports.length > 1 && (
          <select
            data-testid="stitch-manuscript-split-report"
            aria-label="Report"
            value={report ? report.id : ''}
            onChange={(e) => onPickReport(e.target.value)}
            style={{
              height: 28, maxWidth: 190, background: C.card2, border: `1px solid ${C.brd}`,
              borderRadius: 8, color: C.txt, fontSize: 11, fontFamily: "'IBM Plex Sans',sans-serif",
              padding: '0 6px', flexShrink: 0,
            }}
          >
            {reports.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        )}

        <span style={{ flex: '0 0 auto', marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {/* §4 — quick widths + "Restore the layout if needed", beside free resizing. */}
          {layout === 'split' && SPLIT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              data-testid={`stitch-manuscript-split-preset-${p.id}`}
              aria-pressed={presetActive === p.id ? 'true' : 'false'}
              title={p.title}
              onClick={() => split.setPreset(p.ratio)}
              style={{
                height: 24, padding: '0 8px', borderRadius: 6, cursor: 'pointer',
                background: presetActive === p.id ? alpha(C.acc, '14') : 'transparent',
                border: `1px solid ${presetActive === p.id ? alpha(C.acc, '38') : C.brd}`,
                color: presetActive === p.id ? C.acc : C.txt2,
                fontSize: 10.5, fontWeight: 600, fontFamily: "'IBM Plex Sans',sans-serif",
                whiteSpace: 'nowrap',
              }}
            >{p.label}</button>
          ))}
          <button
            type="button"
            data-testid="stitch-manuscript-split-exit"
            onClick={onExit}
            title="Close the PDF pane and restore the workspace"
            style={{ ...btnS('ghost'), fontSize: 10.5, padding: '4px 9px' }}
          >Exit PDF view</button>
        </span>
      </div>

      {/* The viewer host. `position: relative` is the containing block the hidden
          keep-alive viewers are stacked in — they keep their real size, which is why
          returning to one does not re-fit it. */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
        {!articles.length && (
          <div data-testid="stitch-manuscript-split-empty" style={emptyBox}>
            <div style={{ fontWeight: 700, color: C.txt, marginBottom: 4 }}>No included studies yet</div>
            <p style={{ margin: 0 }}>
              Once studies are included in this review they appear here, and their PDFs
              open from the files Screening and Extraction already hold.
            </p>
          </div>
        )}
        {!!articles.length && !report && (
          <div data-testid="stitch-manuscript-split-empty" style={emptyBox}>
            <div style={{ fontWeight: 700, color: C.txt, marginBottom: 4 }}>
              {activeArticle ? 'No PDF attached to this article yet' : 'Choose an included article'}
            </div>
            <p style={{ margin: 0 }}>
              {activeArticle
                ? 'Attach the full text from the Screening workspace (or add a study document in Extraction) and it will open here — this workspace never uploads a second copy.'
                : 'Search the included studies above to open one beside the manuscript.'}
            </p>
          </div>
        )}
        {pool.map((e) => {
          const visible = e.key === entryKey;
          return (
            <div
              key={e.key}
              data-testid={visible ? 'stitch-manuscript-split-viewer' : undefined}
              aria-hidden={visible ? undefined : 'true'}
              style={visible ? {
                position: 'absolute', inset: 0, display: 'flex', minHeight: 0,
              } : {
                position: 'absolute', inset: 0, display: 'flex', minHeight: 0,
                visibility: 'hidden', pointerEvents: 'none',
              }}
            >
              <ReportViewer entry={e} projectId={projectId} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

const emptyBox = {
  padding: '22px 18px', textAlign: 'center', color: C.txt2, fontSize: 12, lineHeight: 1.6,
  margin: 'auto', maxWidth: 420,
};

export default PdfSplitPane;
