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
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import Icon from '../components/icons.jsx';
import { robApi, getRobSettings, guidedRobAppraisalEnabled } from './robApi.js';
import { judgmentStyle, legendFor } from './judgmentStyle.js';
import RobTrafficLight from './RobTrafficLight.jsx';
import RobPdfPanel from './RobPdfPanel.jsx';
import { screeningApi } from '../screening/api-client/screeningApi.js';
import { studyDocApi } from '../../features/extraction/unified/studyDocApi.js';
import { extractStudyFullText } from './robFullText.js';
import {
  ROB2, getInstrument, isReachable, proposeDomain, proposeOverall, completeness,
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

// prompt34 Task 2 — the assessment workspace fills the viewport down from wherever
// it is mounted (it sits below the app header + the "Risk of Bias" section header),
// so the PDF + questions + the action footer are visible WITHOUT page scrolling.
// We measure the element's distance from the viewport top and size it to fill the
// rest, leaving a small bottom gap. Robust to whatever chrome sits above it.
function useFillViewportHeight(ref, bottomGap = 24, minHeight = 460) {
  const [height, setHeight] = useState(null);
  useEffect(() => {
    let raf = 0;
    const timers = [];
    const recompute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current; if (!el) return;
        try {
          const top = el.getBoundingClientRect().top;
          const h = Math.max(minHeight, window.innerHeight - top - bottomGap);
          setHeight((prev) => (prev != null && Math.abs(prev - h) < 1 ? prev : h));
        } catch { /* ignore */ }
      });
    };
    recompute();
    // prompt42 Task 7 — the embedding shell removes its page padding ONE render AFTER
    // this workspace mounts (its full-bleed flag commits next), which shifts our
    // rect.top. The hook used to recompute only on window resize, so the first measure
    // was taken with the old padding → a stale (short) height + a blank gap. Re-measure
    // on the next frames + a short timeout so we settle on the true post-layout height.
    timers.push(requestAnimationFrame(() => requestAnimationFrame(recompute)));
    timers.push(setTimeout(recompute, 90));
    timers.push(setTimeout(recompute, 250));
    window.addEventListener('resize', recompute);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach((t) => { cancelAnimationFrame(t); clearTimeout(t); });
      window.removeEventListener('resize', recompute);
    };
  }, [ref, bottomGap, minHeight]);
  return height;
}

// Measure an element's pixel height (for the PDF iframe to fill its column). The
// native PDF viewer then scrolls long documents internally — no page scroll.
function useMeasuredHeight(ref) {
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(entries => { for (const e of entries) setH(e.contentRect.height); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return h;
}

// prompt43 Area 3 — measure the assessment pane's own width (NOT the viewport) so the
// domain navigation can adapt to the available room: a vertical side-rail when the
// pane is comfortably wide, or a compact horizontal strip (freeing the full width for
// the questions) when the PDF is taking most of the space. Container-query in spirit.
function useMeasuredWidth(ref) {
  const [w, setW] = useState(0);
  // Seed the width synchronously BEFORE the first paint so the rail picks its correct
  // (side/top) layout on the first committed frame — no visible side→top reflow flash.
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    try { const cw = el.getBoundingClientRect().width; if (cw) setW(Math.round(cw)); } catch { /* ignore */ }
  }, [ref]);
  useEffect(() => {
    const el = ref.current; if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let raf = 0;
    const ro = new ResizeObserver(entries => {
      const cw = entries[0]?.contentRect?.width;
      if (cw == null) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setW(prev => (Math.abs(prev - cw) >= 1 ? Math.round(cw) : prev)));
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [ref]);
  return w;
}

// Below this assessment-pane width the domain rail moves to a horizontal strip above
// the questions, so the questions are never squeezed into a sliver beside the rail.
const RAIL_TOP_BELOW = 640;

// prompt36 Task 1 — the RoB workspace opens 70% PDF / 30% assessment and the
// divider between the panes is draggable. The ratio (PDF fraction) is clamped so
// neither pane becomes unusable and is persisted per browser. It is smooth and
// lag-free even on weak machines because a drag writes a CSS custom property
// straight to the row element (one requestAnimationFrame per frame) instead of
// re-rendering React on every pointer move — React state is touched only once,
// on pointer-up, to commit + persist the final ratio.
// prompt41 Task 4 — the split is draggable BOTH ways. The previous bounds
// (0.45–0.72) let the assessment GROW but barely SHRINK (PDF capped at 72%). Widen
// to 0.20–0.82 so either pane can shrink to a usable minimum (assessment 18%–80%,
// PDF 20%–82%) while neither becomes unusable. Default stays 70/30.
const SPLIT_MIN_PDF = 0.20;   // PDF panel never narrower than 20% (assessment up to 80%)
const SPLIT_MAX_PDF = 0.82;   // PDF panel never wider than 82% (assessment down to ~18%)
// prompt43 Area 3 — the assessment is the primary work surface, so the default now
// gives it real width instead of the old cramped 70/30.
// prompt46 #6 — split evenly (PDF 50% / assessment 50%) so the assessment pane is wide
// enough for the 2-column signalling-question grid below, removing the internal scroll
// in the common case WITHOUT compressing any padding.
const SPLIT_DEFAULT = 0.50;
const SPLIT_STORAGE_KEY = 'metalab.rob.splitRatio';
export function clampSplit(v) { return Math.min(SPLIT_MAX_PDF, Math.max(SPLIT_MIN_PDF, v)); }
function readSplitRatio() {
  try { const v = parseFloat(localStorage.getItem(SPLIT_STORAGE_KEY)); return (v >= SPLIT_MIN_PDF && v <= SPLIT_MAX_PDF) ? v : SPLIT_DEFAULT; } catch { return SPLIT_DEFAULT; }
}

// Divider track width (px); the handle is centred in it, so the drag math offsets
// the cursor by half this to keep the handle directly under the pointer.
const SPLIT_DIVIDER_PX = 16;
function useResizableSplit(rowRef) {
  const [ratio, setRatio] = useState(readSplitRatio);
  const [dragging, setDragging] = useState(false);
  const rafRef = useRef(0);
  const teardownRef = useRef(null); // active-drag teardown, so an unmount mid-drag can clean up
  const applyVar = useCallback((v) => { const el = rowRef.current; if (el) el.style.setProperty('--rob-pdf-pct', `${(v * 100).toFixed(3)}%`); }, [rowRef]);
  useEffect(() => { applyVar(ratio); }, [ratio, applyVar]);
  const persist = (v) => { try { localStorage.setItem(SPLIT_STORAGE_KEY, String(v)); } catch { /* best-effort */ } };

  const onPointerDown = useCallback((e) => {
    const el = rowRef.current; if (!el) return;
    e.preventDefault();
    // preventDefault on pointerdown suppresses the default focus, so focus the
    // handle explicitly — otherwise the keyboard nudge won't work after a drag.
    try { e.currentTarget && e.currentTarget.focus && e.currentTarget.focus(); } catch { /* ignore */ }
    const rect = el.getBoundingClientRect();
    let last = ratio;
    setDragging(true);
    const move = (ev) => {
      // Offset by half the divider track so the handle sits under the cursor.
      last = clampSplit((ev.clientX - rect.left - SPLIT_DIVIDER_PX / 2) / Math.max(1, rect.width));
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => applyVar(last));
    };
    // Single teardown bound to BOTH pointerup AND pointercancel — the browser/OS
    // fires pointercancel (not pointerup) on a gesture/scroll takeover, so without
    // this the listeners + frozen body cursor/userSelect would leak for the session.
    const end = () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      teardownRef.current = null;
      setDragging(false);
      setRatio(last); persist(last);
    };
    // A non-committing variant for unmount cleanup (never setState after unmount).
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
  }, [ratio, applyVar, rowRef]);

  // If the component unmounts mid-drag, restore global cursor/selection + drop the
  // document listeners so a cancelled drag never strands the whole app.
  useEffect(() => () => { if (teardownRef.current) teardownRef.current(); }, []);

  const reset = useCallback(() => { setRatio(SPLIT_DEFAULT); persist(SPLIT_DEFAULT); }, []);
  const nudge = useCallback((delta) => { setRatio(r => { const v = clampSplit(r + delta); persist(v); return v; }); }, []);
  return { ratio, dragging, onPointerDown, reset, nudge };
}

