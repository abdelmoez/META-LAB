/**
 * PecanSearchTab.jsx — the "Search & Discovery" workspace (P1). A first-class,
 * accessible research surface over the Pecan Search Engine backend
 * (server/pecanSearch). It does NOT re-implement search; it drives the contract
 * API (pecanSearchApi.js) and renders the seven product areas of the mandate:
 *
 *   1. Search Strategy  — canonical query (from the Search Builder), source
 *                         selection, per-source translated query + warnings,
 *                         optional override, date/result caps, debounced count
 *                         preview per source.
 *   2. Source cards     — one card per configured provider (availability, creds
 *                         state, translation status, preview, cap, inclusion).
 *   3. Run review       — a pre-flight summary + Start (Idempotency-Key per try).
 *   4. Live progress    — authoritative polling + the realtime poke channel, an
 *                         honest INDETERMINATE state, Cancel + Retry.
 *   5. Completion        — every number from run.counts + links + report export.
 *   6. Search history   — paginated past runs + detail + safe retry + export.
 *   7. Duplicate review  — explainable, side-by-side ambiguous-pair resolution.
 *
 * Reconstruction-first: the active run is always rebuilt from the server; the
 * realtime event is only a hint to refetch (never trusted as data). Read-only
 * callers can browse + preview but cannot start/cancel/retry/resolve.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { C, btnS, inp, lbl } from '../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../frontend/theme/tokens.js';
import { Icon } from '../../frontend/components/icons.jsx';
import { useRealtime } from '../../frontend/hooks/useRealtime.js';
import {
  pecanSearchApi, loadCanonicalQuery, newIdempotencyKey, selectSourceIds,
} from './pecanSearchApi.js';
import {
  Card, StatTile, StatusPill, Disclosure, Note, Skeleton,
  EmptyState, Btn, CountValue, CredsBadge, Toggle, formatWhen,
} from './components/parts.jsx';
import DuplicateReview from './components/DuplicateReview.jsx';
import SearchImportProgressModal from './components/SearchImportProgressModal.jsx';
import { nextProgressPercent } from '../../research-engine/search/runProgress.js';

const PREVIEW_DEBOUNCE_MS = 700;
const ACTIVE_POLL_MS = 2500;
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'partial']);

/* Count concepts/terms in a canonical query for the read-only summary. */
function summarizeQuery(canonical) {
  if (!canonical || !Array.isArray(canonical.concepts)) return { concepts: 0, terms: 0 };
  const concepts = canonical.concepts.length;
  const terms = canonical.concepts.reduce((n, c) => n + (Array.isArray(c.terms) ? c.terms.length : 0), 0);
  return { concepts, terms };
}

/* Terms whose text contains a STANDALONE uppercase Boolean operator (AND/OR/NOT).
   Such terms are searched literally as a phrase (≈ 0 hits), so we flag them. Mirrors
   the server-side ast.findLiteralBooleanTerms; uppercase-only keeps it high-precision
   (a real phrase like "signs and symptoms" uses lowercase and is not flagged). */
function literalBooleanTerms(canonical) {
  if (!canonical || !Array.isArray(canonical.concepts)) return [];
  const re = /(?:^|\s)(AND|OR|NOT)(?:\s|$)/;
  const out = [];
  for (const c of canonical.concepts) {
    for (const t of (c.terms || [])) {
      const text = (t && t.text) || '';
      const m = re.exec(text);
      if (m && text.trim().split(/\s+/).length > 1) out.push({ text, op: m[1] });
    }
  }
  return out;
}

