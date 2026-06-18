/**
 * RobWorkspace.jsx — the keyboard-first RoB 2 assessment workspace (rob.md §6).
 *
 * Three regions: context bar (citation + live Overall pill + autosave), domain
 * rail (D1–D5 + Summary stepper with traffic-light dots), and the assessment
 * pane (signalling questions as 5-option segmented controls, expandable guidance,
 * rationale + evidence, a live "Algorithm proposes" panel with the engine's
 * reasons trace, and an Override control requiring a logged justification).
 *
 * The PURE engine (research-engine/rob) is imported directly so reachability +
 * proposals update INSTANTLY as answers change — it is the SAME module the server
 * uses, so there is no drift; the server persists the authoritative copy on each
 * debounced autosave.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import Icon from '../components/icons.jsx';
import { robApi, getRobSettings } from './robApi.js';
import { judgmentStyle, JUDGMENT_LEGEND } from './judgmentStyle.js';
import RobTrafficLight from './RobTrafficLight.jsx';
import RobPdfPanel from './RobPdfPanel.jsx';
import { screeningApi } from '../screening/api-client/screeningApi.js';
import {
  ROB2, isReachable, proposeDomain, proposeOverall, completeness,
} from '../../research-engine/rob/index.js';

const RESPONSE_KEYS = ['Y', 'PY', 'PN', 'N', 'NI'];
const KEY_TO_RESPONSE = { 1: 'Y', 2: 'PY', 3: 'PN', 4: 'N', 5: 'NI' };
// prompt30 Part 4 — full RoB 2 answer wording shown in the UI; the short codes
// (Y/PY/PN/N/NI) remain the stored/scoring values and are shown as a subtle hint.
const RESPONSE_LABELS = { Y: 'Yes', PY: 'Probably yes', PN: 'Probably no', N: 'No', NI: 'No information' };
const DOMAIN_IDS = ROB2.domains.map(d => d.id);

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  });
  useEffect(() => {
    let mq; try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { return undefined; }
    const fn = e => setReduced(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', fn); else if (mq.addListener) mq.addListener(fn);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', fn); else if (mq.removeListener) mq.removeListener(fn); };
  }, []);
  return reduced;
}

// prompt32 Task 4 — below this width the two-column workspace stacks to one column
// (the assessment then sits under the PDF/article) so neither pane is squeezed.
const STACK_BELOW = 900;
function useViewportNarrow(breakpoint = STACK_BELOW) {
  const [narrow, setNarrow] = useState(() => {
    try { return window.innerWidth < breakpoint; } catch { return false; }
  });
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { try { setNarrow(window.innerWidth < breakpoint); } catch { /* ignore */ } });
    };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [breakpoint]);
  return narrow;
}

const ROB_SETTINGS_FALLBACK = { showPdfPanel: true, showArticleInfoTab: true, defaultLeftTab: 'pdf', compactAssessmentCards: false };

// ── Small presentational pieces ───────────────────────────────────────────────
function JudgmentPill({ judgment, size = 'md', provisional }) {
  const st = judgmentStyle(judgment);
  const pad = size === 'lg' ? '6px 14px' : size === 'sm' ? '2px 8px' : '4px 11px';
  const fs = size === 'lg' ? 14 : size === 'sm' ? 11 : 12.5;
  return (
    <span role="status" aria-label={`Risk of bias: ${st.label}${provisional ? ' (provisional)' : ''}`} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: pad, borderRadius: 20,
      background: st.bg, color: st.fg, border: `1px solid ${alpha(st.hex, 0.5)}`, fontSize: fs, fontWeight: 700, fontFamily: FONT, whiteSpace: 'nowrap',
    }}>
      <Icon name={st.icon} size={fs + 2} />
      <span>{st.label}{provisional ? ' · provisional' : ''}</span>
    </span>
  );
}

function TrafficDot({ judgment, size = 13 }) {
  const st = judgmentStyle(judgment);
  return <span title={st.label} style={{ display: 'inline-flex', width: size, height: size, borderRadius: '50%', background: st.hex, flexShrink: 0 }} />;
}