// The draggable gutter between the PDF and the assessment (Task 1). Subtle by
// default, brightens on hover/drag, exposes the resize cursor, and is fully
// keyboard-operable (←/→ nudge, Home resets). Double-click restores 70/30.
export function ResizeDivider({ split, reduced }) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  // Focus + hover + drag all brighten the handle; since outline is suppressed, the
  // brightened handle IS the keyboard-focus cue (so the ←/→/Home controls are
  // discoverable after a mouse grab, which now focuses the handle).
  const active = hover || focused || split.dragging;
  return (
    <div role="separator" aria-orientation="vertical" tabIndex={0}
      aria-label="Resize the PDF and assessment panels"
      aria-valuemin={Math.round(SPLIT_MIN_PDF * 100)} aria-valuemax={Math.round(SPLIT_MAX_PDF * 100)} aria-valuenow={Math.round(split.ratio * 100)}
      onPointerDown={split.onPointerDown}
      onDoubleClick={split.reset}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { split.nudge(-0.02); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { split.nudge(0.02); e.preventDefault(); }
        else if (e.key === 'Home') { split.reset(); e.preventDefault(); }
      }}
      title="Drag to resize panels · double-click to reset"
      style={{ alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'col-resize', touchAction: 'none', outline: 'none' }}>
      <span style={{
        width: active ? 5 : 3, height: active ? 64 : 44, borderRadius: 5,
        background: split.dragging ? C.acc : active ? alpha(C.acc, '80') : C.brd2,
        boxShadow: (split.dragging || focused) ? `0 0 0 3px ${alpha(C.acc, '22')}` : 'none',
        transition: reduced ? 'none' : 'all 0.15s ease',
      }} />
    </div>
  );
}

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
    <div role="radiogroup" aria-label={`Response for question ${qid}`} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {RESPONSE_KEYS.map((r, i) => {
        const on = value === r;
        return (
          <button key={r} role="radio" aria-checked={on} aria-label={RESPONSE_LABELS[r]} onClick={() => onChange(on ? '' : r)} title={`${RESPONSE_LABELS[r]} (${r} · press ${i + 1})`} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 600,
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

// ── Domain navigation (prompt43 Area 3) ───────────────────────────────────────
// Renders the D1–D5 + Summary navigator either as a vertical side-rail (wide pane)
// or a compact horizontal strip (narrow pane). Same data + handlers; only the
// arrangement changes so the questions always get a comfortable, readable width.
function DomainNav({ mode, active, setActive, setFocusedQ, completeness, dotJudgment, overriddenByDomain, domains = ROB2.domains, legend = legendFor('RoB2') }) {
  const go = (id) => { setActive(id); setFocusedQ(null); };

  if (mode === 'top') {
    return (
      <nav aria-label="RoB domains" style={{ borderBottom: `1px solid ${C.brd}`, background: C.surf, padding: '10px 16px', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
          {domains.map((d) => {
            const comp = completeness.perDomain[d.id]; const on = active === d.id;
            return (
              <button key={d.id} onClick={() => go(d.id)} aria-current={on} title={`${d.id} · ${d.shortLabel}`} style={navChip(on)}>
                <TrafficDot judgment={dotJudgment(d.id)} size={11} />
                <span style={{ fontSize: 12.5, fontWeight: on ? 700 : 600, color: on ? C.txt : C.txt2, whiteSpace: 'nowrap' }}>{d.id}</span>
                <span style={{ fontSize: 9.5, fontFamily: MONO, color: comp.missing.length ? C.yel : C.grn }}>{comp.missing.length ? `${comp.answered}/${comp.required}` : '✓'}</span>
                {overriddenByDomain[d.id] && <Icon name="pencil" size={10} title="Overridden" />}
              </button>
            );
          })}
          <button onClick={() => go('summary')} aria-current={active === 'summary'} style={navChip(active === 'summary')}>
            <Icon name="barChart" size={13} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: active === 'summary' ? C.txt : C.txt2, whiteSpace: 'nowrap' }}>Summary</span>
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'center' }}>
          {legend.map(l => (
            <span key={l.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: l.hex }} />
              <span style={{ fontSize: 10, color: C.txt2 }}>{l.label}</span>
            </span>
          ))}
        </div>
      </nav>
    );
  }

  // Side rail (wide pane) — more padding than before for breathing room.
  return (
    <nav aria-label="RoB domains" style={{ borderRight: `1px solid ${C.brd}`, padding: '16px 12px', background: C.surf, overflowY: 'auto', minHeight: 0 }}>
      {domains.map((d) => {
        const comp = completeness.perDomain[d.id];
        const on = active === d.id;
        return (
          <button key={d.id} onClick={() => go(d.id)} aria-current={on} style={railItem(on)}>
            <TrafficDot judgment={dotJudgment(d.id)} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: on ? 700 : 600, color: on ? C.txt : C.txt2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.id} · {d.shortLabel}</span>
              <span style={{ display: 'block', fontSize: 10, fontFamily: MONO, color: comp.missing.length ? C.yel : C.grn, marginTop: 1 }}>{comp.missing.length ? `${comp.answered}/${comp.required}` : 'complete'}</span>
            </span>
            {overriddenByDomain[d.id] && <Icon name="pencil" size={11} title="Overridden" />}
          </button>
        );
      })}
      <button onClick={() => go('summary')} aria-current={active === 'summary'} style={{ ...railItem(active === 'summary'), marginTop: 8, borderTop: `1px solid ${C.brd}`, borderRadius: 0, paddingTop: 14 }}>
        <Icon name="barChart" size={14} />
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: active === 'summary' ? C.txt : C.txt2 }}>Summary</span>
      </button>
      <div style={{ marginTop: 16, padding: '0 6px' }}>
        <div style={{ fontSize: 9, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Legend</div>
        {legend.map(l => (
          <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: l.hex }} />
            <Icon name={l.icon} size={12} />
            <span style={{ fontSize: 10.5, color: C.txt2 }}>{l.label}</span>
          </div>
        ))}
        <div style={{ fontSize: 9.5, fontFamily: MONO, color: C.muted, marginTop: 10, lineHeight: 1.6 }}>1–5 answer · n/p question · [ ] domain · o override · ? guidance</div>
      </div>
    </nav>
  );
}