export default function PecanSearchTab({
  projectId, pico, readOnly,
  // prompt60 — the Search Wizard passes its LIVE in-memory query straight into the run
  // step so there is no separate "load strategy" round-trip. All optional: when absent
  // the tab loads the saved strategy (loadCanonicalQuery) and seeds sources from it,
  // preserving the standalone behaviour. initialSources/initialOverrides are keyed by
  // pecan PROVIDER id (already intersected by the wizard).
  initialCanonicalQuery, initialSources, initialOverrides,
  // 73.md P1 — embedded mode: the staged Search Workspace supplies its own single
  // header, so this tab suppresses its big header block (all controls/body kept).
  // Default false → standalone/legacy usage is byte-identical.
  embedded = false,
}) {
  // ── Canonical query (the saved Search Builder strategy) ──────────────────────
  const [query, setQuery] = useState(null);        // { concepts, filters, overrides } | null
  const [queryState, setQueryState] = useState('loading'); // loading | ready | empty | error
  const [queryError, setQueryError] = useState('');

  // ── Providers ────────────────────────────────────────────────────────────────
  const [providers, setProviders] = useState(null);  // array | null
  const [engineCfg, setEngineCfg] = useState(null);
  const [providersError, setProvidersError] = useState('');

  // ── Per-source selection / overrides / caps ──────────────────────────────────
  const [selected, setSelected] = useState({});      // { [id]: true }
  const [overrides, setOverrides] = useState({});    // { [id]: string }
  const [caps, setCaps] = useState({});              // { [id]: number }
  const [showOverride, setShowOverride] = useState({}); // { [id]: true }

  // ── Translation + preview (debounced) ────────────────────────────────────────
  const [translations, setTranslations] = useState({}); // { [id]: {...} }
  const [counts, setCounts] = useState({});             // { [id]: {count,kind,at} }
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // ── Run lifecycle ─────────────────────────────────────────────────────────────
  const [runName, setRunName] = useState('');
  const [activeRun, setActiveRun] = useState(null);   // the run summary we are tracking
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  // ── 87.md — the "Adding articles to Screening" progress modal ─────────────────
  // Opens the instant the user clicks Start (before the 202 lands) so the page never
  // looks frozen; the run is then driven by the existing poll + realtime. `displayPct`
  // is the MONOTONIC (never-backward) percent held across polls via nextProgressPercent.
  const [progressOpen, setProgressOpen] = useState(false);
  const [displayPct, setDisplayPct] = useState(0);
  const pctRef = useRef(0);

  // ── Duplicates (for the active/selected run) ─────────────────────────────────
  const [dupes, setDupes] = useState(null);
  const [dupesState, setDupesState] = useState('idle'); // idle|loading|ready|error
  const [dupesError, setDupesError] = useState('');
  const [resolving, setResolving] = useState(false);

  // ── History ───────────────────────────────────────────────────────────────────
  const [history, setHistory] = useState(null);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyState, setHistoryState] = useState('loading');
  const HISTORY_TAKE = 10;

  // ── Report (for the completion summary) ──────────────────────────────────────
  const [report, setReport] = useState(null);

  const debounceRef = useRef(null);
  const previewAbort = useRef(null);
  const pollRef = useRef(null);
  const canRun = !readOnly;

  /* ── load canonical query + providers + first history page on mount ───────── */
  useEffect(() => {
    let dead = false;
    (async () => {
      // 1. Canonical query — prefer a LIVE in-memory query handed in by the Search
      //    Wizard (prompt60); otherwise load the saved strategy from the Search Builder.
      let q = null;
      if (initialCanonicalQuery && Array.isArray(initialCanonicalQuery.concepts)) {
        q = {
          concepts: initialCanonicalQuery.concepts,
          filters: initialCanonicalQuery.filters || { dateFrom: '', dateTo: '', languages: [], pubTypes: [] },
          overrides: (initialOverrides && typeof initialOverrides === 'object') ? initialOverrides : {},
          databases: Array.isArray(initialSources) ? initialSources : [],
        };
        if (!dead) { setQuery(q); setQueryState(q.concepts.length ? 'ready' : 'empty'); }
      } else {
        try {
          q = await loadCanonicalQuery(projectId);
          if (dead) return;
          if (!q || !q.concepts || q.concepts.length === 0) { setQuery(q || null); setQueryState('empty'); }
          else { setQuery(q); setQueryState('ready'); }
        } catch (e) {
          if (!dead) { setQueryError(e.message || 'Failed to load strategy'); setQueryState('error'); }
          q = null;
        }
      }
      // 2. Providers + source seeding (prompt60 seam fixes #1/#2).
      try {
        const p = await pecanSearchApi.getProviders();
        if (dead) return;
        const list = (p && p.providers) || [];
        setProviders(list);
        setEngineCfg((p && p.engine) || null);
        const selectableIds = list.filter((pr) => pr.selectable).map((pr) => pr.id);
        // Default caps from provider.
        const cp = {};
        for (const pr of list) cp[pr.id] = pr.defaultCap || (p.engine && p.engine.defaultResultCap) || 2000;
        setCaps(cp);
        // Seed source selection from the user's explicit database choice; with no
        // explicit choice, default to all selectable providers (prompt60 seam fix #1 —
        // see selectSourceIds; preserves multi-database recall).
        const chosen = selectSourceIds({
          initialSources,
          databases: q && q.databases,
          selectableIds,
        });
        const sel = {};
        for (const id of chosen) sel[id] = true;
        setSelected(sel);
        // Seed per-source overrides from the strategy (keyed by provider id; the builder
        // and Pecan share ids for the overlapping providers, e.g. pubmed).
        const ovSrc = (initialOverrides && typeof initialOverrides === 'object') ? initialOverrides
          : ((q && q.overrides) || {});
        const ov = {};
        for (const id of selectableIds) { if (ovSrc[id]) ov[id] = ovSrc[id]; }
        if (Object.keys(ov).length) setOverrides(ov);
      } catch (e) {
        if (!dead) setProvidersError(e.message || 'Failed to load providers');
      }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /* ── load history (page) ──────────────────────────────────────────────────── */
  const loadHistory = useCallback(async (page = historyPage) => {
    setHistoryState('loading');
    try {
      const out = await pecanSearchApi.listRuns(projectId, { skip: page * HISTORY_TAKE, take: HISTORY_TAKE });
      const runs = (out && out.runs) || [];
      setHistory(runs);
      setHistoryTotal((out && out.total) || 0);
      setHistoryState('ready');
      // Reload-reconstruction (§6.4): if a run is still in flight and nothing is
      // currently tracked, re-attach to it so the Live Progress card resumes after
      // a browser refresh. Functional update → never clobbers an active selection.
      if (page === 0) {
        const inflight = runs.find((r) => !TERMINAL.has(r.state));
        if (inflight) setActiveRun((prev) => prev || inflight);
      }
    } catch {
      setHistoryState('error');
    }
  }, [projectId, historyPage]);

  useEffect(() => { loadHistory(historyPage); }, [historyPage, loadHistory]);

  /* ── debounced translate + preview whenever the inputs change ──────────────── */
  const sourceIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);
  const overridesKey = useMemo(() => JSON.stringify(overrides), [overrides]);

  const runPreview = useCallback(async () => {
    if (queryState !== 'ready' || sourceIds.length === 0) { setTranslations({}); setCounts({}); return; }
    // cancel any in-flight preview
    if (previewAbort.current) previewAbort.current.cancelled = true;
    const token = { cancelled: false };
    previewAbort.current = token;
    setPreviewing(true); setPreviewError('');
    const canonicalQuery = { concepts: query.concepts, filters: query.filters };
    const sources = sourceIds.map((id) => ({ provider: id }));
    try {
      const [tr, ct] = await Promise.all([
        pecanSearchApi.translate(projectId, { canonicalQuery, sources, overrides }),
        pecanSearchApi.previewCount(projectId, { canonicalQuery, sources, overrides }),
      ]);
      if (token.cancelled) return;
      setTranslations((tr && tr.translations) || {});
      setCounts((ct && ct.counts) || {});
    } catch (e) {
      if (!token.cancelled) setPreviewError(e.message || 'Preview failed');
    } finally {
      if (!token.cancelled) setPreviewing(false);
    }
  }, [projectId, query, queryState, sourceIds, overrides]);

  useEffect(() => {
    if (queryState !== 'ready') return undefined;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { runPreview(); }, PREVIEW_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // re-run when the selected sources, overrides, or loaded query change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIds.join(','), overridesKey, queryState, query]);

  /* ── refetch the active run from the server (authoritative) ────────────────── */
  const refetchActiveRun = useCallback(async (runId) => {
    const id = runId || (activeRun && activeRun.id);
    if (!id) return;
    try {
      const out = await pecanSearchApi.getRun(projectId, id);
      if (out && out.run) setActiveRun(out.run);
    } catch { /* keep the last good summary; polling/realtime will retry */ }
  }, [projectId, activeRun]);

  /* ── poll the active run while it is non-terminal (server is the truth) ────── */
  useEffect(() => {
    if (!activeRun || TERMINAL.has(activeRun.state)) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return undefined;
    }
    pollRef.current = setInterval(() => { refetchActiveRun(activeRun.id); }, ACTIVE_POLL_MS);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [activeRun, refetchActiveRun]);

  /* ── 87.md — derive the MONOTONIC display percent from every fresh run summary.
       The server's percent can wobble (estimate totals shrink, previewCount arrives
       late); nextProgressPercent clamps to a running max and snaps to 100 on terminal.
       The high-water mark resets whenever the TRACKED run id changes (a new run, a
       history run opened, a retry, or a refresh reconstruction) so one run never
       inherits another's progress. ── */
  const trackedIdRef = useRef(null);
  useEffect(() => {
    if (!activeRun) return;
    if (trackedIdRef.current !== activeRun.id) { trackedIdRef.current = activeRun.id; pctRef.current = 0; }
    const next = nextProgressPercent(pctRef.current, activeRun);
    pctRef.current = next;
    setDisplayPct(next);
  }, [activeRun]);

  const closeProgress = useCallback(() => { setProgressOpen(false); setStartError(''); }, []);

  /* ── when the active run reaches a terminal state, pull report + duplicates ── */
  useEffect(() => {
    if (!activeRun || !TERMINAL.has(activeRun.state)) return;
    let dead = false;
    (async () => {
      try { const r = await pecanSearchApi.getReport(projectId, activeRun.id); if (!dead && r) setReport(r.report); } catch { /* report optional */ }
      loadDupes(activeRun.id);
      loadHistory(historyPage);
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun && activeRun.state, activeRun && activeRun.id]);

  /* ── realtime: a poke for THIS project → refetch the authoritative run ─────── */
  useRealtime({
    'search.run.progress': (ev) => {
      if (ev && ev.metaLabProjectId === projectId) {
        const id = ev.runId || (activeRun && activeRun.id);
        if (id) refetchActiveRun(id);
      }
    },
  });

  /* ── duplicates loader ─────────────────────────────────────────────────────── */
  const loadDupes = useCallback(async (runId) => {
    if (!runId) return;
    setDupesState('loading'); setDupesError('');
    try {
      const out = await pecanSearchApi.listDuplicates(projectId, runId, { skip: 0, take: 50 });
      setDupes(out);
      setDupesState('ready');
    } catch (e) {
      setDupesError(e.message || 'Failed to load duplicates');
      setDupesState('error');
    }
  }, [projectId]);

  const resolveDupe = useCallback(async (decisionId, action) => {
    if (!activeRun) return;
    setResolving(true);
    try {
      await pecanSearchApi.resolveDuplicate(projectId, activeRun.id, decisionId, action);
      await loadDupes(activeRun.id);
    } catch (e) {
      setDupesError(e.message || 'Failed to resolve');
    } finally {
      setResolving(false);
    }
  }, [projectId, activeRun, loadDupes]);

  /* ── start a run (Idempotency-Key per attempt) ─────────────────────────────── */
  const startRun = useCallback(async () => {
    if (!canRun || sourceIds.length === 0 || queryState !== 'ready') return;
    // 87.md — open the progress modal in the SAME tick as the click, before the network
    // round-trip, so the app never appears frozen. Reset the monotonic percent to 0 for
    // the new run (a fresh run must not inherit a prior run's high-water mark).
    pctRef.current = 0; setDisplayPct(0);
    setProgressOpen(true);
    setStarting(true); setStartError('');
    const idem = newIdempotencyKey();
    const canonicalQuery = { concepts: query.concepts, filters: query.filters };
    const sources = sourceIds.map((id) => ({ provider: id, override: overrides[id] || '' }));
    const capPayload = {};
    for (const id of sourceIds) if (caps[id]) capPayload[id] = Number(caps[id]);
    try {
      const out = await pecanSearchApi.startRun(projectId, {
        name: runName.trim(), canonicalQuery, sources, caps: capPayload,
      }, idem);
      if (out && out.run) {
        setActiveRun(out.run);
        setReport(null);
        setDupes(null); setDupesState('idle');
      }
      loadHistory(0); setHistoryPage(0);
    } catch (e) {
      setStartError(e.message || 'Could not start the search.');
    } finally {
      setStarting(false);
    }
  }, [canRun, sourceIds, queryState, query, overrides, caps, projectId, runName, loadHistory]);

  const cancelActive = useCallback(async () => {
    if (!activeRun) return;
    try { await pecanSearchApi.cancelRun(projectId, activeRun.id); await refetchActiveRun(activeRun.id); } catch { /* refetch will reconcile */ }
  }, [projectId, activeRun, refetchActiveRun]);

  const retryActive = useCallback(async (runId) => {
    const id = runId || (activeRun && activeRun.id);
    if (!id) return;
    try { const out = await pecanSearchApi.retryRun(projectId, id); if (out && out.run) setActiveRun(out.run); } catch { /* surfaced via refetch */ }
  }, [projectId, activeRun]);

  const openHistoryRun = useCallback(async (runId) => {
    try {
      const out = await pecanSearchApi.getRun(projectId, runId);
      if (out && out.run) {
        setActiveRun(out.run);
        setReport(null);
        if (TERMINAL.has(out.run.state)) {
          try { const r = await pecanSearchApi.getReport(projectId, runId); if (r) setReport(r.report); } catch { /* optional */ }
          loadDupes(runId);
        }
      }
    } catch { /* ignore */ }
  }, [projectId, loadDupes]);

  /* ── derived ────────────────────────────────────────────────────────────────── */
  const qSummary = summarizeQuery(query);
  const selectableProviders = (providers || []).filter((p) => p.selectable);
  const totalPreview = sourceIds.reduce((n, id) => {
    const c = counts[id];
    return (c && (c.kind === 'estimate' || c.kind === 'exact') && c.count != null) ? n + Number(c.count) : n;
  }, 0);
  const anyUnknownPreview = sourceIds.some((id) => { const c = counts[id]; return !c || (c.kind !== 'estimate' && c.kind !== 'exact'); });

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      {!embedded && <Header />}

      {/* ════════════ (1) SEARCH STRATEGY ════════════ */}
      <StrategyCard
        queryState={queryState} queryError={queryError} query={query} qSummary={qSummary} pico={pico}
      />

      {/* ════════════ (2) SOURCE CARDS ════════════ */}
      <SourcesSection
        providers={providers} providersError={providersError} engineCfg={engineCfg}
        selected={selected} setSelected={setSelected}
        overrides={overrides} setOverrides={setOverrides}
        showOverride={showOverride} setShowOverride={setShowOverride}
        caps={caps} setCaps={setCaps}
        translations={translations} counts={counts}
        previewing={previewing} previewError={previewError}
        readOnly={readOnly} queryReady={queryState === 'ready'}
        onRefreshPreview={runPreview}
      />

      {/* ════════════ (3) RUN REVIEW + START ════════════ */}
      {canRun && (
        <RunReview
          projectId={projectId}
          sourceIds={sourceIds} providers={providers} counts={counts} caps={caps}
          totalPreview={totalPreview} anyUnknownPreview={anyUnknownPreview}
          runName={runName} setRunName={setRunName}
          queryReady={queryState === 'ready'}
          starting={starting} startError={startError} onStart={startRun}
          hasActiveRun={!!activeRun && !TERMINAL.has(activeRun.state)}
        />
      )}

      {/* ════════════ (4/5) PROGRESS — modal-first (87.md) ════════════
          The centered "Adding articles to Screening" modal is the primary surface for
          the active run. Behind it (when the modal is closed/minimised) the inline area
          shows either the completion summary (a finished or history-opened run) or a
          compact reopen banner (a job still running that was minimised or reconstructed
          after a refresh) — never a second live progress indicator alongside the modal. */}
      {activeRun && !progressOpen && (
        TERMINAL.has(activeRun.state)
          ? <CompletionSummary run={activeRun} report={report} projectId={projectId} onRetry={canRun ? () => retryActive(activeRun.id) : null} />
          : <RunningBanner run={activeRun} percent={displayPct} onOpen={() => setProgressOpen(true)} />
      )}

      <SearchImportProgressModal
        open={progressOpen && (!!activeRun || starting || !!startError)}
        run={activeRun}
        starting={starting}
        startError={startError}
        displayPercent={displayPct}
        onClose={closeProgress}
        onCancel={canRun ? cancelActive : null}
        onRetry={canRun && activeRun && (activeRun.state === 'failed' || activeRun.state === 'partial') ? () => retryActive(activeRun.id) : null}
        screeningHref={screeningImportHref()}
        onGoToScreening={() => setProgressOpen(false)}
        readOnly={readOnly}
      />

      {/* ════════════ (7) DUPLICATE REVIEW ════════════ */}
      {activeRun && TERMINAL.has(activeRun.state) && (dupesState !== 'idle') && (
        <DuplicateReview
          candidates={dupes && dupes.candidates}
          total={dupes && dupes.total}
          loading={dupesState === 'loading'}
          error={dupesState === 'error' ? dupesError : ''}
          onResolve={canRun ? resolveDupe : (() => {})}
          onReload={() => loadDupes(activeRun.id)}
          resolving={resolving}
        />
      )}

      {/* ════════════ (6) SEARCH HISTORY ════════════ */}
      <SearchHistory
        history={history} total={historyTotal} state={historyState}
        page={historyPage} take={HISTORY_TAKE} setPage={setHistoryPage}
        onOpen={openHistoryRun} onRetry={canRun ? retryActive : null}
        projectId={projectId} activeRunId={activeRun && activeRun.id}
      />
    </div>
  );
}

/* ════════════ HEADER ════════════ */
function Header() {
  return (
    <header style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <div aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 10, color: C.acc, background: themeAlpha(C.acc, '16'), border: `1px solid ${themeAlpha(C.acc, '28')}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="globe" size={16} />
        </div>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: C.txt, letterSpacing: -0.4 }}>Run search — Pecan Search Engine</h2>
      </div>
      <p style={{ margin: 0, paddingLeft: 48, fontSize: 12.5, color: C.muted, lineHeight: 1.7, maxWidth: 760 }}>
        Run your saved search strategy across multiple bibliographic databases, deduplicate the results, and hand the new records straight to screening — with a reproducible, PRISMA-S–ready record of exactly what ran.
      </p>
    </header>
  );
}

/* ════════════ (1) STRATEGY CARD ════════════ */
function StrategyCard({ queryState, queryError, query, qSummary, pico }) {
  return (
    <Card title="Search strategy" icon="search" desc="The canonical concept query you built in the Strategy Builder. Edit it there — this is the single source of truth.">
      {queryState === 'loading' && <Skeleton height={56} />}
      {queryState === 'error' && <Note tone="error" role="alert">Could not load your saved strategy: {queryError}. The Pecan Search Engine needs a strategy to run.</Note>}
      {queryState === 'empty' && (
        <EmptyState icon="search" title="No saved search strategy yet">
          Build your concept query in the <strong>Strategy Builder</strong> step first. Once it is saved, it appears here ready to run across every database.
        </EmptyState>
      )}
      {queryState === 'ready' && query && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ ...tagStyle() }}>{qSummary.concepts} concept{qSummary.concepts === 1 ? '' : 's'}</span>
            <span style={{ ...tagStyle() }}>{qSummary.terms} term{qSummary.terms === 1 ? '' : 's'}</span>
            {query.filters && (query.filters.dateFrom || query.filters.dateTo) && (
              <span style={{ ...tagStyle() }}>Dates {query.filters.dateFrom || '*'}–{query.filters.dateTo || '*'}</span>
            )}
            {query.updatedAt && <span style={{ fontSize: 11, color: C.dim, alignSelf: 'center' }}>Saved {formatWhen(query.updatedAt)}</span>}
          </div>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {query.concepts.map((c, i) => (
              <li key={c.id || i} style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6 }}>
                <strong style={{ color: C.txt }}>{c.label || `Concept ${i + 1}`}</strong>
                {/* Terms within a concept are SYNONYMS → always shown (and searched) with OR.
                    The concept's op joins it to the NEXT concept, not its own terms. */}
                <span style={{ color: C.muted }}> — {(c.terms || []).map((t) => t.text).filter(Boolean).join('  OR  ')}</span>
                {i < query.concepts.length - 1 && (
                  <span style={{ color: C.dim, fontWeight: 700, fontSize: 11 }}> &nbsp;{c.op === 'OR' ? 'OR' : 'AND'}↓</span>
                )}
              </li>
            ))}
          </ol>
          <div style={{ marginTop: 12 }}>
            <Note tone="info">Terms inside a concept are <strong>alternatives (OR)</strong> — any one of them matches; concepts are combined with <strong>AND</strong>. To change the strategy, open the <strong>Strategy Builder</strong> step.</Note>
          </div>
          {literalBooleanTerms(query).length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Note tone="warn">
                {literalBooleanTerms(query).length === 1 ? 'One term contains' : `${literalBooleanTerms(query).length} terms contain`} a literal <strong>AND/OR/NOT</strong> and {literalBooleanTerms(query).length === 1 ? 'is' : 'are'} searched as text, not as an operator — e.g. “{literalBooleanTerms(query)[0].text}”. In the <strong>Strategy Builder</strong>, split {literalBooleanTerms(query).length === 1 ? 'it' : 'them'} into separate terms; synonyms in a concept are already combined for you.
              </Note>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
function tagStyle() {
  return { display: 'inline-flex', alignItems: 'center', padding: '3px 11px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: C.card2, color: C.txt2, border: `1px solid ${C.brd}` };
}

/* ════════════ (2) SOURCE CARDS ════════════ */
function SourcesSection({
  providers, providersError, engineCfg, selected, setSelected, overrides, setOverrides,
  showOverride, setShowOverride, caps, setCaps, translations, counts, previewing, previewError,
  readOnly, queryReady, onRefreshPreview,
}) {
  return (
    <Card
      title="Sources"
      icon="layers"
      desc="Pick the databases to search. Each card shows availability, the query translated to that database, and an estimated result count."
      right={previewing ? <span style={{ fontSize: 11, color: C.muted, display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="spin-ico" aria-hidden="true">⟳</span> Updating previews…</span>
        : queryReady ? <Btn variant="ghost" style={{ fontSize: 11 }} onClick={onRefreshPreview}>Refresh counts</Btn> : null}
    >
      {providers == null && !providersError && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height={150} radius={12} />)}
        </div>
      )}
      {providersError && <Note tone="error" role="alert">Could not load the provider list: {providersError}</Note>}
      {providers && providers.length === 0 && !providersError && (
        <EmptyState icon="alert" title="No search providers are configured">
          Ask an administrator to enable at least one database in the Ops console before running a search.
        </EmptyState>
      )}
      {previewError && <div style={{ marginBottom: 12 }}><Note tone="warn">Some previews could not be fetched ({previewError}). You can still run the search.</Note></div>}
      {providers && providers.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 12 }}>
          {providers.map((p) => (
            <SourceCard
              key={p.id} provider={p}
              selected={!!selected[p.id]}
              onToggle={(v) => setSelected((s) => ({ ...s, [p.id]: v }))}
              translation={translations[p.id]} count={counts[p.id]}
              cap={caps[p.id]} onCap={(v) => setCaps((c) => ({ ...c, [p.id]: v }))}
              overrideValue={overrides[p.id] || ''} onOverride={(v) => setOverrides((o) => ({ ...o, [p.id]: v }))}
              overrideOpen={!!showOverride[p.id]} onToggleOverride={(v) => setShowOverride((s) => ({ ...s, [p.id]: v }))}
              maxCap={(p.maxCap) || (engineCfg && engineCfg.maxResultCap) || 10000}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function SourceCard({ provider, selected, onToggle, translation, count, cap, onCap, overrideValue, onOverride, overrideOpen, onToggleOverride, maxCap, readOnly }) {
  const p = provider;
  const usable = p.selectable;
  const trWarnings = (translation && translation.warnings) || [];
  const unsupported = (translation && translation.unsupported) || [];
  return (
    <div style={{ background: selected && usable ? themeAlpha(C.acc, '06') : C.bg, border: `1px solid ${selected && usable ? themeAlpha(C.acc, '40') : C.brd}`, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, opacity: usable ? 1 : 0.78 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.txt }}>{p.label}</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>{p.platform}</div>
        </div>
        <Toggle on={selected && usable} disabled={!usable || readOnly} ariaLabel={`Include ${p.label} in the search`} onChange={onToggle} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {usable ? <span style={{ ...tagStyle(), color: C.grn, borderColor: themeAlpha(C.grn, '40') }}>Available</span>
          : p.implemented === false ? <span style={{ ...tagStyle(), color: C.muted }}>Not yet available</span>
            : <span style={{ ...tagStyle(), color: C.yel, borderColor: themeAlpha(C.yel, '40') }}>Unavailable</span>}
        <CredsBadge requiresCredentials={p.requiresCredentials} configured={p.configured} />
        {p.maxResults != null && <span style={{ ...tagStyle() }}>Cap ≤ {Number(p.maxResults).toLocaleString()}</span>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5 }}>
        <span style={{ color: C.muted }}>Estimated results</span>
        {p.supportsCountPreview === false
          ? <span style={{ fontSize: 11, color: C.dim }}>preview not supported</span>
          : <CountValue count={count && count.count} kind={count && count.kind} at={count && count.at} />}
      </div>

      {translation && (
        <Disclosure summary="Translated query" count={trWarnings.length}>
          {translation.query
            ? <pre style={{ margin: 0, fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, lineHeight: 1.6, color: C.txt, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: C.card2, border: `1px solid ${C.brd}`, borderRadius: 6, padding: 10 }}>{translation.query}</pre>
            : <div style={{ fontSize: 11.5, color: C.dim }}>{translation.available === false ? 'This source is unavailable.' : 'No query produced.'}</div>}
          {trWarnings.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 11, color: C.yel, lineHeight: 1.6 }}>
              {trWarnings.map((w, i) => <li key={i}>{typeof w === 'string' ? w : (w.message || JSON.stringify(w))}</li>)}
            </ul>
          )}
          {unsupported.length > 0 && (
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6 }}>Unsupported here: {unsupported.map((u) => (typeof u === 'string' ? u : u.field || '')).filter(Boolean).join(', ')}</div>
          )}
        </Disclosure>
      )}

      {usable && !readOnly && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700 }}>Result cap
            <input type="number" min={1} max={maxCap} value={cap || ''} disabled={!selected}
              onChange={(e) => onCap(Math.max(1, Math.min(maxCap, parseInt(e.target.value, 10) || 0)))}
              aria-label={`Maximum results to retrieve from ${p.label}`}
              style={{ ...inp, width: 92, padding: '5px 8px', fontSize: 11.5, marginLeft: 6, display: 'inline-block', opacity: selected ? 1 : 0.5 }} />
          </label>
          <button type="button" onClick={() => onToggleOverride(!overrideOpen)} disabled={!selected}
            style={{ ...btnS('ghost'), fontSize: 10.5, padding: '4px 10px', opacity: selected ? 1 : 0.5 }}
            aria-expanded={overrideOpen}>
            {overrideOpen ? 'Hide override' : 'Override query'}
          </button>
        </div>
      )}

      {usable && overrideOpen && !readOnly && (
        <div>
          <label style={{ ...lbl, marginBottom: 4 }}>Manual query override for {p.label}</label>
          <textarea value={overrideValue} onChange={(e) => onOverride(e.target.value)}
            placeholder="Leave blank to use the translated query above. A non-empty override replaces it for this source only."
            style={{ ...inp, height: 70, resize: 'vertical', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }} />
        </div>
      )}
    </div>
  );
}

/* ════════════ (3) RUN REVIEW + START ════════════ */
function RunReview({ sourceIds, providers, counts, caps, totalPreview, anyUnknownPreview, runName, setRunName, queryReady, starting, startError, onStart, hasActiveRun }) {
  const providerById = useMemo(() => Object.fromEntries((providers || []).map((p) => [p.id, p])), [providers]);
  const ready = queryReady && sourceIds.length > 0 && !hasActiveRun;
  return (
    <Card title="Review &amp; run" icon="checkSquare" desc="Confirm what will run. Records land in this project's screening workspace.">
      {!queryReady && <Note tone="warn">Save a search strategy first (Strategy Builder).</Note>}
      {queryReady && sourceIds.length === 0 && <Note tone="warn">Select at least one available source above.</Note>}
      {hasActiveRun && <div style={{ marginBottom: 12 }}><Note tone="info">A search is already running for this project. Wait for it to finish (or cancel it) before starting another.</Note></div>}

      {queryReady && sourceIds.length > 0 && (
        <>
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="pecan-run-name" style={lbl}>Search name (optional)</label>
            <input id="pecan-run-name" value={runName} onChange={(e) => setRunName(e.target.value)} maxLength={200}
              placeholder="e.g. Primary search — June 2026" style={inp} />
          </div>
          <div style={{ overflowX: 'auto', marginBottom: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <caption className="sr-only" style={srOnly}>Sources that will run, with their estimated counts and caps.</caption>
              <thead>
                <tr>
                  {['Source', 'Estimated', 'Cap'].map((h, i) => (
                    <th key={h} scope="col" style={{ textAlign: i === 0 ? 'left' : 'right', padding: '7px 10px', color: C.muted, fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', borderBottom: `1px solid ${C.brd}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sourceIds.map((id) => {
                  const c = counts[id];
                  return (
                    <tr key={id}>
                      <td style={{ padding: '7px 10px', color: C.txt, borderBottom: `1px solid ${C.brd}` }}>{(providerById[id] && providerById[id].label) || id}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', borderBottom: `1px solid ${C.brd}` }}><CountValue count={c && c.count} kind={c && c.kind} /></td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: C.txt2, fontFamily: "'IBM Plex Mono',monospace", borderBottom: `1px solid ${C.brd}` }}>{caps[id] ? Number(caps[id]).toLocaleString() : '—'}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ padding: '7px 10px', fontWeight: 700, color: C.txt }}>Total ({sourceIds.length} source{sourceIds.length === 1 ? '' : 's'})</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: C.txt, fontFamily: "'IBM Plex Mono',monospace" }}>
                    {totalPreview ? totalPreview.toLocaleString() : '—'}{anyUnknownPreview ? '+' : ''}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          {anyUnknownPreview && <div style={{ marginBottom: 12 }}><Note tone="info">Some sources could not estimate a count, so the total is a lower bound (shown with a “+”). The search still runs in full.</Note></div>}
          <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 14 }}>Destination: <strong style={{ color: C.txt2 }}>this project&apos;s screening workspace</strong>. Duplicates are removed automatically; ambiguous matches go to duplicate review.</div>
          {startError && <div style={{ marginBottom: 12 }}><Note tone="error" role="alert">{startError}</Note></div>}
          <Btn variant="primary" disabled={!ready} busy={starting} onClick={onStart} style={{ padding: '9px 22px', fontSize: 13 }}>
            <Icon name="arrowRight" size={14} /> Start search
          </Btn>
        </>
      )}
    </Card>
  );
}

/* ════════════ (4) RUNNING BANNER — the minimised / reconstructed progress affordance ══
   Shown when a run is in flight but the progress modal is closed: the user minimised it
   ("Run in background"), or it was reconstructed from history after a page refresh. One
   click reopens the full modal. The live detail lives in the modal — this stays compact
   so the workspace behind it is usable. */
function RunningBanner({ run, percent, onOpen }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent || 0)));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', marginBottom: 16, background: C.card, border: `1px solid ${C.brd}`, borderLeft: `3px solid ${C.acc}`, borderRadius: 12, flexWrap: 'wrap' }}>
      <span className="spin-ico" aria-hidden="true" style={{ color: C.acc, fontSize: 15 }}>⟳</span>
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>Adding articles to Screening… <StatusPill state={run.state} /></div>
        <div role="progressbar" aria-label="Search import progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${pct}%`}
          style={{ marginTop: 7, height: 5, borderRadius: 99, background: C.brd, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: C.acc, borderRadius: 99, transition: 'width .5s ease' }} />
        </div>
      </div>
      <span aria-hidden="true" style={{ fontSize: 12, fontWeight: 700, color: C.txt2, fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'right' }}>{pct}%</span>
      <Btn variant="ghost" onClick={onOpen}>View progress</Btn>
    </div>
  );
}

