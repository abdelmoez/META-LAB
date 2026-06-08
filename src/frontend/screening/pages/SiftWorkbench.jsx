/**
 * SiftWorkbench.jsx — META·SIFT Beta screening workbench
 * Route: /sift-beta/projects/:pid
 *
 * The main title/abstract screening interface.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { screeningApi } from '../api-client/screeningApi.js';

const C = {
  bg:    '#080c15', surf:  '#0c1322', card:  '#101929',
  brd:   '#1a2b42', brd2:  '#213452',
  acc:   '#5b9cf6', acc2:  '#3b7ef4',
  gold:  '#dba96a', teal:  '#2dd4bf',
  txt:   '#ecf0fb', txt2:  '#8b9ec6',
  muted: '#4a5e82',
  grn:   '#4ade80', red:   '#f87171', ylw:   '#fbbf24',
};
const FONT = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', monospace";

const DECISION_COLORS = {
  include:   { bg: '#14532d', border: '#4ade80', txt: '#4ade80' },
  exclude:   { bg: '#450a0a', border: '#f87171', txt: '#f87171' },
  maybe:     { bg: '#451a03', border: '#fbbf24', txt: '#fbbf24' },
  undecided: { bg: '#1a2235', border: '#1a2b42', txt: '#4a5e82' },
};

function BetaBadge() {
  return (
    <span style={{
      fontSize: 9, fontFamily: MONO, fontWeight: 700,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      background: '#2dd4bf18', border: '1px solid #2dd4bf50',
      color: '#2dd4bf', borderRadius: 4, padding: '2px 7px',
    }}>BETA</span>
  );
}

function ProgressBar({ pct, color = C.acc }) {
  return (
    <div style={{ height: 3, background: '#1a2b42', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{
        width: `${Math.min(100, Math.max(0, pct || 0))}%`,
        height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s',
      }} />
    </div>
  );
}

function Spinner({ size = 16 }) {
  return (
    <div style={{
      display: 'inline-block', width: size, height: size,
      border: `2px solid ${C.brd2}`, borderTopColor: C.acc,
      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
      flexShrink: 0,
    }} />
  );
}

function DecisionBadge({ decision }) {
  if (!decision) return <span style={{ fontSize: 10, color: C.muted, fontFamily: MONO }}>—</span>;
  const dc = DECISION_COLORS[decision] || DECISION_COLORS.undecided;
  const labels = { include: '✓', exclude: '✗', maybe: '?', undecided: '·' };
  return (
    <span style={{
      fontSize: 10, fontFamily: MONO, fontWeight: 700,
      color: dc.txt, background: dc.bg + 'cc',
      border: `1px solid ${dc.border}60`,
      borderRadius: 4, padding: '1px 6px',
    }}>{labels[decision] || decision[0].toUpperCase()}</span>
  );
}

function StarRating({ value, onChange }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          onClick={() => onChange(value === n ? 0 : n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 18, lineHeight: 1, padding: '0 1px',
            color: n <= (hover || value) ? C.gold : C.brd2,
            transition: 'color 0.1s',
          }}
        >★</button>
      ))}
    </div>
  );
}

export default function SiftWorkbench() {
  const { pid } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  // Project & stats
  const [project,        setProject]        = useState(null);
  const [stats,          setStats]          = useState({});
  const [labels,         setLabels]         = useState([]);
  const [reasons,        setReasons]        = useState([]);

  // Records list
  const [records,        setRecords]        = useState([]);
  const [recordsTotal,   setRecordsTotal]   = useState(0);
  const [page,           setPage]           = useState(1);
  const [hasMore,        setHasMore]        = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);

  // Selection
  const [selectedId,     setSelectedId]     = useState(null);
  const selectedRecord = records.find(r => r.id === selectedId) || null;

  // Filters
  const [search,         setSearch]         = useState('');
  const [decisionFilter, setDecisionFilter] = useState('');
  const [hasAbstract,    setHasAbstract]    = useState(false);
  const searchRef = useRef('');
  const decisionRef = useRef('');

  // Decision form
  const [decision,       setDecision]       = useState('');
  const [excReason,      setExcReason]      = useState('');
  const [excNote,        setExcNote]        = useState('');
  const [rating,         setRating]         = useState(0);
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [notes,          setNotes]          = useState('');
  const [saving,         setSaving]         = useState(false);
  const [saveMsg,        setSaveMsg]        = useState('');

  // New label / reason
  const [newLabelName,   setNewLabelName]   = useState('');
  const [newReasonText,  setNewReasonText]  = useState('');
  const [addingLabel,    setAddingLabel]    = useState(false);
  const [addingReason,   setAddingReason]   = useState(false);

  // Page load
  const [pageLoading,    setPageLoading]    = useState(true);
  const [pageError,      setPageError]      = useState(null);

  const LIMIT = 50;

  // ── Load project metadata ──────────────────────────────────────────────
  const loadMeta = useCallback(async () => {
    setPageLoading(true);
    setPageError(null);
    try {
      const [proj, statsData, labelsData, reasonsData] = await Promise.all([
        screeningApi.getProject(pid),
        screeningApi.getStats(pid),
        screeningApi.listLabels(pid),
        screeningApi.listReasons(pid),
      ]);
      setProject(proj);
      setStats(statsData || {});
      setLabels(labelsData.labels || []);
      setReasons(reasonsData.reasons || []);
    } catch (e) {
      setPageError(e.message || 'Failed to load project');
    } finally {
      setPageLoading(false);
    }
  }, [pid]);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  // ── Load records ───────────────────────────────────────────────────────
  const loadRecords = useCallback(async (reset = false, searchVal, decisionVal) => {
    const p = reset ? 1 : page;
    const s = searchVal !== undefined ? searchVal : search;
    const d = decisionVal !== undefined ? decisionVal : decisionFilter;
    setLoadingRecords(true);
    try {
      const params = { page: reset ? 1 : p, limit: LIMIT };
      if (s) params.search = s;
      if (d) params.decision = d;
      const data = await screeningApi.listRecords(pid, params);
      const newRecs = data.records || [];
      if (reset) {
        setRecords(newRecs);
        setPage(1);
      } else {
        setRecords(prev => [...prev, ...newRecs]);
      }
      setRecordsTotal(data.total || 0);
      setHasMore((reset ? 1 : p) < (data.pages || 1));
      if (reset && newRecs.length > 0 && !selectedId) {
        setSelectedId(newRecs[0].id);
      }
    } catch (e) {
      // silent – show error inline
    } finally {
      setLoadingRecords(false);
    }
  }, [pid, page, search, decisionFilter, selectedId]);

  useEffect(() => {
    if (!pageLoading) loadRecords(true);
  }, [pageLoading]); // eslint-disable-line

  // ── Populate decision form when selection changes ──────────────────────
  useEffect(() => {
    if (!selectedRecord) return;
    const d = selectedRecord.myDecision;
    setDecision(d?.decision || '');
    setExcReason(d?.exclusionReason || '');
    setNotes(d?.notes || '');
    setExcNote('');
    setRating(d?.rating || 0);
    setSelectedLabels(d?.labels || []);
    setSaveMsg('');
  }, [selectedRecord?.id]); // eslint-disable-line

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); handleDecisionKey('include'); }
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); handleDecisionKey('exclude'); }
      if (e.key === 'm' || e.key === 'M') { e.preventDefault(); handleDecisionKey('maybe'); }
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); moveSelection(-1); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [records, selectedId, decision]); // eslint-disable-line

  function handleDecisionKey(d) {
    if (!selectedId) return;
    setDecision(prev => {
      const next = prev === d ? '' : d;
      saveDecision(selectedId, next);
      return next;
    });
  }

  function moveSelection(dir) {
    const idx = records.findIndex(r => r.id === selectedId);
    const next = records[idx + dir];
    if (next) setSelectedId(next.id);
  }

  // ── Save decision ─────────────────────────────────────────────────────
  async function saveDecision(rid, dec, opts = {}) {
    if (!rid) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const body = {
        decision: dec || 'undecided',
        exclusionReason: opts.excReason !== undefined ? opts.excReason : excReason,
        notes: opts.notes !== undefined ? opts.notes : notes,
        rating: opts.rating !== undefined ? opts.rating : rating,
        labels: opts.labels !== undefined ? opts.labels : selectedLabels,
      };
      await screeningApi.saveDecision(pid, rid, body);
      // Update record in list
      setRecords(prev => prev.map(r =>
        r.id === rid ? { ...r, myDecision: { ...body } } : r
      ));
      setSaveMsg('Saved');
      // Refresh stats
      screeningApi.getStats(pid).then(s => setStats(s || {})).catch(() => {});
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (e) {
      setSaveMsg('Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    await saveDecision(selectedId, decision, { excReason, notes, rating, labels: selectedLabels });
  }

  async function handleDecisionClick(d) {
    const next = decision === d ? '' : d;
    setDecision(next);
    if (next !== 'exclude') setExcReason('');
    await saveDecision(selectedId, next, { excReason: next !== 'exclude' ? '' : excReason, notes, rating, labels: selectedLabels });
  }

  // ── Search / filter ───────────────────────────────────────────────────
  const searchTimer = useRef(null);
  function handleSearchChange(val) {
    setSearch(val);
    searchRef.current = val;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      loadRecords(true, val, decisionRef.current);
    }, 350);
  }

  function handleDecisionFilterChange(val) {
    setDecisionFilter(val);
    decisionRef.current = val;
    loadRecords(true, searchRef.current, val);
  }

  // ── Labels ────────────────────────────────────────────────────────────
  async function handleAddLabel(e) {
    e.preventDefault();
    if (!newLabelName.trim()) return;
    setAddingLabel(true);
    try {
      const data = await screeningApi.createLabel(pid, { name: newLabelName.trim() });
      setLabels(prev => [...prev, data]);
      setNewLabelName('');
    } catch { /* silent */ }
    setAddingLabel(false);
  }

  async function handleDeleteLabel(lid) {
    try {
      await screeningApi.deleteLabel(pid, lid);
      setLabels(prev => prev.filter(l => l.id !== lid));
    } catch { /* silent */ }
  }

  // ── Reasons ───────────────────────────────────────────────────────────
  async function handleAddReason(e) {
    e.preventDefault();
    if (!newReasonText.trim()) return;
    setAddingReason(true);
    try {
      const data = await screeningApi.createReason(pid, { text: newReasonText.trim() });
      setReasons(prev => [...prev, data]);
      setNewReasonText('');
    } catch { /* silent */ }
    setAddingReason(false);
  }

  // ── Load more ─────────────────────────────────────────────────────────
  async function loadMore() {
    const next = page + 1;
    setPage(next);
    setLoadingRecords(true);
    try {
      const params = { page: next, limit: LIMIT };
      if (search) params.search = search;
      if (decisionFilter) params.decision = decisionFilter;
      const data = await screeningApi.listRecords(pid, params);
      setRecords(prev => [...prev, ...(data.records || [])]);
      setHasMore(next < (data.pages || 1));
    } catch { /* silent */ }
    setLoadingRecords(false);
  }

  // ── Toggle label on record ────────────────────────────────────────────
  function toggleLabel(lid) {
    setSelectedLabels(prev =>
      prev.includes(lid) ? prev.filter(x => x !== lid) : [...prev, lid]
    );
  }

  // ── Render ────────────────────────────────────────────────────────────
  if (pageLoading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap'); @keyframes spin { to { transform: rotate(360deg); } } * { box-sizing: border-box; }`}</style>
        <Spinner size={28} />
      </div>
    );
  }

  if (pageError) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, flexDirection: 'column', gap: 12 }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap'); * { box-sizing: border-box; }`}</style>
        <div style={{ color: C.red, fontSize: 14 }}>{pageError}</div>
        <button onClick={() => navigate('/sift-beta')} style={{ background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 13, fontFamily: FONT }}>
          ← Back to Projects
        </button>
      </div>
    );
  }

  const total = stats.total || 0;
  const screened = (stats.included || 0) + (stats.excluded || 0) + (stats.maybe || 0);
  const pct = total > 0 ? Math.round((screened / total) * 100) : 0;

  const navItems = [
    { label: 'Import', path: `/sift-beta/projects/${pid}/import` },
    { label: 'Duplicates', path: `/sift-beta/projects/${pid}/duplicates`, badge: stats.duplicates },
    { label: 'Conflicts', path: `/sift-beta/projects/${pid}/conflicts`, badge: stats.conflicts },
    { label: 'Export', path: `/sift-beta/projects/${pid}/export` },
  ];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.txt, display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1a2b42; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #213452; }
      `}</style>

      {/* ── Sticky Header ─────────────────────────────────────────────── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 200,
        background: C.surf, borderBottom: `1px solid ${C.brd}`,
      }}>
        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 20px', gap: 12 }}>
          <button
            onClick={() => navigate('/sift-beta')}
            style={{ background: 'none', border: 'none', color: C.txt2, cursor: 'pointer', fontSize: 12, fontFamily: FONT, padding: '3px 6px', borderRadius: 5 }}
            onMouseEnter={e => e.currentTarget.style.color = C.txt}
            onMouseLeave={e => e.currentTarget.style.color = C.txt2}
          >
            ← Projects
          </button>
          <span style={{ color: C.brd2 }}>|</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.txt, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {project?.title}
            </span>
            <BetaBadge />
            {project?.blindMode && (
              <span style={{ fontSize: 9, fontFamily: MONO, fontWeight: 600, background: '#dba96a18', border: '1px solid #dba96a40', color: C.gold, borderRadius: 4, padding: '1px 6px', letterSpacing: '0.1em' }}>BLIND</span>
            )}
          </div>

          {/* Stats pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexWrap: 'wrap' }}>
            {[
              { label: 'Total',     val: total,              color: C.txt2 },
              { label: 'Included',  val: stats.included || 0, color: C.grn  },
              { label: 'Excluded',  val: stats.excluded || 0, color: C.red  },
              { label: 'Maybe',     val: stats.maybe || 0,    color: C.ylw  },
              { label: 'Undecided', val: stats.undecided || 0,color: C.muted},
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: s.color, fontFamily: MONO }}>{s.val}</span>
                <span style={{ fontSize: 11, color: C.muted }}>{s.label}</span>
              </div>
            ))}
            {(stats.conflicts || 0) > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.gold, fontFamily: MONO }}>{stats.conflicts}</span>
                <span style={{ fontSize: 11, color: C.muted }}>Conflicts</span>
              </div>
            )}
          </div>

          {/* Nav items */}
          <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
            {navItems.map(item => (
              <button
                key={item.label}
                onClick={() => navigate(item.path)}
                style={{
                  background: 'none', border: `1px solid ${C.brd}`, color: C.txt2,
                  fontSize: 11, fontFamily: FONT, padding: '4px 10px', borderRadius: 5,
                  cursor: 'pointer', position: 'relative', transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.brd2; e.currentTarget.style.color = C.txt; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.brd; e.currentTarget.style.color = C.txt2; }}
              >
                {item.label}
                {item.badge > 0 && (
                  <span style={{
                    position: 'absolute', top: -5, right: -5,
                    background: C.gold, color: '#000', fontSize: 8,
                    fontFamily: MONO, fontWeight: 700, borderRadius: '50%',
                    width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{item.badge}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Progress bar */}
        <ProgressBar pct={pct} color={pct >= 100 ? C.grn : C.acc} />
      </div>

      {/* ── Main content: left panel + right panel ──────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', height: 'calc(100vh - 56px)' }}>

        {/* ── LEFT PANEL ─────────────────────────────────────────────── */}
        <div style={{
          width: '35%', minWidth: 260, maxWidth: 380,
          borderRight: `1px solid ${C.brd}`,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Filter area */}
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.brd}`, flexShrink: 0 }}>
            {/* Search */}
            <input
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search title, author, DOI…"
              style={{
                width: '100%', background: C.card, border: `1px solid ${C.brd2}`,
                borderRadius: 6, padding: '7px 10px', color: C.txt, fontSize: 12,
                fontFamily: FONT, outline: 'none', marginBottom: 10,
              }}
            />

            {/* Decision filter */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {[
                { val: '',          label: 'All records' },
                { val: 'undecided', label: 'Undecided' },
                { val: 'include',   label: 'Included' },
                { val: 'exclude',   label: 'Excluded' },
                { val: 'maybe',     label: 'Maybe' },
              ].map(opt => (
                <label key={opt.val} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', padding: '3px 0' }}>
                  <input
                    type="radio"
                    name="decisionFilter"
                    checked={decisionFilter === opt.val}
                    onChange={() => handleDecisionFilterChange(opt.val)}
                    style={{ accentColor: C.acc, flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 12, color: decisionFilter === opt.val ? C.txt : C.txt2 }}>
                    {opt.label}
                    {opt.val && stats[opt.val === 'undecided' ? 'undecided' : opt.val + 'ed'] !== undefined && (
                      <span style={{ marginLeft: 5, fontSize: 10, color: C.muted, fontFamily: MONO }}>
                        ({stats[opt.val === 'include' ? 'included' : opt.val === 'exclude' ? 'excluded' : opt.val] || 0})
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>

            <div style={{ marginTop: 8, fontSize: 10, color: C.muted, fontFamily: MONO }}>
              {recordsTotal} records
              {(search || decisionFilter) && ' (filtered)'}
            </div>
          </div>

          {/* Record list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingRecords && records.length === 0 ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                <Spinner />
              </div>
            ) : records.length === 0 ? (
              <div style={{ padding: 20, color: C.muted, fontSize: 12, textAlign: 'center' }}>
                {search || decisionFilter ? 'No records match filters' : 'No records. Import references to begin.'}
              </div>
            ) : (
              <>
                {records.map(record => (
                  <RecordListItem
                    key={record.id}
                    record={record}
                    isSelected={record.id === selectedId}
                    onClick={() => setSelectedId(record.id)}
                    blindMode={project?.blindMode}
                  />
                ))}
                {hasMore && (
                  <div style={{ padding: '10px 14px', textAlign: 'center' }}>
                    <button
                      onClick={loadMore}
                      disabled={loadingRecords}
                      style={{
                        background: 'none', border: `1px solid ${C.brd}`, color: C.txt2,
                        fontSize: 11, fontFamily: FONT, padding: '5px 14px', borderRadius: 5,
                        cursor: 'pointer',
                      }}
                    >
                      {loadingRecords ? 'Loading…' : `Load more (${recordsTotal - records.length} remaining)`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Keyboard hint */}
          <div style={{
            padding: '8px 14px', borderTop: `1px solid ${C.brd}`,
            fontSize: 10, color: C.muted, fontFamily: MONO, flexShrink: 0,
          }}>
            I include · E exclude · M maybe · ↑↓ navigate
          </div>
        </div>

        {/* ── RIGHT PANEL ────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {!selectedRecord ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 13 }}>
              Select a record to review
            </div>
          ) : (
            <div style={{ padding: '20px 28px', maxWidth: 860 }}>
              {/* Record header */}
              <div style={{ marginBottom: 20 }}>
                <h2 style={{
                  fontSize: 17, fontWeight: 700, color: C.txt, lineHeight: 1.4,
                  margin: '0 0 8px', letterSpacing: '-0.01em',
                }}>
                  {selectedRecord.title || <span style={{ color: C.muted, fontStyle: 'italic' }}>No title</span>}
                </h2>

                {!project?.blindMode && (
                  <div style={{ fontSize: 12, color: C.txt2, marginBottom: 6, lineHeight: 1.5 }}>
                    {selectedRecord.authors && <span>{selectedRecord.authors}</span>}
                    {selectedRecord.year && <span style={{ marginLeft: 6 }}>· {selectedRecord.year}</span>}
                    {selectedRecord.journal && <span style={{ marginLeft: 6, fontStyle: 'italic', color: C.muted }}>· {selectedRecord.journal}</span>}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  {selectedRecord.doi && (
                    <a
                      href={`https://doi.org/${selectedRecord.doi}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none' }}
                    >
                      DOI: {selectedRecord.doi}
                    </a>
                  )}
                  {selectedRecord.pmid && (
                    <a
                      href={`https://pubmed.ncbi.nlm.nih.gov/${selectedRecord.pmid}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none' }}
                    >
                      PMID: {selectedRecord.pmid}
                    </a>
                  )}
                  {selectedRecord.sourceDb && (
                    <span style={{ fontSize: 10, color: C.muted, fontFamily: MONO }}>{selectedRecord.sourceDb}</span>
                  )}
                  {selectedRecord.isDuplicate && (
                    <span style={{ fontSize: 10, color: C.gold, fontFamily: MONO, background: '#dba96a18', border: '1px solid #dba96a30', borderRadius: 4, padding: '1px 6px' }}>DUPLICATE</span>
                  )}
                </div>
              </div>

              {/* Abstract */}
              <div style={{
                background: C.card, border: `1px solid ${C.brd}`,
                borderRadius: 8, padding: '16px 18px', marginBottom: 20,
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.08em', marginBottom: 10, fontFamily: MONO, textTransform: 'uppercase' }}>
                  Abstract
                </div>
                {selectedRecord.abstract ? (
                  <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.7, margin: 0 }}>
                    {selectedRecord.abstract}
                  </p>
                ) : (
                  <p style={{ fontSize: 13, color: C.muted, fontStyle: 'italic', margin: 0 }}>
                    No abstract available for this record.
                  </p>
                )}
              </div>

              {selectedRecord.keywords && (
                <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontSize: 10, color: C.muted, alignSelf: 'center', fontFamily: MONO, marginRight: 2 }}>KEYWORDS</span>
                  {selectedRecord.keywords.split(/[;,]/).map((kw, i) => (
                    <span key={i} style={{
                      fontSize: 10, background: C.brd + '80', border: `1px solid ${C.brd}`,
                      color: C.txt2, borderRadius: 10, padding: '2px 8px',
                    }}>{kw.trim()}</span>
                  ))}
                </div>
              )}

              {/* Decision section */}
              <div style={{
                background: C.card, border: `1px solid ${C.brd}`,
                borderRadius: 8, padding: '18px 20px',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.08em', marginBottom: 14, fontFamily: MONO, textTransform: 'uppercase' }}>
                  Decision
                </div>

                {/* Decision buttons */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                  {[
                    { val: 'include', label: '✓ Include', hoverBg: '#14532d', hoverBorder: C.grn, hoverTxt: C.grn },
                    { val: 'exclude', label: '✗ Exclude', hoverBg: '#450a0a', hoverBorder: C.red, hoverTxt: C.red },
                    { val: 'maybe',   label: '? Maybe',   hoverBg: '#451a03', hoverBorder: C.ylw, hoverTxt: C.ylw },
                  ].map(btn => {
                    const active = decision === btn.val;
                    const dc = DECISION_COLORS[btn.val];
                    return (
                      <DecisionBtn
                        key={btn.val}
                        label={btn.label}
                        active={active}
                        activeBg={dc.bg}
                        activeBorder={dc.border}
                        activeTxt={dc.txt}
                        hoverBg={btn.hoverBg}
                        hoverBorder={btn.hoverBorder}
                        hoverTxt={btn.hoverTxt}
                        onClick={() => handleDecisionClick(btn.val)}
                      />
                    );
                  })}
                  {decision && (
                    <button
                      onClick={() => handleDecisionClick(decision)}
                      style={{
                        background: 'transparent', border: `1px solid ${C.brd}`,
                        color: C.muted, fontSize: 13, fontFamily: FONT,
                        padding: '8px 16px', borderRadius: 7, cursor: 'pointer',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = C.brd2; e.currentTarget.style.color = C.txt2; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = C.brd; e.currentTarget.style.color = C.muted; }}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Exclusion reason (only when excluded) */}
                {decision === 'exclude' && (
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Exclusion Reason</label>
                    {reasons.length > 0 && (
                      <select
                        value={excReason}
                        onChange={e => setExcReason(e.target.value)}
                        style={selectStyle}
                      >
                        <option value="">— Select predefined reason —</option>
                        {reasons.map(r => (
                          <option key={r.id} value={r.text}>{r.text}</option>
                        ))}
                      </select>
                    )}
                    <input
                      value={excReason}
                      onChange={e => setExcReason(e.target.value)}
                      placeholder="Or type exclusion reason…"
                      style={{ ...inputStyle, marginTop: reasons.length > 0 ? 6 : 0 }}
                    />

                    {/* Quick add reason */}
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <input
                        value={newReasonText}
                        onChange={e => setNewReasonText(e.target.value)}
                        placeholder="Save as predefined reason…"
                        style={{ ...inputStyle, flex: 1, fontSize: 11 }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddReason(e); } }}
                      />
                      <button
                        onClick={handleAddReason}
                        disabled={addingReason || !newReasonText.trim()}
                        style={{ ...smallBtnStyle, opacity: !newReasonText.trim() ? 0.4 : 1 }}
                      >
                        + Save
                      </button>
                    </div>
                  </div>
                )}

                {/* Labels */}
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Labels</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {labels.length === 0 && (
                      <span style={{ fontSize: 11, color: C.muted }}>No labels yet.</span>
                    )}
                    {labels.map(label => {
                      const active = selectedLabels.includes(label.id);
                      return (
                        <button
                          key={label.id}
                          onClick={() => toggleLabel(label.id)}
                          style={{
                            background: active ? (label.color || C.acc) + '30' : C.brd + '60',
                            border: `1px solid ${active ? (label.color || C.acc) + '80' : C.brd}`,
                            color: active ? (label.color || C.acc) : C.txt2,
                            fontSize: 11, fontFamily: FONT,
                            padding: '3px 10px', borderRadius: 12, cursor: 'pointer',
                            transition: 'all 0.15s',
                          }}
                        >
                          {label.name}
                        </button>
                      );
                    })}
                  </div>
                  {/* Add label */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      value={newLabelName}
                      onChange={e => setNewLabelName(e.target.value)}
                      placeholder="New label…"
                      style={{ ...inputStyle, flex: 1, fontSize: 11 }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddLabel(e); } }}
                    />
                    <button
                      onClick={handleAddLabel}
                      disabled={addingLabel || !newLabelName.trim()}
                      style={{ ...smallBtnStyle, opacity: !newLabelName.trim() ? 0.4 : 1 }}
                    >
                      + Add
                    </button>
                  </div>
                </div>

                {/* Notes */}
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Notes</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Optional screening notes…"
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                </div>

                {/* Rating */}
                <div style={{ marginBottom: 18 }}>
                  <label style={labelStyle}>Quality Rating</label>
                  <StarRating value={rating} onChange={r => setRating(r)} />
                </div>

                {/* Save button */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                      background: C.acc2, border: 'none', color: '#fff',
                      fontSize: 13, fontWeight: 600, fontFamily: FONT,
                      padding: '8px 22px', borderRadius: 7, cursor: 'pointer',
                      opacity: saving ? 0.7 : 1, transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!saving) e.currentTarget.style.background = C.acc; }}
                    onMouseLeave={e => { e.currentTarget.style.background = C.acc2; }}
                  >
                    {saving ? 'Saving…' : 'Save Decision'}
                  </button>
                  {saveMsg && (
                    <span style={{
                      fontSize: 11, fontFamily: MONO,
                      color: saveMsg === 'Saved' ? C.grn : C.red,
                    }}>
                      {saveMsg}
                    </span>
                  )}
                </div>
              </div>

              {/* Navigation footer */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, paddingBottom: 20 }}>
                <button
                  onClick={() => moveSelection(-1)}
                  disabled={records.findIndex(r => r.id === selectedId) <= 0}
                  style={{ ...navBtnStyle, opacity: records.findIndex(r => r.id === selectedId) <= 0 ? 0.3 : 1 }}
                >
                  ← Previous
                </button>
                <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO, alignSelf: 'center' }}>
                  {records.findIndex(r => r.id === selectedId) + 1} / {records.length}
                  {recordsTotal > records.length && ` (of ${recordsTotal})`}
                </span>
                <button
                  onClick={() => moveSelection(1)}
                  disabled={records.findIndex(r => r.id === selectedId) >= records.length - 1}
                  style={{ ...navBtnStyle, opacity: records.findIndex(r => r.id === selectedId) >= records.length - 1 ? 0.3 : 1 }}
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function RecordListItem({ record, isSelected, onClick, blindMode }) {
  const d = record.myDecision?.decision || '';
  const dc = DECISION_COLORS[d] || DECISION_COLORS.undecided;

  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 14px',
        background: isSelected ? '#0e1e35' : 'transparent',
        borderLeft: `3px solid ${isSelected ? C.acc : 'transparent'}`,
        borderBottom: `1px solid ${C.brd}`,
        cursor: 'pointer',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#0a1525'; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, justifyContent: 'space-between' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: isSelected ? 600 : 500,
            color: isSelected ? C.txt : C.txt2,
            lineHeight: 1.3, marginBottom: 3,
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {record.title || <span style={{ fontStyle: 'italic', color: C.muted }}>No title</span>}
          </div>
          {!blindMode && (
            <div style={{ fontSize: 10, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[record.authors?.split(',')[0] + (record.authors?.includes(',') ? ' et al.' : ''), record.year].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <span style={{
          fontSize: 10, fontFamily: MONO, fontWeight: 700,
          color: dc.txt, flexShrink: 0, marginTop: 1,
        }}>
          {d === 'include' ? '✓' : d === 'exclude' ? '✗' : d === 'maybe' ? '?' : '·'}
        </span>
      </div>
    </div>
  );
}

function DecisionBtn({ label, active, activeBg, activeBorder, activeTxt, hoverBg, hoverBorder, hoverTxt, onClick }) {
  const [hover, setHover] = useState(false);
  const bg     = active ? activeBg     : hover ? hoverBg     : 'transparent';
  const border = active ? activeBorder : hover ? hoverBorder : C.brd;
  const color  = active ? activeTxt   : hover ? hoverTxt    : C.txt2;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: bg, border: `1px solid ${border}`, color,
        fontSize: 13, fontWeight: 600, fontFamily: FONT,
        padding: '8px 20px', borderRadius: 7, cursor: 'pointer',
        transition: 'all 0.15s', minWidth: 100,
      }}
    >
      {label}
    </button>
  );
}

// Styles
const labelStyle = {
  display: 'block', fontSize: 10, fontWeight: 700, color: C.muted,
  marginBottom: 5, letterSpacing: '0.06em', textTransform: 'uppercase',
  fontFamily: MONO,
};
const inputStyle = {
  width: '100%', background: C.surf, border: `1px solid ${C.brd2}`,
  borderRadius: 6, padding: '7px 10px', color: C.txt, fontSize: 12,
  fontFamily: FONT, outline: 'none',
};
const selectStyle = {
  width: '100%', background: C.surf, border: `1px solid ${C.brd2}`,
  borderRadius: 6, padding: '7px 10px', color: C.txt, fontSize: 12,
  fontFamily: FONT, outline: 'none', marginBottom: 0,
};
const smallBtnStyle = {
  background: C.brd, border: `1px solid ${C.brd2}`, color: C.txt2,
  fontSize: 11, fontFamily: FONT, padding: '5px 12px', borderRadius: 5,
  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
};
const navBtnStyle = {
  background: 'none', border: `1px solid ${C.brd}`, color: C.txt2,
  fontSize: 12, fontFamily: FONT, padding: '6px 14px', borderRadius: 6,
  cursor: 'pointer',
};