// ── Workspace ─────────────────────────────────────────────────────────────────
export default function RobWorkspace({ assessmentId, onClose, onChanged, onContinue, readOnly = false }) {
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
  // prompt30 Part 3 — the assessment opens as a two-section split: PDF (left) +
  // RoB questions (right). The PDF panel can be collapsed for more answering room.
  const [showPdf, setShowPdf] = useState(true);
  // prompt34 Task 4/5 — RobWorkspace owns the single study-record fetch; it feeds
  // BOTH the persistent article header (spanning both columns) and the PDF panel.
  // The standalone "Article Information" tab was removed — its details now live in
  // the header's expandable disclosure (gated by robSettings.showArticleInfoTab).
  const [studyRecord, setStudyRecord] = useState({ loading: true, error: '', record: null, screenProjectId: null, recordId: null, studyDocUrl: null });
  const [robSettings, setRobSettings] = useState(ROB_SETTINGS_FALLBACK);
  const reduced = usePrefersReducedMotion();
  const narrow = useViewportNarrow();
  // prompt34 Task 2/5 — the workspace fills the viewport; the two-column row is
  // measured so the PDF iframe fills its column and the assessment scrolls inside.
  const rootRef = useRef(null);
  const rowRef = useRef(null);
  const paneRef = useRef(null);            // the assessment <section>, measured for the responsive rail
  const fillHeight = useFillViewportHeight(rootRef);
  const rowHeight = useMeasuredHeight(rowRef);
  const paneWidth = useMeasuredWidth(paneRef);
  const railTop = paneWidth > 0 && paneWidth < RAIL_TOP_BELOW; // rail on top vs side
  const split = useResizableSplit(rowRef); // prompt36 Task 1 — default split, draggable
  const saveTimer = useRef(null);
  const savedTimer = useRef(null);
  const pending = useRef({ answers: {}, meta: {} });
  const answersRef = useRef({});
  answersRef.current = answers;        // always-fresh mirror so flush() never reads a stale closure
  const mounted = useRef(true);

  // ── Instrument-awareness (P14) ──────────────────────────────────────────────
  // The workspace is driven by the assessment's OWN instrument (RoB 2 for
  // randomised trials, ROBINS-I for non-randomised studies) instead of a hardcoded
  // ROB2. The pure engine dispatches by instrument, so the SAME client code drives
  // both. Falls back to RoB 2 until the assessment view loads / for an unknown id.
  const instrument = useMemo(() => {
    try { return getInstrument(view?.instrumentId || 'RoB2'); } catch { return ROB2; }
  }, [view?.instrumentId]);
  const domainIds = useMemo(() => instrument.domains.map(d => d.id), [instrument]);
  const legend = useMemo(() => legendFor(instrument.id), [instrument]);

  // ── Guided appraisal (P14, flag-gated) ──────────────────────────────────────
  // When the guidedRobAppraisal flag is OFF, none of this renders and the
  // workspace behaves EXACTLY as today (RoB 2 only, no appraisal).
  const [appraisalOn, setAppraisalOn] = useState(false);
  const [appraisal, setAppraisal] = useState(null);      // server /appraise result
  const [appraising, setAppraising] = useState(false);
  const [appraiseError, setAppraiseError] = useState('');
  // Per-question disposition of a suggestion: 'accepted' | 'rejected' (absent = pending).
  const [suggestionState, setSuggestionState] = useState({});

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

  // prompt34 Task 4 — read the admin RoB presentation settings once. The separate
  // "Article Information" tab was removed; showArticleInfoTab now controls whether
  // the full article details (abstract/keywords/badges) are offered as an
  // expandable disclosure inside the persistent header that spans both columns.
  useEffect(() => {
    let alive = true;
    getRobSettings().then(s => { if (alive) setRobSettings(s); }).catch(() => { /* fallback already set */ });
    return () => { alive = false; };
  }, []);

  // P14 — is the guided-appraisal layer enabled? Gates the "Run guided appraisal"
  // action + the per-question suggestion cards. Fail-safe OFF.
  useEffect(() => {
    let alive = true;
    guidedRobAppraisalEnabled().then(v => { if (alive) setAppraisalOn(!!v); }).catch(() => { /* stays OFF */ });
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
      let studyDocUrl = null;
      if (!r.recordId || !r.screenProjectId) {
        // 77.md §5 — no screening record, but a manually-added study may carry a persisted
        // study document; surface it here so the PDF is available wherever the study is used.
        try {
          const d = await studyDocApi.get(view.projectId, view.studyId);
          if (d && d.document && d.document.storedName) studyDocUrl = studyDocApi.downloadUrl(view.projectId, view.studyId);
        } catch { /* no study doc — clean empty state */ }
      }
      setStudyRecord({ loading: false, error: '', record: r.record || null, screenProjectId: r.screenProjectId || null, recordId: r.recordId || null, studyDocUrl });
    } catch (e) {
      setStudyRecord({ loading: false, error: e?.message || 'Could not load the study PDF.', record: null, screenProjectId: null, recordId: null, studyDocUrl: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyKey]);
  useEffect(() => { resolveStudyRecord(); }, [resolveStudyRecord]);

  // ── Live (client-side) reachability + proposals from the SAME engine module ──
  // Uses the SELECTED instrument object, which the pure engine dispatches by id.
  const liveProposals = useMemo(() => {
    const out = {};
    for (const d of instrument.domains) out[d.id] = proposeDomain(instrument, d.id, answers[d.id] || {});
    return out;
  }, [answers, instrument]);
  const liveOverall = useMemo(() => {
    const resolved = {};
    for (const d of instrument.domains) {
      const dv = (view?.domains || []).find(x => x.domainId === d.id);
      resolved[d.id] = (dv && dv.overridden && dv.finalJudgment) ? dv.finalJudgment : liveProposals[d.id].judgment;
    }
    return proposeOverall(instrument, resolved);
  }, [liveProposals, view, instrument]);
  const liveCompleteness = useMemo(() => completeness(instrument, { answersByDomain: answers }), [answers, instrument]);

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
  // prompt46 #3 — a non-creator (who isn't owner/leader) gets canMutate:false from the
  // API, so the whole assessment is read-only for them (server enforces it too).
  // Default-allow when the field is absent so nothing regresses.
  const editable = !finalised && !readOnly && (view?.canMutate !== false);

  // ── Autosave (debounced) ──────────────────────────────────────────────────
  const flush = useCallback(async () => {
    const batch = pending.current;
    const qids = new Set([...Object.keys(batch.answers), ...Object.keys(batch.meta)]);
    if (!qids.size) return;
    pending.current = { answers: {}, meta: {} };
    const items = [];
    for (const qid of qids) {
      const domainId = instrument.domains.find(d => d.questions.some(q => q.id === qid))?.id;
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
  }, [assessmentId, onChanged, instrument]);

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
        if (e.key === '[' || e.key === 'p') { setActive(domainIds[domainIds.length - 1]); e.preventDefault(); }
        return;
      }
      const di = domainIds.indexOf(active);
      if (di < 0) return; // active is not a domain of this instrument (guard during load)
      const reachable = instrument.domains[di].questions.filter(q => isReachable(q, answers[active] || {}));
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
        setActive(di < domainIds.length - 1 ? domainIds[di + 1] : 'summary'); setFocusedQ(null); e.preventDefault();
      } else if (e.key === '[') {
        if (di > 0) { setActive(domainIds[di - 1]); setFocusedQ(null); } e.preventDefault();
      } else if (e.key === 'o' && editable) {
        setOverride({ target: 'domain', domainId: active, current: resolvedDomain(active) }); e.preventDefault();
      } else if (e.key === '?') {
        // Toggle guidance for the focused question, or the first reachable one so
        // '?' always does something useful on a domain (matches the rail legend).
        const target = focusedQ || reachable[0]?.id;
        if (target) setGuidanceOpen(g => ({ ...g, [target]: !g[target] }));
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focusedQ, answers, finalised, readOnly, override, domainIds, instrument, editable]);

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

  // ── Guided appraisal actions (P14) ──────────────────────────────────────────
  const domainOfQid = useCallback(
    (qid) => instrument.domains.find(d => d.questions.some(q => q.id === qid))?.id,
    [instrument],
  );

  // Obtain the study's full text CLIENT-SIDE (best-effort — reuses the existing
  // pdf.js pipeline + screening PDF routes) and POST it to /appraise. The server
  // appraises title + abstract itself and saves suggestions as PROPOSED answers
  // only; nothing here becomes a final judgement without a human accepting it.
  async function runAppraisal(force = false) {
    if (!editable || appraising) return;
    setAppraising(true); setAppraiseError('');
    try {
      const ft = await extractStudyFullText({ screenProjectId: studyRecord.screenProjectId, recordId: studyRecord.recordId });
      const res = await robApi.appraise(assessmentId, { fullText: ft.text || '', force });
      setAppraisal(res);
      setSuggestionState({}); // a fresh run resets every suggestion to pending
    } catch (e) {
      setAppraiseError(e?.message || 'Guided appraisal is unavailable right now.');
    } finally {
      setAppraising(false);
    }
  }

  // Accept a suggestion → write it as an ANSWER via the existing autosave (PUT
  // /answers): the deterministic engine then re-proposes the judgement, and the
  // human still sets the FINAL judgement via the override flow. Accepting never
  // finalises anything on its own.
  function acceptSuggestion(qid, response, evidenceQuote) {
    const domainId = domainOfQid(qid);
    if (!domainId || !response || !editable) return;
    setAnswer(domainId, qid, response);
    if (evidenceQuote) setQMeta(qid, { evidenceQuote });
    setSuggestionState(s => ({ ...s, [qid]: 'accepted' }));
  }
  function rejectSuggestion(qid) {
    setSuggestionState(s => ({ ...s, [qid]: 'rejected' }));
  }
  function clearAppraisal() { setAppraisal(null); setSuggestionState({}); setAppraiseError(''); }

  const suggestionByQid = useMemo(() => {
    const m = {};
    if (appraisal && Array.isArray(appraisal.domains)) {
      for (const d of appraisal.domains) for (const q of (d.questions || [])) m[q.questionId] = q;
    }
    return m;
  }, [appraisal]);
  const appraisalActive = appraisalOn && !!appraisal;
  // Suggestions still awaiting the reviewer's decision (not yet accepted/rejected).
  const pendingSuggestions = useMemo(
    () => Object.keys(suggestionByQid).filter(qid => !suggestionState[qid]).length,
    [suggestionByQid, suggestionState],
  );
  function jumpToFirstSuggestion() {
    const firstQid = Object.keys(suggestionByQid).find(qid => !suggestionState[qid]);
    if (!firstQid) return;
    const domainId = domainOfQid(firstQid);
    if (domainId) { setActive(domainId); setFocusedQ(firstQid); }
  }

  if (loading) return <div style={shell}><div style={{ padding: 60, textAlign: 'center', color: C.muted, fontFamily: FONT }}>Loading assessment…</div></div>;
  if (error && !view) return <div style={shell}><div style={{ padding: 40 }}><ErrorBox msg={error} /><button onClick={onClose} style={ghostBtn}>Back</button></div></div>;
  if (!view) return null;

  const allComplete = liveCompleteness.overall.complete;
  const summaryOverall = (allComplete || view.overall.overridden) ? (finalised ? view.overall.resolvedOverall : liveOverall.judgment) : 'na';
  // `instrumentId` on the matrix makes the traffic-light legend match the plot.
  const single = { instrumentId: instrument.id, domains: instrument.domains.map(d => ({ id: d.id, shortLabel: d.shortLabel })), rows: [{ id: view.id, label: view.resultLabel || view.studyId, cells: instrument.domains.map(d => ({ domainId: d.id, judgment: dotJudgment(d.id) })), overall: summaryOverall }] };
  const completedDomains = instrument.domains.filter(d => domainComplete(d.id)).length;

  // prompt34 Task 4 — the PDF column is shown when admin-enabled AND not collapsed
  // by the "Hide source" toggle. (prompt41 Task 3 — the cluttered article header was
  // replaced by one compact title bar, so the old article-details disclosure flag is
  // no longer read here.)
  const pdfTabOn = robSettings.showPdfPanel !== false;
  const hasLeftColumn = showPdf && pdfTabOn;
  // prompt34 Task 1/2 — the PDF iframe fills its column (measured); the native
  // viewer scrolls long PDFs internally so the page itself never scrolls. On narrow
  // (stacked) screens the page is allowed to scroll, so a viewport-relative height
  // is used instead of the measured (and then unbounded) row height.
  const pdfPreviewHeight = narrow ? 'calc(100vh - 300px)' : (rowHeight > 0 ? `${Math.max(320, Math.round(rowHeight - 78))}px` : 'calc(100vh - 320px)');

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, ...(narrow ? { minHeight: 'auto' } : { height: fillHeight ? `${fillHeight}px` : 'calc(100vh - 200px)', minHeight: 460 }) }}>
    {/* ── prompt41 Task 3 — ONE compact, focused header bar spanning the workspace:
        Back · "RoB 2 · effect of assignment" · study title · a single "Open study"
        external-link icon. Author/DOI/PMID/PubMed clutter is removed so the user
        stays focused on the assessment tool. ── */}
    {(() => {
      const rec = studyRecord.record;
      const studyTitle = rec?.title || view?.resultLabel || `Study ${view?.studyId || ''}`.trim() || 'Study';
      const studyLink = rec?.doi ? `https://doi.org/${rec.doi}` : rec?.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${rec.pmid}` : null;
      return (
        // prompt43 Area 3 — the workspace top bar stays put. In wide mode the page
        // never scrolls so it is fixed by construction; in narrow (stacked) mode the
        // page DOES scroll, so `sticky` keeps Back + study title + Show/Hide source
        // visible at all times instead of scrolling away.
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 2px 12px', flexWrap: 'wrap', flexShrink: 0, position: 'sticky', top: 0, zIndex: 6, background: C.bg, borderBottom: `1px solid ${C.brd}`, boxShadow: `0 4px 12px -8px ${C.shadow}` }}>
          <button onClick={onClose} style={{ ...ghostBtn, fontWeight: 700, color: C.txt }} aria-label="Back to Risk of Bias">
            <Icon name="arrowLeft" size={15} /> Back to Risk of Bias
          </button>
          <span title="Assessment tool" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 7, background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '38')}`, color: C.acc, fontSize: 11, fontFamily: MONO, fontWeight: 700, flexShrink: 0 }}>
            <Icon name="scale" size={13} /> {view?.instrumentLabel || 'RoB 2'} · {instrument.id === 'ROBINS-I' ? 'non-randomised studies' : (view?.variant === 'adherence' ? 'effect of adherence' : 'effect of assignment')}
          </span>
          {/* Study title + single open-study link (the only metadata kept). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 220px', minWidth: 0 }}>
            <span aria-hidden style={{ width: 1, height: 18, background: C.brd, flexShrink: 0 }} />
            <span title={studyTitle} style={{ fontSize: 13.5, fontWeight: 700, color: C.txt, fontFamily: FONT, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{studyTitle}</span>
            {studyLink ? (
              <a href={studyLink} target="_blank" rel="noopener noreferrer" title="Open study" aria-label="Open study link"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 26, flexShrink: 0, borderRadius: 6, border: `1px solid ${C.brd2}`, color: C.txt2, textDecoration: 'none' }}>
                <Icon name="externalLink" size={14} />
              </a>
            ) : (
              <span title="No study link available" aria-label="No study link available"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 26, flexShrink: 0, borderRadius: 6, border: `1px solid ${C.brd}`, color: C.dim, opacity: 0.45 }}>
                <Icon name="externalLink" size={14} />
              </span>
            )}
          </div>
          {pdfTabOn && (
            <button onClick={() => setShowPdf(p => !p)} aria-pressed={showPdf}
              style={{ ...ghostBtn, padding: '6px 11px', flexShrink: 0, background: showPdf ? alpha(C.acc, '14') : 'transparent', color: showPdf ? C.acc : C.txt2, borderColor: showPdf ? alpha(C.acc, '50') : C.brd2 }}
              title={showPdf ? 'Hide the PDF and give the assessment the full width' : 'Show the study PDF beside the assessment'}>
              <Icon name="fileText" size={14} /> {showPdf ? 'Hide source' : 'Show source'}
            </button>
          )}
        </div>
      );
    })()}

    {/* ── prompt36 Task 1 — two-column workspace fills the remaining height. PDF
        70% (left, draggable), assessment 30% (right). The PDF track width is a CSS
        custom property mutated directly during a drag (no React re-render); a 16px
        divider track carries the drag handle. Stacks to one column under
        STACK_BELOW (no divider). ── */}
    <div ref={rowRef} style={{
      marginTop: 12,
      ...(narrow
        ? { display: 'flex', flexDirection: 'column', gap: 16 }
        : { flex: 1, minHeight: 0, display: 'grid', gap: 0,
            gridTemplateColumns: hasLeftColumn
              ? `var(--rob-pdf-pct, ${(split.ratio * 100).toFixed(3)}%) 16px minmax(0, 1fr)`
              : '1fr' }),
    }}>
    {/* ── Left section: the study PDF, filling the column (Task 1). On stacked
        (narrow) screens the column has no grid height to stretch into, so it is
        given an explicit height — otherwise the flush PDF iframe's height:100%
        chain would resolve to ~150px (prompt36 review fix). ── */}
    {hasLeftColumn && (
      <aside style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, ...(narrow ? { height: pdfPreviewHeight } : null) }}>
        <RobPdfPanel loading={studyRecord.loading} error={studyRecord.error} screenProjectId={studyRecord.screenProjectId} recordId={studyRecord.recordId}
          studyDocUrl={studyRecord.studyDocUrl}
          canManage={editable} onRetry={resolveStudyRecord} previewHeight={pdfPreviewHeight} />
      </aside>
    )}
    {/* ── Draggable divider (Task 1) — only in the side-by-side grid layout. ── */}
    {hasLeftColumn && !narrow && <ResizeDivider split={split} reduced={reduced} />}
    {/* ── Right section: the RoB assessment engine — context bar, scrolling body,
        and a sticky action footer that stays visible (Task 2/7). ── */}
    <section ref={paneRef} style={{ ...shell, minWidth: 0, display: 'flex', flexDirection: 'column', ...(narrow ? { minHeight: 520, marginBottom: 16 } : { minHeight: 0 }) }}>
      {/* ── Context bar with live progress (Task 7) ─────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 20px', borderBottom: `1px solid ${C.brd}`, background: C.card, flexWrap: 'wrap', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: C.txt, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{view.resultLabel || 'Risk-of-bias assessment'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, whiteSpace: 'nowrap' }}>{completedDomains}/{instrument.domains.length} domains</span>
            <span aria-hidden style={{ flex: 1, maxWidth: 140, height: 4, borderRadius: 4, background: C.brd, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${(completedDomains / instrument.domains.length) * 100}%`, background: allComplete ? C.grn : C.acc, transition: reduced ? 'none' : 'width 0.3s ease' }} />
            </span>
            {/* prompt46 #3 — who started this assessment (creator visibility). */}
            {view.reviewerName && <span style={{ fontSize: 10, color: C.muted, whiteSpace: 'nowrap' }}>· Started by {view.reviewerName}</span>}
          </div>
        </div>
        {/* P14 — guided appraisal action (flag ON, editable, not finalised). It
            suggests answers from the study text; the reviewer accepts/edits each. */}
        {appraisalOn && editable && !finalised && (
          <button onClick={() => runAppraisal(!!appraisal)} disabled={appraising}
            title={appraisal ? 'Re-run the guided appraisal from the study text' : 'Suggest signalling answers from the study text — you review and accept each one'}
            style={{ ...ghostBtn, flexShrink: 0, background: appraising ? C.surf : alpha(C.acc, '12'), color: appraising ? C.muted : C.acc, borderColor: alpha(C.acc, '45'), cursor: appraising ? 'progress' : 'pointer' }}>
            <Icon name="clipboard" size={14} /> {appraising ? 'Appraising…' : appraisal ? 'Re-run appraisal' : 'Run guided appraisal'}
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Overall</span>
          <JudgmentPill judgment={finalised ? view.overall.resolvedOverall : liveOverall.judgment} size="md" provisional={!liveCompleteness.overall.complete && !finalised} />
        </div>
      </div>

      {/* P14 — guided-appraisal status: coverage + warnings, stated calmly, with an
          explicit reminder that these are SUGGESTIONS a human must review. */}
      {appraisalOn && (appraisalActive || appraiseError) && (
        <AppraisalStatusBar
          appraisal={appraisal} error={appraiseError} pending={pendingSuggestions}
          onClear={clearAppraisal} onJumpFirst={jumpToFirstSuggestion}
        />
      )}

      {error && <div style={{ padding: '8px 20px 0', flexShrink: 0 }}><ErrorBox msg={error} /></div>}

      {/* ── Scrolling body: domain rail + questions. prompt43 Area 3 — the rail is a
          vertical side-rail when the pane is wide, and a compact horizontal strip
          (freeing the full width for the questions) when the PDF squeezes the pane,
          so the questions are never crushed into a sliver. ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gap: 0,
        ...(railTop
          ? { gridTemplateColumns: '1fr', gridTemplateRows: 'auto minmax(0, 1fr)' }
          : { gridTemplateColumns: '216px minmax(0, 1fr)' }) }}>
        <DomainNav
          mode={railTop ? 'top' : 'side'}
          domains={instrument.domains} legend={legend}
          active={active} setActive={setActive} setFocusedQ={setFocusedQ}
          completeness={liveCompleteness} dotJudgment={dotJudgment} overriddenByDomain={overriddenByDomain}
        />

        {/* ── Assessment pane / Summary (scrolls internally) ─────────────── */}
        <main style={{ padding: railTop ? '20px clamp(16px, 4vw, 40px)' : '22px clamp(20px, 2.4vw, 36px)', overflowY: 'auto', minHeight: 0 }}>
          {active === 'summary' ? (
            <SummaryStep view={view} instrument={instrument} live={{ proposals: liveProposals, overall: liveOverall, completeness: liveCompleteness, resolvedDomain: dotJudgment }}
              single={single} finalised={finalised} editable={editable} onExport={exportAs}
              onOverrideOverall={() => setOverride({ target: 'overall', current: view.overall.resolvedOverall })} onJump={setActive} />
          ) : (
            <DomainPane
              domain={instrument.domains[domainIds.indexOf(active)]}
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
              suggestions={appraisalActive ? suggestionByQid : null}
              suggestionState={suggestionState}
              onAcceptSuggestion={acceptSuggestion}
              onRejectSuggestion={rejectSuggestion}
            />
          )}
        </main>
      </div>

      {/* ── Sticky action footer (Task 2/7) — always visible without page scroll.
          Carries autosave state, domain nav, and the primary next action. ── */}
      <WorkspaceFooter
        active={active} setActive={setActive} setFocusedQ={setFocusedQ} domainIds={domainIds}
        allComplete={allComplete} finalised={finalised} readOnly={readOnly} editable={editable}
        saving={saveState === 'saving'} saveState={saveState}
        onFinalise={doFinalise} onReopen={doReopen} onContinue={onContinue}
      />
    </section>
    </div>

    {override && (
      <OverrideModal info={override} judgmentLevels={instrument.judgmentLevels} onCancel={() => setOverride(null)} onSubmit={doOverride} />
    )}
    </div>
  );
}

