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
import { useState, useEffect, useCallback, useRef } from 'react';
import { C, FONT, MONO, DECISION_COLORS, DECISION_GLYPH } from '../ui/theme.js';
import { Loading, ErrorBanner, Button, Badge, DecisionChip, Card, SectionLabel, EmptyState, Toggle } from '../ui/components.jsx';
import { renderHighlighted } from '../ui/highlightRender.jsx';
import { extractKeywords } from '../../../research-engine/screening/keywords.js';
import ChatPanel from '../components/ChatPanel.jsx';
import { screeningApi } from '../api-client/screeningApi.js';

const LIMIT = 50;

// Filter options for the left-column selector. `value` is sent as params.filter.
const FILTERS = [
  { value: 'all',         label: 'All records' },
  { value: 'unopened_me', label: 'Unopened (me)' },
  { value: 'opened_me',   label: 'Opened (me)' },
  { value: 'undecided',   label: 'Undecided' },
  { value: 'included',    label: 'Included' },
  { value: 'excluded',    label: 'Excluded' },
  { value: 'maybe',       label: 'Maybe' },
  { value: 'quorum',      label: 'Quorum met' },
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

export default function ScreeningTab({ pid, project, access, refreshProject }) {
  const isLeader = !!access?.isLeader;
  const canScreen = !!access?.canScreen;
  const canChat = !!access?.canChat;
  const blindMode = !!project?.blindMode;

  // Parsed project config (keywords / study-type filter).
  const inclusion = parseList(project?.inclusionKeywords);
  const exclusion = parseList(project?.exclusionKeywords);
  const studyTypes = parseList(project?.studyTypeFilter);

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
    Promise.all([
      screeningApi.listLabels(pid).then(d => d.labels || []).catch(() => []),
      screeningApi.listReasons(pid).then(d => d.reasons || []).catch(() => []),
    ]).then(([ls, rs]) => { setLabels(ls); setReasons(rs); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

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
      setSaveMsg(resp?.promoted ? 'Saved · advanced to Second Review' : 'Saved');
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

  // ── Keyboard shortcuts (ignored while typing in a form control) ──────────
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (k === 'i' && canScreen) { e.preventDefault(); onDecisionClick('include'); }
      else if (k === 'e' && canScreen) { e.preventDefault(); onDecisionClick('exclude'); }
      else if (k === 'm' && canScreen) { e.preventDefault(); onDecisionClick('maybe'); }
      else if (k === 'u' && canScreen) { e.preventDefault(); onUndo(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); moveSelection(-1); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canScreen, decision, excReason, notes, rating, chosenLabels, selectedId]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)', background: C.bg, fontFamily: FONT, color: C.txt, overflow: 'hidden' }}>
      <style>{`
        .sift-rl::-webkit-scrollbar, .sift-mid::-webkit-scrollbar, .sift-rt::-webkit-scrollbar { width: 8px; }
        .sift-rl::-webkit-scrollbar-thumb, .sift-mid::-webkit-scrollbar-thumb, .sift-rt::-webkit-scrollbar-thumb { background: #213452; border-radius: 4px; }
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
      />

      <MiddleColumn
        record={selected} loading={loading}
        blindMode={blindMode} canScreen={canScreen} isLeader={isLeader}
        inclusion={inclusion} exclusion={exclusion}
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
      />

      <RightColumn
        pid={pid} project={project} access={access} refreshProject={refreshProject}
        isLeader={isLeader} canChat={canChat}
        inclusion={inclusion} exclusion={exclusion} studyTypes={studyTypes}
        showInclusion={showInclusion} setShowInclusion={setShowInclusion}
        showExclusion={showExclusion} setShowExclusion={setShowExclusion}
        labels={labels} setLabels={setLabels} reasons={reasons} setReasons={setReasons}
        blindMode={blindMode}
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
}) {
  return (
    <div style={{ width: 300, flexShrink: 0, borderRight: `1px solid ${C.brd}`, display: 'flex', flexDirection: 'column', background: C.surf, overflow: 'hidden' }}>
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
      <div className="sift-rl" style={{ flex: 1, overflowY: 'auto' }}>
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
              <div style={{ padding: '12px 14px', textAlign: 'center' }}>
                <Button variant="ghost" onClick={onLoadMore} disabled={loadingMore} full style={{ fontSize: 12, padding: '7px 14px' }}>
                  {loadingMore ? 'Loading…' : `Load more (${total - records.length})`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Keyboard hint */}
      <div style={{ padding: '8px 14px', borderTop: `1px solid ${C.brd}`, fontSize: 9.5, color: C.muted, fontFamily: MONO, letterSpacing: '0.04em', flexShrink: 0 }}>
        I include · E exclude · M maybe · U undo · ↑↓ move
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
        background: selected ? '#0e1e35' : hover ? '#0a1525' : 'transparent',
        cursor: 'pointer', transition: 'background 0.1s',
      }}
    >
      {/* Title + my decision glyph + opened dot */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span
          title={record.myOpened ? 'Opened' : 'Unopened'}
          style={{
            width: 7, height: 7, borderRadius: '50%', marginTop: 4, flexShrink: 0,
            background: record.myOpened ? C.acc : 'transparent',
            border: `1.5px solid ${record.myOpened ? C.acc : C.muted}`,
          }}
        />
        <div style={{
          flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: selected ? 600 : 500,
          color: selected ? C.txt : C.txt2, lineHeight: 1.35,
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {record.title || <span style={{ fontStyle: 'italic', color: C.muted }}>Untitled record</span>}
        </div>
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
                    background: dc.bg + 'aa',
                    border: rv.isMe ? `1.5px solid ${dc.border}` : `1px solid ${dc.border}55`,
                    boxShadow: rv.isMe ? `0 0 0 1px ${C.surf}` : 'none',
                  }}
                >
                  {DECISION_GLYPH[rv.decision] || '·'}
                </span>
              );
            })}
          </span>
        )}
        {record.quorumMet && <Badge color={C.teal}>Quorum</Badge>}
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
}) {
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
    <div className="sift-mid" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '24px 28px', maxWidth: 860, margin: '0 auto', animation: 'sift-fade 0.25s ease' }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <h2 style={{ fontSize: 17, fontWeight: 700, color: C.txt, lineHeight: 1.42, margin: '0 0 10px', letterSpacing: '-0.01em' }}>
          {record.title || <span style={{ color: C.muted, fontStyle: 'italic' }}>Untitled record</span>}
        </h2>

        {!blindMode && (record.authors || record.journal || record.year) && (
          <div style={{ fontSize: 12.5, color: C.txt2, marginBottom: 10, lineHeight: 1.5 }}>
            {record.authors && <span>{record.authors}</span>}
            {record.journal && <span style={{ fontStyle: 'italic', color: C.muted }}>{record.authors ? ' · ' : ''}{record.journal}</span>}
            {record.year && <span style={{ color: C.muted }}>{(record.authors || record.journal) ? ' · ' : ''}{record.year}</span>}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
          {record.doi && (
            <a href={`https://doi.org/${record.doi}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none' }}>DOI: {record.doi}</a>
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
            <p style={{ fontSize: 14, color: C.txt, lineHeight: 1.75, margin: 0 }}>
              {renderHighlighted(record.abstract, { inclusion, exclusion, showInclusion, showExclusion })}
            </p>
          ) : (
            <p style={{ fontSize: 13.5, color: C.muted, fontStyle: 'italic', margin: 0 }}>No abstract available for this record.</p>
          )}

          {record.keywords && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.brd}` }}>
              <span style={{ fontSize: 9.5, color: C.muted, fontFamily: MONO, alignSelf: 'center', letterSpacing: '0.08em' }}>KEYWORDS</span>
              {record.keywords.split(/[;,]/).map((kw, i) => kw.trim() && (
                <span key={i} style={{ fontSize: 10.5, background: C.brd + '70', border: `1px solid ${C.brd}`, color: C.txt2, borderRadius: 10, padding: '2px 9px' }}>{kw.trim()}</span>
              ))}
            </div>
          )}
        </Card>

        {/* ── PDF attachments ────────────────────────────────────────────── */}
        <PdfRow pid={pid} record={record} canManage={canScreen || isLeader} />

        {/* ── Quorum status ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.txt2 }}>
            <span style={{ fontFamily: MONO, fontWeight: 700, color: record.includeCount >= 2 ? C.grn : C.txt }}>{record.includeCount || 0}</span>
            <span style={{ color: C.muted }}> / 2 reviewers included</span>
          </span>
          {record.quorumMet && <Badge color={C.teal}>Quorum met</Badge>}
          {record.currentStage === 'full_text' && <Badge color={C.grn}>✓ Advanced to Second Review</Badge>}
          {record.disputed && <Badge color={C.gold}>Disputed</Badge>}
        </div>

        {/* ── Decision bar ───────────────────────────────────────────────── */}
        <Card style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <SectionLabel>{canScreen ? 'Your decision' : 'Decision (view-only)'}</SectionLabel>
            {!canScreen && <span style={{ fontSize: 11, color: C.gold }}>You have view-only access</span>}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: decision === 'exclude' ? 16 : 0 }}>
            <DecisionButton label="✓ Include" value="include" active={decision === 'include'} disabled={!canScreen} onClick={() => onDecisionClick('include')} />
            <DecisionButton label="✗ Exclude" value="exclude" active={decision === 'exclude'} disabled={!canScreen} onClick={() => onDecisionClick('exclude')} />
            <DecisionButton label="? Maybe"   value="maybe"   active={decision === 'maybe'}   disabled={!canScreen} onClick={() => onDecisionClick('maybe')} />
            <button
              onClick={onUndo}
              disabled={!canScreen || !decision}
              style={{
                background: 'transparent', border: `1px solid ${C.brd}`, color: C.muted,
                fontSize: 13, fontWeight: 600, fontFamily: FONT, padding: '8px 18px',
                borderRadius: 7, cursor: (!canScreen || !decision) ? 'not-allowed' : 'pointer',
                opacity: (!canScreen || !decision) ? 0.4 : 1, transition: 'all 0.15s',
              }}
            >
              ↩ Undo
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
                      background: active ? col + '2e' : C.brd + '50',
                      border: `1px solid ${active ? col + '90' : C.brd}`,
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

        {/* ── Prev / Next nav ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, paddingBottom: 24 }}>
          <Button variant="ghost" onClick={onPrev} disabled={recordIndex <= 0} style={{ fontSize: 12 }}>← Previous</Button>
          <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
            {recordIndex + 1} / {recordCount}{totalCount > recordCount ? ` (of ${totalCount})` : ''}
          </span>
          <Button variant="ghost" onClick={onNext} disabled={recordIndex >= recordCount - 1} style={{ fontSize: 12 }}>Next →</Button>
        </div>
      </div>
    </div>
  );
}

function DecisionButton({ label, value, active, disabled, onClick }) {
  const [hover, setHover] = useState(false);
  const dc = DECISION_COLORS[value];
  const bg     = active ? dc.bg     : hover && !disabled ? dc.bg + '55' : 'transparent';
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
      }}
    >
      {label}
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

// ── PDF attachments row ──────────────────────────────────────────────────────

function PdfRow({ pid, record, canManage }) {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const data = await screeningApi.listPdf(pid, record.id);
      setAttachments(data.attachments || []);
    } catch (e) { setErr(e.message || 'Could not load attachments'); }
    finally { setLoading(false); }
  }, [pid, record.id]);

  useEffect(() => { load(); }, [load]);

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') { setErr('Only PDF files are accepted.'); return; }
    setUploading(true); setErr('');
    try {
      await screeningApi.uploadPdf(pid, record.id, file);
      await load();
    } catch (e2) { setErr(e2.message || 'Upload failed'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function onRemove(aid) {
    setErr('');
    try {
      await screeningApi.deletePdf(pid, record.id, aid);
      setAttachments(prev => prev.filter(a => a.id !== aid));
    } catch (e) { setErr(e.message || 'Could not remove'); }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minHeight: 24 }}>
      {loading ? (
        <span style={{ fontSize: 11.5, color: C.muted, fontFamily: MONO }}>Checking PDF…</span>
      ) : attachments.length > 0 ? (
        attachments.map(a => (
          <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <a
              href={screeningApi.pdfDownloadUrl(pid, record.id, a.id)}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 12.5, color: C.acc, textDecoration: 'none', fontWeight: 600 }}
            >
              📄 View PDF{a.filename ? ` · ${a.filename}` : ''}
            </a>
            {canManage && (
              <button
                onClick={() => onRemove(a.id)}
                style={{ background: 'none', border: 'none', color: C.muted, fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
              >
                Remove
              </button>
            )}
          </span>
        ))
      ) : canManage ? (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: uploading ? 'default' : 'pointer' }}>
          <span style={{
            fontSize: 12, color: C.txt2, border: `1px dashed ${C.brd2}`, borderRadius: 7,
            padding: '6px 12px', background: C.card,
          }}>
            {uploading ? 'Uploading…' : '⬆ Upload PDF'}
          </span>
          <input ref={fileRef} type="file" accept="application/pdf" onChange={onUpload} disabled={uploading} style={{ display: 'none' }} />
        </label>
      ) : (
        <span style={{ fontSize: 11.5, color: C.muted, fontStyle: 'italic' }}>No PDF attached.</span>
      )}
      {err && <span style={{ fontSize: 11, color: C.red }}>{err}</span>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// RIGHT COLUMN — PICO · keywords · toggles · study types · labels · reasons · chat
// ════════════════════════════════════════════════════════════════════════════

function RightColumn({
  pid, project, access, refreshProject, isLeader, canChat,
  inclusion, exclusion, studyTypes,
  showInclusion, setShowInclusion, showExclusion, setShowExclusion,
  labels, setLabels, reasons, setReasons, blindMode,
}) {
  const [open, setOpen] = useState({
    pico: true, keywords: true, highlights: true,
    studyTypes: false, labels: false, reasons: false, chat: false,
  });
  const toggle = key => setOpen(o => ({ ...o, [key]: !o[key] }));

  return (
    <div className="sift-rt" style={{ width: 320, flexShrink: 0, borderLeft: `1px solid ${C.brd}`, background: C.surf, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
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

      {/* Keywords */}
      <Section title="Highlight keywords" open={open.keywords} onToggle={() => toggle('keywords')}>
        <KeywordEditor
          pid={pid} project={project} refreshProject={refreshProject}
          inclusion={inclusion} exclusion={exclusion} isLeader={isLeader}
        />
      </Section>

      {/* Highlight toggles */}
      <Section title="Highlights" open={open.highlights} onToggle={() => toggle('highlights')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Toggle checked={showInclusion} onChange={setShowInclusion} label="Inclusion (green)" />
          <Toggle checked={showExclusion} onChange={setShowExclusion} label="Exclusion (red)" />
          <button
            onClick={() => { setShowInclusion(false); setShowExclusion(false); }}
            disabled={!showInclusion && !showExclusion}
            style={{
              alignSelf: 'flex-start', background: 'none', border: `1px solid ${C.brd}`, color: C.txt2,
              fontSize: 11.5, fontFamily: FONT, padding: '5px 12px', borderRadius: 6,
              cursor: (!showInclusion && !showExclusion) ? 'default' : 'pointer',
              opacity: (!showInclusion && !showExclusion) ? 0.45 : 1,
            }}
          >
            All highlights off
          </button>
        </div>
      </Section>

      {/* Study type filter */}
      <Section title="Study type filter" open={open.studyTypes} onToggle={() => toggle('studyTypes')}>
        {studyTypes.length === 0 ? (
          <span style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>No study-type filter set.</span>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {studyTypes.map((t, i) => (
              <span key={i} style={{ fontSize: 11.5, background: C.brd + '60', border: `1px solid ${C.brd}`, color: C.txt2, borderRadius: 12, padding: '3px 10px' }}>{t}</span>
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

      {/* Project chat */}
      <Section title="Project chat" open={open.chat} onToggle={() => toggle('chat')} noPad>
        {open.chat && (
          canChat ? (
            <div style={{ height: 420, display: 'flex', flexDirection: 'column' }}>
              <ChatPanel pid={pid} access={access} />
            </div>
          ) : (
            <div style={{ padding: '0 16px 16px', fontSize: 12, color: C.muted, fontStyle: 'italic' }}>
              You do not have chat access in this project.
            </div>
          )
        )}
      </Section>
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

  const chip = (term, kind) => {
    const tint = kind === 'incl'
      ? { bg: 'rgba(74,222,128,0.14)', bd: 'rgba(74,222,128,0.5)', tx: C.grn }
      : { bg: 'rgba(248,113,113,0.14)', bd: 'rgba(248,113,113,0.5)', tx: C.red };
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
          background: accent + '22', border: `1px solid ${accent}55`, color: accent,
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
