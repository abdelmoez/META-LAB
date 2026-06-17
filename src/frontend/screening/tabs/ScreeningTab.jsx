/**
 * ScreeningTab.jsx — META·SIFT collaborative screening workbench.
 *
 * The centerpiece 3-column screening surface:
 *   LEFT   — search · filter · record list (reviewer indicators, quorum/disputed)
 *   MIDDLE — selected record detail · abstract w/ PICO highlighting · PDF · decision bar
 *   RIGHT  — PICO question · inclusion/exclusion keywords · highlight toggles ·
 *            study-type filter · labels · reasons · blind-mode · project chat
 *
 * Restructures the logic of pages/SiftWorkbench.jsx into three columns and the
 * shared design system (ui/theme.js + ui/components.jsx). Inline styles only.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { C, FONT, MONO, alpha, DECISION_COLORS, DECISION_GLYPH } from '../ui/theme.js';
import { Loading, ErrorBanner, Button, Badge, DecisionChip, Card, SectionLabel, EmptyState, Toggle } from '../ui/components.jsx';
import { renderHighlighted } from '../ui/highlightRender.jsx';
import { extractKeywords } from '../../../research-engine/screening/keywords.js';
import { DEFAULT_INCLUDE_KEYWORDS, DEFAULT_EXCLUDE_KEYWORDS } from '../../../research-engine/screening/defaultKeywords.js';
import { effectiveKeywords, KEYWORD_SOURCE } from '../../../research-engine/screening/criteriaKeywords.js';
import PdfViewer from '../components/PdfViewer.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
import { useRealtime } from '../../hooks/useRealtime.js';
import { useScreeningShortcuts } from '../hooks/useScreeningShortcuts.js';
import { parseScreeningShortcuts, DEFAULT_SCREENING_SHORTCUTS, keyLabel } from '../screeningShortcuts.js';
import { api } from '../../api-client/apiClient.js';

const LIMIT = 50;

// Filter options for the left-column selector. `value` is sent as params.filter.
// Per-member "new/viewed" wording (Task 7) so reviewers track their own progress.
const FILTERS = [
  { value: 'all',         label: 'All records' },
  { value: 'unopened_me', label: 'New to me' },
  { value: 'opened_me',   label: 'Viewed by me' },
  { value: 'undecided',   label: 'Undecided' },
  { value: 'included',    label: 'Included by me' },
  { value: 'excluded',    label: 'Excluded by me' },
  { value: 'maybe',       label: 'Maybe (me)' },
  { value: 'quorum',      label: 'Quorum / 2nd review' },
  { value: 'disputed',    label: 'Disputed' },
];

// Safely parse a JSON string of string[] (project keyword/filter fields).
function parseList(json) {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// myDecision.labels arrives as a JSON string of label IDs; normalize to array.
function parseLabels(labels) {
  if (Array.isArray(labels)) return labels;
  try {
    const v = JSON.parse(labels || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────────────

export default function ScreeningTab({ pid, project, access, refreshProject, userId }) {
  const isLeader = !!access?.isLeader;
  const canScreen = !!access?.canScreen;
  const blindMode = !!project?.blindMode;

  // Parsed project config (keywords / study-type filter). Projects created before
  // default-keyword seeding fall back to the shared defaults so the panel is never
  // empty (Task 8 — "default keyword sets to every project").
  const storedIncl = parseList(project?.inclusionKeywords);
  const storedExcl = parseList(project?.exclusionKeywords);
  const studyTypes = parseList(project?.studyTypeFilter);

  // prompt28 Part 1 — layer this project's inclusion/exclusion CRITERIA on top of
  // the stored (default/manual) keywords. The criteria are derived from the linked
  // META·LAB project's eligibility criteria, cached per-screening-project in
  // `picoSnapshot` (refreshed server-side on every load), so the keywords stay
  // project-specific and update when the criteria change — WITHOUT persisting or
  // duplicating anything. Each term carries a source so the panel can badge the
  // criteria-derived ones.
  const effKw = useMemo(() => effectiveKeywords({
    storedInclude: storedIncl,
    storedExclude: storedExcl,
    defaultInclude: DEFAULT_INCLUDE_KEYWORDS,
    defaultExclude: DEFAULT_EXCLUDE_KEYWORDS,
    picoSnapshot: project?.picoSnapshot,
  }), [storedIncl.join('|'), storedExcl.join('|'), project?.picoSnapshot]); // eslint-disable-line react-hooks/exhaustive-deps
  const inclusion = effKw.include.terms;
  const exclusion = effKw.exclude.terms;
  const inclSource = effKw.include.sourceByTerm;
  const exclSource = effKw.exclude.sourceByTerm;
  // The leader's keyword editor manages ONLY the stored (default/manual) list —
  // the criteria-derived layer is read-only here (edit it in PICO & Question).
  const editInclusion = storedIncl.length ? storedIncl : DEFAULT_INCLUDE_KEYWORDS;
  const editExclusion = storedExcl.length ? storedExcl : DEFAULT_EXCLUDE_KEYWORDS;

  // ── Keyboard shortcut prefs (per-user, persisted to /api/profile) ────────
  const lsKey = userId ? `metalab.screeningShortcuts.${userId}` : null;
  function readCachedPrefs() {
    if (!lsKey) return DEFAULT_SCREENING_SHORTCUTS;
    try { return parseScreeningShortcuts(localStorage.getItem(lsKey)); } catch { return DEFAULT_SCREENING_SHORTCUTS; }
  }
  const [shortcutPrefs, setShortcutPrefs] = useState(() => readCachedPrefs());

  useEffect(() => {
    // Fetch server prefs; update state and mirror to localStorage
    api.profile.get().then(r => {
      const prefs = parseScreeningShortcuts(r?.user?.screeningShortcuts ?? null);
      setShortcutPrefs(prefs);
      if (lsKey) {
        try { localStorage.setItem(lsKey, JSON.stringify(prefs)); } catch { /* storage full */ }
      }
    }).catch(() => { /* non-fatal; keep cached value */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── Records & selection ──────────────────────────────────────────────────
  const [records, setRecords]       = useState([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [pages, setPages]           = useState(1);
  const [loading, setLoading]       = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError]   = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState('all');

  // Labels / reasons (project-level vocab).
  const [labels, setLabels]   = useState([]);
  const [reasons, setReasons] = useState([]);

  // Highlight toggles (default on).
  const [showInclusion, setShowInclusion] = useState(true);
  const [showExclusion, setShowExclusion] = useState(true);

  // Keyword filtering (Task 8): selected include/exclude phrases + article counts.
  const [selectedIncl, setSelectedIncl] = useState([]);
  const [selectedExcl, setSelectedExcl] = useState([]);
  const [kwStats, setKwStats] = useState({ total: 0, include: {}, exclude: {} });
  const selectedKeywords = [...selectedIncl, ...selectedExcl];
  const keywordsParam = selectedKeywords.join(',');
  const keywordsRef = useRef('');

  // Highlight terms follow the selection when the reviewer has narrowed it down;
  // otherwise the project's full keyword lists highlight out of the box.
  const hlIncl = selectedIncl.length ? selectedIncl : inclusion;
  const hlExcl = selectedExcl.length ? selectedExcl : exclusion;

  const clearKeywordFilters = useCallback(() => { setSelectedIncl([]); setSelectedExcl([]); }, []);

  const selected = records.find(r => r.id === selectedId) || null;

  // Refs to keep the latest values inside debounced / keyboard callbacks.
  const searchRef = useRef('');
  const filterRef = useRef('all');
  const recordsRef = useRef(records);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { recordsRef.current = records; }, [records]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // ── Load a page of records (reset = page 1 / append = next page) ──────────
  const loadRecords = useCallback(async ({ reset = false, p, s, f } = {}) => {
    const pageNum = reset ? 1 : (p ?? page);
    const searchVal = s !== undefined ? s : searchRef.current;
    const filterVal = f !== undefined ? f : filterRef.current;
    reset ? setLoading(true) : setLoadingMore(true);
    setListError(null);
    try {
      const params = { page: pageNum, limit: LIMIT };
      if (searchVal) params.search = searchVal;
      if (filterVal && filterVal !== 'all') params.filter = filterVal;
      if (keywordsRef.current) params.keywords = keywordsRef.current;
      const data = await screeningApi.listRecords(pid, params);
      const recs = data.records || [];
      setRecords(prev => (reset ? recs : [...prev, ...recs]));
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      setPage(pageNum);
      if (reset) {
        // Keep selection if still present, else pick the first row.
        setSelectedId(prev => (recs.some(r => r.id === prev) ? prev : (recs[0]?.id || null)));
      }
    } catch (e) {
      setListError(e.message || 'Failed to load records');
    } finally {
      reset ? setLoading(false) : setLoadingMore(false);
    }
  }, [pid, page]);

  // Refetch a single record's row after a decision so reviewer indicators /
  // quorum / disputed flags stay in sync without a full list reload.
  const refreshRow = useCallback(async (rid) => {
    try {
      const params = { page: 1, limit: 200 };
      if (searchRef.current) params.search = searchRef.current;
      if (filterRef.current && filterRef.current !== 'all') params.filter = filterRef.current;
      if (keywordsRef.current) params.keywords = keywordsRef.current;
      const data = await screeningApi.listRecords(pid, params);
      const fresh = (data.records || []).find(r => r.id === rid);
      if (fresh) setRecords(prev => prev.map(r => (r.id === rid ? fresh : r)));
      setTotal(data.total ?? total);
    } catch { /* non-fatal */ }
  }, [pid, total]);

  // Initial / project-change load.
  useEffect(() => {
    searchRef.current = '';
    filterRef.current = 'all';
    setSearch('');
    setFilter('all');
    loadRecords({ reset: true, s: '', f: 'all' });
    setSelectedIncl([]); setSelectedExcl([]); keywordsRef.current = '';
    Promise.all([
      screeningApi.listLabels(pid).then(d => d.labels || []).catch(() => []),
      screeningApi.listReasons(pid).then(d => d.reasons || []).catch(() => []),
    ]).then(([ls, rs]) => { setLabels(ls); setReasons(rs); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  // prompt23 Task 4 — keep the Title & Abstract list live when ANY decision lands
  // (a teammate's screening decision OR a resolved conflict, which promotes/decides
  // a record). The server emits `decision.saved` to project members on both; refetch
  // page 1 with the current filters so a resolved/advanced record leaves this list
  // (or updates its quorum/disputed flags) without a manual refresh.
  useRealtime({
    'decision.saved': (ev) => {
      if (!ev || ev.projectId === pid || ev.projectId === undefined) {
        loadRecords({ reset: true, s: searchRef.current, f: filterRef.current });
      }
    },
  });

  // Keyword article counts — refresh on project load and whenever the project's
  // keyword lists change (a leader edited them).
  const loadKwStats = useCallback(() => {
    screeningApi.getKeywordStats(pid)
      .then(s => setKwStats({ total: s.total || 0, include: s.include || {}, exclude: s.exclude || {} }))
      .catch(() => {});
  }, [pid]);
  useEffect(() => { loadKwStats(); /* eslint-disable-next-line */ }, [pid, inclusion.join('|'), exclusion.join('|')]);

  // Re-filter the list when the keyword selection changes (skip first mount).
  const kwFirst = useRef(true);
  useEffect(() => {
    keywordsRef.current = keywordsParam;
    if (kwFirst.current) { kwFirst.current = false; return; }
    loadRecords({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywordsParam]);

  // ── Debounced search ─────────────────────────────────────────────────────
  const searchTimer = useRef(null);
  function onSearchChange(val) {
    setSearch(val);
    searchRef.current = val;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      loadRecords({ reset: true, s: val, f: filterRef.current });
    }, 300);
  }

  function onFilterChange(val) {
    setFilter(val);
    filterRef.current = val;
    loadRecords({ reset: true, s: searchRef.current, f: val });
  }

  function loadMore() {
    if (loadingMore) return;
    loadRecords({ reset: false, p: page + 1 });
  }

  // ── Select a record → mark opened ────────────────────────────────────────
  const selectRecord = useCallback((rid) => {
    setSelectedId(rid);
    const rec = recordsRef.current.find(r => r.id === rid);
    if (rec && !rec.myOpened) {
      screeningApi.markOpened(pid, rid).catch(() => {});
      setRecords(prev => prev.map(r => (r.id === rid ? { ...r, myOpened: true } : r)));
    }
  }, [pid]);

  function moveSelection(dir) {
    const recs = recordsRef.current;
    const idx = recs.findIndex(r => r.id === selectedIdRef.current);
    const next = recs[idx + dir];
    if (next) selectRecord(next.id);
  }

  // ── Decision form state (mirrors the selected record's myDecision) ───────
  const [decision, setDecision]   = useState('');
  const [excReason, setExcReason] = useState('');
  const [notes, setNotes]         = useState('');
  const [rating, setRating]       = useState(0);
  const [chosenLabels, setChosenLabels] = useState([]);
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState('');
  const [decErr, setDecErr]       = useState('');

  useEffect(() => {
    if (!selected) { setDecision(''); setExcReason(''); setNotes(''); setRating(0); setChosenLabels([]); return; }
    const d = selected.myDecision;
    setDecision(d?.decision && d.decision !== 'undecided' ? d.decision : '');
    setExcReason(d?.exclusionReason || '');
    setNotes(d?.notes || '');
    setRating(d?.rating || 0);
    setChosenLabels(parseLabels(d?.labels));
    setSaveMsg('');
    setDecErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ── Save a decision (auto-save on click; persist on Save) ────────────────
  const saveDecision = useCallback(async (rid, dec, extra = {}) => {
    if (!rid || !canScreen) return;
    setSaving(true);
    setSaveMsg('');
    setDecErr('');
    try {
      const body = {
        decision: dec || 'undecided',
        exclusionReason: extra.exclusionReason !== undefined ? extra.exclusionReason : excReason,
        notes: extra.notes !== undefined ? extra.notes : notes,
        rating: extra.rating !== undefined ? extra.rating : rating,
        labels: extra.labels !== undefined ? extra.labels : chosenLabels,
      };
      const resp = await screeningApi.saveDecision(pid, rid, body);
      // Optimistically reflect the new decision in the row.
      setRecords(prev => prev.map(r => r.id === rid
        ? { ...r, myDecision: { decision: body.decision, exclusionReason: body.exclusionReason, notes: body.notes, rating: body.rating, labels: JSON.stringify(body.labels) } }
        : r));
      setSaveMsg(resp?.promoted ? 'Saved · advanced to Final Review' : 'Saved');
      refreshRow(rid); // re-sync reviewer indicators / quorum / disputed
      setTimeout(() => setSaveMsg(''), 2200);
    } catch (e) {
      setDecErr(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [pid, canScreen, excReason, notes, rating, chosenLabels, refreshRow]);

  // Click Include/Exclude/Maybe → auto-save immediately (toggle = undo).
  function onDecisionClick(val) {
    if (!canScreen) return;
    const next = decision === val ? '' : val;
    setDecision(next);
    const nextReason = next === 'exclude' ? excReason : '';
    if (next !== 'exclude') setExcReason('');
    saveDecision(selectedId, next, { exclusionReason: nextReason });
  }
  function onUndo() {
    if (!canScreen) return;
    setDecision('');
    setExcReason('');
    saveDecision(selectedId, '', { exclusionReason: '' });
  }
  function onSaveDetails() {
    saveDecision(selectedId, decision, { exclusionReason: excReason, notes, rating, labels: chosenLabels });
  }

  function toggleLabel(lid) {
    setChosenLabels(prev => prev.includes(lid) ? prev.filter(x => x !== lid) : [...prev, lid]);
  }

  // ── Keyboard shortcuts (user-configurable, guarded while typing) ─────────
  useScreeningShortcuts({
    enabled: shortcutPrefs.enabled && !!canScreen,
    keys: shortcutPrefs.keys,
    onNext:    () => moveSelection(1),
    onPrev:    () => moveSelection(-1),
    onInclude: () => onDecisionClick('include'),
    onExclude: () => onDecisionClick('exclude'),
    onMaybe:   () => onDecisionClick('maybe'),
    onUndo:    () => onUndo(),
  });

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', background: C.bg, fontFamily: FONT, color: C.txt, overflow: 'hidden' }}>
      <style>{`
        .sift-rl::-webkit-scrollbar, .sift-mid::-webkit-scrollbar, .sift-rt::-webkit-scrollbar { width: 8px; }
        .sift-rl::-webkit-scrollbar-thumb, .sift-mid::-webkit-scrollbar-thumb, .sift-rt::-webkit-scrollbar-thumb { background: ${C.brd2}; border-radius: 4px; }
        .sift-in:focus { border-color: ${C.acc} !important; }
      `}</style>

      <LeftColumn
        records={records} total={total} loading={loading} loadingMore={loadingMore}
        listError={listError} onRetry={() => loadRecords({ reset: true })}
        search={search} onSearchChange={onSearchChange}
        filter={filter} onFilterChange={onFilterChange}
        selectedId={selectedId} onSelect={selectRecord}
        blindMode={blindMode}
        hasMore={records.length < total} onLoadMore={loadMore}
        shortcutPrefs={shortcutPrefs}
      />

      <MiddleColumn
        record={selected} loading={loading}
        blindMode={blindMode} canScreen={canScreen} isLeader={isLeader}
        inclusion={hlIncl} exclusion={hlExcl}
        showInclusion={showInclusion} showExclusion={showExclusion}
        pid={pid}
        decision={decision} excReason={excReason} setExcReason={setExcReason}
        notes={notes} setNotes={setNotes} rating={rating} setRating={setRating}
        reasons={reasons} setReasons={setReasons}
        labels={labels} chosenLabels={chosenLabels} toggleLabel={toggleLabel}
        onDecisionClick={onDecisionClick} onUndo={onUndo} onSaveDetails={onSaveDetails}
        saving={saving} saveMsg={saveMsg} decErr={decErr}
        recordIndex={records.findIndex(r => r.id === selectedId)}
        recordCount={records.length} totalCount={total}
        onPrev={() => moveSelection(-1)} onNext={() => moveSelection(1)}
        shortcutPrefs={shortcutPrefs}
      />

      <RightColumn
        pid={pid} project={project} access={access} refreshProject={refreshProject}
        isLeader={isLeader}
        inclusion={inclusion} exclusion={exclusion} studyTypes={studyTypes}
        inclSource={inclSource} exclSource={exclSource}
        editInclusion={editInclusion} editExclusion={editExclusion}
        showInclusion={showInclusion} setShowInclusion={setShowInclusion}
        showExclusion={showExclusion} setShowExclusion={setShowExclusion}
        labels={labels} setLabels={setLabels} reasons={reasons} setReasons={setReasons}
        blindMode={blindMode}
        kwStats={kwStats} loadKwStats={loadKwStats}
        selectedIncl={selectedIncl} setSelectedIncl={setSelectedIncl}
        selectedExcl={selectedExcl} setSelectedExcl={setSelectedExcl}
        clearKeywordFilters={clearKeywordFilters}
        shownCount={total} projectTotal={kwStats.total}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LEFT COLUMN — search · filter · record list
// ════════════════════════════════════════════════════════════════════════════

function LeftColumn({
  records, total, loading, loadingMore, listError, onRetry,
  search, onSearchChange, filter, onFilterChange,
  selectedId, onSelect, blindMode, hasMore, onLoadMore,
  shortcutPrefs,
}) {
  const k = shortcutPrefs?.keys ?? DEFAULT_SCREENING_SHORTCUTS.keys;
  return (
    <div style={{ width: 300, flexShrink: 0, borderRight: `1px solid ${C.brd}`, display: 'flex', flexDirection: 'column', background: C.surf, overflow: 'hidden', minHeight: 0 }}>
      {/* Sticky search + filter header */}
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.brd}`, flexShrink: 0 }}>
        <input
          className="sift-in"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search title, author, DOI…"
          style={{
            width: '100%', background: C.card, border: `1px solid ${C.brd2}`,
            borderRadius: 7, padding: '8px 11px', color: C.txt, fontSize: 12.5,
            fontFamily: FONT, outline: 'none', marginBottom: 9, transition: 'border-color 0.15s',
          }}
        />
        <select
          value={filter}
          onChange={e => onFilterChange(e.target.value)}
          style={{
            width: '100%', background: C.card, border: `1px solid ${C.brd2}`,
            borderRadius: 7, padding: '7px 10px', color: C.txt, fontSize: 12,
            fontFamily: FONT, outline: 'none', cursor: 'pointer', appearance: 'none',
          }}
        >
          {FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <div style={{ marginTop: 8, fontSize: 10, color: C.muted, fontFamily: MONO, letterSpacing: '0.04em' }}>
          {records.length} / {total} {total === 1 ? 'RECORD' : 'RECORDS'}
          {(search || filter !== 'all') && ' · FILTERED'}
        </div>
      </div>

      {/* List */}
      <div className="sift-rl" style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <div style={{ padding: '14px 16px' }}><Loading label="Loading records…" /></div>
        ) : listError ? (
          <div style={{ padding: 14 }}><ErrorBanner onRetry={onRetry}>{listError}</ErrorBanner></div>
        ) : records.length === 0 ? (
          <div style={{ padding: 18 }}>
            <EmptyState icon="🔍" title="No records">
              {search || filter !== 'all' ? 'No records match the current filter.' : 'Import references to begin screening.'}
            </EmptyState>
          </div>
        ) : (
          <>
            {records.map(r => (
              <RecordRow key={r.id} record={r} selected={r.id === selectedId} onClick={() => onSelect(r.id)} blindMode={blindMode} />
            ))}
            {hasMore && (
              <div style={{ position: 'sticky', bottom: 0, background: C.surf, borderTop: `1px solid ${C.brd}`, padding: '10px 14px', textAlign: 'center', flexShrink: 0 }}>
                <Button variant="ghost" onClick={onLoadMore} disabled={loadingMore} full style={{ fontSize: 12, padding: '7px 14px' }}>
                  {loadingMore ? 'Loading…' : `Load more (${total - records.length})`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Keyboard hint — reflects current user shortcut config */}
      <div style={{ padding: '8px 14px', borderTop: `1px solid ${C.brd}`, fontSize: 9.5, color: C.muted, fontFamily: MONO, letterSpacing: '0.04em', flexShrink: 0 }}>
        {shortcutPrefs?.enabled !== false
          ? `${keyLabel(k.include)} include · ${keyLabel(k.exclude)} exclude · ${keyLabel(k.maybe)} maybe · ${keyLabel(k.undo)} undo · ${keyLabel(k.previous)}${keyLabel(k.next)} move`
          : 'Keyboard shortcuts disabled'}
      </div>
    </div>
  );
}

function RecordRow({ record, selected, onClick, blindMode }) {
  const [hover, setHover] = useState(false);
  const my = record.myDecision?.decision;
  const myDc = DECISION_COLORS[my] || DECISION_COLORS.undecided;
  const reviewers = (record.reviewerDecisions || []);
  const authorLine = [
    record.authors ? record.authors.split(',')[0] + (record.authors.includes(',') ? ' et al.' : '') : null,
    record.year,
  ].filter(Boolean).join(' · ');

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '10px 13px 10px 12px',
        borderBottom: `1px solid ${C.brd}`,
        borderLeft: `3px solid ${selected ? C.acc : 'transparent'}`,
        background: selected ? C.accBg : hover ? C.card2 : 'transparent',
        cursor: 'pointer', transition: 'background 0.1s',
      }}
    >
      {/* Title + my decision glyph + per-member new/viewed marker */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        {record.myOpened ? (
          <span title="Viewed by you" style={{
            width: 7, height: 7, borderRadius: '50%', marginTop: 5, flexShrink: 0,
            background: 'transparent', border: `1.5px solid ${C.muted}`,
          }} />
        ) : (
          <span title="New to you — not yet opened" style={{
            fontSize: 8, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.06em', marginTop: 2, flexShrink: 0,
            color: C.acc, background: alpha(C.acc, '20'), border: `1px solid ${alpha(C.acc, '55')}`, borderRadius: 3, padding: '1px 4px',
          }}>NEW</span>
        )}
        <div style={{
          flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: selected ? 600 : (record.myOpened ? 500 : 600),
          color: selected ? C.txt : (record.myOpened ? C.txt2 : C.txt), lineHeight: 1.35,
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {record.title || <span style={{ fontStyle: 'italic', color: C.muted }}>Untitled record</span>}
        </div>
        {record.disputed && <span title="Reviewers disagree — disputed" style={{ fontSize: 13, flexShrink: 0, marginTop: 0 }}>⚠️</span>}
        <span style={{ fontSize: 12, fontFamily: MONO, fontWeight: 700, color: myDc.txt, flexShrink: 0, marginTop: 1 }}>
          {DECISION_GLYPH[my] || '·'}
        </span>
      </div>

      {/* Author · year (hidden in blind mode) */}
      {!blindMode && authorLine && (
        <div style={{ fontSize: 10, color: C.muted, marginTop: 4, marginLeft: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {authorLine}
        </div>
      )}

      {/* Reviewer indicators + badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, marginLeft: 15, flexWrap: 'wrap' }}>
        {reviewers.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 3 }}>
            {reviewers.map((rv, i) => {
              const dc = DECISION_COLORS[rv.decision] || DECISION_COLORS.undecided;
              return (
                <span
                  key={i}
                  title={`${rv.reviewerName}: ${rv.decision}`}
                  style={{
                    fontSize: 9.5, fontFamily: MONO, fontWeight: 700, color: dc.txt,
                    width: 15, height: 15, borderRadius: '50%',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: alpha(dc.bg, 'aa'),
                    border: rv.isMe ? `1.5px solid ${dc.border}` : `1px solid ${alpha(dc.border, '55')}`,
                    boxShadow: rv.isMe ? `0 0 0 1px ${C.surf}` : 'none',
                  }}
                >
                  {DECISION_GLYPH[rv.decision] || '·'}
                </span>
              );
            })}
          </span>
        )}
        {record.currentStage === 'full_text'
          ? <Badge color={C.grn}>2nd review</Badge>
          : record.quorumMet && <Badge color={C.teal}>Quorum</Badge>}
        {record.handoffStatus === 'sent' && <Badge color={C.acc}>Sent</Badge>}
        {record.disputed && <Badge color={C.gold}>Disputed</Badge>}
        {record.isDuplicate && <Badge color={C.gold}>Dup</Badge>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MIDDLE COLUMN — record detail · abstract · PDF · decision bar
// ════════════════════════════════════════════════════════════════════════════

function MiddleColumn({
  record, loading, blindMode, canScreen, isLeader,
  inclusion, exclusion, showInclusion, showExclusion, pid,
  decision, excReason, setExcReason, notes, setNotes, rating, setRating,
  reasons, setReasons, labels, chosenLabels, toggleLabel,
  onDecisionClick, onUndo, onSaveDetails, saving, saveMsg, decErr,
  recordIndex, recordCount, totalCount, onPrev, onNext,
  shortcutPrefs,
}) {
  const k = shortcutPrefs?.keys ?? DEFAULT_SCREENING_SHORTCUTS.keys;
  const shortcutsOn = shortcutPrefs?.enabled !== false;
  if (loading && !record) {
    return <div className="sift-mid" style={{ flex: 1, overflowY: 'auto', padding: 28 }}><Loading label="Loading workbench…" /></div>;
  }
  if (!record) {
    return (
      <div className="sift-mid" style={{ flex: 1, overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ maxWidth: 420, width: '100%' }}>
          <EmptyState icon="📄" title="Select a record">Choose a record from the list to review its abstract and record your decision.</EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="sift-mid" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
      <div style={{ padding: '24px 28px', maxWidth: 860, margin: '0 auto', animation: 'sift-fade 0.25s ease' }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <h2 style={{ fontSize: 17, fontWeight: 700, color: C.txt, lineHeight: 1.42, margin: '0 0 10px', letterSpacing: '-0.01em', minWidth: 0, overflowWrap: 'anywhere' }}>
          {record.title || <span style={{ color: C.muted, fontStyle: 'italic' }}>Untitled record</span>}
        </h2>

        {!blindMode && (record.authors || record.journal || record.year) && (
          <div style={{ fontSize: 12.5, color: C.txt2, marginBottom: 10, lineHeight: 1.5, minWidth: 0, overflowWrap: 'anywhere' }}>
            {record.authors && <span>{record.authors}</span>}
            {record.journal && <span style={{ fontStyle: 'italic', color: C.muted }}>{record.authors ? ' · ' : ''}{record.journal}</span>}
            {record.year && <span style={{ color: C.muted }}>{(record.authors || record.journal) ? ' · ' : ''}{record.year}</span>}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
          {record.doi && (
            <a href={`https://doi.org/${record.doi}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none', minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-all' }}>DOI: {record.doi}</a>
          )}
          {record.pmid && (
            <a href={`https://pubmed.ncbi.nlm.nih.gov/${record.pmid}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none' }}>PMID: {record.pmid}</a>
          )}
          {record.sourceDb && <Badge color={C.txt2}>{record.sourceDb}</Badge>}
          {record.isDuplicate && <Badge color={C.gold}>Duplicate</Badge>}
        </div>

        {/* ── Abstract (with PICO highlighting) ──────────────────────────── */}
        <Card style={{ marginBottom: 18, padding: '18px 20px' }}>
          <SectionLabel>Abstract</SectionLabel>
          {record.abstract ? (
            <p style={{ fontSize: 14, color: C.txt, lineHeight: 1.75, margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
              {renderHighlighted(record.abstract, { inclusion, exclusion, showInclusion, showExclusion })}
            </p>
          ) : (
            <p style={{ fontSize: 13.5, color: C.muted, fontStyle: 'italic', margin: 0 }}>No abstract available for this record.</p>
          )}

          {record.keywords && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.brd}` }}>
              <span style={{ fontSize: 9.5, color: C.muted, fontFamily: MONO, alignSelf: 'center', letterSpacing: '0.08em' }}>KEYWORDS</span>
              {record.keywords.split(/[;,]/).map((kw, i) => kw.trim() && (
                <span key={i} style={{ fontSize: 10.5, background: alpha(C.brd, '70'), border: `1px solid ${C.brd}`, color: C.txt2, borderRadius: 10, padding: '2px 9px' }}>{kw.trim()}</span>
              ))}
            </div>
          )}
        </Card>

        {/* ── PDF attachment + in-browser preview ────────────────────────── */}
        <div style={{ margin: '4px 0 16px' }}>
          <PdfViewer pid={pid} recordId={record.id} canManage={canScreen || isLeader} />
        </div>

        {/* ── Quorum / workflow status ───────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.txt2 }}>
            <span style={{ fontFamily: MONO, fontWeight: 700, color: record.includeCount >= 2 ? C.grn : C.txt }}>{record.includeCount || 0}</span>
            <span style={{ color: C.muted }}> / 2 reviewers included</span>
          </span>
          {record.quorumMet && <Badge color={C.teal}>Quorum met</Badge>}
          {record.currentStage === 'full_text' && <Badge color={C.grn}>✓ In Final Review</Badge>}
          {record.handoffStatus === 'sent' && <Badge color={C.acc}>↗ Sent to Data Extraction</Badge>}
          {record.disputed && <Badge color={C.gold}>⚠ Disputed</Badge>}
        </div>

        {/* ── Decision bar ───────────────────────────────────────────────── */}
        <Card style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <SectionLabel>{canScreen ? 'Your decision' : 'Decision (view-only)'}</SectionLabel>
            {!canScreen && <span style={{ fontSize: 11, color: C.gold }}>You have view-only access</span>}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: decision === 'exclude' ? 16 : 0 }}>
            <DecisionButton label="✓ Include" value="include" active={decision === 'include'} disabled={!canScreen} onClick={() => onDecisionClick('include')} keyHint={shortcutsOn ? keyLabel(k.include) : null} />
            <DecisionButton label="✗ Exclude" value="exclude" active={decision === 'exclude'} disabled={!canScreen} onClick={() => onDecisionClick('exclude')} keyHint={shortcutsOn ? keyLabel(k.exclude) : null} />
            <DecisionButton label="? Maybe"   value="maybe"   active={decision === 'maybe'}   disabled={!canScreen} onClick={() => onDecisionClick('maybe')}   keyHint={shortcutsOn ? keyLabel(k.maybe)   : null} />
            <button
              onClick={onUndo}
              disabled={!canScreen || !decision}
              style={{
                background: 'transparent', border: `1px solid ${C.brd}`, color: C.muted,
                fontSize: 13, fontWeight: 600, fontFamily: FONT, padding: '8px 18px',
                borderRadius: 7, cursor: (!canScreen || !decision) ? 'not-allowed' : 'pointer',
                opacity: (!canScreen || !decision) ? 0.4 : 1, transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              ↩ Undo
              {shortcutsOn && (
                <span style={{ fontSize: 9, fontFamily: MONO, background: alpha(C.brd, '80'), border: `1px solid ${C.brd2}`, borderRadius: 3, padding: '1px 4px', color: C.muted, lineHeight: 1.2 }}>
                  {keyLabel(k.undo)}
                </span>
              )}
            </button>
          </div>

          {/* Exclusion reason (when excluded) */}
          {decision === 'exclude' && (
            <ExclusionReason
              pid={pid} reasons={reasons} setReasons={setReasons}
              value={excReason} onChange={setExcReason} disabled={!canScreen}
            />
          )}

          {/* Labels */}
          <div style={{ marginTop: 16 }}>
            <SectionLabel>Labels</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {labels.length === 0 && <span style={{ fontSize: 11.5, color: C.muted }}>No labels defined. Leaders can add labels in the right panel.</span>}
              {labels.map(l => {
                const active = chosenLabels.includes(l.id);
                const col = l.color || C.acc;
                return (
                  <button
                    key={l.id}
                    onClick={() => canScreen && toggleLabel(l.id)}
                    disabled={!canScreen}
                    style={{
                      background: active ? alpha(col, '2e') : alpha(C.brd, '50'),
                      border: `1px solid ${active ? alpha(col, '90') : C.brd}`,
                      color: active ? col : C.txt2, fontSize: 11.5, fontFamily: FONT,
                      padding: '4px 11px', borderRadius: 12,
                      cursor: canScreen ? 'pointer' : 'default', transition: 'all 0.15s',
                    }}
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginTop: 16 }}>
            <SectionLabel>Notes</SectionLabel>
            <textarea
              className="sift-in"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={!canScreen}
              placeholder="Optional screening notes…"
              rows={3}
              style={{
                width: '100%', background: C.surf, border: `1px solid ${C.brd2}`,
                borderRadius: 7, padding: '9px 11px', color: C.txt, fontSize: 13,
                fontFamily: FONT, outline: 'none', resize: 'vertical', lineHeight: 1.55, transition: 'border-color 0.15s',
              }}
            />
          </div>

          {/* Rating */}
          <div style={{ marginTop: 16 }}>
            <SectionLabel>Quality rating</SectionLabel>
            <StarRating value={rating} onChange={setRating} disabled={!canScreen} />
          </div>

          {/* Save row */}
          {canScreen && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
              <Button onClick={onSaveDetails} disabled={saving}>{saving ? 'Saving…' : 'Save reason · labels · notes'}</Button>
              {saveMsg && <span style={{ fontSize: 11.5, fontFamily: MONO, color: C.grn }}>{saveMsg}</span>}
              {decErr && <span style={{ fontSize: 11.5, fontFamily: MONO, color: C.red }}>{decErr}</span>}
            </div>
          )}
        </Card>

      </div>
      </div>

      {/* ── Prev / Next nav — sticky footer, always visible ────────────── */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${C.brd}`, background: C.surf, padding: '12px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant="ghost" onClick={onPrev} disabled={recordIndex <= 0} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {shortcutsOn && <span style={{ fontSize: 9, fontFamily: MONO, background: alpha(C.brd, '80'), border: `1px solid ${C.brd2}`, borderRadius: 3, padding: '1px 4px', color: C.muted, lineHeight: 1.2 }}>{keyLabel(k.previous)}</span>}
          ← Previous
        </Button>
        <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
          {recordIndex + 1} / {recordCount}{totalCount > recordCount ? ` (of ${totalCount})` : ''}
        </span>
        <Button variant="ghost" onClick={onNext} disabled={recordIndex >= recordCount - 1} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          Next →
          {shortcutsOn && <span style={{ fontSize: 9, fontFamily: MONO, background: alpha(C.brd, '80'), border: `1px solid ${C.brd2}`, borderRadius: 3, padding: '1px 4px', color: C.muted, lineHeight: 1.2 }}>{keyLabel(k.next)}</span>}
        </Button>
      </div>
    </div>
  );
}

function DecisionButton({ label, value, active, disabled, onClick, keyHint }) {
  const [hover, setHover] = useState(false);
  const dc = DECISION_COLORS[value];
  const bg     = active ? dc.bg     : hover && !disabled ? alpha(dc.bg, '55') : 'transparent';
  const border = active ? dc.border : hover && !disabled ? dc.border    : C.brd;
  const color  = active ? dc.txt    : hover && !disabled ? dc.txt        : C.txt2;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: bg, border: `1px solid ${border}`, color,
        fontSize: 13, fontWeight: 600, fontFamily: FONT, padding: '8px 20px',
        borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1, minWidth: 104, transition: 'all 0.15s',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}
    >
      {label}
      {keyHint && (
        <span style={{
          fontSize: 9, fontFamily: MONO,
          background: active ? alpha(dc.border, '30') : alpha(C.brd, '80'),
          border: `1px solid ${active ? alpha(dc.border, '60') : C.brd2}`,
          borderRadius: 3, padding: '1px 4px', color: active ? dc.txt : C.muted,
          lineHeight: 1.2, fontWeight: 400, letterSpacing: '0.04em',
        }}>
          {keyHint}
        </span>
      )}
    </button>
  );
}

function ExclusionReason({ pid, reasons, setReasons, value, onChange, disabled }) {
  const [newReason, setNewReason] = useState('');
  const [savePredef, setSavePredef] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function addPredefined() {
    const text = (newReason || value).trim();
    if (!text) return;
    setBusy(true); setErr('');
    try {
      const created = await screeningApi.createReason(pid, { text });
      setReasons(prev => [...prev, created]);
      onChange(text);
      setNewReason('');
      setSavePredef(false);
    } catch (e) { setErr(e.message || 'Could not save reason'); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 14 }}>
      <SectionLabel>Exclusion reason</SectionLabel>
      {reasons.length > 0 && (
        <select
          value={reasons.some(r => r.text === value) ? value : ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          style={{
            width: '100%', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 6,
            padding: '8px 10px', color: C.txt, fontSize: 12.5, fontFamily: FONT, outline: 'none',
            marginBottom: 7, cursor: disabled ? 'default' : 'pointer',
          }}
        >
          <option value="">— Predefined reason —</option>
          {reasons.map(r => <option key={r.id} value={r.text}>{r.text}</option>)}
        </select>
      )}
      <input
        className="sift-in"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Or type a free-text exclusion reason…"
        style={{
          width: '100%', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 6,
          padding: '8px 10px', color: C.txt, fontSize: 12.5, fontFamily: FONT, outline: 'none', transition: 'border-color 0.15s',
        }}
      />
      {!disabled && (
        <div style={{ marginTop: 8 }}>
          <Toggle checked={savePredef} onChange={setSavePredef} label="Save as predefined reason" />
          {savePredef && (
            <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
              <input
                className="sift-in"
                value={newReason}
                onChange={e => setNewReason(e.target.value)}
                placeholder={value ? `Save “${value.slice(0, 28)}…”` : 'Reason text…'}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPredefined(); } }}
                style={{
                  flex: 1, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 6,
                  padding: '6px 10px', color: C.txt, fontSize: 11.5, fontFamily: FONT, outline: 'none',
                }}
              />
              <Button variant="subtle" onClick={addPredefined} disabled={busy || !(newReason || value).trim()} style={{ fontSize: 11, padding: '6px 12px' }}>+ Save</Button>
            </div>
          )}
          {err && <div style={{ fontSize: 11, color: C.red, marginTop: 6 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}

function StarRating({ value, onChange, disabled }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          onClick={() => !disabled && onChange(value === n ? 0 : n)}
          onMouseEnter={() => !disabled && setHover(n)}
          onMouseLeave={() => setHover(0)}
          disabled={disabled}
          style={{
            background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer',
            fontSize: 19, lineHeight: 1, padding: '0 1px',
            color: n <= (hover || value) ? C.gold : C.brd2, transition: 'color 0.1s',
          }}
        >★</button>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// RIGHT COLUMN — PICO · keyword filters/highlights · study types · labels · reasons
// ════════════════════════════════════════════════════════════════════════════

function RightColumn({
  pid, project, access, refreshProject, isLeader,
  inclusion, exclusion, studyTypes, inclSource, exclSource, editInclusion, editExclusion,
  showInclusion, setShowInclusion, showExclusion, setShowExclusion,
  labels, setLabels, reasons, setReasons, blindMode,
  kwStats, loadKwStats, selectedIncl, setSelectedIncl, selectedExcl, setSelectedExcl,
  clearKeywordFilters, shownCount, projectTotal,
}) {
  const [open, setOpen] = useState({
    pico: true, keywords: true,
    studyTypes: false, labels: false, reasons: false,
  });
  const toggle = key => setOpen(o => ({ ...o, [key]: !o[key] }));

  return (
    <div className="sift-rt" style={{ width: 320, flexShrink: 0, borderLeft: `1px solid ${C.brd}`, background: C.surf, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Blind-mode banner */}
      {blindMode && (
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge color={C.gold}>Blind mode</Badge>
          <span style={{ fontSize: 11, color: C.txt2 }}>Authors & reviewers anonymised</span>
        </div>
      )}

      {/* PICO / Question */}
      <Section title="PICO / Question" open={open.pico} onToggle={() => toggle('pico')}>
        {project?.reviewQuestion
          ? <p style={{ fontSize: 13, color: C.txt, lineHeight: 1.65, margin: 0 }}>{project.reviewQuestion}</p>
          : <p style={{ fontSize: 12.5, color: C.muted, fontStyle: 'italic', margin: 0 }}>No review question set.</p>}
      </Section>

      {/* Keyword filters + highlighting (Task 8) */}
      <Section title="Keyword filters & highlights" open={open.keywords} onToggle={() => toggle('keywords')}>
        <KeywordPanel
          pid={pid} project={project} refreshProject={refreshProject} isLeader={isLeader}
          inclusion={inclusion} exclusion={exclusion}
          inclSource={inclSource} exclSource={exclSource}
          editInclusion={editInclusion} editExclusion={editExclusion}
          kwStats={kwStats} loadKwStats={loadKwStats}
          selectedIncl={selectedIncl} setSelectedIncl={setSelectedIncl}
          selectedExcl={selectedExcl} setSelectedExcl={setSelectedExcl}
          clearKeywordFilters={clearKeywordFilters}
          shownCount={shownCount} projectTotal={projectTotal}
          showInclusion={showInclusion} setShowInclusion={setShowInclusion}
          showExclusion={showExclusion} setShowExclusion={setShowExclusion}
        />
      </Section>

      {/* Study type filter */}
      <Section title="Study type filter" open={open.studyTypes} onToggle={() => toggle('studyTypes')}>
        {studyTypes.length === 0 ? (
          <span style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>No study-type filter set.</span>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {studyTypes.map((t, i) => (
              <span key={i} style={{ fontSize: 11.5, background: alpha(C.brd, '60'), border: `1px solid ${C.brd}`, color: C.txt2, borderRadius: 12, padding: '3px 10px' }}>{t}</span>
            ))}
          </div>
        )}
      </Section>

      {/* Labels manager */}
      <Section title="Labels" open={open.labels} onToggle={() => toggle('labels')}>
        <VocabManager
          items={labels} setItems={setLabels} isLeader={isLeader}
          getText={l => l.name} getColor={l => l.color || C.acc}
          onAdd={name => screeningApi.createLabel(pid, { name })}
          onDelete={id => screeningApi.deleteLabel(pid, id)}
          placeholder="New label…" emptyText="No labels yet."
        />
      </Section>

      {/* Reasons manager */}
      <Section title="Exclusion reasons" open={open.reasons} onToggle={() => toggle('reasons')}>
        <VocabManager
          items={reasons} setItems={setReasons} isLeader={isLeader}
          getText={r => r.text}
          onAdd={text => screeningApi.createReason(pid, { text })}
          onDelete={id => screeningApi.deleteReason(pid, id)}
          placeholder="New exclusion reason…" emptyText="No predefined reasons yet."
        />
      </Section>

      <div style={{ padding: '12px 16px', fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
        Use the <strong style={{ color: C.txt2 }}>💬 Chat</strong> button in the top bar to message the project team.
      </div>
    </div>
  );
}

function Section({ title, open, onToggle, children, noPad }) {
  return (
    <div style={{ borderBottom: `1px solid ${C.brd}` }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'none', border: 'none', cursor: 'pointer', padding: '13px 16px', textAlign: 'left',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = C.cardHover; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
      >
        <span style={{ fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: open ? C.txt2 : C.muted }}>
          {title}
        </span>
        <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>›</span>
      </button>
      {open && <div style={{ padding: noPad ? 0 : '0 16px 16px' }}>{children}</div>}
    </div>
  );
}

// ── Keyword filter + highlight panel (Task 8) ────────────────────────────────
//
// Checkbox lists for the project's include/exclude keywords, each annotated with
// the number of ARTICLES containing it. Selecting keywords filters the record
// list (OR — any selected term) and drives green/red highlighting; highlights can
// be toggled off without clearing the filter, and all filters cleared in one click.

const KW_PREVIEW = 8; // collapsed list length

function KeywordPanel({
  pid, project, refreshProject, isLeader,
  inclusion, exclusion, inclSource, exclSource, editInclusion, editExclusion, kwStats, loadKwStats,
  selectedIncl, setSelectedIncl, selectedExcl, setSelectedExcl, clearKeywordFilters,
  shownCount, projectTotal,
  showInclusion, setShowInclusion, showExclusion, setShowExclusion,
}) {
  const [editing, setEditing] = useState(false);
  const anySelected = selectedIncl.length + selectedExcl.length > 0;
  const criteriaCount = [...Object.values(inclSource || {}), ...Object.values(exclSource || {})]
    .filter(s => s === KEYWORD_SOURCE.CRITERIA).length;

  return (
    <div>
      {/* Shown / total summary */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 11.5, color: C.txt2, fontFamily: MONO }}>
          Shown <span style={{ color: C.txt, fontWeight: 700 }}>{shownCount}</span> / {projectTotal || 0} articles
        </span>
        <button
          onClick={clearKeywordFilters}
          disabled={!anySelected}
          style={{
            background: 'none', border: `1px solid ${C.brd}`, color: anySelected ? C.acc : C.muted,
            fontSize: 10.5, fontFamily: FONT, padding: '3px 9px', borderRadius: 6,
            cursor: anySelected ? 'pointer' : 'default', opacity: anySelected ? 1 : 0.5,
          }}>Clear filters</button>
      </div>

      <KeywordGroup
        title="Include keywords" accent={C.grn}
        terms={inclusion} counts={kwStats.include || {}} sourceByTerm={inclSource}
        selected={selectedIncl} setSelected={setSelectedIncl}
      />
      <div style={{ height: 14 }} />
      <KeywordGroup
        title="Exclude keywords" accent={C.red}
        terms={exclusion} counts={kwStats.exclude || {}} sourceByTerm={exclSource}
        selected={selectedExcl} setSelected={setSelectedExcl}
      />

      {/* prompt28 Part 1 — explain the criteria-derived layer when present. */}
      {criteriaCount > 0 && (
        <div style={{ marginTop: 10, fontSize: 10.5, color: C.muted, lineHeight: 1.5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <CriteriaBadge />
          <span>Keywords drawn from this project&apos;s eligibility criteria. Edit them in PICO &amp; Question.</span>
        </div>
      )}

      {/* Highlight toggles (independent of filters) */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.brd}`, display: 'flex', flexDirection: 'column', gap: 11 }}>
        <span style={{ fontSize: 9.5, fontFamily: MONO, color: C.muted, letterSpacing: '0.1em' }}>HIGHLIGHTING</span>
        <Toggle checked={showInclusion} onChange={setShowInclusion} label="Inclusion (green)" />
        <Toggle checked={showExclusion} onChange={setShowExclusion} label="Exclusion (red)" />
        <button
          onClick={() => { setShowInclusion(false); setShowExclusion(false); }}
          disabled={!showInclusion && !showExclusion}
          style={{
            alignSelf: 'flex-start', background: 'none', border: `1px solid ${C.brd}`, color: C.txt2,
            fontSize: 11, fontFamily: FONT, padding: '5px 12px', borderRadius: 6,
            cursor: (!showInclusion && !showExclusion) ? 'default' : 'pointer',
            opacity: (!showInclusion && !showExclusion) ? 0.45 : 1,
          }}>All highlights off</button>
      </div>

      {/* Leader: edit the keyword lists */}
      {isLeader && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.brd}` }}>
          <button
            onClick={() => setEditing(e => !e)}
            style={{ background: 'none', border: 'none', color: C.acc, fontSize: 11.5, fontFamily: FONT, cursor: 'pointer', padding: 0 }}>
            {editing ? '▾ Hide keyword editor' : '✎ Edit keyword lists'}
          </button>
          {editing && (
            <div style={{ marginTop: 12 }}>
              <KeywordEditor
                pid={pid} project={project} isLeader={isLeader}
                inclusion={editInclusion} exclusion={editExclusion}
                refreshProject={() => { refreshProject?.(); loadKwStats?.(); }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Subtle "Project criteria" provenance badge (prompt28 Part 1).
function CriteriaBadge({ compact }) {
  return (
    <span
      title="Derived from this project's inclusion/exclusion criteria"
      style={{
        display: 'inline-flex', alignItems: 'center', flexShrink: 0,
        fontSize: 8.5, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.03em',
        color: C.acc, background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '38')}`,
        borderRadius: 5, padding: compact ? '0px 4px' : '1px 5px', textTransform: 'uppercase', whiteSpace: 'nowrap',
      }}
    >criteria</span>
  );
}

function KeywordGroup({ title, accent, terms, counts, selected, setSelected, sourceByTerm }) {
  const [expanded, setExpanded] = useState(false);
  const list = expanded ? terms : terms.slice(0, KW_PREVIEW);
  const allSelected = terms.length > 0 && selected.length === terms.length;

  const toggleTerm = t => setSelected(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  const toggleAll  = () => setSelected(allSelected ? [] : [...terms]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
        <span style={{ fontSize: 9.5, fontFamily: MONO, color: accent, letterSpacing: '0.1em' }}>
          {title.toUpperCase()}{selected.length ? ` · ${selected.length}` : ''}
        </span>
        {terms.length > 0 && (
          <button onClick={toggleAll}
            style={{ background: 'none', border: 'none', color: C.txt2, fontSize: 10.5, fontFamily: FONT, cursor: 'pointer', padding: 0 }}>
            {allSelected ? 'Clear' : 'Select all'}
          </button>
        )}
      </div>

      {terms.length === 0 ? (
        <span style={{ fontSize: 11.5, color: C.muted, fontStyle: 'italic' }}>None defined.</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {list.map(t => {
            const on = selected.includes(t);
            const n = counts[t] || 0;
            const isCriteria = (sourceByTerm || {})[t] === KEYWORD_SOURCE.CRITERIA;
            return (
              <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '2px 0' }}>
                <input type="checkbox" checked={on} onChange={() => toggleTerm(t)}
                  style={{ accentColor: accent, cursor: 'pointer', flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: on ? C.txt : C.txt2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={isCriteria ? `${t} · from project criteria` : t}>{t}</span>
                {isCriteria && <CriteriaBadge compact />}
                <span style={{ fontSize: 10, fontFamily: MONO, color: n ? accent : C.muted, background: n ? alpha(accent, '14') : 'transparent', borderRadius: 4, padding: '1px 6px', flexShrink: 0, minWidth: 22, textAlign: 'center' }}>{n}</span>
              </label>
            );
          })}
        </div>
      )}

      {terms.length > KW_PREVIEW && (
        <button onClick={() => setExpanded(e => !e)}
          style={{ marginTop: 6, background: 'none', border: 'none', color: C.acc, fontSize: 11, fontFamily: FONT, cursor: 'pointer', padding: 0 }}>
          {expanded ? 'Show less' : `Show more (${terms.length - KW_PREVIEW})`}
        </button>
      )}
    </div>
  );
}

// ── Keyword editor (chips + add + auto-generate, leader-only edits) ──────────

function KeywordEditor({ pid, project, refreshProject, inclusion, exclusion, isLeader }) {
  const [incl, setIncl] = useState(inclusion);
  const [excl, setExcl] = useState(exclusion);
  const [newIncl, setNewIncl] = useState('');
  const [newExcl, setNewExcl] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Re-sync when the project's persisted keywords change.
  useEffect(() => { setIncl(inclusion); /* eslint-disable-next-line */ }, [inclusion.join('|')]);
  useEffect(() => { setExcl(exclusion); /* eslint-disable-next-line */ }, [exclusion.join('|')]);

  async function persist(nextIncl, nextExcl) {
    setSaving(true); setErr(''); setMsg('');
    try {
      await screeningApi.updateProject(pid, {
        inclusionKeywords: JSON.stringify(nextIncl),
        exclusionKeywords: JSON.stringify(nextExcl),
      });
      setMsg('Saved');
      refreshProject?.();
      setTimeout(() => setMsg(''), 1800);
    } catch (e) { setErr(e.message || 'Save failed'); }
    finally { setSaving(false); }
  }

  function addTerm(kind) {
    const raw = (kind === 'incl' ? newIncl : newExcl).trim();
    if (!raw) return;
    const list = kind === 'incl' ? incl : excl;
    if (list.some(t => t.toLowerCase() === raw.toLowerCase())) {
      kind === 'incl' ? setNewIncl('') : setNewExcl('');
      return;
    }
    const next = [...list, raw];
    if (kind === 'incl') { setIncl(next); setNewIncl(''); persist(next, excl); }
    else { setExcl(next); setNewExcl(''); persist(incl, next); }
  }

  function removeTerm(kind, term) {
    if (kind === 'incl') { const next = incl.filter(t => t !== term); setIncl(next); persist(next, excl); }
    else { const next = excl.filter(t => t !== term); setExcl(next); persist(incl, next); }
  }

  async function autoGenerate() {
    const k = extractKeywords({ question: project?.reviewQuestion || '' });
    setIncl(k.inclusion); setExcl(k.exclusion);
    persist(k.inclusion, k.exclusion);
  }

  function resetDefaults() {
    setIncl(DEFAULT_INCLUDE_KEYWORDS); setExcl(DEFAULT_EXCLUDE_KEYWORDS);
    persist(DEFAULT_INCLUDE_KEYWORDS, DEFAULT_EXCLUDE_KEYWORDS);
  }

  const chip = (term, kind) => {
    const tint = kind === 'incl'
      ? { bg: alpha(C.grn, 0.14), bd: alpha(C.grn, 0.5), tx: C.grn }
      : { bg: alpha(C.red, 0.14), bd: alpha(C.red, 0.5), tx: C.red };
    return (
      <span key={kind + term} style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11,
        background: tint.bg, border: `1px solid ${tint.bd}`, color: tint.tx,
        borderRadius: 11, padding: '2px 4px 2px 9px',
      }}>
        {term}
        {isLeader && (
          <button
            onClick={() => removeTerm(kind, term)}
            style={{ background: 'none', border: 'none', color: tint.tx, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 2px', opacity: 0.7 }}
            title="Remove"
          >×</button>
        )}
      </span>
    );
  };

  return (
    <div>
      {/* Inclusion */}
      <div style={{ fontSize: 9.5, fontFamily: MONO, color: C.grn, letterSpacing: '0.1em', marginBottom: 7 }}>INCLUSION (GREEN)</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: isLeader ? 8 : 14 }}>
        {incl.length === 0 && <span style={{ fontSize: 11.5, color: C.muted }}>None.</span>}
        {incl.map(t => chip(t, 'incl'))}
      </div>
      {isLeader && (
        <ChipAdder value={newIncl} setValue={setNewIncl} onAdd={() => addTerm('incl')} placeholder="Add inclusion term…" accent={C.grn} />
      )}

      {/* Exclusion */}
      <div style={{ fontSize: 9.5, fontFamily: MONO, color: C.red, letterSpacing: '0.1em', margin: '14px 0 7px' }}>EXCLUSION (RED)</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: isLeader ? 8 : 14 }}>
        {excl.length === 0 && <span style={{ fontSize: 11.5, color: C.muted }}>None.</span>}
        {excl.map(t => chip(t, 'excl'))}
      </div>
      {isLeader && (
        <ChipAdder value={newExcl} setValue={setNewExcl} onAdd={() => addTerm('excl')} placeholder="Add exclusion term…" accent={C.red} />
      )}

      {/* Auto-generate */}
      {isLeader && (
        <div style={{ marginTop: 14 }}>
          <Button variant="subtle" onClick={resetDefaults} disabled={saving} full style={{ fontSize: 12, marginBottom: 8 }}>
            ↺ Reset to default keywords
          </Button>
          <Button variant="subtle" onClick={autoGenerate} disabled={saving} full style={{ fontSize: 12 }}>
            ✨ Auto-generate from PICO
          </Button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, minHeight: 14 }}>
            {saving && <span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}>Saving…</span>}
            {msg && <span style={{ fontSize: 10.5, color: C.grn, fontFamily: MONO }}>{msg}</span>}
            {err && <span style={{ fontSize: 10.5, color: C.red, fontFamily: MONO }}>{err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function ChipAdder({ value, setValue, onAdd, placeholder, accent }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input
        className="sift-in"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }}
        placeholder={placeholder}
        style={{
          flex: 1, background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 6,
          padding: '6px 10px', color: C.txt, fontSize: 11.5, fontFamily: FONT, outline: 'none', transition: 'border-color 0.15s',
        }}
      />
      <button
        onClick={onAdd}
        disabled={!value.trim()}
        style={{
          background: alpha(accent, '22'), border: `1px solid ${alpha(accent, '55')}`, color: accent,
          fontSize: 11.5, fontFamily: FONT, padding: '6px 12px', borderRadius: 6,
          cursor: value.trim() ? 'pointer' : 'default', opacity: value.trim() ? 1 : 0.4, whiteSpace: 'nowrap',
        }}
      >+ Add</button>
    </div>
  );
}

// ── Generic vocab manager (labels / reasons) ─────────────────────────────────

function VocabManager({ items, setItems, isLeader, getText, getColor, onAdd, onDelete, placeholder, emptyText }) {
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function add() {
    const text = val.trim();
    if (!text) return;
    setBusy(true); setErr('');
    try {
      const created = await onAdd(text);
      setItems(prev => [...prev, created]);
      setVal('');
    } catch (e) { setErr(e.message || 'Could not add'); }
    finally { setBusy(false); }
  }

  async function del(id) {
    setErr('');
    try {
      await onDelete(id);
      setItems(prev => prev.filter(i => i.id !== id));
    } catch (e) { setErr(e.message || 'Could not delete'); }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: isLeader ? 10 : 0 }}>
        {items.length === 0 && <span style={{ fontSize: 11.5, color: C.muted, fontStyle: 'italic' }}>{emptyText}</span>}
        {items.map(it => {
          const col = getColor ? getColor(it) : C.txt2;
          return (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: C.txt, minWidth: 0 }}>
                {getColor && <span style={{ width: 9, height: 9, borderRadius: '50%', background: col, flexShrink: 0 }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getText(it)}</span>
              </span>
              {isLeader && (
                <button
                  onClick={() => del(it.id)}
                  style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, lineHeight: 1, flexShrink: 0 }}
                  title="Delete"
                >×</button>
              )}
            </div>
          );
        })}
      </div>
      {isLeader && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="sift-in"
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder={placeholder}
            style={{
              flex: 1, background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 6,
              padding: '6px 10px', color: C.txt, fontSize: 11.5, fontFamily: FONT, outline: 'none', transition: 'border-color 0.15s',
            }}
          />
          <Button variant="subtle" onClick={add} disabled={busy || !val.trim()} style={{ fontSize: 11, padding: '6px 12px' }}>+ Add</Button>
        </div>
      )}
      {err && <div style={{ fontSize: 11, color: C.red, marginTop: 6 }}>{err}</div>}
    </div>
  );
}
