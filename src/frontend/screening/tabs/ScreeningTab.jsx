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
import { Loading, ErrorBanner, Button, Badge, DecisionChip, Card, SectionLabel, EmptyState, Toggle, Modal } from '../ui/components.jsx';
import { renderAbstract } from '../ui/highlightRender.jsx';
import { DEFAULT_INCLUDE_KEYWORDS, DEFAULT_EXCLUDE_KEYWORDS } from '../../../research-engine/screening/defaultKeywords.js';
// 107.md §2 — active vs suggested keyword state + the shared single-term reducer.
import { resolveKeywordState } from '../../../research-engine/screening/criteriaKeywords.js';
import { KEYWORD_ORIGIN, dismissConflictOps } from '../../../research-engine/screening/keywordModel.js';
import { normalizeKeywordKey } from '../../../research-engine/screening/keywordNormalize.js';
// 107.md §4 — structured-abstract heading segmentation (memoized per record).
import { segmentAbstract } from '../../../research-engine/screening/abstractSegments.js';
// 107.md §3 — Cmd/Ctrl+I / Cmd/Ctrl+E over an abstract selection.
import { useAbstractSelectionShortcuts } from '../hooks/useAbstractSelectionShortcuts.js';
import KeywordSnackbar from '../components/KeywordSnackbar.jsx';
import PdfViewer from '../components/PdfViewer.jsx';
// 96.md 5D — collapsible article-level "Import provenance" (lazy; 404 soft-fail).
import ImportProvenance from '../components/ImportProvenance.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
import { useRealtime } from '../../hooks/useRealtime.js';
import { useScreeningShortcuts } from '../hooks/useScreeningShortcuts.js';
import { useScreeningAi } from '../ai/useScreeningAi.js';
import { AiScoreCard, AiQueueBar, AiStatusPanel, ScoreBadge } from '../ai/AiAssist.jsx';
// P10 Criteria Screener (feature flag: eligibilityScreening) — self-detecting hook,
// renders nothing + makes no network calls when the flag is off (no-op for today).
import { useEligibility } from '../eligibility/useEligibility.js';
import CriteriaBuilder from '../eligibility/CriteriaBuilder.jsx';
import EligibilityCard from '../eligibility/EligibilityCard.jsx';
import EligibilityValidationPanel from '../eligibility/EligibilityValidationPanel.jsx';
import { rankItems } from '../../../research-engine/screening/ai/ranking.js';
import { parseScreeningShortcuts, DEFAULT_SCREENING_SHORTCUTS, keyLabel } from '../screeningShortcuts.js';
// 107.md §5 — nearestScrollTop: minimal-scroll ('nearest') arithmetic for one container.
import { shouldWindow, computeListWindow, measuredRowHeight, nearestScrollTop, DEFAULT_ROW_HEIGHT } from '../lib/listWindow.js';
// 107.md rec — the keyword gate, resolved in one pure place (see lib/screenAccess.js).
import { canEditScreeningKeywords } from '../lib/screenAccess.js';
// 100.md §13 — pure page-window arithmetic (what is still loadable before/after the
// contiguous run of pages currently held), shared with the list-query module's tests.
// 107.md §7 — moveIntent: what a next/previous keystroke means at the current position.
import { pageWindow, moveIntent, advanceContextMatches } from '../../../research-engine/screening/recordListQuery.js';
import { api } from '../../api-client/apiClient.js';
import Tooltip from '../../components/Tooltip.jsx';

// prompt29 Parts 6/7 — plain-English explanations for the compact status labels.
const STATUS_HELP = {
  secondReview: 'This record moved to second / full-text review.',
  quorum: 'Required reviewer agreement has been reached.',
  sent: 'Sent to PecanRev for the downstream data-extraction workflow.',
  disputed: 'Reviewers made conflicting decisions — this record needs resolution.',
  duplicate: 'Detected as a duplicate of another record.',
};
const DECISION_LABEL = { include: 'Included', exclude: 'Excluded', maybe: 'Maybe', undecided: 'Undecided' };
function fmtDecisionDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}

const LIMIT = 50;