// ── Sticky action footer (Task 2/7) — domain nav + primary action, always visible.
// `domainIds` defaults to RoB 2's D1–D5 so the SSR test (which renders this in
// isolation) still nav-labels correctly; the workspace passes the active
// instrument's domain ids (RoB 2 → 5, ROBINS-I → 7).
export function WorkspaceFooter({ active, setActive, setFocusedQ, domainIds = DOMAIN_IDS, allComplete, finalised, readOnly, editable = true, saving, saveState, onFinalise, onReopen, onContinue }) {
  const go = (target) => { setActive(target); setFocusedQ(null); };
  const onSummary = active === 'summary';
  const di = domainIds.indexOf(active);
  const lastDomain = domainIds[domainIds.length - 1];
  const prevTarget = onSummary ? lastDomain : (di > 0 ? domainIds[di - 1] : null);
  const isLast = di >= domainIds.length - 1;
  const nextTarget = onSummary ? null : (isLast ? 'summary' : domainIds[di + 1]);
  const nextLabel = onSummary ? '' : (isLast ? 'Summary' : `${domainIds[di + 1]}`);
  const saveText = readOnly ? 'view only' : finalised ? '✓ finalised' : saving ? 'saving…' : saveState === 'saved' ? '✓ saved' : saveState === 'error' ? 'save failed' : 'autosaves';
  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '11px 18px', borderTop: `1px solid ${C.brd}`, background: C.card }}>
      <span aria-live="polite" style={{ fontSize: 11, fontFamily: MONO, color: saveState === 'error' ? C.red : C.muted, minWidth: 70 }}>{saveText}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button onClick={() => prevTarget && go(prevTarget)} disabled={!prevTarget} style={{ ...ghostBtn, opacity: prevTarget ? 1 : 0.45, cursor: prevTarget ? 'pointer' : 'not-allowed' }}>
          <Icon name="arrowLeft" size={14} /> {onSummary ? `Back to ${lastDomain}` : 'Previous'}
        </button>
        {nextTarget && (
          <button onClick={() => go(nextTarget)} style={ghostBtn}>
            Next: {nextLabel} <Icon name="arrowRight" size={14} />
          </button>
        )}
        {/* prompt46 #3 — Finalise / Re-open are mutations, so gate them on `editable`
            (which folds in per-assessment canMutate), not just project-level readOnly.
            A non-creator project-editor sees a hint instead of a button that 403s. */}
        {!readOnly && editable && (finalised ? (
          <>
            <button onClick={onReopen} style={ghostBtn}><Icon name="refresh" size={13} /> Re-open</button>
            {onContinue && <button onClick={() => onContinue('grade')} style={primaryBtn(false)}>Continue to GRADE <Icon name="arrowRight" size={14} /></button>}
          </>
        ) : (
          <button onClick={onFinalise} disabled={!allComplete || saving}
            title={saving ? 'Saving…' : (!allComplete ? 'Answer all reachable signalling questions first' : 'Finalise this assessment')}
            style={primaryBtn(!allComplete || saving)}>
            <Icon name="check" size={14} /> {saving ? 'Saving…' : 'Finalise'}
          </button>
        ))}
        {!readOnly && !editable && !finalised && (
          <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted }}>Only the creator, a leader, or the owner can edit this assessment</span>
        )}
        {!readOnly && !editable && finalised && onContinue && (
          <button onClick={() => onContinue('grade')} style={ghostBtn}>Continue to GRADE <Icon name="arrowRight" size={14} /></button>
        )}
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