function SegmentedControl({ qid, value, onChange }) {
  return (
    <div role="radiogroup" aria-label={`Response for question ${qid}`} style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {RESPONSE_KEYS.map((r, i) => {
        const on = value === r;
        return (
          <button key={r} role="radio" aria-checked={on} aria-label={RESPONSE_LABELS[r]} onClick={() => onChange(on ? '' : r)} title={`${RESPONSE_LABELS[r]} (${r} · press ${i + 1})`} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 600,
            background: on ? C.acc : C.surf, color: on ? C.accText : C.txt2,
            border: `1px solid ${on ? C.acc : C.brd2}`, transition: 'background 0.12s, border-color 0.12s', whiteSpace: 'nowrap',
          }}>
            {RESPONSE_LABELS[r]}
            <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, opacity: on ? 0.85 : 0.5 }}>{r}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Workspace ─────────────────────────────────────────────────────────────────
export default function RobWorkspace({ assessmentId, onClose, onChanged, readOnly = false }) {
  const [view, setView] = useState(null);       // server assessment view
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [active, setActive] = useState('D1');    // 'D1'..'D5' | 'summary'
  const [answers, setAnswers] = useState({});    // { domainId: { qid: response } } (optimistic)
  const [meta, setMeta] = useState({});          // { qid: { rationale, evidenceQuote } }
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [focusedQ, setFocusedQ] = useState(null);
  const [guidanceOpen, setGuidanceOpen] = useState({});
  const [override, setOverride] = useState(null); // { target, domainId, current }
  const [showGuide, setShowGuide] = useState(false);
  // prompt30 Part 3 — the assessment opens as a two-section split: PDF (left) +
  // RoB questions (right). The PDF panel can be collapsed for more answering room.
  const [showPdf, setShowPdf] = useState(true);
  // prompt32 Task 2 — the left column now has two tabs (Study PDF / Article
  // Information) over a persistent article header. RobWorkspace owns the single
  // study-record fetch so BOTH the header/article tab and the PDF tab share it
  // even when the PDF tab is admin-hidden. robSettings tunes which tabs appear +
  // the initial tab; `leftTab` is set once settings arrive.
  const [studyRecord, setStudyRecord] = useState({ loading: true, error: '', record: null, screenProjectId: null, recordId: null });
  const [leftTab, setLeftTab] = useState('pdf');     // 'pdf' | 'article'
  const [robSettings, setRobSettings] = useState(ROB_SETTINGS_FALLBACK);
  const reduced = usePrefersReducedMotion();
  const narrow = useViewportNarrow();
  const saveTimer = useRef(null);
  const savedTimer = useRef(null);
  const pending = useRef({ answers: {}, meta: {} });
  const answersRef = useRef({});
  answersRef.current = answers;        // always-fresh mirror so flush() never reads a stale closure
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await robApi.getAssessment(assessmentId);
      const a = res.assessment;
      setView(a);
      setAnswers(JSON.parse(JSON.stringify(a.answersByDomain || {})));
      const m = {};
      for (const x of (a.answerMeta || [])) m[x.questionId] = { rationale: x.rationale || '', evidenceQuote: x.evidenceQuote || '' };
      setMeta(m);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [assessmentId]);

  useEffect(() => { load(); }, [load]);

  // prompt32 Task 2 — read the admin RoB presentation settings once, then honour
  // the configured default tab. If the PDF tab is hidden, open Article instead
  // (and vice-versa); falls back to safe defaults if the fetch fails.
  useEffect(() => {
    let alive = true;
    getRobSettings().then(s => {
      if (!alive) return;
      setRobSettings(s);
      const pdfOk = s.showPdfPanel !== false;
      const artOk = s.showArticleInfoTab !== false;
      let initial = s.defaultLeftTab === 'article' ? 'article' : 'pdf';
      if (initial === 'pdf' && !pdfOk) initial = 'article';
      if (initial === 'article' && !artOk) initial = 'pdf';
      setLeftTab(initial);
    }).catch(() => { /* fallback already set */ });
    return () => { alive = false; };
  }, []);

  // prompt32 Task 2 — single study-record resolution (one network call). Runs once
  // the assessment is loaded (it needs view.projectId + view.studyId). The result
  // drives the persistent article header, the Article Information tab, and the PDF
  // panel (screenProjectId/recordId). `record` is null for manual, non-handoff
  // studies. Exposed via resolveStudyRecord for the PDF panel's Retry button.
  const studyKey = view ? `${view.projectId}::${view.studyId}` : null;
  const resolveStudyRecord = useCallback(async () => {
    if (!view) return;
    setStudyRecord(s => ({ ...s, loading: true, error: '' }));
    try {
      const r = await screeningApi.metalabStudyRecord(view.projectId, view.studyId);
      setStudyRecord({ loading: false, error: '', record: r.record || null, screenProjectId: r.screenProjectId || null, recordId: r.recordId || null });
    } catch (e) {
      setStudyRecord({ loading: false, error: e?.message || 'Could not load the study PDF.', record: null, screenProjectId: null, recordId: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyKey]);
  useEffect(() => { resolveStudyRecord(); }, [resolveStudyRecord]);

  // ── Live (client-side) reachability + proposals from the SAME engine module ──
  const liveProposals = useMemo(() => {
    const out = {};
    for (const d of ROB2.domains) out[d.id] = proposeDomain(ROB2, d.id, answers[d.id] || {});
    return out;
  }, [answers]);
  const liveOverall = useMemo(() => {
    const resolved = {};
    for (const d of ROB2.domains) {
      const dv = (view?.domains || []).find(x => x.domainId === d.id);
      resolved[d.id] = (dv && dv.overridden && dv.finalJudgment) ? dv.finalJudgment : liveProposals[d.id].judgment;
    }
    return proposeOverall(ROB2, resolved);
  }, [liveProposals, view]);
  const liveCompleteness = useMemo(() => completeness(ROB2, { answersByDomain: answers }), [answers]);

  const overriddenByDomain = useMemo(() => {
    const m = {};
    for (const dv of (view?.domains || [])) if (dv.overridden && dv.finalJudgment) m[dv.domainId] = dv.finalJudgment;
    return m;
  }, [view]);
  const resolvedDomain = (domainId) => overriddenByDomain[domainId] || liveProposals[domainId]?.judgment || 'na';
  const domainComplete = (domainId) => (liveCompleteness.perDomain[domainId]?.missing.length || 0) === 0;
  // Dot/cell judgement for the rail, summary list and traffic-light plot: a genuine
  // override always shows; otherwise the proposed judgement is shown ONLY once the
  // domain is complete, so a half-answered domain never displays a misleading
  // favourable colour (it shows neutral "na" until its required questions are answered).
  const dotJudgment = (domainId) => overriddenByDomain[domainId] || (domainComplete(domainId) ? (liveProposals[domainId]?.judgment || 'na') : 'na');
  const finalised = view?.status === 'complete';
  // A view-only viewer (e.g. a read-only/shared project, or insufficient
  // permission) can navigate + read everything but cannot change anything.
  const editable = !finalised && !readOnly;

  // ── Autosave (debounced) ──────────────────────────────────────────────────
  const flush = useCallback(async () => {
    const batch = pending.current;
    const qids = new Set([...Object.keys(batch.answers), ...Object.keys(batch.meta)]);
    if (!qids.size) return;
    pending.current = { answers: {}, meta: {} };
    const items = [];
    for (const qid of qids) {
      const domainId = ROB2.domains.find(d => d.questions.some(q => q.id === qid))?.id;
      // Meta-only (rationale/evidence) edits must NOT wipe the saved answer: read
      // the CURRENT response from answersRef (always fresh — never a stale closure);
      // default to 'NA' only when the question is genuinely unanswered.
      const response = batch.answers[qid] !== undefined
        ? batch.answers[qid]
        : ((answersRef.current[domainId] || {})[qid] || '');
      const item = { questionId: qid, response: response || 'NA' };
      const mm = batch.meta[qid];
      if (mm) { item.rationale = mm.rationale ?? ''; item.evidenceQuote = mm.evidenceQuote ?? ''; }
      items.push(item);
    }
    if (mounted.current) setSaveState('saving');
    try {
      const res = await robApi.saveAnswers(assessmentId, items);
      if (mounted.current) {
        setView(res.assessment);
        setSaveState('saved');
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1600);
      }
      onChanged && onChanged();
    } catch (e) {
      // Re-queue the un-saved batch (newer edits win) so the next change retries it
      // instead of silently dropping the failed edits.
      pending.current.answers = { ...batch.answers, ...pending.current.answers };
      pending.current.meta = { ...batch.meta, ...pending.current.meta };
      if (mounted.current) { setSaveState('error'); setError(e.message); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId, onChanged]);

  function queueSave() {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 450);
  }
  // On unmount: stop timers and fire a best-effort final flush so the last edits
  // made within the debounce window are persisted (not silently dropped).
  useEffect(() => () => {
    clearTimeout(saveTimer.current); clearTimeout(savedTimer.current);
    mounted.current = false;
    flush();
  }, [flush]);
  function setAnswer(domainId, qid, response) {
    setAnswers(prev => ({ ...prev, [domainId]: { ...(prev[domainId] || {}), [qid]: response } }));
    pending.current.answers[qid] = response;
    queueSave();
  }
  function setQMeta(qid, patch) {
    setMeta(prev => ({ ...prev, [qid]: { ...(prev[qid] || {}), ...patch } }));
    pending.current.meta[qid] = { ...(meta[qid] || {}), ...patch };
    queueSave();
  }

  // ── Keyboard shortcuts (1–5 answer · n/p question · [ ] domain · o · ?) ─────
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (override) return; // the override modal owns the keyboard while open
      if (active === 'summary') {
        if (e.key === '[' || e.key === 'p') { setActive('D5'); e.preventDefault(); }
        if (e.key === '?') { setShowGuide(g => !g); e.preventDefault(); }
        return;
      }
      const di = DOMAIN_IDS.indexOf(active);
      const reachable = ROB2.domains[di].questions.filter(q => isReachable(q, answers[active] || {}));
      const fi = reachable.findIndex(q => q.id === focusedQ);
      if (e.key >= '1' && e.key <= '5' && focusedQ && editable) {
        // Only answer when the focused question actually belongs to (and is reachable
        // in) the active domain — guards against a stale focusedQ after a domain switch.
        // `editable` also blocks the read-only/finalised number-key bypass.
        if (reachable.some(q => q.id === focusedQ)) setAnswer(active, focusedQ, KEY_TO_RESPONSE[e.key]);
        e.preventDefault();
      } else if (e.key === 'n') {
        const next = reachable[Math.min(reachable.length - 1, (fi < 0 ? 0 : fi + 1))]; if (next) setFocusedQ(next.id); e.preventDefault();
      } else if (e.key === 'p') {
        const prev = reachable[Math.max(0, (fi < 0 ? 0 : fi - 1))]; if (prev) setFocusedQ(prev.id); e.preventDefault();
      } else if (e.key === ']') {
        setActive(di < DOMAIN_IDS.length - 1 ? DOMAIN_IDS[di + 1] : 'summary'); setFocusedQ(null); e.preventDefault();
      } else if (e.key === '[') {
        if (di > 0) { setActive(DOMAIN_IDS[di - 1]); setFocusedQ(null); } e.preventDefault();
      } else if (e.key === 'o' && editable) {
        setOverride({ target: 'domain', domainId: active, current: resolvedDomain(active) }); e.preventDefault();
      } else if (e.key === '?') {
        if (focusedQ) setGuidanceOpen(g => ({ ...g, [focusedQ]: !g[focusedQ] })); else setShowGuide(s => !s); e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focusedQ, answers, finalised, override]);

  async function doOverride({ finalJudgment, justification, clear }) {
    try {
      const body = override.target === 'domain'
        ? { target: 'domain', domainId: override.domainId, finalJudgment, justification, clear }
        : { target: 'overall', finalJudgment, justification, clear };
      const res = await robApi.override(assessmentId, body);
      setView(res.assessment); setOverride(null); onChanged && onChanged();
    } catch (e) { setError(e.message); }
  }
  async function doFinalise() {
    try { const res = await robApi.finalise(assessmentId); setView(res.assessment); onChanged && onChanged(); }
    catch (e) { setError(e.message); }
  }
  async function doReopen() {
    try { const res = await robApi.reopen(assessmentId); setView(res.assessment); onChanged && onChanged(); }
    catch (e) { setError(e.message); }
  }
  async function exportAs(format) {
    try {
      const res = await robApi.exportAssessment(assessmentId, format);
      if (res?.content == null) { setError('Export returned no content'); return; }
      const content = typeof res.content === 'string' ? res.content : JSON.stringify(res.content, null, 2);
      const blob = new Blob([content], { type: res.mime || 'text/plain' });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a'); a.href = url; a.download = res.filename || `rob2.${format}`;
        document.body.appendChild(a); a.click(); a.remove();
      } finally { URL.revokeObjectURL(url); }
    } catch (e) { setError(e.message); }
  }

  if (loading) return <div style={shell}><div style={{ padding: 60, textAlign: 'center', color: C.muted, fontFamily: FONT }}>Loading assessment…</div></div>;
  if (error && !view) return <div style={shell}><div style={{ padding: 40 }}><ErrorBox msg={error} /><button onClick={onClose} style={ghostBtn}>Back</button></div></div>;
  if (!view) return null;

  const allComplete = liveCompleteness.overall.complete;
  const summaryOverall = (allComplete || view.overall.overridden) ? (finalised ? view.overall.resolvedOverall : liveOverall.judgment) : 'na';
  const single = { domains: ROB2.domains.map(d => ({ id: d.id, shortLabel: d.shortLabel })), rows: [{ id: view.id, label: view.resultLabel || view.studyId, cells: ROB2.domains.map(d => ({ domainId: d.id, judgment: dotJudgment(d.id) })), overall: summaryOverall }] };

  // prompt32 Task 2 — which left-pane tabs are available (admin-tunable). The
  // "source" toggle (showPdf) collapses the WHOLE left column so the assessment
  // can use the full width — same intent as the old PDF toggle.
  const pdfTabOn = robSettings.showPdfPanel !== false;
  const articleTabOn = robSettings.showArticleInfoTab !== false;
  const hasLeftColumn = showPdf && (pdfTabOn || articleTabOn);
  // Keep the active tab valid if settings hid the currently-selected one.
  const effectiveLeftTab = (leftTab === 'pdf' && !pdfTabOn) ? 'article'
    : (leftTab === 'article' && !articleTabOn) ? 'pdf'
    : leftTab;
  // The PDF should fill the column down to the workspace bottom (Task 4); the
  // header row + panel chrome consume a fixed slice, so subtract it from the vh.
  const pdfPreviewHeight = 'calc(100vh - 260px)';

  return (
    <div style={{ paddingInline: 'clamp(24px, 6vw, 96px)' }}>
    {/* ── Task 3 — study-workspace header ABOVE both columns. The labelled Back
        button works after refresh / deep-link because onClose owns the routing. ── */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 0 16px', flexWrap: 'wrap' }}>
      <button onClick={onClose} style={{ ...ghostBtn, fontWeight: 700, color: C.txt }} aria-label="Back to Risk of Bias">
        <Icon name="arrowLeft" size={15} /> Back to Risk of Bias
      </button>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 7, background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '38')}`, color: C.acc, fontSize: 11, fontFamily: MONO, fontWeight: 700 }}>
        <Icon name="scale" size={13} /> RoB 2
      </span>
      <div style={{ flex: 1 }} />
      {(pdfTabOn || articleTabOn) && (
        <button onClick={() => setShowPdf(p => !p)} aria-pressed={showPdf}
          style={{ ...ghostBtn, padding: '6px 11px', background: showPdf ? alpha(C.acc, '14') : 'transparent', color: showPdf ? C.acc : C.txt2, borderColor: showPdf ? alpha(C.acc, '50') : C.brd2 }}>
          <Icon name="fileText" size={14} /> {showPdf ? 'Hide source' : 'Show source'}
        </button>
      )}
    </div>

    {/* ── Task 4 — two-column grid: left source pane fills, right assessment is a
        clamped width pinned to the right boundary. Stacks under STACK_BELOW. ── */}
    <div style={{
      display: 'grid',
      gridTemplateColumns: (hasLeftColumn && !narrow) ? 'minmax(0, 1fr) clamp(380px, 32vw, 560px)' : '1fr',
      gap: 16, alignItems: 'stretch',
    }}>
    {/* ── Left section: source (PDF tab + Article Information tab) over a
        persistent article header (Task 2). Omitted entirely with no record. ── */}
    {hasLeftColumn && (
      <aside style={{ display: 'flex', flexDirection: 'column', minWidth: 0, ...(narrow ? {} : { position: 'sticky', top: 0, alignSelf: 'start' }) }}>
        <ArticleHeader record={studyRecord.record} fallbackLabel={view.resultLabel || `Study ${view.studyId}`} studyId={view.studyId} outcomeId={view.outcomeId} />
        <div role="tablist" aria-label="Study source" style={{ display: 'flex', gap: 6, margin: '12px 0 10px' }}>
          {pdfTabOn && <SourceTab on={effectiveLeftTab === 'pdf'} icon="fileText" label="Study PDF" onClick={() => setLeftTab('pdf')} />}
          {articleTabOn && <SourceTab on={effectiveLeftTab === 'article'} icon="info" label="Article Information" onClick={() => setLeftTab('article')} />}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          {effectiveLeftTab === 'pdf' && pdfTabOn ? (
            <RobPdfPanel loading={studyRecord.loading} error={studyRecord.error} screenProjectId={studyRecord.screenProjectId} recordId={studyRecord.recordId}
              canManage={editable} onRetry={resolveStudyRecord} previewHeight={pdfPreviewHeight} showHeader={false} />
          ) : (
            <ArticleInfoPane record={studyRecord.record} loading={studyRecord.loading} fallbackLabel={view.resultLabel || `Study ${view.studyId}`} />
          )}
        </div>
      </aside>
    )}
    {/* ── Right section: the RoB assessment, a clamped column pinned right (Task 4) ── */}
    <div style={{ ...shell, minWidth: 0 }}>
      {/* ── Context bar ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px', borderBottom: `1px solid ${C.brd}`, background: C.card, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.txt, fontFamily: FONT }}>{view.resultLabel || 'Risk-of-bias assessment'}</div>
          <div style={{ fontSize: 12, color: C.muted, fontFamily: MONO, marginTop: 2 }}>Study {view.studyId}{view.outcomeId ? ` · ${view.outcomeId}` : ''}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Overall</span>
          <JudgmentPill judgment={finalised ? view.overall.resolvedOverall : liveOverall.judgment} size="md" provisional={!liveCompleteness.overall.complete && !finalised} />
        </div>
        <span aria-live="polite" style={{ fontSize: 11, fontFamily: MONO, color: saveState === 'error' ? C.red : C.muted, minWidth: 64 }}>
          {readOnly ? 'view only' : finalised ? 'finalised' : saveState === 'saving' ? 'saving…' : saveState === 'saved' ? '✓ saved' : saveState === 'error' ? 'save failed' : 'autosaves'}
        </span>
      </div>

      {error && <div style={{ padding: '8px 20px 0' }}><ErrorBox msg={error} /></div>}

      <div style={{ display: 'grid', gridTemplateColumns: '232px minmax(0, 1fr)', gap: 0, alignItems: 'stretch' }}>
        {/* ── Domain rail ───────────────────────────────────────────────── */}
        <nav aria-label="RoB domains" style={{ borderRight: `1px solid ${C.brd}`, padding: '14px 10px', background: C.surf }}>
          {ROB2.domains.map((d, i) => {
            const comp = liveCompleteness.perDomain[d.id];
            const on = active === d.id;
            return (
              <button key={d.id} onClick={() => { setActive(d.id); setFocusedQ(null); }} aria-current={on} style={railItem(on)}>
                <TrafficDot judgment={dotJudgment(d.id)} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: on ? 700 : 600, color: on ? C.txt : C.txt2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.id} · {d.shortLabel}</span>
                  <span style={{ display: 'block', fontSize: 10, fontFamily: MONO, color: comp.missing.length ? C.yel : C.grn, marginTop: 1 }}>{comp.missing.length ? `${comp.answered}/${comp.required}` : 'complete'}</span>
                </span>
                {overriddenByDomain[d.id] && <Icon name="pencil" size={11} title="Overridden" />}
              </button>
            );
          })}
          <button onClick={() => setActive('summary')} aria-current={active === 'summary'} style={{ ...railItem(active === 'summary'), marginTop: 8, borderTop: `1px solid ${C.brd}`, borderRadius: 0, paddingTop: 14 }}>
            <Icon name="barChart" size={14} />
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: active === 'summary' ? C.txt : C.txt2 }}>Summary</span>
          </button>
          <div style={{ marginTop: 14, padding: '0 6px' }}>
            <div style={{ fontSize: 9, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Legend</div>
            {JUDGMENT_LEGEND.map(l => (
              <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: l.hex }} />
                <Icon name={l.icon} size={12} />
                <span style={{ fontSize: 10.5, color: C.txt2 }}>{l.label}</span>
              </div>
            ))}
            <div style={{ fontSize: 9.5, fontFamily: MONO, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>1–5 answer · n/p question · [ ] domain · o override · ? guidance</div>
          </div>
        </nav>

        {/* ── Assessment pane / Summary ─────────────────────────────────── */}
        <main style={{ padding: '20px 24px', minHeight: 420 }}>
          {active === 'summary' ? (
            <SummaryStep view={view} live={{ proposals: liveProposals, overall: liveOverall, completeness: liveCompleteness, resolvedDomain: dotJudgment }}
              saving={saveState === 'saving'} single={single} finalised={finalised} editable={editable} readOnly={readOnly} onFinalise={doFinalise} onReopen={doReopen} onExport={exportAs}
              onOverrideOverall={() => setOverride({ target: 'overall', current: view.overall.resolvedOverall })} onJump={setActive} />
          ) : (
            <DomainPane
              domain={ROB2.domains[DOMAIN_IDS.indexOf(active)]}
              answers={answers[active] || {}}
              meta={meta}
              proposal={liveProposals[active]}
              resolved={resolvedDomain(active)}
              overrideInfo={(view.domains || []).find(x => x.domainId === active)}
              focusedQ={focusedQ} setFocusedQ={setFocusedQ}
              guidanceOpen={guidanceOpen} setGuidanceOpen={setGuidanceOpen}
              reduced={reduced} finalised={finalised} editable={editable}
              onAnswer={(qid, r) => setAnswer(active, qid, r)}
              onMeta={setQMeta}
              onOverride={() => setOverride({ target: 'domain', domainId: active, current: resolvedDomain(active) })}
            />
          )}

          {/* prompt29 Part 1 — explicit Previous / Next section navigation. The
              domain rail + keyboard ([ ]) still work; this makes stepping through
              domains obvious. Answers autosave, so navigating never loses them.
              Moving on from an incomplete domain is allowed (its status is shown). */}
          <SectionNav active={active} setActive={setActive} setFocusedQ={setFocusedQ} domainComplete={domainComplete} />
        </main>
      </div>
    </div>
    </div>

    {override && (
      <OverrideModal info={override} onCancel={() => setOverride(null)} onSubmit={doOverride} />
    )}
    </div>
  );
}

// ── Section navigation (Previous / Next across domains → Summary) ───────────────
function SectionNav({ active, setActive, setFocusedQ, domainComplete }) {
  const go = (target) => { setActive(target); setFocusedQ(null); };
  if (active === 'summary') {
    return (
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.brd}`, display: 'flex' }}>
        <button onClick={() => go('D5')} style={ghostBtn}><Icon name="arrowLeft" size={14} /> Back to {ROB2.domains[DOMAIN_IDS.length - 1].id}</button>
      </div>
    );
  }
  const di = DOMAIN_IDS.indexOf(active);
  const prev = di > 0 ? DOMAIN_IDS[di - 1] : null;
  const isLast = di >= DOMAIN_IDS.length - 1;
  const next = isLast ? 'summary' : DOMAIN_IDS[di + 1];
  const nextLabel = isLast ? 'Summary' : `${next} · ${ROB2.domains[di + 1].shortLabel}`;
  const incomplete = !domainComplete(active);
  return (
    <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <button onClick={() => prev && go(prev)} disabled={!prev} style={{ ...ghostBtn, opacity: prev ? 1 : 0.45, cursor: prev ? 'pointer' : 'not-allowed' }}>
        <Icon name="arrowLeft" size={14} /> Previous
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {incomplete && (
          <span style={{ fontSize: 11.5, color: C.yel, display: 'inline-flex', alignItems: 'center', gap: 5 }} title="You can continue; some signalling questions in this domain are still unanswered.">
            <Icon name="alertTriangle" size={13} /> Domain incomplete
          </span>
        )}
        <button onClick={() => go(next)} style={primaryBtn(false)}>
          Next: {nextLabel} <Icon name="arrowRight" size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Left-pane source: persistent article header + tabs + article info ──────────
// (prompt32 Task 2). The header never changes when switching tabs; the Article
// Information pane mirrors Final Review's article display (title, meta, badges,
// abstract, keywords, decision) using plain text (no PICO highlighting).

function RobBadge({ children, color = C.txt2 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 10, fontSize: 10.5, fontWeight: 700, fontFamily: FONT, color, background: alpha(color, '14'), border: `1px solid ${alpha(color, '40')}`, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

// Compact, always-visible header at the top of the left column.
function ArticleHeader({ record, fallbackLabel, studyId, outcomeId }) {
  const title = record?.title || fallbackLabel || 'Study';
  const authors = record?.authors;
  const journal = record?.journal;
  const year = record?.year;
  const hasMeta = authors || journal || year;
  return (
    <div style={{ padding: '14px 16px', border: `1px solid ${C.brd}`, borderRadius: 12, background: C.card }}>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: C.txt, fontFamily: FONT, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{title}</div>
      {hasMeta ? (
        <div style={{ fontSize: 12, color: C.txt2, marginTop: 5, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
          {authors && <span>{authors}</span>}
          {journal && <span style={{ fontStyle: 'italic', color: C.muted }}>{authors ? ' · ' : ''}{journal}</span>}
          {year && <span style={{ color: C.muted }}>{(authors || journal) ? ' · ' : ''}{year}</span>}
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: C.muted, fontFamily: MONO, marginTop: 5 }}>Study {studyId}{outcomeId ? ` · ${outcomeId}` : ''}</div>
      )}
      {(record?.doi || record?.pmid) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
          {record.doi && <a href={`https://doi.org/${record.doi}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none', overflowWrap: 'anywhere', wordBreak: 'break-all' }}>DOI: {record.doi}</a>}
          {record.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${record.pmid}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none' }}>PMID: {record.pmid}</a>}
        </div>
      )}
    </div>
  );
}

function SourceTab({ on, icon, label, onClick }) {
  return (
    <button role="tab" aria-selected={on} onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 9, cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 700,
      background: on ? alpha(C.acc, '14') : C.surf, color: on ? C.acc : C.txt2,
      border: `1px solid ${on ? alpha(C.acc, '50') : C.brd2}`, transition: 'background 0.12s, border-color 0.12s',
    }}>
      <Icon name={icon} size={14} /> {label}
    </button>
  );
}

// Mirrors Final Review's article display. Blind mode does not apply here (the
// study is already accepted), so the full metadata is shown.
function ArticleInfoPane({ record, loading, fallbackLabel }) {
  if (loading) {
    return <div style={{ ...shell, padding: 26, textAlign: 'center', color: C.muted, fontSize: 12.5, fontFamily: MONO }}>Loading article…</div>;
  }
  if (!record) {
    return (
      <div style={{ ...shell, padding: '26px 20px', textAlign: 'center', color: C.txt2, fontSize: 12.5, lineHeight: 1.6 }}>
        <div style={{ display: 'inline-flex', padding: 12, borderRadius: '50%', background: alpha(C.acc, '12'), marginBottom: 12 }}><Icon name="info" size={20} /></div>
        <div style={{ fontWeight: 700, color: C.txt, marginBottom: 4 }}>{fallbackLabel || 'No article information'}</div>
        <p style={{ margin: 0 }}>This study isn&apos;t linked to a screening record, so there is no imported article metadata. It may have been added manually in Data Extraction.</p>
      </div>
    );
  }
  const keywords = (record.keywords || '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
  const decision = articleDecisionBadge(record);
  return (
    <div style={{ ...shell, padding: '18px 20px', overflowY: 'auto', maxHeight: 'calc(100vh - 230px)' }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: C.txt, margin: '0 0 8px', fontFamily: FONT, lineHeight: 1.42, overflowWrap: 'anywhere' }}>{record.title || 'Untitled record'}</h2>
      {(record.authors || record.journal || record.year) && (
        <div style={{ fontSize: 12.5, color: C.txt2, marginBottom: 10, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
          {record.authors && <span>{record.authors}</span>}
          {record.journal && <span style={{ fontStyle: 'italic', color: C.muted }}>{record.authors ? ' · ' : ''}{record.journal}</span>}
          {record.year && <span style={{ color: C.muted }}>{(record.authors || record.journal) ? ' · ' : ''}{record.year}</span>}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {record.doi && <a href={`https://doi.org/${record.doi}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none', overflowWrap: 'anywhere', wordBreak: 'break-all' }}>DOI: {record.doi}</a>}
        {record.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${record.pmid}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none' }}>PMID: {record.pmid}</a>}
        {record.sourceDb && <RobBadge>{record.sourceDb}</RobBadge>}
        {record.isDuplicate && <RobBadge color={C.gold}>Duplicate</RobBadge>}
        {decision && <RobBadge color={decision.color}>{decision.label}</RobBadge>}
      </div>

      <div style={{ marginBottom: 14, padding: '14px 16px', border: `1px solid ${C.brd}`, borderRadius: 10, background: C.card }}>
        <div style={{ fontSize: 9.5, color: C.muted, fontFamily: MONO, letterSpacing: '0.08em', marginBottom: 8 }}>ABSTRACT</div>
        {record.abstract ? (
          <p style={{ fontSize: 13.5, color: C.txt, lineHeight: 1.7, margin: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{record.abstract}</p>
        ) : (
          <p style={{ fontSize: 13, color: C.muted, fontStyle: 'italic', margin: 0 }}>No abstract provided.</p>
        )}
        {keywords.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.brd}` }}>
            <span style={{ fontSize: 9.5, color: C.muted, fontFamily: MONO, alignSelf: 'center', letterSpacing: '0.08em' }}>KEYWORDS</span>
            {keywords.map((kw, i) => <span key={i} style={{ fontSize: 10.5, background: alpha(C.brd, '70'), border: `1px solid ${C.brd}`, color: C.txt2, borderRadius: 10, padding: '2px 9px' }}>{kw}</span>)}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <InfoRow label="Source database" value={record.sourceDb} />
        <InfoRow label="Current stage" value={record.currentStage} />
        <InfoRow label="Final-review status" value={record.finalStatus} />
        <InfoRow label="Accepted" value={record.acceptedAt ? new Date(record.acceptedAt).toLocaleDateString() : null} />
        <InfoRow label="Handoff" value={record.handoffStatus} />
        {record.rejectedReason && <InfoRow label="Rejected reason" value={record.rejectedReason} />}
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 12, lineHeight: 1.5 }}>
      <span style={{ flex: '0 0 130px', color: C.muted, fontFamily: MONO, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', paddingTop: 1 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, color: C.txt2, overflowWrap: 'anywhere' }}>{value || '—'}</span>
    </div>
  );
}

// Translate the screening record's final-review fields into a single badge.
function articleDecisionBadge(record) {
  if (record.handoffStatus === 'sent') return { label: '↗ Sent to Data Extraction', color: C.acc };
  if (record.finalStatus === 'accepted' || record.currentStage === 'full_text') return { label: '✓ Accepted in Final Review', color: C.grn };
  if (record.finalStatus === 'rejected') return { label: '✗ Rejected in Final Review', color: C.red };
  return null;
}

// ── Domain pane ───────────────────────────────────────────────────────────────
function DomainPane({ domain, answers, meta, proposal, resolved, overrideInfo, focusedQ, setFocusedQ, guidanceOpen, setGuidanceOpen, reduced, finalised, editable, onAnswer, onMeta, onOverride }) {
  const reachable = domain.questions.filter(q => isReachable(q, answers));
  return (
    <div>
      <div style={{ marginBottom: 4, fontSize: 11, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Domain {domain.id.slice(1)}</div>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: C.txt, margin: '0 0 4px', fontFamily: FONT }}>{domain.name}</h2>
      <p style={{ fontSize: 13, color: C.txt2, margin: '0 0 18px', lineHeight: 1.55, maxWidth: 720 }}>{domain.description}</p>

      <div style={{ display: 'grid', gap: 12 }}>
        {reachable.map(q => {
          const focused = focusedQ === q.id;
          const gOpen = guidanceOpen[q.id];
          const m = meta[q.id] || {};
          return (
            <div key={q.id} onClick={() => setFocusedQ(q.id)} style={{
              border: `1px solid ${focused ? alpha(C.acc, '55') : C.brd}`, borderRadius: 12, padding: '14px 16px', background: C.card,
              boxShadow: focused ? `0 0 0 3px ${alpha(C.acc, '14')}` : 'none', transition: reduced ? 'none' : 'box-shadow 0.15s, border-color 0.15s, opacity 0.25s', cursor: 'default',
            }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color: C.acc, flexShrink: 0, marginTop: 1 }}>{q.id}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: C.txt, lineHeight: 1.5, fontWeight: 500 }}>{q.text}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 11, flexWrap: 'wrap' }}>
                    <SegmentedControl qid={q.id} value={answers[q.id] || ''} onChange={r => editable && onAnswer(q.id, r)} />
                    <button onClick={() => setGuidanceOpen(g => ({ ...g, [q.id]: !g[q.id] }))} style={linkBtn} aria-expanded={!!gOpen}>
                      <Icon name="info" size={13} /> {gOpen ? 'Hide guidance' : 'Guidance'}
                    </button>
                  </div>
                  {gOpen && (
                    <div style={{ marginTop: 11, padding: '10px 12px', background: C.surf, borderRadius: 8, fontSize: 12.5, color: C.txt2, lineHeight: 1.6, borderLeft: `3px solid ${alpha(C.acc, '50')}` }}>{q.guidance}</div>
                  )}
                  {focused && editable && (
                    <div style={{ marginTop: 11, display: 'grid', gap: 8 }}>
                      <textarea placeholder="Rationale (optional)" value={m.rationale || ''} onChange={e => onMeta(q.id, { rationale: e.target.value })}
                        rows={2} style={taStyle} />
                      <textarea placeholder="Evidence quote from the paper (optional)" value={m.evidenceQuote || ''} onChange={e => onMeta(q.id, { evidenceQuote: e.target.value })}
                        rows={2} style={{ ...taStyle, fontStyle: 'italic' }} />
                    </div>
                  )}
                  {!focused && (m.rationale || m.evidenceQuote) && (
                    <div style={{ marginTop: 8, fontSize: 11.5, color: C.muted, fontStyle: m.evidenceQuote ? 'italic' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.evidenceQuote ? `“${m.evidenceQuote}”` : m.rationale}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Proposed-judgement panel */}
      <div style={{ marginTop: 20, padding: '16px 18px', borderRadius: 12, background: judgmentStyle(resolved).bg, border: `1px solid ${alpha(judgmentStyle(resolved).hex, 0.4)}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Algorithm proposes</span>
            <JudgmentPill judgment={proposal.judgment} />
            {overrideInfo?.overridden && (
              <>
                <Icon name="arrowRight" size={13} />
                <JudgmentPill judgment={resolved} />
                <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted }}>(overridden)</span>
              </>
            )}
          </div>
          {editable && (
            <button onClick={onOverride} style={overrideBtn}><Icon name="pencil" size={12} /> Override (o)</button>
          )}
        </div>
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5, color: C.txt2, lineHeight: 1.6 }}>
          {proposal.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        {overrideInfo?.overridden && overrideInfo.overrideJustification && (
          <div style={{ marginTop: 10, padding: '8px 11px', background: alpha(C.txt, '06'), borderRadius: 7, fontSize: 12, color: C.txt2 }}>
            <strong style={{ color: C.txt }}>Override rationale:</strong> {overrideInfo.overrideJustification}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Summary step ──────────────────────────────────────────────────────────────
function SummaryStep({ view, live, saving, single, finalised, editable, readOnly, onFinalise, onReopen, onExport, onOverrideOverall, onJump }) {
  const complete = live.completeness.overall.complete;
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: C.txt, margin: '0 0 4px', fontFamily: FONT }}>Summary</h2>
      <p style={{ fontSize: 13, color: C.txt2, margin: '0 0 18px' }}>Risk-of-bias traffic light for this result. The expert may override any judgement; both the algorithm proposal and the final judgement are recorded.</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Overall</span>
        <JudgmentPill judgment={view.overall.resolvedOverall} size="lg" provisional={!complete && !finalised} />
        {view.overall.multiSomeConcernsFlag && !view.overall.overridden && (
          <span style={{ fontSize: 12, color: C.yel, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="alertTriangle" size={14} /> Multiple domains raise Some concerns — consider escalating to High.
          </span>
        )}
        {editable && <button onClick={onOverrideOverall} style={overrideBtn}><Icon name="pencil" size={12} /> Override overall</button>}
      </div>

      <div style={{ marginBottom: 20 }}>
        <RobTrafficLight matrix={single} title={view.resultLabel || `Study ${view.studyId}`} />
      </div>

      {/* Per-domain rationale */}
      <div style={{ display: 'grid', gap: 8, marginBottom: 20 }}>
        {ROB2.domains.map(d => {
          const dv = (view.domains || []).find(x => x.domainId === d.id) || {};
          const reasons = live.proposals[d.id].reasons;
          return (
            <button key={d.id} onClick={() => onJump(d.id)} style={{ textAlign: 'left', display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 10, border: `1px solid ${C.brd}`, background: C.card, cursor: 'pointer', fontFamily: FONT }}>
              <TrafficDot judgment={live.resolvedDomain(d.id)} size={15} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>{d.id} · {d.name}</div>
                <div style={{ fontSize: 12, color: C.txt2, marginTop: 2, lineHeight: 1.5 }}>{reasons[0]}</div>
                {dv.overridden && <div style={{ fontSize: 11, color: C.yel, marginTop: 3 }}>Overridden → {judgmentStyle(dv.finalJudgment).label}: {dv.overrideJustification}</div>}
              </div>
            </button>
          );
        })}
      </div>

      {!complete && editable && (
        <div style={{ padding: '10px 14px', borderRadius: 9, background: alpha(C.yel, '14'), border: `1px solid ${alpha(C.yel, '40')}`, color: C.txt2, fontSize: 12.5, marginBottom: 16 }}>
          <Icon name="info" size={13} /> Answer all reachable signalling questions to enable finalising ({live.completeness.overall.answered}/{live.completeness.overall.required} answered).
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {readOnly ? null : finalised ? (
          <button onClick={onReopen} style={ghostBtn}><Icon name="refresh" size={13} /> Re-open</button>
        ) : (
          <button onClick={onFinalise} disabled={!complete || saving} title={saving ? 'Saving…' : (!complete ? 'Answer all reachable questions first' : 'Finalise')} style={primaryBtn(!complete || saving)}><Icon name="check" size={14} /> {saving ? 'Saving…' : 'Finalise'}</button>
        )}
        <button onClick={() => onExport('csv')} style={ghostBtn}><Icon name="download" size={13} /> CSV</button>
        <button onClick={() => onExport('json')} style={ghostBtn}><Icon name="download" size={13} /> JSON</button>
        <button onClick={() => onExport('robvis')} style={ghostBtn}><Icon name="download" size={13} /> robvis</button>
      </div>
    </div>
  );
}

// ── Override modal ────────────────────────────────────────────────────────────
function OverrideModal({ info, onCancel, onSubmit }) {
  const [judgment, setJudgment] = useState(info.current && info.current !== 'na' ? info.current : 'some');
  const [justification, setJustification] = useState('');
  const valid = justification.trim().length > 0;
  // Escape closes; focus returns to the element that opened the modal on unmount.
  useEffect(() => {
    const opener = (typeof document !== 'undefined') ? document.activeElement : null;
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); try { opener && opener.focus && opener.focus(); } catch { /* ignore */ } };
  }, [onCancel]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Override judgement" style={{ position: 'fixed', inset: 0, background: alpha('#000', 0.45), display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.brd}`, padding: 22, width: 460, maxWidth: '100%', boxShadow: C.shadow }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: C.txt, fontFamily: FONT }}>Override {info.target === 'overall' ? 'overall' : info.domainId} judgement</h3>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: C.muted }}>This deviates from the algorithm. A justification is required and will be logged.</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {['low', 'some', 'high'].map(j => {
            const st = judgmentStyle(j); const on = judgment === j;
            return (
              <button key={j} onClick={() => setJudgment(j)} style={{ flex: 1, padding: '9px 8px', borderRadius: 9, cursor: 'pointer', fontFamily: FONT, fontWeight: 700, fontSize: 12.5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: on ? st.bg : C.surf, color: on ? st.fg : C.txt2, border: `1px solid ${on ? alpha(st.hex, 0.6) : C.brd2}` }}>
                <Icon name={st.icon} size={14} /> {st.label}
              </button>
            );
          })}
        </div>
        <textarea autoFocus placeholder="Why does the expert judgement differ from the algorithm?" value={justification} onChange={e => setJustification(e.target.value)} rows={3} style={{ ...taStyle, marginBottom: 14 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          {info.current && info.current !== 'na'
            ? <button onClick={() => onSubmit({ clear: true })} style={{ ...ghostBtn, color: C.muted }}>Clear override</button>
            : <span />}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onCancel} style={ghostBtn}>Cancel</button>
            <button onClick={() => valid && onSubmit({ finalJudgment: judgment, justification: justification.trim() })} disabled={!valid} style={primaryBtn(!valid)}>Save override</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorBox({ msg }) {
  return <div style={{ padding: '9px 13px', background: alpha(C.red, '12'), border: `1px solid ${alpha(C.red, '40')}`, borderRadius: 8, color: C.red, fontSize: 12.5, marginBottom: 10, fontFamily: FONT }}>{msg}</div>;
}

// ── styles ────────────────────────────────────────────────────────────────────
const shell = { background: C.bg, borderRadius: 14, border: `1px solid ${C.brd}`, overflow: 'hidden' };
const taStyle = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt, fontSize: 12.5, fontFamily: FONT, lineHeight: 1.5, resize: 'vertical' };
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt2, fontSize: 12.5, cursor: 'pointer', fontFamily: FONT };
const linkBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 6px', background: 'transparent', border: 'none', color: C.acc, fontSize: 12, cursor: 'pointer', fontFamily: FONT };
const overrideBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT };
function primaryBtn(disabled) {
  return { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', background: disabled ? C.surf : C.acc, border: `1px solid ${disabled ? C.brd2 : C.acc}`, borderRadius: 9, color: disabled ? C.muted : C.accText, fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: FONT };
}
function railItem(on) {
  return { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 10px', marginBottom: 2, borderRadius: 9, background: on ? C.card : 'transparent', border: `1px solid ${on ? C.brd : 'transparent'}`, cursor: 'pointer', textAlign: 'left', fontFamily: FONT };
}