// 100.md §14 — this workbench IS the Title & Abstract stage; Final Review lives in
// SecondReviewTab. Resume progress is kept per user + project + STAGE, so the stage id
// is explicit rather than implied.
const SCREENING_STAGE = 'title_abstract';

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

  // 107.md §2 — keyword ops answer with the FULL updated keyword columns, so a
  // single-term edit updates in place instead of refetching the whole project. Held
  // as a local override that is dropped the moment the server-side project changes.
  const [kwLocal, setKwLocal] = useState(null);
  useEffect(() => {
    setKwLocal(null);
  }, [pid, project?.inclusionKeywords, project?.exclusionKeywords, project?.keywordMeta]);
  const kwSrc = kwLocal || project || {};

  // Parsed project config (keywords / study-type filter). Projects created before
  // default-keyword seeding fall back to the shared defaults so the panel is never
  // empty (Task 8 — "default keyword sets to every project").
  const storedIncl = parseList(kwSrc.inclusionKeywords);
  const storedExcl = parseList(kwSrc.exclusionKeywords);
  const studyTypes = parseList(project?.studyTypeFilter);

  // 107.md §2 — ACTIVE keywords (the stored list, or the shared defaults when it is
  // empty) vs SUGGESTED ones derived live from this project's eligibility criteria.
  // Suggestions never highlight, never filter and never count until a leader accepts
  // them, and a concept whose polarity is ambiguous lands in `conflicts` instead of
  // silently appearing on both sides. Nothing derived is persisted, so editing the
  // criteria updates the suggestions and regeneration can never overwrite a manual term.
  const kw = useMemo(() => resolveKeywordState({
    storedInclude: storedIncl,
    storedExclude: storedExcl,
    defaultInclude: DEFAULT_INCLUDE_KEYWORDS,
    defaultExclude: DEFAULT_EXCLUDE_KEYWORDS,
    picoSnapshot: project?.picoSnapshot,
    keywordMeta: kwSrc.keywordMeta,
  }), [storedIncl.join('|'), storedExcl.join('|'), project?.picoSnapshot, kwSrc.keywordMeta]); // eslint-disable-line react-hooks/exhaustive-deps
  const inclusion = kw.include.terms;
  const exclusion = kw.exclude.terms;
  const inclSource = kw.include.sourceByTerm;
  const exclSource = kw.exclude.sourceByTerm;

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

  // ── Collapsible side panels (prompt29 Parts 4/5) — persisted per user so the
  // reading area can be widened. Collapsing only swaps the rendered column for a
  // thin rail; all screening state (selection, filters, keyword selection) lives
  // here in the parent, so nothing is lost. ───────────────────────────────────
  const uiPrefsKey = userId ? `metalab.screeningUI.${userId}` : null;
  const [uiPrefs, setUiPrefs] = useState(() => {
    if (!uiPrefsKey) return { leftCollapsed: false, rightCollapsed: false };
    try { const v = JSON.parse(localStorage.getItem(uiPrefsKey) || '{}'); return { leftCollapsed: !!v.leftCollapsed, rightCollapsed: !!v.rightCollapsed }; }
    catch { return { leftCollapsed: false, rightCollapsed: false }; }
  });
  const setPanel = useCallback((key, val) => {
    setUiPrefs(prev => {
      const next = { ...prev, [key]: val };
      if (uiPrefsKey) { try { localStorage.setItem(uiPrefsKey, JSON.stringify(next)); } catch { /* storage full */ } }
      return next;
    });
  }, [uiPrefsKey]);

  // ── Records & selection ──────────────────────────────────────────────────
  const [records, setRecords]       = useState([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  // 100.md §13 — the LOWEST loaded page. Normally 1; after Resume Screening jumps into
  // the middle of a long list the loaded window starts there, and "earlier records" /
  // "load more" / the remaining count all read from this pair.
  const [firstPage, setFirstPage]   = useState(1);
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

  // ── 107.md §2/§3 — keyword operations (add / remove / move / accept / reject) ──
  // Every mutation goes through ONE server endpoint that applies the shared reducer
  // inside a transaction, so concurrent leaders compose instead of clobbering. The
  // response carries the full updated columns; we adopt them locally rather than
  // refetching the whole project per chip.
  const [kwOpError, setKwOpError] = useState('');
  const [kwNote, setKwNote] = useState(null);        // { message, tone, undo }
  const [kwConflict, setKwConflict] = useState(null); // { phrase, from, to }
  const canEditKeywords = canEditScreeningKeywords(access);

  // 107.md rec — RESPONSE SEQUENCING. Two ops can be in flight at once (nothing locks
  // the abstract shortcut or the chip buttons), and the responses carry FULL keyword
  // columns. Adopting whichever resolves last would let an older snapshot overwrite a
  // newer one — the second term silently vanishes from the chips, the highlighting and
  // `kwCtxRef`, and nothing refetches (the server excludes the acting user from its
  // realtime poke). Only the latest request may write `kwLocal`.
  const kwSeqRef = useRef(0);

  const runKeywordOp = useCallback(async (op) => {
    const seq = (kwSeqRef.current += 1);
    setKwOpError('');
    try {
      const r = await screeningApi.keywordOp(pid, op);
      if (seq !== kwSeqRef.current) return r;   // superseded — its state is stale
      setKwLocal({
        inclusionKeywords: r.inclusionKeywords,
        exclusionKeywords: r.exclusionKeywords,
        keywordMeta: r.keywordMeta,
      });
      return r;
    } catch (e) {
      const message = e.message || 'Could not update keywords';
      if (seq === kwSeqRef.current) {
        setKwOpError(message);
        // Also surface it where the action was taken (the abstract, not the panel).
        setKwNote({ message, tone: 'error' });
      }
      return null;
    }
  }, [pid]);

  // Cmd/Ctrl+I / Cmd/Ctrl+E over a selection inside the abstract.
  const abstractRef = useRef(null);
  const kwCtxRef = useRef({});
  kwCtxRef.current = { inclusion, exclusion, canEditKeywords, runKeywordOp };

  const onSelectionKeyword = useCallback(({ list, phrase }) => {
    const { inclusion: inc, exclusion: exc, canEditKeywords: may, runKeywordOp: run } = kwCtxRef.current;
    const label = list === 'include' ? 'inclusion' : 'exclusion';
    if (!may) {
      setKwNote({ message: 'Only project leaders can edit keyword lists.', tone: 'warn' });
      return;
    }
    const key = normalizeKeywordKey(phrase);
    const inThis = (list === 'include' ? inc : exc).some(t => normalizeKeywordKey(t) === key);
    if (inThis) {
      setKwNote({ message: `Already in ${label} keywords: “${phrase}”`, tone: 'info' });
      return;
    }
    const other = list === 'include' ? 'exclude' : 'include';
    const inOther = (other === 'include' ? inc : exc).some(t => normalizeKeywordKey(t) === key);
    if (inOther) {
      // Never silently create a cross-list conflict (107.md §3 "Opposite List").
      setKwConflict({ phrase, from: other, to: list });
      return;
    }
    run({ type: 'add', list, term: phrase }).then(r => {
      if (!r) return;
      setKwNote({
        message: `Added “${phrase}” to ${label} keywords.`,
        tone: 'info',
        // Undo is a real inverse op against the server, not a local rollback.
        // `reject: false` is what makes it an INVERSE rather than a second edit: a
        // plain `remove` also records a 'rejected' verdict, which permanently
        // suppressed the matching criteria suggestion the add was never meant to touch.
        undo: { type: 'remove', list, term: phrase, reject: false },
      });
    });
  }, []);

  useAbstractSelectionShortcuts({
    enabled: true,
    containerRef: abstractRef,
    onTrigger: onSelectionKeyword,
  });

  const confirmKeywordMove = useCallback(() => {
    const c = kwConflict;
    if (!c) return;
    setKwConflict(null);
    const label = c.to === 'include' ? 'inclusion' : 'exclusion';
    runKeywordOp({ type: 'move', list: c.from, term: c.phrase, toList: c.to }).then(r => {
      if (!r) return;
      setKwNote({
        message: `Moved “${c.phrase}” to ${label} keywords.`,
        tone: 'info',
        // Non-verdict inverse: restores the source origin verbatim and leaves no
        // 'rejected' residue on the list the term is being moved back onto.
        undo: { type: 'move', list: c.to, term: c.phrase, toList: c.from, reject: false },
      });
    });
  }, [kwConflict, runKeywordOp]);

  const undoKeywordNote = useCallback(() => {
    const op = kwNote?.undo;
    setKwNote(null);
    if (op) runKeywordOp(op);
  }, [kwNote, runKeywordOp]);
  // Stable identity: the snackbar's auto-dismiss timer keys off onDismiss, and a
  // fresh inline arrow every render would restart the 8s countdown forever.
  const dismissKeywordNote = useCallback(() => setKwNote(null), []);

  const selected = records.find(r => r.id === selectedId) || null;

  // Refs to keep the latest values inside debounced / keyboard callbacks.
  const searchRef = useRef('');
  const filterRef = useRef('all');
  const recordsRef = useRef(records);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { recordsRef.current = records; }, [records]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // ── AI Screening Intelligence Engine (feature flag: aiScreening) ──────────
  // Self-detecting hook: when the flag is off it reports { enabled:false } and
  // every AI surface below renders nothing, so behaviour is identical to today.
  const ai = useScreeningAi(pid, 'title_abstract');
  // P10 Criteria Screener — self-detecting; { enabled:false } (silent) when the
  // `eligibilityScreening` flag is off, so nothing below renders or network-calls.
  const elig = useEligibility(pid);
  const [queueMode, setQueueMode] = useState('default');
  const [aiBand, setAiBand] = useState('all');

  // AI-reordered / band-filtered view of the LOADED records. When AI is off or in
  // default mode this is exactly `records` (referential identity preserved).
  const displayRecords = useMemo(() => {
    if (!ai.enabled || (queueMode === 'default' && aiBand === 'all')) return records;
    let list = records;
    // Prefer the server-attached r.aiScore (authoritative for the loaded page) over
    // the separately-fetched ai.scores map, which can be stale/empty and would
    // otherwise silently hide in-band records the server legitimately returned.
    const scoreOf = (r) => r.aiScore || ai.scores[r.id];
    if (aiBand !== 'all') {
      list = list.filter(r => {
        const sc = scoreOf(r);
        if (!sc) return false;
        if (aiBand === 'uncertain') return sc.prediction === 'uncertain';
        if (aiBand === 'low') return sc.score != null && sc.score < 0.4;  // "Low (<40)" covers the low + very_low bands
        return sc.band === aiBand;
      });
    }
    if (queueMode !== 'default') {
      const items = list.map((r, i) => {
        const sc = scoreOf(r) || {};
        return { recordId: r.id, score: sc.score, uncertainty: sc.uncertainty, picoMean: sc.picoMean, missingAbstract: sc.missingAbstract, isDuplicate: r.isDuplicate, hasConflict: r.disputed, order: i };
      });
      const byId = new Map(list.map(r => [r.id, r]));
      list = rankItems(items, queueMode).map(it => byId.get(it.recordId)).filter(Boolean);
    }
    return list;
  }, [records, ai.enabled, ai.scores, queueMode, aiBand]);
  const displayRecordsRef = useRef(displayRecords);
  useEffect(() => { displayRecordsRef.current = displayRecords; }, [displayRecords]);

  // When an AI band/queue filter excludes the currently-selected record, re-select
  // the first in-band record so the Prev/Next footer never strands at "0 / N".
  useEffect(() => {
    if (ai.enabled && selectedId && displayRecords.length && !displayRecords.some(r => r.id === selectedId)) {
      setSelectedId(displayRecords[0].id);
    }
  }, [displayRecords, ai.enabled, selectedId]);

  // Refs so loadRecords (stable identity) can send the active AI queue mode/band to
  // the server, which orders + filters the WHOLE pool before paginating (the
  // client-side displayRecords reorder above is then just instant in-page feedback).
  const aiEnabledRef = useRef(ai.enabled);
  const queueModeRef = useRef(queueMode);
  const aiBandRef = useRef(aiBand);
  useEffect(() => { aiEnabledRef.current = ai.enabled; }, [ai.enabled]);
  useEffect(() => { queueModeRef.current = queueMode; }, [queueMode]);
  useEffect(() => { aiBandRef.current = aiBand; }, [aiBand]);
  // Re-query the server (page 1) when the queue mode or band changes so ordering
  // spans every record, not just the loaded page. Skips the initial mount.
  const aiQueueMounted = useRef(false);
  useEffect(() => {
    if (!aiQueueMounted.current) { aiQueueMounted.current = true; return; }
    if (ai.enabled) loadRecords({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueMode, aiBand]);

  // ── Load a page of records (reset = page 1 / append = next page) ──────────
  /**
   * Load a window of the record list.
   *   reset            replace the list (optionally starting at page `p`)
   *   direction 'next' append the page after the last loaded one
   *   direction 'prev' PREPEND the page before the first loaded one
   *
   * 100.md §13 — a reset normally lands on page 1, but Resume Screening jumps straight
   * to the page holding the article the reviewer stopped at (paging there one request
   * at a time would be dozens of round-trips on a real review). The loaded window is
   * therefore a CONTIGUOUS run of pages `firstPage…page`, not always `1…page`, which is
   * what `hasMore` / `hasEarlier` / the remaining count below are derived from.
   *
   * 107.md rec — LOAD GENERATION. A `reset` replaces the whole window (project switch,
   * filter/search change, Resume Screening, the realtime `decision.saved` refresh); an
   * append issued against the PREVIOUS window and landing afterwards would splice rows
   * answering a different query onto it — page 2 of the old list appended below page 9
   * of the new one, with `page`/`firstPage` describing a window the array no longer
   * holds. Every reset bumps the generation; an append captures it at request time and
   * is DISCARDED when it no longer matches.
   */
  const loadGenRef = useRef(0);
  const loadRecords = useCallback(async ({ reset = false, direction = 'next', p, s, f, select } = {}) => {
    const pageNum = reset ? (p ?? 1) : (p ?? (direction === 'prev' ? firstPage - 1 : page + 1));
    if (!reset && (pageNum < 1)) return false;
    const gen = reset ? (loadGenRef.current += 1) : loadGenRef.current;
    const searchVal = s !== undefined ? s : searchRef.current;
    const filterVal = f !== undefined ? f : filterRef.current;
    reset ? setLoading(true) : setLoadingMore(true);
    setListError(null);
    try {
      const params = { page: pageNum, limit: LIMIT };
      if (searchVal) params.search = searchVal;
      if (filterVal && filterVal !== 'all') params.filter = filterVal;
      if (keywordsRef.current) params.keywords = keywordsRef.current;
      if (aiEnabledRef.current) {
        if (queueModeRef.current && queueModeRef.current !== 'default') params.aiQueue = queueModeRef.current;
        if (aiBandRef.current && aiBandRef.current !== 'all') params.aiBand = aiBandRef.current;
      }
      const data = await screeningApi.listRecords(pid, params);
      // Superseded by a reset issued while this append was in flight. Dropping it is
      // the only correct merge — its rows answer a query the list no longer shows.
      if (!reset && gen !== loadGenRef.current) return false;
      const recs = data.records || [];
      recordsRef.current = reset ? recs : (direction === 'prev' ? [...recs, ...recordsRef.current] : [...recordsRef.current, ...recs]);
      setRecords(recordsRef.current);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      if (reset) { setPage(pageNum); setFirstPage(pageNum); }
      else if (direction === 'prev') setFirstPage(pageNum);
      else setPage(pageNum);
      if (reset) {
        // 100.md §13 — an explicit `select` (the resume target) wins; otherwise keep the
        // current selection if it survived the reload, else fall back to the first row.
        setSelectedId(prev => {
          if (select && recs.some(r => r.id === select)) return select;
          return recs.some(r => r.id === prev) ? prev : (recs[0]?.id || null);
        });
      }
      return true;
    } catch (e) {
      setListError(e.message || 'Failed to load records');
      // Report the failure so a caller (Resume Screening) does not announce success
      // over a list that never loaded.
      return false;
    } finally {
      reset ? setLoading(false) : setLoadingMore(false);
    }
  }, [pid, page, firstPage]);

  // Refetch a single record's row after a decision so reviewer indicators /
  // quorum / disputed flags stay in sync without a full list reload.
  // 100.md §13 — this used to always refetch page 1 (limit 200), so a record outside
  // the first 200 silently never refreshed. Resume Screening makes that the NORMAL
  // case (it lands you on page 9 of a real review), so refetch the page the record is
  // actually on: the loaded window is the contiguous run firstPage…page.
  const refreshRow = useCallback(async (rid) => {
    try {
      const idx = recordsRef.current.findIndex(r => r.id === rid);
      const targetPage = idx >= 0 ? firstPage + Math.floor(idx / LIMIT) : firstPage;
      const params = { page: targetPage, limit: LIMIT };
      if (searchRef.current) params.search = searchRef.current;
      if (filterRef.current && filterRef.current !== 'all') params.filter = filterRef.current;
      if (keywordsRef.current) params.keywords = keywordsRef.current;
      const data = await screeningApi.listRecords(pid, params);
      const fresh = (data.records || []).find(r => r.id === rid);
      if (fresh) setRecords(prev => prev.map(r => (r.id === rid ? fresh : r)));
      setTotal(data.total ?? total);
    } catch { /* non-fatal */ }
  }, [pid, total, firstPage]);

  // Initial / project-change load.
  useEffect(() => {
    searchRef.current = '';
    filterRef.current = 'all';
    setSearch('');
    setFilter('all');
    // Reset AI queue state so a mode/band never leaks into another project. Refs are
    // set BEFORE loadRecords so the first page-1 load sends no stale aiQueue/aiBand.
    setQueueMode('default'); setAiBand('all');
    queueModeRef.current = 'default'; aiBandRef.current = 'all';
    // 100.md §13 — the page window belongs to the OLD project; reset it synchronously so
    // a realtime event arriving mid-switch cannot reload "page 9" of a fresh project.
    setFirstPage(1); firstPageRef.current = 1;
    aiQueueMounted.current = false;
    // 107.md rec — an auto-advance armed in the OLD project must not resolve against
    // the new one (it would select a foreign record and markOpened a 404). The load
    // generation below covers filter/search resets; a pid change is scrubbed here.
    pendingAdvanceRef.current = null; advanceLockRef.current = false;
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
  // 100.md §14 — a teammate's decision can change what is left for ME to screen
  // (promotion to full text, conflict resolution), so the resume point is recomputed
  // alongside the list. Held in a ref because refreshResume is declared further down.
  const refreshResumeRef = useRef(() => {});
  const firstPageRef = useRef(1);
  useEffect(() => { firstPageRef.current = firstPage; }, [firstPage]);

  useRealtime({
    'decision.saved': (ev) => {
      if (!ev || ev.projectId === pid || ev.projectId === undefined) {
        // 100.md §§13-14 — refresh the window the reviewer is STANDING IN, not page 1.
        // In a two-reviewer project a teammate decides constantly; snapping a reviewer
        // who resumed at article 412 back to article 1 on every one of those events
        // would undo the whole point of Resume Screening.
        loadRecords({
          reset: true, p: firstPageRef.current,
          s: searchRef.current, f: filterRef.current, select: selectedIdRef.current,
        });
        refreshResumeRef.current();
      }
    },
    // se2.md §6 — a background rescore finished: refresh scores/badges + flag that
    // fresher rankings are available, WITHOUT auto-reordering under the reviewer.
    'ai.updated': (ev) => {
      if (!ev || ev.projectId === pid || ev.projectId === undefined) ai.onScoresUpdated();
    },
  });

  // Apply the freshly-computed ranking on demand (preserves the current record).
  const refreshRankings = useCallback(() => {
    ai.clearRankingsAvailable();
    loadRecords({ reset: true, s: searchRef.current, f: filterRef.current });
  }, [ai, loadRecords]);

  // Keyword article counts — refresh on project load and whenever the project's
  // keyword lists change (a leader edited them).
  const loadKwStats = useCallback(() => {
    screeningApi.getKeywordStats(pid)
      .then(s => setKwStats({ total: s.total || 0, include: s.include || {}, exclude: s.exclude || {} }))
      .catch(() => {});
  }, [pid]);
  // 107.md §2 — pending suggestions are counted too (the review UI shows an article
  // count per suggestion), so they belong in the refresh trigger.
  useEffect(() => { loadKwStats(); /* eslint-disable-next-line */ },
    [pid, inclusion.join('|'), exclusion.join('|'), kw.include.pending.join('|'), kw.exclude.pending.join('|')]);

  // Re-filter the list when the keyword selection changes (skip first mount).
  const kwFirst = useRef(true);
  // 100.md §13 — set by doResume when it clears the chips programmatically, so this
  // effect does not fire a competing page-1 load against the resume load.
  const kwSuppressRef = useRef(false);
  useEffect(() => {
    keywordsRef.current = keywordsParam;
    if (kwFirst.current) { kwFirst.current = false; return; }
    if (kwSuppressRef.current) { kwSuppressRef.current = false; return; }
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

  // 100.md §13 / 107.md §7 — what is still loadable around the contiguous run of pages
  // currently held. Hoisted out of the LeftColumn props because keyboard navigation
  // needs `hasMore` too (and the middle column's end-of-list note reads it as well).
  const pageWin = pageWindow({ firstPage, page, pages, total, limit: LIMIT });

  function loadMore() {
    if (loadingMore) return;
    loadRecords({ reset: false, direction: 'next' });
  }
  // 100.md §13 — the mirror of "Load more". Without it, a resume jump into page 9 would
  // make pages 1-8 unreachable without clearing the filters, which is exactly the
  // "saved article becomes inaccessible with no explanation" trap §15 warns about —
  // in reverse.
  function loadEarlier() {
    if (loadingMore || firstPage <= 1) return;
    loadRecords({ reset: false, direction: 'prev' });
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

  /* ── 107.md §7 — keyboard navigation past the last loaded study ───────────────
     Arrowing forward off the end used to be a silent no-op, so a reviewer working a
     5,000-record list stopped dead at row 50 until they found the mouse. Moving
     forward now paginates automatically and lands on the FIRST study of the new
     batch — under three constraints that make the difference between seamless and
     corrupt:
       · one request at a time — a ref lock closes the window between the keystroke
         and `loadingMore` becoming true, so held-down arrows cannot fan out into
         concurrent page requests (which interleave and duplicate rows);
       · never advance into an index that does not exist yet — the selection moves in
         the effect below, after the records actually arrive;
       · identify the new study by IDENTITY, not by index — an AI queue mode reorders
         the merged list, so `records[previousCount]` is not reliably a new record. */
  const navCtxRef = useRef({});
  // 107.md rec — `loading` (the RESET state) belongs in the in-flight input too. Only
  // `loadingMore` was consulted, so a keystroke during a reset (Resume Screening, a
  // filter change, the realtime `decision.saved` refresh) still returned 'load-next'
  // and issued an append computed from the pre-reset `page`.
  navCtxRef.current = { hasMore: pageWin.hasMore, loadingMore, loading };
  const advanceLockRef = useRef(false);
  const pendingAdvanceRef = useRef(null);

  function moveSelection(dir) {
    const recs = displayRecordsRef.current;
    const idx = recs.findIndex(r => r.id === selectedIdRef.current);
    const { hasMore, loadingMore: busy, loading: resetting } = navCtxRef.current;
    const intent = moveIntent({
      index: idx, dir, count: recs.length,
      hasMore, loadingMore: busy || resetting || advanceLockRef.current,
    });
    if (intent === 'move') {
      const next = recs[idx + (Number(dir) < 0 ? -1 : 1)];
      if (next) selectRecord(next.id);
      return;
    }
    if (intent !== 'load-next') return;   // 'end' → stay put; 'noop' → already loading
    advanceLockRef.current = true;
    // Stamp the DATASET this advance was armed against (107.md rec): the effect below
    // fires on the first render where `loadingMore` is false — whichever load that was
    // — so without the stamp a project switch or filter change mid-flight lands the
    // reader on a record from the previous list.
    pendingAdvanceRef.current = {
      seen: new Set(recs.map(r => r.id)),
      pid, filter: filterRef.current, search: searchRef.current, gen: loadGenRef.current,
    };
    loadMore();
  }

  // The other half of the auto-advance: the batch has landed (or failed). Selecting
  // here rather than in moveSelection is what guarantees no skipped/duplicated study —
  // the choice is made against the list that really exists.
  useEffect(() => {
    const pend = pendingAdvanceRef.current;
    if (!pend || loadingMore) return;     // still in flight
    pendingAdvanceRef.current = null;
    advanceLockRef.current = false;
    // Failure: the error banner + the manual "Load more" button carry the retry, and
    // the reviewer keeps the study (and the decision form) they were already on.
    if (listError) return;
    // The list under us is no longer the one the keystroke was issued against — drop
    // the advance silently rather than selecting a record from the previous dataset.
    if (!advanceContextMatches(pend, {
      pid, filter: filterRef.current, search: searchRef.current, gen: loadGenRef.current,
    })) return;
    const next = displayRecords.find(r => !pend.seen.has(r.id));
    if (next) selectRecord(next.id);
  }, [displayRecords, loadingMore, listError, selectRecord, pid]);

  /* ── 100.md §§12-15 — Resume Screening ─────────────────────────────────────
     The reviewer's stopping point lives on the SERVER, derived from their OWN
     ScreenDecision rows (unique per record + reviewer + stage). Nothing is cached in
     localStorage, so a second browser, a re-login, and a teammate screening the same
     project all behave correctly by construction — and a deleted or deduplicated
     article simply stops being a candidate instead of stranding a saved pointer.
     Refreshed on mount and after every decision (ours or a teammate's). */
  const [resume, setResume] = useState(null);
  const [resuming, setResuming] = useState(false);
  const [resumeNote, setResumeNote] = useState('');
  const [scrollToSelected, setScrollToSelected] = useState(false);
  // Stable identity: the LeftColumn scroll effect lists it as a dependency, so an
  // inline arrow would re-run that effect on every render of the tab.
  const clearScrollToSelected = useCallback(() => setScrollToSelected(false), []);

  // The resume point is derived server-side from several indexed counts, so it is not
  // free. `decision.saved` arrives for EVERY decision every teammate makes, which on a
  // busy two-reviewer project would fan out to one heavy call each. Coalesce them: run
  // at most once per REFRESH_MS, and run the trailing edge so the last event still lands.
  const REFRESH_MS = 4000;
  const resumeAtRef = useRef(0);
  const resumeTimerRef = useRef(null);
  const runRefreshResume = useCallback(() => {
    resumeAtRef.current = Date.now();
    screeningApi.getResumePoint(pid, { stage: SCREENING_STAGE, limit: LIMIT })
      .then(r => setResume(r || null))
      .catch(() => { /* non-fatal — the control just stays out of the way */ });
  }, [pid]);
  const refreshResume = useCallback(({ now = false } = {}) => {
    if (!canScreen) { setResume(null); return; }
    clearTimeout(resumeTimerRef.current);
    const since = Date.now() - resumeAtRef.current;
    if (now || since >= REFRESH_MS) { runRefreshResume(); return; }
    resumeTimerRef.current = setTimeout(runRefreshResume, REFRESH_MS - since);
  }, [canScreen, runRefreshResume]);
  useEffect(() => () => clearTimeout(resumeTimerRef.current), []);

  useEffect(() => { refreshResumeRef.current = refreshResume; }, [refreshResume]);
  useEffect(() => { resumeAtRef.current = 0; setResume(null); setResumeNote(''); refreshResume({ now: true }); }, [refreshResume]);

  /* Jump to the resume target. Search / filters / keyword selection are cleared first:
     100.md §15 — a saved article that the current filter excludes must never become
     unreachable with no explanation, so we restore a view that definitely contains it
     and say so. */
  const doResume = useCallback(async () => {
    if (resuming) return;
    setResuming(true);
    setResumeNote('');
    try {
      const r = await screeningApi.getResumePoint(pid, { stage: SCREENING_STAGE, limit: LIMIT });
      setResume(r || null);
      if (!r || !r.recordId) {
        setResumeNote((r && r.message) || 'There is nothing left to screen here.');
        return;
      }
      const hadKeywords = !!keywordsRef.current;
      // An AI queue mode or band REORDERS (and filters) the whole pool server-side, so
      // the canonical `position`/`page` the resume endpoint returned do not address the
      // same list. Fall back to the default worklist rather than jumping to the right
      // page of the wrong ordering.
      const reordered = queueModeRef.current !== 'default' || aiBandRef.current !== 'all';
      if (reordered) {
        queueModeRef.current = 'default'; aiBandRef.current = 'all';
        setQueueMode('default'); setAiBand('all');
      }
      const narrowed = !!searchRef.current || filterRef.current !== 'all' || hadKeywords || reordered;
      if (narrowed) {
        // Clearing the keyword chips changes `keywordsParam`, whose effect issues its
        // OWN `loadRecords({reset:true})` for page 1 — which would race the resume load
        // below and (landing later) dump the reviewer back at article 1 while the note
        // claimed they were resumed. Suppress exactly that one reload; the resume load
        // already carries the cleared filters.
        if (hadKeywords) kwSuppressRef.current = true;
        searchRef.current = ''; filterRef.current = 'all'; keywordsRef.current = '';
        setSearch(''); setFilter('all'); setSelectedIncl([]); setSelectedExcl([]);
      }
      // A pending search keystroke would otherwise fire ~300ms later and re-filter the
      // list right back off the resumed article.
      clearTimeout(searchTimer.current);

      if (!narrowed && recordsRef.current.some(x => x.id === r.recordId)) {
        selectRecord(r.recordId);
      } else {
        const ok = await loadRecords({ reset: true, p: r.page || 1, s: '', f: 'all', select: r.recordId });
        if (!ok) { setResumeNote('Could not load that part of the list — try again in a moment.'); return; }
        // Only select what actually arrived: loadRecords' own fallback already picked a
        // sane row if the target was not in the page (a concurrent delete, say), and
        // pointing `selectedId` at a record that is not in the list blanks the reader.
        if (!recordsRef.current.some(x => x.id === r.recordId)) {
          setResumeNote(`${r.message} That article is no longer in the list, so the nearest one is open.`);
          return;
        }
        selectRecord(r.recordId);
      }
      setScrollToSelected(true);
      setResumeNote(narrowed
        ? `${r.message} Your ${reordered ? 'AI worklist order and filters were' : 'filters were'} cleared so it is visible.`
        : r.message);
    } catch {
      setResumeNote('Could not work out where you stopped — try again in a moment.');
    } finally {
      setResuming(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, resuming, loadRecords, selectRecord]);

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
      // 100.md §13 — the stopping point moved: recompute how much is left and where
      // "continue" now points, so leaving the page and coming back is always accurate.
      refreshResume({ now: true });
      setResumeNote('');
      // se2.md §6 — surface the "scores updating" indicator promptly after a
      // settled decision (the server has queued a debounced rescore).
      if (dec === 'include' || dec === 'exclude') ai.loadJobStatus?.();
      setTimeout(() => setSaveMsg(''), 2200);
    } catch (e) {
      setDecErr(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [pid, canScreen, excReason, notes, rating, chosenLabels, refreshRow, refreshResume]);

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

      {uiPrefs.leftCollapsed ? (
        <CollapsedRail side="left" label="Records" hint={`${total} record${total === 1 ? '' : 's'}`} onExpand={() => setPanel('leftCollapsed', false)} />
      ) : (
        <LeftColumn
          records={displayRecords} total={total} loading={loading} loadingMore={loadingMore}
          listError={listError} onRetry={() => loadRecords({ reset: true })}
          search={search} onSearchChange={onSearchChange}
          filter={filter} onFilterChange={onFilterChange}
          selectedId={selectedId} onSelect={selectRecord}
          blindMode={blindMode}
          /* 100.md §13 — derived from the PAGE WINDOW, not from records.length: after a
             resume jump the loaded run starts at firstPage, so `records.length < total`
             would promise 499 more when only 399 lie ahead — and would hide the pages
             before the jump entirely. (pageWindow is pure + unit-tested.) */
          {...pageWin}
          onLoadMore={loadMore} onLoadEarlier={loadEarlier}
          shortcutPrefs={shortcutPrefs}
          onCollapse={() => setPanel('leftCollapsed', true)}
          ai={ai} queueMode={queueMode} onQueueMode={setQueueMode} aiBand={aiBand} onAiBand={setAiBand} onRefreshRankings={refreshRankings}
          /* 100.md §§12-15 */
          resume={resume} resuming={resuming} resumeNote={resumeNote} onResume={doResume}
          canScreen={canScreen}
          scrollToSelected={scrollToSelected} onScrolledToSelected={clearScrollToSelected}
        />
      )}

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
        recordIndex={displayRecords.findIndex(r => r.id === selectedId)}
        recordCount={displayRecords.length} totalCount={total}
        onPrev={() => moveSelection(-1)} onNext={() => moveSelection(1)}
        /* 107.md §7 — the footer says whether "Next" can still go anywhere, so the
           reviewer is never left guessing at the bottom of a 5,000-record list. */
        hasMore={pageWin.hasMore} loadingMore={loadingMore} listError={listError}
        shortcutPrefs={shortcutPrefs}
        ai={ai}
        elig={elig}
        abstractRef={abstractRef}
      />

      {uiPrefs.rightCollapsed ? (
        <CollapsedRail side="right" label="Filters & keywords" hint={selectedKeywords.length ? `${selectedKeywords.length} active` : ''} onExpand={() => setPanel('rightCollapsed', false)} />
      ) : (
        <RightColumn
          pid={pid} project={project} access={access} refreshProject={refreshProject}
          isLeader={isLeader}
          inclusion={inclusion} exclusion={exclusion} studyTypes={studyTypes}
          inclSource={inclSource} exclSource={exclSource}
          showInclusion={showInclusion} setShowInclusion={setShowInclusion}
          showExclusion={showExclusion} setShowExclusion={setShowExclusion}
          labels={labels} setLabels={setLabels} reasons={reasons} setReasons={setReasons}
          blindMode={blindMode}
          kwStats={kwStats} loadKwStats={loadKwStats}
          selectedIncl={selectedIncl} setSelectedIncl={setSelectedIncl}
          selectedExcl={selectedExcl} setSelectedExcl={setSelectedExcl}
          clearKeywordFilters={clearKeywordFilters}
          shownCount={total} projectTotal={kwStats.total}
          onCollapse={() => setPanel('rightCollapsed', true)}
          ai={ai}
          elig={elig}
          /* 107.md §2 — suggestion review + single-term ops */
          kwPendingIncl={kw.include.pending} kwPendingExcl={kw.exclude.pending}
          kwConflicts={kw.conflicts}
          canEditKeywords={canEditKeywords}
          runKeywordOp={runKeywordOp} kwOpError={kwOpError}
        />
      )}

      {/* 107.md §3 — opposite-list confirmation. Moving is one atomic 'move' op. */}
      {kwConflict && (
        <Modal onClose={() => setKwConflict(null)} width={420} label="Move keyword to the other list">
          <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 8 }}>
            Already an {kwConflict.from === 'include' ? 'inclusion' : 'exclusion'} keyword
          </div>
          <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, margin: '0 0 18px' }}>
            “{kwConflict.phrase}” is already in your {kwConflict.from === 'include' ? 'inclusion' : 'exclusion'} keywords.
            Move it to {kwConflict.to === 'include' ? 'inclusion' : 'exclusion'} instead?
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setKwConflict(null)}>Cancel</Button>
            <Button onClick={confirmKeywordMove}>
              {kwConflict.to === 'include' ? 'Move to Inclusion' : 'Move to Exclusion'}
            </Button>
          </div>
        </Modal>
      )}

      {/* 107.md §3 — subtle confirmation + real (server-persisted) Undo. */}
      <KeywordSnackbar
        message={kwNote?.message || ''}
        tone={kwNote?.tone}
        onUndo={kwNote?.undo ? undoKeywordNote : undefined}
        onDismiss={dismissKeywordNote}
      />
    </div>
  );
}

// Thin vertical rail shown when a side panel is collapsed (prompt29 Parts 4/5).
function CollapsedRail({ side, label, hint, onExpand }) {
  const border = side === 'left' ? { borderRight: `1px solid ${C.brd}` } : { borderLeft: `1px solid ${C.brd}` };
  return (
    <div style={{ width: 38, flexShrink: 0, background: C.surf, ...border, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 10, gap: 12 }}>
      <button
        onClick={onExpand}
        title={`Show ${label} panel`}
        aria-label={`Show ${label} panel`}
        style={{ background: C.card, border: `1px solid ${C.brd2}`, color: C.txt2, cursor: 'pointer', borderRadius: 7, width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, lineHeight: 1 }}
      >{side === 'left' ? '›' : '‹'}</button>
      <span style={{ writingMode: 'vertical-rl', transform: side === 'left' ? 'rotate(180deg)' : 'none', fontSize: 10, fontFamily: MONO, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted, userSelect: 'none' }}>
        {label}{hint ? ` · ${hint}` : ''}
      </span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LEFT COLUMN — search · filter · record list
// ════════════════════════════════════════════════════════════════════════════

function LeftColumn({
  records, total, loading, loadingMore, listError, onRetry,
  search, onSearchChange, filter, onFilterChange,
  selectedId, onSelect, blindMode,
  hasMore, remaining, onLoadMore, hasEarlier, earlierCount, onLoadEarlier,
  shortcutPrefs, onCollapse,
  ai, queueMode, onQueueMode, aiBand, onAiBand, onRefreshRankings,
  resume, resuming, resumeNote, onResume, canScreen,
  scrollToSelected, onScrolledToSelected,
}) {
  const k = shortcutPrefs?.keys ?? DEFAULT_SCREENING_SHORTCUTS.keys;

  // 65.md SCR-5 — windowed rendering of the ACCUMULATED array. "Load more" keeps
  // appending records, but only a slice around the scroll position is in the DOM;
  // spacer blocks preserve the scroll height so the scrollbar behaves as if every
  // row were rendered. Small lists (≤ WINDOW_MIN_COUNT) render exactly as before.
  const scrollRef = useRef(null);
  const rowsRef = useRef(null);
  const scrollRaf = useRef(0);
  // 107.md rec — the opaque sticky "Load more" bar is pinned INSIDE this scrollport, so
  // the bottom of `clientHeight` is not visible space. Measured, not hard-coded: the
  // button's padding and font scale with the design tokens.
  const loadMoreRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [rowH, setRowH] = useState(DEFAULT_ROW_HEIGHT);
  const windowed = shouldWindow(records.length);
  const win = windowed
    ? computeListWindow({ count: records.length, scrollTop, viewportHeight: viewportH, rowHeight: rowH })
    : null;
  const visibleRecords = windowed ? records.slice(win.start, win.end) : records;

  const onListScroll = useCallback(() => {
    if (scrollRaf.current) return; // coalesce to one state update per frame
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      const el = scrollRef.current;
      if (!el) return;
      setScrollTop(el.scrollTop);
      setViewportH(el.clientHeight || 600);
    });
  }, []);
  useEffect(() => () => { if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current); }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const measure = () => setViewportH(el.clientHeight || 600);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  // Refine the row-height estimate from the really-rendered slice (threshold-gated,
  // so this cannot re-render in a loop).
  useEffect(() => {
    if (!windowed || !rowsRef.current || !visibleRecords.length) return;
    setRowH(prev => measuredRowHeight(rowsRef.current.offsetHeight, visibleRecords.length, prev));
  }, [windowed, visibleRecords.length, records.length, scrollTop]);

  // Shared by the two scroll effects below: which selection the nearest-scroll pass has
  // already handled, and whether it still owes one. Declared here because the resume
  // one-shot has to hand ownership of a selection over to it (107.md rec).
  const navSelRef = useRef(null);
  const navPendingRef = useRef(false);

  // 100.md §13 — after Resume Screening loads the right page, bring the resumed row
  // into view. One-shot: the parent clears the flag so ordinary selection (arrow keys,
  // clicking a row) never yanks the list around.
  useEffect(() => {
    if (!scrollToSelected || !selectedId) return;
    const el = scrollRef.current;
    if (!el) return;
    let centred = false;
    const row = el.querySelector(`[data-record-id="${CSS.escape(selectedId)}"]`);
    if (row && typeof row.scrollIntoView === 'function') {
      try { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { row.scrollIntoView(); }
      centred = true;
    } else if (windowed) {
      // Above WINDOW_MIN_COUNT rows only a slice is in the DOM (65.md SCR-5), so the
      // resumed row can be absent — scrolling to nothing would silently strand the
      // reviewer at the top of a list whose selected article is 400 rows down. Drive the
      // virtual scroller to the row's computed offset instead; the window then renders
      // it, and this effect's next pass centres it exactly.
      const idx = records.findIndex(r => r.id === selectedId);
      if (idx >= 0) {
        el.scrollTop = Math.max(0, (idx * rowH) - (el.clientHeight / 2));
        return; // keep the flag set: re-run once the row is mounted
      }
    }
    // 107.md rec — this one-shot OWNS the scroll for this selection. Clearing the flag
    // below re-runs the nearest-scroll effect one commit later, and it would write
    // `el.scrollTop` a few milliseconds into the smooth animation above — cancelling it
    // and leaving the resumed article edge-aligned instead of centred. Marking the
    // selection handled here is what keeps the centring.
    if (centred) { navSelRef.current = selectedId; navPendingRef.current = false; }
    if (onScrolledToSelected) onScrolledToSelected();
  }, [scrollToSelected, selectedId, onScrolledToSelected, windowed, records, rowH]);

  /* ── 107.md §5 — keep the selected row visible during ordinary navigation ──────
     Arrow keys could move the selection to a row far outside the visible slice (or,
     above WINDOW_MIN_COUNT rows, to one that is not even mounted), so the reviewer
     lost all list context while the abstract changed under them.

     Deliberately NOT `row.scrollIntoView()`: that walks up the tree and can scroll the
     page and the middle column too, which §5 forbids ("do not scroll the entire
     browser page / reposition the abstract"). Writing `container.scrollTop` moves this
     one element and nothing else. The offset is the MINIMUM that makes the row fully
     visible ('nearest'), so a row already in view never moves — this is also why the
     effect must fire on SELECTION changes only: reacting to scrollTop as well would
     snap the list back every time the reviewer scrolled ahead by hand.

     107.md rec — the offset is computed against the UNOBSTRUCTED band, not the raw
     clientHeight: the "Load more" bar is `position: sticky; bottom: 0` and opaque
     inside this very scrollport, so bottom-aligning a row parked ~50px of a 74px row
     behind it on exactly the long lists this was written for. The "Earlier records"
     block at the top is in normal flow (it scrolls away), so there is no top inset. */
  useEffect(() => {
    if (navSelRef.current !== selectedId) { navSelRef.current = selectedId; navPendingRef.current = true; }
    if (!navPendingRef.current) return;
    if (scrollToSelected) return;                 // the resume one-shot owns this pass
    const el = scrollRef.current;
    const vh = el ? (el.clientHeight || 0) : 0;
    if (!el || !selectedId || !vh) { navPendingRef.current = false; return; }
    // 0 when the bar is not rendered (`!hasMore`) — React nulls the ref on unmount, and
    // the prop is checked too so a stale node can never contribute a phantom inset.
    const insetBottom = (hasMore && loadMoreRef.current) ? (loadMoreRef.current.offsetHeight || 0) : 0;

    const row = el.querySelector(`[data-record-id="${CSS.escape(selectedId)}"]`);
    if (row) {
      // Measured against the container's own box: `offsetTop` is relative to whatever
      // the nearest positioned ancestor happens to be, which is not this container.
      const cRect = el.getBoundingClientRect();
      const rRect = row.getBoundingClientRect();
      const next = nearestScrollTop({
        rowTop: (rRect.top - cRect.top) + el.scrollTop,
        rowHeight: rRect.height,
        scrollTop: el.scrollTop, viewportHeight: vh,
        insetBottom,
      });
      if (next != null) el.scrollTop = next;
      navPendingRef.current = false;
      return;
    }
    if (!windowed) { navPendingRef.current = false; return; }
    // Windowed and unmounted: estimate from the uniform row height, drive the virtual
    // scroller there, and keep the flag set — the window then mounts the row and the
    // next pass measures it for real (same two-step the resume effect above uses).
    const idx = records.findIndex(r => r.id === selectedId);
    if (idx < 0) { navPendingRef.current = false; return; }
    const next = nearestScrollTop({ rowTop: idx * rowH, rowHeight: rowH, scrollTop: el.scrollTop, viewportHeight: vh, insetBottom });
    if (next == null) { navPendingRef.current = false; return; }
    el.scrollTop = next;
  }, [selectedId, scrollToSelected, windowed, records, rowH, scrollTop, hasMore]);

  return (
    <div style={{ width: 300, flexShrink: 0, borderRight: `1px solid ${C.brd}`, display: 'flex', flexDirection: 'column', background: C.surf, overflow: 'hidden', minHeight: 0 }}>
      {/* 100.md §12 — Resume Screening: prominent (first thing in the panel, full
          width, accent-tinted) but unobtrusive (one line, no icon noise, and it
          disappears entirely once the stage is finished or there is nothing to
          resume). §15 — the completed / empty states say so instead of doing nothing. */}
      <ResumeBar resume={resume} resuming={resuming} note={resumeNote} onResume={onResume} canScreen={canScreen} />

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
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 10, color: C.muted, fontFamily: MONO, letterSpacing: '0.04em' }}>
            {records.length} / {total} {total === 1 ? 'RECORD' : 'RECORDS'}
            {(search || filter !== 'all') && ' · FILTERED'}
          </span>
          {onCollapse && (
            <button onClick={onCollapse} title="Collapse records panel" aria-label="Collapse records panel"
              style={{ background: 'none', border: `1px solid ${C.brd2}`, color: C.txt2, cursor: 'pointer', borderRadius: 6, width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, lineHeight: 1, flexShrink: 0 }}>‹</button>
          )}
        </div>
      </div>

      {/* AI active-learning queue selector (feature flag: aiScreening) */}
      {ai?.enabled && (
        <div style={{ padding: '9px 14px', borderBottom: `1px solid ${C.brd}`, flexShrink: 0 }}>
          <AiQueueBar ai={ai} mode={queueMode} onMode={onQueueMode} band={aiBand} onBand={onAiBand} onRefreshRankings={onRefreshRankings} />
        </div>
      )}

      {/* List — windowed above WINDOW_MIN_COUNT rows (65.md SCR-5) */}
      <div ref={scrollRef} onScroll={windowed ? onListScroll : undefined} className="sift-rl" style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
            {/* 100.md §13 — the mirror of "Load more": after Resume Screening lands you
                in the middle of a long list, the records BEFORE it must stay reachable. */}
            {hasEarlier && (
              <div data-testid="screening-load-earlier" style={{ background: C.surf, borderBottom: `1px solid ${C.brd}`, padding: '10px 14px', textAlign: 'center', flexShrink: 0 }}>
                <Button variant="ghost" onClick={onLoadEarlier} disabled={loadingMore} full style={{ fontSize: 12, padding: '7px 14px' }}>
                  {loadingMore ? 'Loading…' : `↑ Earlier records (${Number(earlierCount || 0).toLocaleString()})`}
                </Button>
              </div>
            )}
            {windowed && <div aria-hidden="true" style={{ height: win.topPad, flexShrink: 0 }} />}
            <div ref={rowsRef} style={{ flexShrink: 0 }}>
              {visibleRecords.map(r => (
                <RecordRow key={r.id} record={r} selected={r.id === selectedId} onClick={() => onSelect(r.id)} blindMode={blindMode} scoreInfo={ai?.enabled ? (r.aiScore || ai.scores[r.id]) : null} />
              ))}
            </div>
            {windowed && <div aria-hidden="true" style={{ height: win.bottomPad, flexShrink: 0 }} />}
            {hasMore && (
              /* 107.md rec — measured by the nearest-scroll effect above: this bar is
                 opaque and pinned over the bottom of the list's own scrollport, so it
                 has to be subtracted from the usable viewport before a row is
                 bottom-aligned against it. */
              <div ref={loadMoreRef} data-testid="screening-load-more" style={{ position: 'sticky', bottom: 0, background: C.surf, borderTop: `1px solid ${C.brd}`, padding: '10px 14px', textAlign: 'center', flexShrink: 0 }}>
                <Button variant="ghost" onClick={onLoadMore} disabled={loadingMore} full style={{ fontSize: 12, padding: '7px 14px' }}>
                  {loadingMore ? 'Loading…' : `Load more (${Number(remaining || 0).toLocaleString()})`}
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

/**
 * ResumeBar — 100.md §§12/15. One line at the very top of the records panel.
 *
 * Wording comes from the SERVER (`resume.message`, produced by the shared pure
 * `resumeMessage` helper) so the button, the confirmation line and any future surface
 * can never drift apart. The bar renders nothing at all when there is nothing useful
 * to say — a reviewer with an empty project or no screening permission sees no chrome.
 */
export function ResumeBar({ resume, resuming, note, onResume, canScreen }) {
  if (!canScreen || !resume) return null;
  const { status, pending, decided, position, stageTotal } = resume;
  if (status === 'empty') return null;

  const done = status === 'complete';
  const tone = done ? C.grn : C.acc;
  const label = status === 'start'
    ? 'Start screening'
    : status === 'reopen'
      ? 'Back to your open article'
      : 'Continue where you left off';
  const detail = done
    ? `All ${Number(stageTotal || 0).toLocaleString()} screened`
    : `${Number(pending || 0).toLocaleString()} left${position ? ` · resumes at #${Number(position).toLocaleString()}` : ''}`;

  return (
    <div data-testid="screening-resume-bar" data-status={status}
      style={{ padding: '10px 14px', borderBottom: `1px solid ${C.brd}`, background: C.surf, flexShrink: 0 }}>
      {done ? (
        <div data-testid="screening-resume-complete"
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: C.grn, lineHeight: 1.5 }}>
          <span aria-hidden="true">✓</span>
          <span>You have completed screening for this stage.</span>
        </div>
      ) : (
        /* Two lines, not one row: the records panel is 300px wide, so a label + stats
           on the same line ellipsised the label away ("Contin… 3 done · 5 left"). The
           action reads first; the numbers sit under it in the same mono voice as the
           record counter below. */
        <button
          type="button"
          data-testid="screening-resume-button"
          onClick={onResume}
          disabled={!!resuming}
          aria-label={`${label} — ${detail}`}
          title="Jump to the next article that needs your decision"
          style={{
            width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 3,
            background: C.accBg, border: `1px solid ${tone}55`, borderRadius: 8,
            padding: '8px 11px', color: C.txt, fontFamily: FONT, fontSize: 12.5, fontWeight: 600,
            cursor: resuming ? 'wait' : 'pointer', textAlign: 'left', opacity: resuming ? 0.65 : 1,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {resuming ? 'Finding your place…' : label}
            </span>
            <span aria-hidden="true" style={{ color: tone, flexShrink: 0, fontSize: 13, lineHeight: 1 }}>→</span>
          </span>
          <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 400, color: C.muted, letterSpacing: '0.04em' }}>
            {decided ? `${Number(decided).toLocaleString()} done · ` : ''}{detail}
          </span>
        </button>
      )}
      {note && (
        <div data-testid="screening-resume-note" role="status" aria-live="polite"
          style={{ marginTop: 6, fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
          {note}
        </div>
      )}
    </div>
  );
}

// 107.md §6 — the left-list decision indicator. Exported so the glyph contract (one
// compact mark per row, driven by the optimistic `myDecision` patch) is regression-
// locked alongside the decision bar it has to agree with.
export function RecordRow({ record, selected, onClick, blindMode, scoreInfo }) {
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
      /* 100.md §13 — Resume Screening scrolls the resumed article into view, which
         needs a stable way to find its row. Also the first addressable hook the
         screening list has had for tests. */
      data-testid="screening-record-row"
      data-record-id={record.id}
      data-selected={selected ? 'true' : 'false'}
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
              const decLabel = DECISION_LABEL[rv.decision] || rv.decision;
              const dateStr = fmtDecisionDate(rv.decidedAt);
              // Respect blind mode: never reveal (even anonymised) identity as a name.
              const tip = blindMode
                ? { title: 'Reviewer decision hidden', description: 'Reviewer identity is hidden during blind review.' }
                : { title: `${rv.reviewerName} — ${decLabel}`, description: dateStr ? `Reviewed ${dateStr}` : undefined };
              return (
                <Tooltip key={i} title={tip.title} description={tip.description}>
                  <span
                    tabIndex={0}
                    aria-label={blindMode ? 'Reviewer decision (identity hidden during blind review)' : `${rv.reviewerName}: ${decLabel}${dateStr ? `, reviewed ${dateStr}` : ''}`}
                    style={{
                      fontSize: 9.5, fontFamily: MONO, fontWeight: 700, color: dc.txt,
                      width: 15, height: 15, borderRadius: '50%',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: alpha(dc.bg, 'aa'),
                      border: rv.isMe ? `1.5px solid ${dc.border}` : `1px solid ${alpha(dc.border, '55')}`,
                      boxShadow: rv.isMe ? `0 0 0 1px ${C.surf}` : 'none', cursor: 'default',
                    }}
                  >
                    {DECISION_GLYPH[rv.decision] || '·'}
                  </span>
                </Tooltip>
              );
            })}
          </span>
        )}
        {record.currentStage === 'full_text'
          ? <Tooltip content={STATUS_HELP.secondReview}><Badge color={C.grn}>2nd review</Badge></Tooltip>
          : record.quorumMet && <Tooltip content={STATUS_HELP.quorum}><Badge color={C.teal}>Quorum</Badge></Tooltip>}
        {record.handoffStatus === 'sent' && <Tooltip content={STATUS_HELP.sent}><Badge color={C.acc}>Sent</Badge></Tooltip>}
        {record.disputed && <Tooltip content={STATUS_HELP.disputed}><Badge color={C.gold}>Disputed</Badge></Tooltip>}
        {record.isDuplicate && <Tooltip content={STATUS_HELP.duplicate}><Badge color={C.gold}>Dup</Badge></Tooltip>}
        {scoreInfo && <ScoreBadge score={scoreInfo.score} band={scoreInfo.band} prediction={scoreInfo.prediction} />}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MIDDLE COLUMN — record detail · abstract · PDF · decision bar
// ════════════════════════════════════════════════════════════════════════════

export function MiddleColumn({
  record, loading, blindMode, canScreen, isLeader,
  inclusion, exclusion, showInclusion, showExclusion, pid,
  decision, excReason, setExcReason, notes, setNotes, rating, setRating,
  reasons, setReasons, labels, chosenLabels, toggleLabel,
  onDecisionClick, onUndo, onSaveDetails, saving, saveMsg, decErr,
  recordIndex, recordCount, totalCount, onPrev, onNext,
  hasMore, loadingMore, listError,
  shortcutPrefs, ai, elig, abstractRef,
}) {
  const k = shortcutPrefs?.keys ?? DEFAULT_SCREENING_SHORTCUTS.keys;
  const shortcutsOn = shortcutPrefs?.enabled !== false;
  // 107.md §4 — segment once per record; highlighting still recomputes per render.
  // Declared before the early returns so hook order stays stable.
  const abstractSegs = useMemo(() => segmentAbstract(record?.abstract || ''), [record?.abstract]);
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
            /* 107.md §3 — the ref proves a selection belongs to THIS abstract before
               Cmd/Ctrl+I / Cmd/Ctrl+E may add it as a keyword.
               107.md §4 — structured headings render <strong>; keyword <mark>s are
               produced per text segment, so the two can never overlap. */
            <p ref={abstractRef} data-testid="screening-abstract"
              style={{ fontSize: 14, color: C.txt, lineHeight: 1.75, margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
              {renderAbstract(record.abstract, { inclusion, exclusion, showInclusion, showExclusion, segments: abstractSegs })}
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

        {/* ── Import provenance (96.md 5D) — which searches found this article,
               which databases it appeared in, and later metadata changes.
               key resets the lazy fetch when the selected record changes. ──── */}
        <div style={{ margin: '4px 0 16px' }}>
          <ImportProvenance key={record.id} pid={pid} recordId={record.id} />
        </div>

        {/* ── AI relevance assistance (feature flag: aiScreening) ─────────── */}
        {ai?.enabled && (
          <div style={{ margin: '4px 0 16px' }}>
            <AiScoreCard ai={ai} record={record} decided={record.myDecision?.decision} />
          </div>
        )}

        {/* ── Criteria Screener eligibility (feature flag: eligibilityScreening) ─ */}
        {elig?.enabled && (
          <div style={{ margin: '4px 0 16px' }}>
            <EligibilityCard elig={elig} record={record} canScreen={canScreen} />
          </div>
        )}

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

        {/* ── Decision details ───────────────────────────────────────────────
               107.md §6 — Include / Exclude / Maybe themselves live in the STICKY
               DecisionBar below, directly under the abstract and permanently visible;
               what stays here is everything that only matters once a decision is
               made (reason, labels, notes, rating). */}
        <Card style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <SectionLabel>{canScreen ? 'Decision details' : 'Decision details (view-only)'}</SectionLabel>
            {!canScreen && <span style={{ fontSize: 11, color: C.gold }}>You have view-only access</span>}
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
            </div>
          )}
        </Card>

        {/* 107.md §6 — the decision controls themselves: last in normal flow (so they
            can never cover the abstract) and sticky to the bottom of this scroll
            container (so they are never out of reach on a laptop screen). */}
        <DecisionBar
          decision={decision} canScreen={canScreen}
          onDecisionClick={onDecisionClick} onUndo={onUndo}
          shortcutPrefs={shortcutPrefs} saveMsg={saveMsg} decErr={decErr}
        />

      </div>
      </div>

      {/* ── Prev / Next nav — sticky footer, always visible ────────────── */}
      <RecordNavFooter
        recordIndex={recordIndex} recordCount={recordCount} totalCount={totalCount}
        hasMore={hasMore} loadingMore={loadingMore} listError={listError}
        onPrev={onPrev} onNext={onNext} shortcutPrefs={shortcutPrefs}
      />
    </div>
  );
}

/**
 * DecisionBar — 107.md §6. Include / Exclude / Maybe under the abstract, always
 * visible, with the CURRENT decision stated rather than implied.
 *
 * Sticky rather than fixed: it is the last block of the middle column's scrolling
 * content, so it occupies real space at the end of the record instead of floating
 * over the text, and `bottom: 0` pins it to the viewport edge while the reviewer is
 * still reading. A single compact row keeps it viable on short laptop displays.
 *
 * The chip is the honest part: an unscreened record reads "Undecided" in the muted
 * palette — no button is left looking half-selected (§6 "neither should look falsely
 * selected"), which is also why `aria-pressed` is on every button rather than only
 * the active one.
 */
export function DecisionBar({ decision, canScreen, onDecisionClick, onUndo, shortcutPrefs, saveMsg, decErr }) {
  const k = shortcutPrefs?.keys ?? DEFAULT_SCREENING_SHORTCUTS.keys;
  const shortcutsOn = shortcutPrefs?.enabled !== false;
  const current = decision || 'undecided';
  return (
    <div
      data-testid="screening-decision-bar"
      data-decision={current}
      style={{
        position: 'sticky', bottom: 0, zIndex: 3,
        margin: '18px -28px -24px', padding: '10px 28px',
        background: C.surf, borderTop: `1px solid ${C.brd}`, boxShadow: `0 -8px 20px ${C.shadow}`,
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginRight: 2 }}>
        <span style={{ fontSize: 9.5, fontFamily: MONO, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted }}>Decision</span>
        <DecisionChip decision={current} label={DECISION_LABEL[current] || 'Undecided'} />
      </span>
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
      {/* Save feedback lives here, not down in the details card: a keyboard decision
          must confirm itself somewhere the reviewer is actually looking. */}
      <span role="status" aria-live="polite" style={{ fontSize: 11.5, fontFamily: MONO, color: decErr ? C.red : C.grn, minWidth: 0 }}>
        {decErr || saveMsg || ''}
      </span>
    </div>
  );
}

/**
 * RecordNavFooter — 107.md §7. Prev / Next, the position counter, and an honest
 * statement of what lies beyond the last loaded study.
 *
 * "Next" stays enabled at the end of the loaded window whenever more records exist
 * server-side (it triggers the same auto-pagination the arrow key does); it only goes
 * dead at the TRUE end of the list, where the muted "End of list" line says so
 * explicitly instead of leaving a silently disabled button.
 */
export function RecordNavFooter({ recordIndex, recordCount, totalCount, hasMore, loadingMore, listError, onPrev, onNext, shortcutPrefs }) {
  const k = shortcutPrefs?.keys ?? DEFAULT_SCREENING_SHORTCUTS.keys;
  const shortcutsOn = shortcutPrefs?.enabled !== false;
  const atLast = recordCount > 0 && recordIndex >= recordCount - 1;
  const atEnd = atLast && !hasMore;
  return (
    <div data-testid="screening-record-nav" style={{ flexShrink: 0, borderTop: `1px solid ${C.brd}`, background: C.surf, padding: '12px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Button variant="ghost" onClick={onPrev} disabled={recordIndex <= 0} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        {shortcutsOn && <span style={{ fontSize: 9, fontFamily: MONO, background: alpha(C.brd, '80'), border: `1px solid ${C.brd2}`, borderRadius: 3, padding: '1px 4px', color: C.muted, lineHeight: 1.2 }}>{keyLabel(k.previous)}</span>}
        ← Previous
      </Button>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
          {recordIndex + 1} / {recordCount}{totalCount > recordCount ? ` (of ${totalCount})` : ''}
        </span>
        {loadingMore ? (
          <span data-testid="screening-loading-more" role="status" aria-live="polite"
            style={{ fontSize: 9.5, fontFamily: MONO, letterSpacing: '0.06em', color: C.acc }}>
            Loading more…
          </span>
        ) : listError && atLast ? (
          <span data-testid="screening-load-failed" role="status" aria-live="polite"
            style={{ fontSize: 9.5, fontFamily: MONO, letterSpacing: '0.06em', color: C.red }}>
            Could not load more — retry from the list
          </span>
        ) : atEnd ? (
          <span data-testid="screening-end-of-list"
            style={{ fontSize: 9.5, fontFamily: MONO, letterSpacing: '0.06em', color: C.muted }}>
            End of list
          </span>
        ) : null}
      </div>
      <Button variant="ghost" onClick={onNext} disabled={recordIndex < 0 || atEnd || (atLast && loadingMore)} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        Next →
        {shortcutsOn && <span style={{ fontSize: 9, fontFamily: MONO, background: alpha(C.brd, '80'), border: `1px solid ${C.brd2}`, borderRadius: 3, padding: '1px 4px', color: C.muted, lineHeight: 1.2 }}>{keyLabel(k.next)}</span>}
      </Button>
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
      /* 107.md §6 — the state is in the accessibility tree, not only in the colour:
         `aria-pressed` is present on EVERY button (false, not omitted) so an
         unscreened record reads as three explicitly un-pressed toggles. Visible focus
         comes from the app-wide `button:focus-visible` ring in theme/tokens.js. */
      aria-pressed={!!active}
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
  inclusion, exclusion, studyTypes, inclSource, exclSource,
  showInclusion, setShowInclusion, showExclusion, setShowExclusion,
  labels, setLabels, reasons, setReasons, blindMode,
  kwStats, loadKwStats, selectedIncl, setSelectedIncl, selectedExcl, setSelectedExcl,
  clearKeywordFilters, shownCount, projectTotal, onCollapse, ai, elig,
  kwPendingIncl, kwPendingExcl, kwConflicts, canEditKeywords, runKeywordOp, kwOpError,
}) {
  const [open, setOpen] = useState({
    ai: true, eligibility: true, pico: true, keywords: true,
    studyTypes: false, labels: false, reasons: false,
  });
  const toggle = key => setOpen(o => ({ ...o, [key]: !o[key] }));

  return (
    <div className="sift-rt" style={{ width: 320, flexShrink: 0, borderLeft: `1px solid ${C.brd}`, background: C.surf, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Collapse control (prompt29 Part 4) */}
      {onCollapse && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px 8px 16px', borderBottom: `1px solid ${C.brd}` }}>
          <span style={{ fontSize: 9.5, fontFamily: MONO, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted }}>Filters & keywords</span>
          <button onClick={onCollapse} title="Collapse panel" aria-label="Collapse filters panel"
            style={{ background: 'none', border: `1px solid ${C.brd2}`, color: C.txt2, cursor: 'pointer', borderRadius: 6, width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, lineHeight: 1, flexShrink: 0 }}>›</button>
        </div>
      )}
      {/* Blind-mode banner */}
      {blindMode && (
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge color={C.gold}>Blind mode</Badge>
          <span style={{ fontSize: 11, color: C.txt2 }}>Authors & reviewers anonymised</span>
        </div>
      )}

      {/* Guided Screening — the advanced model/diagnostics/config panel. 89.md: this is
          restricted to project ADMINISTRATORS (leader / settings-manager / site admin) via
          the server-computed `canConfigure`. Regular screeners never see this Section; they
          get the simplified Run Scores control (AiQueueBar) + per-article scores instead.
          Score updates keep flowing regardless — the hook + realtime live above this. */}
      {ai?.enabled && ai?.status?.canConfigure && (
        <Section title="Guided Screening" open={open.ai} onToggle={() => toggle('ai')}>
          <AiStatusPanel ai={ai} />
        </Section>
      )}

      {/* Criteria Screener / Eligibility (feature flag: eligibilityScreening) */}
      {elig?.enabled && (
        <Section title="Eligibility criteria" open={open.eligibility} onToggle={() => toggle('eligibility')}>
          <EligibilityCriteria elig={elig} canEdit={isLeader} />
        </Section>
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
          kwPendingIncl={kwPendingIncl} kwPendingExcl={kwPendingExcl} kwConflicts={kwConflicts}
          canEditKeywords={canEditKeywords} runKeywordOp={runKeywordOp} kwOpError={kwOpError}
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

// ── Criteria Screener panel (P10) — build/edit eligibility criteria, run the
// screener over undecided records, and (leaders) review validation. All copy is
// criteria-based; no user-facing "AI". Renders only when the flag self-detects on.
function EligibilityCriteria({ elig, canEdit }) {
  const [showValidation, setShowValidation] = useState(false);
  return (
    <div>
      <CriteriaBuilder
        criteria={elig.criteria}
        version={elig.criteriaVersion}
        canEdit={canEdit}
        onSave={elig.saveCriteria}
        onRun={() => elig.evaluate('undecided')}
        running={elig.running}
        jobStatus={elig.jobStatus}
        summary={elig.summary}
        canRun={canEdit}
      />
      {canEdit && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.brd}` }}>
          <button
            onClick={() => setShowValidation(v => !v)}
            style={{ background: 'none', border: 'none', color: C.acc, fontSize: 11.5, fontFamily: FONT, cursor: 'pointer', padding: 0 }}>
            {showValidation ? '▾ Hide validation' : '▸ Show validation vs reviewer decisions'}
          </button>
          {showValidation && <div style={{ marginTop: 12 }}><EligibilityValidationPanel elig={elig} /></div>}
        </div>
      )}
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
  inclusion, exclusion, inclSource, exclSource, kwStats, loadKwStats,
  selectedIncl, setSelectedIncl, selectedExcl, setSelectedExcl, clearKeywordFilters,
  shownCount, projectTotal,
  showInclusion, setShowInclusion, showExclusion, setShowExclusion,
  kwPendingIncl = [], kwPendingExcl = [], kwConflicts = [],
  canEditKeywords, runKeywordOp, kwOpError,
}) {
  const [editing, setEditing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const anySelected = selectedIncl.length + selectedExcl.length > 0;
  const suggestionCount = kwPendingIncl.length + kwPendingExcl.length + kwConflicts.length;

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

      {/* 107.md §2 — SUGGESTED keywords derived from this project's eligibility
          criteria. They do NOT highlight, filter or count until a leader accepts
          them, and an ambiguous-polarity concept is flagged for review instead of
          being added to both lists. */}
      {canEditKeywords && suggestionCount > 0 && (
        <SuggestedKeywords
          open={reviewOpen} onToggle={() => setReviewOpen(o => !o)}
          pendingIncl={kwPendingIncl} pendingExcl={kwPendingExcl} conflicts={kwConflicts}
          counts={kwStats} runKeywordOp={runKeywordOp} error={kwOpError}
        />
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
                inclusion={inclusion} exclusion={exclusion}
                inclSource={inclSource} exclSource={exclSource}
                canEditKeywords={canEditKeywords} runKeywordOp={runKeywordOp} opError={kwOpError}
                suggestionCount={suggestionCount}
                onReviewSuggestions={() => setReviewOpen(true)}
                refreshProject={() => { refreshProject?.(); loadKwStats?.(); }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 107.md §2 — suggestion review ────────────────────────────────────────────
// Pending suggestions per side (Accept / Reject) plus a flagged group for concepts
// whose polarity is ambiguous. Nothing here is active until it is accepted.

const ORIGIN_LABEL = {
  [KEYWORD_ORIGIN.MANUAL]: 'Added manually',
  [KEYWORD_ORIGIN.ACCEPTED]: 'Accepted suggestion',
  [KEYWORD_ORIGIN.DEFAULT]: 'Default keyword',
};
const ORIGIN_GLYPH = {
  [KEYWORD_ORIGIN.MANUAL]: '✎',
  [KEYWORD_ORIGIN.ACCEPTED]: '✓',
  [KEYWORD_ORIGIN.DEFAULT]: '·',
};

export function SuggestedKeywords({ open, onToggle, pendingIncl, pendingExcl, conflicts, counts, runKeywordOp, error }) {
  const total = pendingIncl.length + pendingExcl.length + conflicts.length;
  return (
    <div data-testid="screening-keyword-suggestions"
      style={{
        marginTop: 14, border: `1px dashed ${alpha(C.acc, '55')}`, borderRadius: 9,
        background: alpha(C.acc, '08'), padding: '10px 12px',
      }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
        }}>
        <span style={{ fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.acc }}>
          Suggested · {total}
        </span>
        <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{open ? '▾' : '▸'}</span>
      </button>
      {!open && (
        <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5, marginTop: 6 }}>
          Derived from this project&apos;s eligibility criteria. Not active until reviewed.
        </div>
      )}
      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5, marginBottom: 10 }}>
            Derived from this project&apos;s eligibility criteria. Suggestions do not highlight,
            filter or count until you accept them.
          </div>
          <SuggestionGroup
            label="For inclusion" accent={C.grn} list="include" terms={pendingIncl}
            counts={counts.include || {}} runKeywordOp={runKeywordOp}
          />
          <SuggestionGroup
            label="For exclusion" accent={C.red} list="exclude" terms={pendingExcl}
            counts={counts.exclude || {}} runKeywordOp={runKeywordOp}
          />
          {conflicts.length > 0 && (
            <div data-testid="screening-keyword-conflicts" style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.brd}` }}>
              <div style={{ fontSize: 9.5, fontFamily: MONO, color: C.gold, letterSpacing: '0.1em', marginBottom: 4 }}>
                NEEDS REVIEW
              </div>
              <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5, marginBottom: 8 }}>
                Needs review — appears in both inclusion and exclusion contexts.
              </div>
              {conflicts.map(c => (
                <div key={c.term} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: C.txt, marginBottom: 4 }} title={c.reason}>{c.term}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <MiniButton accent={C.grn} onClick={() => runKeywordOp({ type: 'accept', list: 'include', term: c.term })}>
                      Add to inclusion
                    </MiniButton>
                    <MiniButton accent={C.red} onClick={() => runKeywordOp({ type: 'accept', list: 'exclude', term: c.term })}>
                      Add to exclusion
                    </MiniButton>
                    {/* Sequential: each op is a read-modify-write, so firing both
                        at once would let the second read a pre-commit snapshot. */}
                    <MiniButton accent={C.muted} onClick={async () => {
                      for (const op of dismissConflictOps(c.term)) await runKeywordOp(op);
                    }}>
                      Dismiss
                    </MiniButton>
                  </div>
                </div>
              ))}
            </div>
          )}
          {error && <div style={{ fontSize: 10.5, color: C.red, marginTop: 8 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

function SuggestionGroup({ label, accent, list, terms, counts, runKeywordOp }) {
  if (!terms.length) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 9.5, fontFamily: MONO, color: accent, letterSpacing: '0.1em', marginBottom: 6 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {terms.map(t => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.txt2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t}>{t}</span>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, flexShrink: 0 }}>{counts[t] || 0}</span>
            <MiniButton accent={accent} onClick={() => runKeywordOp({ type: 'accept', list, term: t })}>Accept</MiniButton>
            <MiniButton accent={C.muted} onClick={() => runKeywordOp({ type: 'reject', list, term: t })}>Reject</MiniButton>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniButton({ children, accent, onClick, title }) {
  return (
    <button onClick={onClick} title={title}
      style={{
        background: alpha(accent, '14'), border: `1px solid ${alpha(accent, '48')}`, color: accent,
        fontSize: 10.5, fontFamily: FONT, padding: '2px 8px', borderRadius: 6,
        cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
      }}>{children}</button>
  );
}

// Subtle per-term origin badge (107.md §2 "Suggested vs User-Added Terms").
function OriginBadge({ origin }) {
  const label = ORIGIN_LABEL[origin] || ORIGIN_LABEL[KEYWORD_ORIGIN.MANUAL];
  const color = origin === KEYWORD_ORIGIN.ACCEPTED ? C.acc : origin === KEYWORD_ORIGIN.DEFAULT ? C.muted : C.txt2;
  return (
    <span
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', flexShrink: 0,
        fontSize: 8.5, fontFamily: MONO, fontWeight: 700, color,
        borderRadius: 5, padding: '0px 3px', whiteSpace: 'nowrap',
      }}
    >{ORIGIN_GLYPH[origin] || ORIGIN_GLYPH[KEYWORD_ORIGIN.MANUAL]}</span>
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
            const origin = (sourceByTerm || {})[t] || KEYWORD_ORIGIN.MANUAL;
            return (
              <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '2px 0' }}>
                <input type="checkbox" checked={on} onChange={() => toggleTerm(t)}
                  style={{ accentColor: accent, cursor: 'pointer', flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: on ? C.txt : C.txt2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${t} · ${ORIGIN_LABEL[origin] || ORIGIN_LABEL[KEYWORD_ORIGIN.MANUAL]}`}>{t}</span>
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

// ── Keyword editor (active chips + add/remove/move, leader-only edits) ───────
//
// 107.md §2 — every mutation here is a SINGLE-TERM operation against the server
// reducer (`POST /keywords/ops`), not a whole-array overwrite, so two leaders
// editing at once compose instead of clobbering. The destructive
// "✨ Auto-generate from PICO" button is gone: suggestions are now derived live and
// reviewed above, so there is nothing left to "generate" over the top of a leader's
// manual terms. "Reset to defaults" survives but needs an explicit confirm.

function KeywordEditor({
  pid, refreshProject, inclusion, exclusion, isLeader,
  inclSource, exclSource, canEditKeywords, runKeywordOp, opError,
  suggestionCount = 0, onReviewSuggestions,
}) {
  const [newIncl, setNewIncl] = useState('');
  const [newExcl, setNewExcl] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  const mayEdit = canEditKeywords !== undefined ? canEditKeywords : isLeader;

  async function runOp(op) {
    setSaving(true); setErr(''); setMsg('');
    try {
      const r = await runKeywordOp?.(op);
      if (r) setMsg(r.changed ? 'Saved' : 'No change');
      setTimeout(() => setMsg(''), 1800);
    } finally { setSaving(false); }
  }

  function addTerm(kind) {
    const list = kind === 'incl' ? 'include' : 'exclude';
    const raw = (kind === 'incl' ? newIncl : newExcl).trim();
    if (!raw) return;
    if (kind === 'incl') setNewIncl(''); else setNewExcl('');
    // Duplicate detection is normalized + case-insensitive (107.md §3) and is
    // re-checked server-side by the same reducer.
    const key = normalizeKeywordKey(raw);
    const target = kind === 'incl' ? inclusion : exclusion;
    if (target.some(t => normalizeKeywordKey(t) === key)) {
      setMsg('Already in the list');
      setTimeout(() => setMsg(''), 1800);
      return;
    }
    runOp({ type: 'add', list, term: raw });
  }

  // Full-list reset stays on the legacy PUT (it deliberately replaces both lists).
  async function resetDefaults() {
    setSaving(true); setErr(''); setMsg('');
    try {
      await screeningApi.updateProject(pid, {
        inclusionKeywords: JSON.stringify(DEFAULT_INCLUDE_KEYWORDS),
        exclusionKeywords: JSON.stringify(DEFAULT_EXCLUDE_KEYWORDS),
        keywordMeta: {},
      });
      setMsg('Reset to defaults');
      setConfirmReset(false);
      refreshProject?.();
      setTimeout(() => setMsg(''), 1800);
    } catch (e) { setErr(e.message || 'Save failed'); }
    finally { setSaving(false); }
  }

  const chip = (term, kind) => {
    const list = kind === 'incl' ? 'include' : 'exclude';
    const other = kind === 'incl' ? 'exclude' : 'include';
    const origin = (kind === 'incl' ? inclSource : exclSource)?.[term] || KEYWORD_ORIGIN.MANUAL;
    const tint = kind === 'incl'
      ? { bg: alpha(C.grn, 0.14), bd: alpha(C.grn, 0.5), tx: C.grn }
      : { bg: alpha(C.red, 0.14), bd: alpha(C.red, 0.5), tx: C.red };
    return (
      <span key={kind + term} title={`${term} · ${ORIGIN_LABEL[origin] || ORIGIN_LABEL[KEYWORD_ORIGIN.MANUAL]}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11,
          background: tint.bg, border: `1px solid ${tint.bd}`, color: tint.tx,
          borderRadius: 11, padding: '2px 4px 2px 9px',
        }}>
        <OriginBadge origin={origin} />
        {term}
        {mayEdit && (
          <button
            onClick={() => runOp({ type: 'move', list, term, toList: other })}
            style={{ background: 'none', border: 'none', color: tint.tx, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '0 2px', opacity: 0.7 }}
            title={kind === 'incl' ? 'Move to exclusion' : 'Move to inclusion'}
          >{kind === 'incl' ? '→' : '←'}</button>
        )}
        {mayEdit && (
          <button
            onClick={() => runOp({ type: 'remove', list, term })}
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: mayEdit ? 8 : 14 }}>
        {inclusion.length === 0 && <span style={{ fontSize: 11.5, color: C.muted }}>None.</span>}
        {inclusion.map(t => chip(t, 'incl'))}
      </div>
      {mayEdit && (
        <ChipAdder value={newIncl} setValue={setNewIncl} onAdd={() => addTerm('incl')} placeholder="Add inclusion term…" accent={C.grn} />
      )}

      {/* Exclusion */}
      <div style={{ fontSize: 9.5, fontFamily: MONO, color: C.red, letterSpacing: '0.1em', margin: '14px 0 7px' }}>EXCLUSION (RED)</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: mayEdit ? 8 : 14 }}>
        {exclusion.length === 0 && <span style={{ fontSize: 11.5, color: C.muted }}>None.</span>}
        {exclusion.map(t => chip(t, 'excl'))}
      </div>
      {mayEdit && (
        <ChipAdder value={newExcl} setValue={setNewExcl} onAdd={() => addTerm('excl')} placeholder="Add exclusion term…" accent={C.red} />
      )}

      {mayEdit && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5, marginBottom: 10 }}>
            Tip: select text in an abstract and press Ctrl/⌘+I or Ctrl/⌘+E to add it here.
          </div>
          {suggestionCount > 0 && (
            <Button variant="subtle" onClick={onReviewSuggestions} full style={{ fontSize: 12, marginBottom: 8 }}>
              Review suggestions ({suggestionCount})
            </Button>
          )}
          {confirmReset ? (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <Button variant="danger" onClick={resetDefaults} disabled={saving} style={{ fontSize: 11.5, flex: 1 }}>
                Replace both lists
              </Button>
              <Button variant="ghost" onClick={() => setConfirmReset(false)} disabled={saving} style={{ fontSize: 11.5 }}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="subtle" onClick={() => setConfirmReset(true)} disabled={saving} full style={{ fontSize: 12, marginBottom: 8 }}>
              ↺ Reset to default keywords
            </Button>
          )}
          {confirmReset && (
            <div style={{ fontSize: 10.5, color: C.gold, lineHeight: 1.5, marginBottom: 8 }}>
              This replaces both keyword lists, including terms you added manually.
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, minHeight: 14 }}>
            {saving && <span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}>Saving…</span>}
            {msg && <span style={{ fontSize: 10.5, color: C.grn, fontFamily: MONO }}>{msg}</span>}
            {(err || opError) && <span style={{ fontSize: 10.5, color: C.red, fontFamily: MONO }}>{err || opError}</span>}
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