// prompt34 Task 4/5 — the persistent article header now SPANS both columns at the
// top of the workspace (the separate "Article Information" tab was removed). It
// shows the article identity (title, authors, journal·year, DOI/PMID links) plus
// compact metadata chips, and offers the fuller detail (abstract + keywords) as an
// expandable disclosure so the header stays compact and is never overloaded.
export function ArticleHeaderBar({ record, loading, view, showDetails }) {
  const [open, setOpen] = useState(false);
  const title = record?.title || view?.resultLabel || `Study ${view?.studyId || ''}`.trim() || 'Study';
  const authors = record?.authors;
  const journal = record?.journal;
  const year = record?.year;
  const hasMeta = authors || journal || year;
  const decision = record ? articleDecisionBadge(record) : null;
  const keywords = (record?.keywords || '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
  const hasDetail = showDetails && record && (record.abstract || keywords.length > 0);
  return (
    <div style={{ flexShrink: 0, padding: '13px 18px', border: `1px solid ${C.brd}`, borderRadius: 12, background: C.card }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: C.txt, fontFamily: FONT, lineHeight: 1.38, overflowWrap: 'anywhere' }}>{title}</div>
          {hasMeta ? (
            <div style={{ fontSize: 12, color: C.txt2, marginTop: 4, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
              {authors && <span>{authors}</span>}
              {journal && <span style={{ fontStyle: 'italic', color: C.muted }}>{authors ? ' · ' : ''}{journal}</span>}
              {year && <span style={{ color: C.muted }}>{(authors || journal) ? ' · ' : ''}{year}</span>}
            </div>
          ) : loading ? (
            <div style={{ fontSize: 11.5, color: C.muted, fontFamily: MONO, marginTop: 4 }}>Loading article…</div>
          ) : (
            <div style={{ fontSize: 11.5, color: C.muted, fontFamily: MONO, marginTop: 4 }}>Study {view?.studyId}{view?.outcomeId ? ` · ${view.outcomeId}` : ''}</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {record?.doi && <a href={`https://doi.org/${record.doi}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none', overflowWrap: 'anywhere', wordBreak: 'break-all' }}>DOI: {record.doi}</a>}
          {record?.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${record.pmid}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none' }}>PMID: {record.pmid}</a>}
          {record?.sourceDb && <RobBadge>{record.sourceDb}</RobBadge>}
          {record?.isDuplicate && <RobBadge color={C.gold}>Duplicate</RobBadge>}
          {decision && <RobBadge color={decision.color}>{decision.label}</RobBadge>}
          {hasDetail && (
            <button onClick={() => setOpen(o => !o)} aria-expanded={open} style={{ ...linkBtn, fontFamily: FONT, fontSize: 11.5 }}>
              <Icon name="info" size={13} /> {open ? 'Hide details' : 'Abstract & keywords'}
            </button>
          )}
        </div>
      </div>
      {hasDetail && open && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.brd}` }}>
          {record.abstract ? (
            <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.65, margin: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>{record.abstract}</p>
          ) : (
            <p style={{ fontSize: 12.5, color: C.muted, fontStyle: 'italic', margin: 0 }}>No abstract provided.</p>
          )}
          {keywords.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              <span style={{ fontSize: 9.5, color: C.muted, fontFamily: MONO, alignSelf: 'center', letterSpacing: '0.08em' }}>KEYWORDS</span>
              {keywords.map((kw, i) => <span key={i} style={{ fontSize: 10.5, background: alpha(C.brd, '70'), border: `1px solid ${C.brd}`, color: C.txt2, borderRadius: 10, padding: '2px 9px' }}>{kw}</span>)}
            </div>
          )}
        </div>
      )}
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
function DomainPane({ domain, answers, meta, proposal, resolved, overrideInfo, focusedQ, setFocusedQ, guidanceOpen, setGuidanceOpen, reduced, finalised, editable, onAnswer, onMeta, onOverride, suggestions, suggestionState, onAcceptSuggestion, onRejectSuggestion }) {
  const reachable = domain.questions.filter(q => isReachable(q, answers));
  return (
    <div>
      <div style={{ marginBottom: 4, fontSize: 11, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Domain {domain.id.slice(1)}</div>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: C.txt, margin: '0 0 4px', fontFamily: FONT }}>{domain.name}</h2>
      <p style={{ fontSize: 13, color: C.txt2, margin: '0 0 18px', lineHeight: 1.55, maxWidth: 720 }}>{domain.description}</p>

      {/* prompt46 #6 — signalling questions flow into newspaper COLUMNS when the pane is
          wide (PDF hidden / even split), so a domain's cards no longer stack into one
          tall column that overflows. CSS multi-column fills top-to-bottom then over, so
          the numbered/branching question order (1.1→1.2→…) is preserved (a row-major grid
          would read 1.1,1.2 across — wrong for a sequential instrument). Collapses to ONE
          column automatically when narrow (column-width 360px). Padding/spacing unchanged —
          width is rebalanced, not compressed. */}
      <div style={{ columns: '360px', columnGap: 16 }}>
        {reachable.map(q => {
          const focused = focusedQ === q.id;
          const gOpen = guidanceOpen[q.id];
          const m = meta[q.id] || {};
          return (
            <div key={q.id} onClick={() => setFocusedQ(q.id)} style={{
              border: `1px solid ${focused ? alpha(C.acc, '55') : C.brd}`, borderRadius: 12, padding: '18px 20px', background: C.card,
              boxShadow: focused ? `0 0 0 3px ${alpha(C.acc, '14')}` : 'none', transition: reduced ? 'none' : 'box-shadow 0.15s, border-color 0.15s, opacity 0.25s', cursor: 'default',
              // prompt46 #6 — keep each card whole within a column + provide the vertical
              // rhythm (CSS multi-column uses margin, not grid gap).
              breakInside: 'avoid', WebkitColumnBreakInside: 'avoid', marginBottom: 16,
            }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color: C.acc, flexShrink: 0, marginTop: 2 }}>{q.id}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: C.txt, lineHeight: 1.55, fontWeight: 500 }}>{q.text}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
                    <SegmentedControl qid={q.id} value={answers[q.id] || ''} onChange={r => editable && onAnswer(q.id, r)} />
                    <button onClick={() => setGuidanceOpen(g => ({ ...g, [q.id]: !g[q.id] }))} style={linkBtn} aria-expanded={!!gOpen}>
                      <Icon name="info" size={13} /> {gOpen ? 'Hide guidance' : 'Guidance'}
                    </button>
                  </div>
                  {gOpen && (
                    <div style={{ marginTop: 13, padding: '12px 14px', background: C.surf, borderRadius: 8, fontSize: 12.5, color: C.txt2, lineHeight: 1.65, borderLeft: `3px solid ${alpha(C.acc, '50')}` }}>{q.guidance}</div>
                  )}
                  {focused && editable && (
                    // prompt43 Area 3 — rationale + evidence sit side-by-side on a wide
                    // pane (auto-fit) and stack only when there isn't room, using
                    // horizontal space instead of always stacking into a tall column.
                    <div style={{ marginTop: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
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
                  {suggestions && suggestions[q.id] && suggestions[q.id].suggestedResponse && (
                    <SuggestionCard
                      suggestion={suggestions[q.id]}
                      state={suggestionState && suggestionState[q.id]}
                      editable={editable}
                      onAccept={(resp, ev) => onAcceptSuggestion(q.id, resp, ev)}
                      onReject={() => onRejectSuggestion(q.id)}
                    />
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
function SummaryStep({ view, instrument = ROB2, live, single, finalised, editable, onExport, onOverrideOverall, onJump }) {
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
        {instrument.domains.map(d => {
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

      {!complete && editable && !finalised && (
        <div style={{ padding: '10px 14px', borderRadius: 9, background: alpha(C.yel, '14'), border: `1px solid ${alpha(C.yel, '40')}`, color: C.txt2, fontSize: 12.5, marginBottom: 16 }}>
          <Icon name="info" size={13} /> Answer all reachable signalling questions to enable finalising ({live.completeness.overall.answered}/{live.completeness.overall.required} answered). The <strong>Finalise</strong> button is in the action bar below.
        </div>
      )}

      {/* Finalise / Re-open live in the always-visible action footer (Task 2); the
          summary keeps only the exports for this assessment. */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted, alignSelf: 'center', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Export</span>
        <button onClick={() => onExport('csv')} style={ghostBtn}><Icon name="download" size={13} /> CSV</button>
        <button onClick={() => onExport('json')} style={ghostBtn}><Icon name="download" size={13} /> JSON</button>
        <button onClick={() => onExport('robvis')} style={ghostBtn}><Icon name="download" size={13} /> robvis</button>
      </div>
    </div>
  );
}

// ── Override modal ────────────────────────────────────────────────────────────
// `judgmentLevels` come from the assessment's instrument: RoB 2 → low/some/high
// (default), ROBINS-I → low/moderate/serious/critical/ni. The human's final
// judgement can be any level the instrument defines.
function OverrideModal({ info, judgmentLevels, onCancel, onSubmit }) {
  const levels = (Array.isArray(judgmentLevels) && judgmentLevels.length)
    ? judgmentLevels.map(l => (typeof l === 'string' ? l : l.value))
    : ['low', 'some', 'high'];
  const [judgment, setJudgment] = useState(
    info.current && info.current !== 'na' && levels.includes(info.current)
      ? info.current
      : (levels[1] || levels[0]),
  );
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
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {levels.map(j => {
            const st = judgmentStyle(j); const on = judgment === j;
            return (
              <button key={j} onClick={() => setJudgment(j)} style={{ flex: '1 1 90px', minWidth: 90, padding: '9px 8px', borderRadius: 9, cursor: 'pointer', fontFamily: FONT, fontWeight: 700, fontSize: 12.5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: on ? st.bg : C.surf, color: on ? st.fg : C.txt2, border: `1px solid ${on ? alpha(st.hex, 0.6) : C.brd2}` }}>
                <Icon name={st.icon} size={14} /> {st.short || st.label}
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

// ── Guided appraisal (P14) ────────────────────────────────────────────────────
// A per-question SUGGESTION card. A suggestion is a reviewer suggestion the human
// accepts / modifies / rejects — it NEVER becomes a final judgement on its own.
// Accepting writes an ANSWER (the deterministic engine then re-proposes the
// judgement); the human still sets the final judgement via the override flow.
const SUGGESTION_SRC_LABEL = { title: 'title', abstract: 'abstract', fullText: 'full text' };

function SuggestionCard({ suggestion, state, editable, onAccept, onReject }) {
  const [mode, setMode] = useState('view');
  const [resp, setResp] = useState(suggestion.suggestedResponse);
  const [ev, setEv] = useState(suggestion.evidenceQuote || '');
  const conf = Math.round((Number(suggestion.confidence) || 0) * 100);
  const where = suggestion.evidenceLocator && suggestion.evidenceLocator.where;
  const srcLabel = SUGGESTION_SRC_LABEL[where] || (where || 'the study text');

  if (state === 'accepted') {
    return (
      <div style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: C.grn, fontFamily: FONT }}>
        <Icon name="check" size={13} /> Suggestion accepted — confirm or override the final judgement below.
      </div>
    );
  }
  if (state === 'rejected') {
    return (
      <div style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.muted, fontFamily: FONT }}>
        <Icon name="x" size={12} /> Suggestion dismissed.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14, border: `1px dashed ${alpha(C.acc, '50')}`, borderRadius: 10, background: alpha(C.acc, '08'), padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: suggestion.evidenceQuote || suggestion.rationale ? 8 : 10 }}>
        <span style={{ fontSize: 9.5, fontFamily: MONO, fontWeight: 700, color: C.acc, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Suggested</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 20, background: alpha(C.acc, '16'), border: `1px solid ${alpha(C.acc, '40')}`, color: C.acc, fontSize: 11.5, fontWeight: 700, fontFamily: FONT }}>
          {RESPONSE_LABELS[suggestion.suggestedResponse] || suggestion.suggestedResponse}
          <span style={{ fontFamily: MONO, fontSize: 9.5, opacity: 0.7 }}>{suggestion.suggestedResponse}</span>
        </span>
        <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted }}>confidence {conf}%</span>
        <span aria-hidden style={{ flex: 1 }} />
        <span style={{ fontSize: 9.5, color: C.muted, fontStyle: 'italic' }}>Suggestion — review before it counts</span>
      </div>
      {suggestion.evidenceQuote ? (
        <div style={{ margin: '0 0 8px', padding: '8px 11px', borderLeft: `3px solid ${alpha(C.acc, '45')}`, background: C.surf, borderRadius: 6, fontSize: 12.5, color: C.txt2, fontStyle: 'italic', lineHeight: 1.55 }}>
          “{suggestion.evidenceQuote}”
          <span style={{ display: 'block', marginTop: 4, fontStyle: 'normal', fontSize: 10.5, color: C.muted, fontFamily: MONO }}>— from the {srcLabel}</span>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, fontStyle: 'italic' }}>No supporting quote was found in the provided text.</div>
      )}
      {suggestion.rationale && <div style={{ fontSize: 12, color: C.txt2, marginBottom: 10, lineHeight: 1.5 }}>{suggestion.rationale}</div>}

      {mode === 'modify' ? (
        <div>
          <div style={{ marginBottom: 8 }}>
            <SegmentedControl qid={suggestion.questionId} value={resp} onChange={r => setResp(r || resp)} />
          </div>
          <textarea value={ev} onChange={e => setEv(e.target.value)} rows={2} placeholder="Evidence quote (edit before saving)" style={{ ...taStyle, marginBottom: 8, fontStyle: 'italic' }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => onAccept(resp, ev)} style={primaryBtn(false)}><Icon name="check" size={13} /> Save answer</button>
            <button onClick={() => setMode('view')} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button disabled={!editable} onClick={() => onAccept(suggestion.suggestedResponse, suggestion.evidenceQuote || '')} style={primaryBtn(!editable)}><Icon name="check" size={13} /> Accept</button>
          <button disabled={!editable} onClick={() => { setResp(suggestion.suggestedResponse); setEv(suggestion.evidenceQuote || ''); setMode('modify'); }} style={{ ...ghostBtn, opacity: editable ? 1 : 0.5 }}><Icon name="pencil" size={12} /> Modify</button>
          <button disabled={!editable} onClick={onReject} style={{ ...ghostBtn, opacity: editable ? 1 : 0.5 }}><Icon name="x" size={12} /> Reject</button>
        </div>
      )}
    </div>
  );
}

// Calm status strip: coverage + warnings + the standing reminder that these are
// suggestions requiring review. No "AI" framing — this is a deterministic,
// text-cue appraisal the reviewer confirms.
function AppraisalStatusBar({ appraisal, error, pending, onClear, onJumpFirst }) {
  const cov = appraisal && appraisal.coverage;
  const warnings = (appraisal && appraisal.warnings) || [];
  return (
    <div style={{ padding: '10px 20px', borderBottom: `1px solid ${C.brd}`, background: alpha(C.acc, '06'), display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontFamily: MONO, color: C.acc, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Guided appraisal</span>
        {error ? (
          <span style={{ fontSize: 12, color: C.red }}>{error}</span>
        ) : (
          <>
            <span style={{ fontSize: 11.5, color: C.txt2 }}>
              {pending > 0 ? `${pending} suggestion${pending === 1 ? '' : 's'} to review` : 'All suggestions reviewed'}
              {cov ? ` · ${cov.hasFullText ? 'full text' : 'title/abstract only'} · ${cov.domainsWithEvidence} domain${cov.domainsWithEvidence === 1 ? '' : 's'} with evidence` : ''}
            </span>
            {pending > 0 && <button onClick={onJumpFirst} style={linkBtn}>Go to first suggestion</button>}
          </>
        )}
        <span aria-hidden style={{ flex: 1 }} />
        <button onClick={onClear} style={{ ...linkBtn, color: C.muted }}><Icon name="x" size={12} /> Clear</button>
      </div>
      {warnings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11.5, color: C.txt2, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <Icon name="info" size={12} /> <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 10.5, color: C.muted, fontStyle: 'italic' }}>
        These are suggestions drawn from the study text — each must be reviewed and accepted; nothing is decided for you.
      </div>
    </div>
  );
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
  return { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 11px', marginBottom: 3, borderRadius: 9, background: on ? C.card : 'transparent', border: `1px solid ${on ? C.brd : 'transparent'}`, cursor: 'pointer', textAlign: 'left', fontFamily: FONT };
}
// Horizontal domain chip (top-rail mode).
function navChip(on) {
  return { display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0, padding: '7px 12px', borderRadius: 9, background: on ? C.card : 'transparent', border: `1px solid ${on ? alpha(C.acc, '55') : C.brd2}`, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' };
}