/* prompt60 — the deep link to the screening Import sub-page WITHIN the unified
   shell. Both shells host the project at the current pathname and read `?tab=`
   (+ `?screen=` for the embedded screening engine), so building it off the live
   pathname works in legacy and Stitch alike. ImportHistory there shows the
   "Pecan Search" badge on these records. */
function screeningImportHref() {
  if (typeof window === 'undefined') return '#';
  const path = (window.location && window.location.pathname) || '/app';
  return `${path}?tab=screening&screen=import`;
}

/* ════════════ (5) COMPLETION SUMMARY ════════════ */
function CompletionSummary({ run, report, projectId, onRetry }) {
  const counts = run.counts || {};
  const perSource = counts.perSource || {};
  const dupRemoved = (counts.exactDup || 0) + (counts.fuzzyDup || 0);
  // Retry is only offered for runs that ended in unintended incomplete work — never
  // for a run the user explicitly cancelled (a cancel stays sticky; start a new run).
  const retryable = (run.state === 'failed' || run.state === 'partial')
    && (run.sources || []).some((s) => s.state === 'failed' || s.state === 'partial');
  const exportBase = pecanSearchApi.reportExportUrl(projectId, run.id);
  return (
    <Card
      title={<span>Search results <StatusPill state={run.state} /></span>}
      icon={run.state === 'completed' ? 'circleCheck' : run.state === 'failed' ? 'alertOctagon' : 'alertTriangle'}
      desc={run.name}
      right={onRetry && retryable ? <Btn variant="ghost" onClick={onRetry}><Icon name="refresh" size={13} /> Retry failed sources</Btn> : null}
    >
      {run.state === 'partial' && <div style={{ marginBottom: 12 }}><Note tone="warn">Some sources succeeded and some did not. Every count below is exact for the sources that completed.</Note></div>}
      {run.state === 'failed' && <div style={{ marginBottom: 12 }}><Note tone="error" role="alert">The search failed. {run.errorSummary || 'No records were imported.'} You can retry.</Note></div>}
      {run.state === 'cancelled' && <div style={{ marginBottom: 12 }}><Note tone="info">This search was cancelled. Any records fetched before cancellation were kept.</Note></div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(135px,1fr))', gap: 10 }}>
        <StatTile label="Records identified" value={(counts.rawRetrieved || 0).toLocaleString()} tone="accent" />
        <StatTile label="Net imported" value={(counts.imported || 0).toLocaleString()} tone="green" hint="new to screening" />
        <StatTile label="Duplicates removed" value={dupRemoved.toLocaleString()} />
        <StatTile label="Already in project" value={(counts.existingMatched || 0).toLocaleString()} />
        <StatTile label="Ambiguous (review)" value={(counts.ambiguousDup || 0).toLocaleString()} tone={counts.ambiguousDup ? 'yellow' : undefined} />
        <StatTile label="Failed records" value={(counts.failedRecords || 0).toLocaleString()} tone={counts.failedRecords ? 'red' : undefined} />
        <StatTile label="Sources OK" value={`${counts.sourcesCompleted || 0}`} tone="green" />
        <StatTile label="Sources failed" value={`${(counts.sourcesFailed || 0) + (counts.sourcesPartial || 0)}`} tone={(counts.sourcesFailed || counts.sourcesPartial) ? 'red' : undefined} />
      </div>

      {Object.keys(perSource).length > 0 && (
        <Disclosure summary="Per-source breakdown" defaultOpen>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['Source', 'Raw', 'Imported', 'Existing', 'Dup', 'Ambiguous', 'Failed', 'Status'].map((h, i) => (
                    <th key={h} scope="col" style={{ textAlign: i === 0 || i === 7 ? 'left' : 'right', padding: '6px 9px', color: C.muted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${C.brd}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(perSource).map(([id, ps]) => (
                  <tr key={id}>
                    <td style={cellL}>{id}</td>
                    <td style={cellR}>{(ps.raw || 0).toLocaleString()}</td>
                    <td style={cellR}>{(ps.imported || 0).toLocaleString()}</td>
                    <td style={cellR}>{(ps.existingMatched || 0).toLocaleString()}</td>
                    <td style={cellR}>{((ps.exactDup || 0) + (ps.fuzzyDup || 0)).toLocaleString()}</td>
                    <td style={cellR}>{(ps.ambiguousDup || 0).toLocaleString()}</td>
                    <td style={cellR}>{(ps.failed || 0).toLocaleString()}</td>
                    <td style={cellL}><StatusPill state={ps.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginRight: 4 }}>Report:</span>
        <a href={exportBase} target="_blank" rel="noreferrer" style={{ ...btnS('ghost'), textDecoration: 'none', fontSize: 11.5 }}><Icon name="download" size={13} /> JSON</a>
        <a href={pecanSearchApi.reportExportUrl(projectId, run.id, 'csv')} target="_blank" rel="noreferrer" style={{ ...btnS('ghost'), textDecoration: 'none', fontSize: 11.5 }}><Icon name="download" size={13} /> CSV</a>
        <a href={pecanSearchApi.reportExportUrl(projectId, run.id, 'html')} target="_blank" rel="noreferrer" style={{ ...btnS('ghost'), textDecoration: 'none', fontSize: 11.5 }}><Icon name="externalLink" size={13} /> HTML</a>
      </div>
      {report && report.counts && (
        <div style={{ fontSize: 11, color: C.dim, marginTop: 10 }}>
          PRISMA identification: {report.counts.recordsIdentified} identified → {report.counts.duplicatesRemoved} duplicates removed → {report.counts.recordsToScreening} to screening.
        </div>
      )}
      {(run.state === 'completed' || run.state === 'partial') && (counts.imported || counts.existingMatched) ? (
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <a href={screeningImportHref()} style={{ ...btnS('primary'), textDecoration: 'none', fontSize: 12.5, padding: '9px 18px' }}>
            <Icon name="arrowRight" size={14} /> Go to Screening
          </a>
          <span style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, flex: 1, minWidth: 220 }}>
            {(counts.imported || 0).toLocaleString()} new record{(counts.imported || 0) === 1 ? '' : 's'} imported with the <strong style={{ color: C.txt2 }}>Pecan Search</strong> badge. Resolve any ambiguous duplicates below before you begin title/abstract screening.
          </span>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 12 }}>
          Imported records are now in the <strong style={{ color: C.txt2 }}>Screening</strong> tab. Resolve any ambiguous duplicates below before you begin title/abstract screening.
        </div>
      )}
    </Card>
  );
}
const cellL = { padding: '6px 9px', color: C.txt, borderBottom: `1px solid ${C.brd}` };
const cellR = { padding: '6px 9px', textAlign: 'right', color: C.txt2, fontFamily: "'IBM Plex Mono',monospace", borderBottom: `1px solid ${C.brd}` };

/* ════════════ (6) SEARCH HISTORY ════════════ */
function SearchHistory({ history, total, state, page, take, setPage, onOpen, onRetry, activeRunId }) {
  const pages = Math.max(1, Math.ceil((total || 0) / take));
  return (
    <Card title="Search history" icon="clock" desc="Every search you have run for this project. Open one to see its results, export its report, or safely retry it.">
      {state === 'loading' && [0, 1].map((i) => <div key={i} style={{ marginBottom: 8 }}><Skeleton height={48} radius={8} /></div>)}
      {state === 'error' && <Note tone="error" role="alert">Could not load the search history.</Note>}
      {state === 'ready' && (!history || history.length === 0) && (
        <EmptyState icon="clock" title="No searches yet">Your past searches will appear here once you run one.</EmptyState>
      )}
      {state === 'ready' && history && history.length > 0 && (
        <>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map((r) => {
              const c = r.counts || {};
              const isActive = r.id === activeRunId;
              return (
                <li key={r.id} style={{ border: `1px solid ${isActive ? themeAlpha(C.acc, '50') : C.brd}`, background: isActive ? themeAlpha(C.acc, '06') : C.bg, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>{r.name || 'Untitled search'}</span>
                      <StatusPill state={r.state} />
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                      {(r.sources || []).map((s) => s.provider).join(', ') || '—'}
                      {r.initiatedByName ? ` · ${r.initiatedByName}` : ''}
                      {r.createdAt ? ` · ${formatWhen(r.createdAt)}` : ''}
                    </div>
                    {r.canonicalText && <div style={{ fontSize: 10.5, color: C.dim, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 460 }}>{r.canonicalText}</div>}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right' }}>
                    <div>raw {(c.rawRetrieved || 0).toLocaleString()}</div>
                    <div>imp {(c.imported || 0).toLocaleString()}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Btn variant="ghost" style={{ fontSize: 11 }} onClick={() => onOpen(r.id)}>Open</Btn>
                    {onRetry && (r.state === 'failed' || r.state === 'partial') && (
                      <Btn variant="ghost" style={{ fontSize: 11 }} onClick={() => onRetry(r.id)}>Retry</Btn>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {pages > 1 && (
            <nav aria-label="Search history pages" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 14 }}>
              <Btn variant="ghost" style={{ fontSize: 11 }} disabled={page <= 0} onClick={() => setPage(page - 1)}><Icon name="chevronLeft" size={13} /> Prev</Btn>
              <span style={{ fontSize: 11.5, color: C.muted }}>Page {page + 1} of {pages}</span>
              <Btn variant="ghost" style={{ fontSize: 11 }} disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next <Icon name="chevronRight" size={13} /></Btn>
            </nav>
          )}
        </>
      )}
    </Card>
  );
}

const srOnly = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 };
