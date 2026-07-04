/**
 * SearchWorkspace.jsx — 71.md + 73.md. A calmer, guided, progressive-disclosure STAGED
 * workspace for the Search stage. It is a COMPOSITION/arrangement redesign of the
 * existing 3-step SearchWizard: it keeps ALL functional power by REUSING the proven
 * engine components unchanged — it never re-implements search.
 *
 * Shape: a LEFT vertical stage rail (modeled on StitchWorkflowStepper — numbered pips
 * that always show the number, status by icon+colour not colour-only, disabled-with-
 * reason, aria-current, keyboard) with 9 stages, and a RIGHT pane that renders the
 * current stage by composing existing components:
 *
 *   1. Research Question   — PICO/question summary (from the `pico` prop) + helper.
 *   2. Concepts            — <SearchBuilderTab phase="concepts"/> (keyword selection +
 *                            compact concept-structure summary).
 *   3. Terms & Vocabulary  — <SearchBuilderTab phase="terms"/> (full concept/term detail,
 *                            MeSH kept separate from free-text + Limits).
 *   4. Search Mode         — 73.md P5: the explicit two-path choice — MANUAL (PecanRev
 *                            compiles a strategy per database, you run it yourself) vs
 *                            AUTOMATED (PecanRev runs its connected databases for you).
 *                            Persisted additively as `searchMode` on the search module.
 *   5. Database Strategies — <SearchBuilderTab phase="build"/> (databases + the 73.md P6
 *                            per-database compiled strategy workspace) + (studio)
 *                            <StrategyStudioPanel/>.
 *   6. Test & Refine       — multi-DB preview counts (pecanSearchApi.previewCount) +
 *                            <SearchQualityPanel/> + <SearchVersionsPanel/>.
 *   7. Automated Search / Run Externally — mode-aware: <PecanSearchTab embedded/> (run +
 *                            live monitor + dedupe + history) OR the manual run guidance.
 *   8. Documentation       — <SearchExportPanel/> (methods text + PRISMA-S) + (studio)
 *                            <RecallReportPanel/>.
 *   9. Send to Screening   — the readyForScreening marker + the "Go to Screening" handoff.
 *
 * 73.md P1 — ONE deliberate scroll model: the page scrolls, the rail is sticky (and
 * scrolls internally when the viewport is short), no nested scrollers; every stage
 * change resets the nearest scrollable ancestor. P3 — a sticky PubMed pulse bar keeps
 * the live estimate visible on every build stage (the builder stays mounted, so its
 * hit machine keeps running).
 *
 * State preservation: the heavy Search Builder is mounted ONCE and kept mounted across
 * every stage (hidden when the active stage isn't a builder stage), so concepts /
 * strategy edits survive stage switches — and it autosaves to the `search`
 * WorkflowModuleState regardless. The single source of truth stays that module; this
 * workspace owns no persisted state of its own beyond the additive `searchMode` key.
 *
 * Gated behind the `searchWorkspaceV2` flag (OFF by default) at the dispatcher; when
 * OFF the legacy SearchWizard renders unchanged. Reuses the existing components + their
 * existing API calls — no engine forks.
 */
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { C, FONT, alpha } from '../../frontend/theme/tokens.js';
import { Icon } from '../../frontend/components/icons.jsx';
import { SearchBuilderTab, searchBuilderApi, loadSearch, saveSearch, relativeTime } from '../searchBuilder/index.js';
import { getDatabase, defaultSelectedDatabases, DATABASE_CATALOG } from '../../research-engine/searchBuilder/databases.js';
import PecanSearchTab from '../pecanSearch/PecanSearchTab.jsx';
import { pecanSearchApi } from '../pecanSearch/pecanSearchApi.js';
import {
  SearchQualityPanel, SearchVersionsPanel, SearchExportPanel,
  StrategyStudioPanel, RecallReportPanel, strategyStudioFlagEnabled,
} from '../searchWizard/index.js';
import { Card, Note } from '../pecanSearch/components/parts.jsx';

/* The 9 guided stages. `num` drives the always-numbered pip; `builder`/`phase` mark the
   stages that render the (persistent) Search Builder; `needsConcepts` marks stages that
   are only meaningful once a strategy exists (disabled-with-reason until then). */
export const STAGES = [
  { id: 'question',      num: 1, label: 'Research Question',   desc: 'Frame the question' },
  { id: 'concepts',      num: 2, label: 'Concepts',            desc: 'Core concepts',         builder: true, phase: 'concepts' },
  { id: 'terms',         num: 3, label: 'Terms & Vocabulary',  desc: 'Synonyms & MeSH',       builder: true, phase: 'terms' },
  { id: 'mode',          num: 4, label: 'Search Mode',         desc: 'Manual or automated' },
  { id: 'strategy',      num: 5, label: 'Database Strategies', desc: 'Per-database syntax',   builder: true, phase: 'build' },
  { id: 'refine',        num: 6, label: 'Test & Refine',       desc: 'Counts & quality' },
  { id: 'results',       num: 7, label: 'Run Externally',      desc: 'Your database accounts', needsConcepts: true },
  { id: 'documentation', num: 8, label: 'Documentation',       desc: 'Methods & PRISMA-S' },
  { id: 'screening',     num: 9, label: 'Send to Screening',   desc: 'Prepare the import',    needsConcepts: true },
];

/* 73.md P5 — the Results stage is mode-aware: automated runs inside PecanRev, manual
   (or not-yet-chosen) runs in the user's own database accounts. Pure + exported. */
export function stagesFor(searchMode) {
  return STAGES.map((s) => {
    if (s.id !== 'results') return s;
    return searchMode === 'automated'
      ? { ...s, label: 'Automated Search', desc: 'Run & deduplicate' }
      : s;
  });
}

const DISABLED_REASON = 'Build a strategy with at least one concept first';

/* 73.md P1 — the nearest scrollable ancestor of `el` (computed overflowY auto|scroll),
   or null. `getStyle` is injectable for tests; defaults to window.getComputedStyle.
   Pure walk + exported for unit tests. */
export function findScrollableAncestor(el, getStyle) {
  const gs = getStyle || ((n) => (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function' ? window.getComputedStyle(n) : null));
  let node = el && el.parentElement ? el.parentElement : null;
  while (node) {
    let oy = '';
    try { const st = gs(node); oy = st ? String(st.overflowY || '') : ''; } catch { oy = ''; }
    if (oy === 'auto' || oy === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/* 73.md P5 — persist the search mode via the SAME load→merge→save path the ready-
   marker uses (no engine fork; the server merges shallowly, but we replay the full
   known shape so a fresh save is always self-consistent). Injectable load/save for
   unit tests. Throws when the save is rejected so callers can soft-fail. */
export async function persistSearchModeMerged(loadFn, saveFn, projectId, mode) {
  const saved = await loadFn(projectId).catch(() => null);
  const merged = {
    concepts: (saved && saved.concepts) || [],
    overrides: (saved && saved.overrides) || {},
    ignored: (saved && saved.ignored) || [],
    databases: (saved && saved.databases) || [],
    dismissedWarnings: (saved && saved.dismissedWarnings) || [],
    filters: (saved && saved.filters) || {},
    readyForScreening: !!(saved && saved.readyForScreening),
    searchMode: mode === 'manual' || mode === 'automated' ? mode : null,
  };
  const ack = await saveFn(projectId, merged);
  if (!ack) throw new Error('save failed');
  return merged;
}

/* ════════════ 73.md P3 — PUBMED PULSE ════════════
   A slim sticky bar keeping the live PubMed estimate visible across the build stages.
   Driven by hit-state snapshots the (always-mounted) builder reports upward. HONEST BY
   DESIGN: a count is only ever presented as current in the 'updated' state; while the
   strategy is changing/refreshing the old number is shown explicitly as "previous",
   struck through. Exported for direct unit tests. */
export function PubMedPulse({ snapshot, hasConcepts, onRetry }) {
  const s = snapshot || { status: 'idle', count: null, updatedAt: null, error: null };
  // Keep the "updated Xm ago" stamp fresh on a slow tick (no fetch).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (s.status !== 'updated' || s.updatedAt == null) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, [s.status, s.updatedAt]);

  const prevCount = s.count != null ? Number(s.count).toLocaleString() : null;
  const dot = (color) => (
    <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
  );
  let body = null;
  if (!hasConcepts) {
    body = <span style={{ color: C.muted }}>Add concepts to see a live PubMed estimate.</span>;
  } else if (s.status === 'updated' && s.count != null) {
    body = (
      <>
        {dot(C.grn)}
        <span style={{ fontWeight: 700, color: C.txt }}>≈ {Number(s.count).toLocaleString()} PubMed records</span>
        {s.updatedAt != null && <span style={{ color: C.dim, fontSize: 10.5 }} title={new Date(s.updatedAt).toLocaleString()}>updated {relativeTime(s.updatedAt)}</span>}
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: C.grn, border: `1px solid ${alpha(C.grn, '55')}`, borderRadius: 4, padding: '0 5px', textTransform: 'uppercase' }}>live</span>
      </>
    );
  } else if (s.status === 'updating') {
    body = (
      <>
        {dot(C.yel)}
        <span style={{ color: C.txt2 }}>Updating estimate…</span>
        {prevCount != null && <span style={{ color: C.dim, fontSize: 10.5 }}>previous: <s>≈ {prevCount}</s></span>}
      </>
    );
  } else if (s.status === 'stale') {
    body = (
      <>
        {dot(C.yel)}
        <span style={{ color: C.yel }}>Strategy changed — estimate refreshing…</span>
        {prevCount != null && <span style={{ color: C.dim, fontSize: 10.5 }}>previous: <s>≈ {prevCount}</s></span>}
      </>
    );
  } else if (s.status === 'failed') {
    body = (
      <>
        {dot(C.red)}
        <span style={{ color: C.red }}>PubMed estimate unavailable{s.error ? ` — ${s.error}` : ''}</span>
        {onRetry && (
          <button type="button" onClick={onRetry} style={{ ...ghostBtn(), fontSize: 10.5, padding: '3px 10px' }}>Retry</button>
        )}
      </>
    );
  } else {
    body = <span style={{ color: C.muted }}>A live PubMed estimate appears here as you build.</span>;
  }
  return (
    <div data-testid="pubmed-pulse" role="status" aria-live="polite"
      style={{
        position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '7px 14px', marginBottom: 14,
        fontSize: 12, fontFamily: FONT, boxShadow: '0 4px 14px #0003',
      }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, color: C.muted, textTransform: 'uppercase', flexShrink: 0 }}>PubMed pulse</span>
      {body}
    </div>
  );
}

/* ════════════ LEFT RAIL ════════════
   Vertical numbered stepper (modeled on StitchWorkflowStepper): the pip ALWAYS shows the
   number; status is a SECONDARY treatment (colour + a right-side icon, never colour
   alone). Continuous connector via two absolutely-positioned segments around a fixed pip
   centre. Disabled stages announce their reason in the aria-label + title. */
const RAIL_PIP = 26;
const RAIL_PAD_TOP = 9;
const RAIL_PIP_CENTER = RAIL_PAD_TOP + RAIL_PIP / 2;

function StageRail({ stages, active, onSelect, statusFor }) {
  return (
    <nav aria-label="Search workflow" data-testid="search-workspace-rail" style={{ fontFamily: FONT }}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {stages.map((s, i) => {
          const st = statusFor(s);
          const connAbove = i > 0;
          const connBelow = i < stages.length - 1;
          const pipBorder = st.active ? C.acc : st.done ? alpha(C.grn, '88') : C.brd2;
          const pipColor = st.active ? C.acc : st.done ? C.grn : (st.disabled ? C.dim : C.txt2);
          const pipBg = st.active ? alpha(C.acc, '14') : st.done ? alpha(C.grn, '12') : C.card2;
          return (
            <li key={s.id} style={{ listStyle: 'none' }}>
              <button
                type="button"
                onClick={st.disabled ? undefined : () => onSelect(s.id)}
                disabled={st.disabled}
                aria-current={st.active ? 'step' : undefined}
                aria-disabled={st.disabled || undefined}
                aria-label={`Stage ${s.num}: ${s.label}${st.done ? ' — done' : ''}${st.disabled ? ` — ${st.reason}` : ''}`}
                title={st.disabled ? st.reason : undefined}
                style={{
                  position: 'relative', display: 'flex', alignItems: 'stretch', gap: 11, width: '100%',
                  padding: `${RAIL_PAD_TOP}px 10px ${RAIL_PAD_TOP}px 0`, border: 'none', borderRadius: 9, textAlign: 'left',
                  background: st.active ? alpha(C.acc, '10') : 'transparent',
                  color: st.disabled ? C.dim : (st.active ? C.acc : C.txt), cursor: st.disabled ? 'not-allowed' : 'pointer',
                  opacity: st.disabled ? 0.65 : 1, fontFamily: FONT,
                }}
              >
                {st.active && <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 3, background: C.acc }} />}
                {/* pip column with continuous connector segments */}
                <span style={{ width: 34, flexShrink: 0, position: 'relative' }}>
                  {connAbove && <span aria-hidden="true" style={{ position: 'absolute', left: '50%', top: 0, height: RAIL_PIP_CENTER, width: 2, transform: 'translateX(-1px)', background: alpha(C.brd2, '99') }} />}
                  {connBelow && <span aria-hidden="true" style={{ position: 'absolute', left: '50%', top: RAIL_PIP_CENTER, bottom: 0, width: 2, transform: 'translateX(-1px)', background: st.done ? alpha(C.grn, '55') : alpha(C.brd2, '99') }} />}
                  <span style={{
                    position: 'absolute', left: '50%', top: RAIL_PAD_TOP, transform: 'translateX(-50%)',
                    width: RAIL_PIP, height: RAIL_PIP, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 800, lineHeight: 1, zIndex: 1,
                    background: pipBg, border: `${st.active ? 2 : 1.6}px solid ${pipBorder}`, color: pipColor,
                  }}>{s.num}</span>
                </span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, paddingTop: 2 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: st.active ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                    {/* secondary status glyph — decorative; the aria-label carries the meaning */}
                    {st.done && !st.active && <span aria-hidden="true" style={{ color: C.grn, fontSize: 12, fontWeight: 800, flexShrink: 0 }}>✓</span>}
                    {st.disabled && <span aria-hidden="true" style={{ color: C.dim, fontSize: 11, flexShrink: 0 }}>🔒</span>}
                  </span>
                  <span style={{ fontSize: 10.5, color: st.disabled ? C.dim : C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.desc}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ════════════ TEST & REFINE — multi-database preview counts ════════════
   Best-effort per-source estimated counts for the current live strategy, via the SAME
   Pecan engine endpoint the wizard uses (pecanSearchApi.previewCount). Databases without
   a connector simply don't appear; a quiet note when the automated run is off. */
function PreviewEstimates({ projectId, getLive, pecanEnabled }) {
  const [state, setState] = useState('idle'); // idle | loading | ready | error
  const [counts, setCounts] = useState({});
  const [err, setErr] = useState('');

  const estimate = useCallback(async () => {
    const live = getLive() || {};
    const concepts = Array.isArray(live.concepts) ? live.concepts : [];
    const databases = Array.isArray(live.databases) ? live.databases : [];
    if (!concepts.length) { setErr('Add concepts first.'); setState('error'); return; }
    setState('loading'); setErr('');
    try {
      const canonicalQuery = { concepts, filters: live.filters || {} };
      const sources = databases.length ? databases.map((id) => ({ provider: id })) : undefined;
      const out = await pecanSearchApi.previewCount(projectId, { canonicalQuery, sources, overrides: live.overrides || {} });
      setCounts((out && out.counts) || {});
      setState('ready');
    } catch (e) {
      setErr((e && e.message) || 'Could not estimate counts.'); setState('error');
    }
  }, [projectId, getLive]);

  if (!pecanEnabled) {
    return (
      <Card title="Estimated results per database" icon="barChart" desc="Live per-database estimates need the Pecan Search Engine — Automated Run (enable it in Ops). You can still build, refine and copy the strategy.">
        <Note tone="info">Once the automated run is enabled, this shows an estimated result count for every connected database before you run.</Note>
      </Card>
    );
  }
  const ids = Object.keys(counts);
  const fmt = (c) => {
    if (!c || c.count == null || c.kind === 'unsupported' || c.kind === 'unavailable') return '—';
    return Number(c.count).toLocaleString() + (c.kind === 'estimate' ? '*' : '');
  };
  return (
    <Card
      title="Estimated results per database" icon="barChart"
      desc="A best-effort count of what the current strategy would return in each connected database — a quick sensitivity check before you run."
      right={<button type="button" onClick={estimate} disabled={state === 'loading'} style={ghostBtn()}>{state === 'loading' ? 'Estimating…' : ids.length ? 'Refresh estimates' : 'Estimate results'}</button>}
    >
      {state === 'error' && <Note tone="warn">{err}</Note>}
      {ids.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ids.map((id) => (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8, padding: '5px 10px', fontSize: 11.5 }}>
              <span style={{ color: C.txt2, fontWeight: 600 }}>{id}</span>
              <span style={{ color: C.acc, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(counts[id])}</span>
            </span>
          ))}
          <span style={{ alignSelf: 'center', fontSize: 10, color: C.dim }}>* estimated</span>
        </div>
      )}
      {state === 'idle' && ids.length === 0 && (
        <div style={{ fontSize: 12, color: C.muted }}>Estimate how many records the current strategy returns in each database.</div>
      )}
    </Card>
  );
}

/* prompt60/71 — the deep link to the screening Import sub-page WITHIN the unified shell
   (both shells read `?tab=` / `?screen=` off the live pathname). Mirrors the Pecan
   completion "Go to Screening" link so the import history there shows these records. */
function screeningImportHref() {
  if (typeof window === 'undefined') return '#';
  const path = (window.location && window.location.pathname) || '/app';
  return `${path}?tab=screening&screen=import`;
}

/* ════════════ 73.md P5 — SEARCH MODE stage ════════════
   Two selectable path cards with radio semantics. Selecting persists `searchMode` via
   the load→merge→save path (soft-fail with an error Note; local state reflects
   immediately). The static automated-provider list is replaced by the live provider
   catalogue when the Pecan engine is enabled. */
const AUTOMATED_PROVIDER_FALLBACK = ['PubMed', 'Europe PMC', 'ClinicalTrials.gov', 'Crossref', 'DOAJ', 'OpenAlex', 'Semantic Scholar'];

function ModeCard({ id, checked, onChoose, onArrow, title, tagline, body, benefit, limitation, next, chips, footNote }) {
  return (
    <div
      role="radio"
      aria-checked={checked}
      tabIndex={0}
      data-testid={`search-mode-card-${id}`}
      onClick={onChoose}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChoose(); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); onArrow(); }
      }}
      style={{
        flex: '1 1 320px', minWidth: 280, cursor: 'pointer', borderRadius: 12, padding: 16, fontFamily: FONT,
        background: checked ? alpha(C.acc, '0c') : C.card,
        border: `2px solid ${checked ? C.acc : C.brd}`,
        outline: 'none', boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
        {/* radio glyph — state is shape + text, never colour alone */}
        <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${checked ? C.acc : C.brd2}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {checked && <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.acc }} />}
        </span>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: C.txt }}>{title}</span>
        {checked && <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, color: C.acc, border: `1px solid ${alpha(C.acc, '55')}`, borderRadius: 5, padding: '1px 7px', textTransform: 'uppercase' }}>selected</span>}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>{tagline}</div>
      <div style={{ fontSize: 12, color: C.txt2, lineHeight: 1.65, marginBottom: 10 }}>{body}</div>
      <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5, color: C.txt2, lineHeight: 1.5, marginBottom: 4 }}>
        <span aria-hidden="true" style={{ color: C.grn, fontWeight: 800 }}>+</span><span>{benefit}</span>
      </div>
      <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5, color: C.txt2, lineHeight: 1.5, marginBottom: 10 }}>
        <span aria-hidden="true" style={{ color: C.yel, fontWeight: 800 }}>−</span><span>{limitation}</span>
      </div>
      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}><strong style={{ color: C.txt2 }}>What happens next:</strong> {next}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {chips.map((c) => (
          <span key={c} style={{ fontSize: 9.5, fontWeight: 600, color: C.txt2, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 99, padding: '2px 9px' }}>{c}</span>
        ))}
      </div>
      {footNote && <div style={{ marginTop: 10 }}><Note tone="info">{footNote}</Note></div>}
    </div>
  );
}

function ModeStage({ searchMode, onSelect, busy, err, pecanEnabled }) {
  // Live provider names when the automated engine is on (soft — static copy otherwise).
  const [providerNames, setProviderNames] = useState(null);
  useEffect(() => {
    if (!pecanEnabled) return undefined;
    let dead = false;
    (async () => {
      try {
        const p = await pecanSearchApi.getProviders();
        const names = ((p && p.providers) || []).filter((x) => x && x.selectable !== false).map((x) => x.label || x.id).filter(Boolean);
        if (!dead && names.length) setProviderNames(names);
      } catch { /* static copy is fine */ }
    })();
    return () => { dead = true; };
  }, [pecanEnabled]);
  const autoChips = providerNames || AUTOMATED_PROVIDER_FALLBACK;
  const allDbCount = DATABASE_CATALOG.length;

  return (
    <Card title="How do you want to run this search?" icon="settings" desc="Two paths to the same place: de-duplicated records in Screening. Your question, concepts, terms and limits are identical either way — this only decides who executes the search.">
      <div role="radiogroup" aria-label="Search mode" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <ModeCard
          id="manual"
          checked={searchMode === 'manual'}
          onChoose={() => !busy && onSelect('manual')}
          onArrow={() => !busy && onSelect('automated')}
          title="Manual search"
          tagline="You run each database yourself"
          body={<>PecanRev builds a database-specific search strategy for every database in your protocol. You review, copy or export each strategy and run it in the database yourself. Works with all {allDbCount} databases (incl. Embase, Scopus, Web of Science, CINAHL…). Results come back into PecanRev via Screening import.</>}
          benefit="Works with every database — including the subscription ones your institution licenses"
          limitation="You execute each search and import the exported results yourself"
          next={<>review each database&apos;s compiled strategy in <strong style={{ color: C.txt2 }}>Database Strategies</strong>, run them in your accounts, then import the exports in <strong style={{ color: C.txt2 }}>Screening</strong>.</>}
          chips={[`All ${allDbCount} databases`, 'Embase', 'Scopus', 'Web of Science', 'CINAHL', '…']}
        />
        <ModeCard
          id="automated"
          checked={searchMode === 'automated'}
          onChoose={() => !busy && onSelect('automated')}
          onArrow={() => !busy && onSelect('manual')}
          title="Automated search"
          tagline="PecanRev runs its connected databases for you"
          body={<>PecanRev runs the strategy for you against its connected databases ({autoChips.join(', ')}), retrieves and de-duplicates records, and hands them to Screening automatically.</>}
          benefit="One click — retrieval, de-duplication and the Screening import happen for you"
          limitation="Connected open databases only — subscription databases (Embase, Scopus, …) still need a manual run"
          next={<>review the strategy, then start the run in <strong style={{ color: C.txt2 }}>Automated Search</strong> and watch it live.</>}
          chips={autoChips}
          footNote={!pecanEnabled ? (<span>The automated run needs the <strong>Pecan Search Engine — Automated Run</strong> enabled by an administrator in Ops. You can still choose this path now.</span>) : null}
        />
      </div>
      {err && <div style={{ marginTop: 12 }}><Note tone="error" role="alert">{err}</Note></div>}
      <div style={{ marginTop: 14, fontSize: 11.5, color: C.muted, lineHeight: 1.65 }}>
        You can switch modes at any time — your question, concepts, terms and limits are shared. Manual strategy edits and automated run history are each kept.
      </div>
    </Card>
  );
}

/* Slim, non-blocking chooser shown on Strategy/Results when no mode is chosen yet. */
function ModeChooserStrip({ onChoose, busy, goMode }) {
  return (
    <div data-testid="mode-chooser-strip" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: alpha(C.acc, '0a'), border: `1px solid ${alpha(C.acc, '33')}`, borderRadius: 10, padding: '8px 14px', marginBottom: 14, fontSize: 12, color: C.txt2, fontFamily: FONT }}>
      <span style={{ flex: 1, minWidth: 200 }}>How will this search run? Choose a mode — you can change it later.</span>
      <button type="button" onClick={() => onChoose('manual')} disabled={busy} style={ghostBtn()}>Manual — I run it</button>
      <button type="button" onClick={() => onChoose('automated')} disabled={busy} style={ghostBtn()}>Automated — PecanRev runs it</button>
      <button type="button" onClick={goMode} style={{ background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 11, fontFamily: FONT, textDecoration: 'underline', padding: 0 }}>Compare the two</button>
    </div>
  );
}

/* ════════════ 73.md P5 — MANUAL RUN stage (Results in manual / undecided mode) ════ */
function ManualRunStage({ getLive, goStrategy, onSwitchAutomated, busy, readOnly }) {
  const live = getLive() || {};
  const dbs = Array.isArray(live.databases) && live.databases.length ? live.databases : defaultSelectedDatabases();
  return (
    <>
      <div data-testid="manual-run-guide">
      <Card title="Run your search externally" icon="globe"
        desc="Manual mode: you execute each database's compiled strategy in the database itself, then bring the exports back into PecanRev.">
        <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.7, marginBottom: 14 }}>
          PecanRev compiled a paste-ready strategy for every database you selected. Run each one in your own database account
          (institutional access where needed), export the results (RIS / CSV / nbib), and import them into <strong style={{ color: C.txt }}>Screening</strong> —
          the import is de-duplicated there and each record keeps its source.
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 7 }}>Your database checklist</div>
        <ul style={{ listStyle: 'none', margin: '0 0 14px', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {dbs.map((id) => {
            const db = getDatabase(id);
            return (
              <li key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8, padding: '7px 12px', fontSize: 12 }}>
                <span aria-hidden="true" style={{ color: C.dim }}>☐</span>
                <span style={{ flex: 1, color: C.txt, fontWeight: 600 }}>{db ? db.label : id}</span>
                <button type="button" onClick={goStrategy} style={{ background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 11, fontFamily: FONT, textDecoration: 'underline', padding: 0 }}>
                  View strategy →
                </button>
              </li>
            );
          })}
        </ul>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <a href={screeningImportHref()} style={{ ...primaryBtn(), textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Icon name="arrowRight" size={14} /> Import your results
          </a>
          <span style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, flex: 1, minWidth: 220 }}>
            Opens the Screening import view — upload each database&apos;s export there; duplicates are matched, not re-added.
          </span>
        </div>
      </Card>
      </div>
      {!readOnly && (
        <Card title="Prefer PecanRev to run it?" icon="settings" desc="Switch to Automated and PecanRev searches its connected open databases, de-duplicates, and imports for you.">
          <button type="button" onClick={onSwitchAutomated} disabled={busy} style={ghostBtn()} data-testid="switch-to-automated">
            {busy ? 'Switching…' : 'Switch to Automated'}
          </button>
        </Card>
      )}
    </>
  );
}

/* ════════════ SEND TO SCREENING — first-class handoff ════════════
   Surfaces the advisory `readyForScreening` marker (read + toggle via the SAME
   search-builder module the builder persists) and the "Go to Screening" handoff.
   73.md P5 — the explanation is mode-aware (auto-import vs external import). */
function SendToScreeningStage({ projectId, pecanEnabled, readOnly, searchMode }) {
  const [ready, setReady] = useState(null); // null=unknown | boolean
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let dead = false;
    (async () => {
      const saved = await loadSearch(projectId).catch(() => null);
      if (!dead) setReady(!!(saved && saved.readyForScreening));
    })();
    return () => { dead = true; };
  }, [projectId]);

  // Toggle via load→merge→save through the existing search-builder API (no engine fork).
  // Advisory single-writer: the Search Builder also owns this flag, so mark ready once the
  // strategy is settled (going back to edit concepts re-triggers its autosave).
  const toggleReady = useCallback(async () => {
    setBusy(true); setErr('');
    try {
      const saved = await loadSearch(projectId).catch(() => null);
      const next = !(saved && saved.readyForScreening);
      const merged = {
        concepts: (saved && saved.concepts) || [],
        overrides: (saved && saved.overrides) || {},
        ignored: (saved && saved.ignored) || [],
        databases: (saved && saved.databases) || [],
        dismissedWarnings: (saved && saved.dismissedWarnings) || [],
        filters: (saved && saved.filters) || {},
        readyForScreening: next,
      };
      const ack = await saveSearch(projectId, merged);
      if (!ack) throw new Error('save failed');
      setReady(next);
    } catch {
      setErr('Could not update the ready state. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  const automated = searchMode === 'automated';
  return (
    <>
      <Card title="Send to screening" icon="arrowRight" desc="Hand the de-duplicated search results to this project's screening workspace, with a reproducible record of exactly what ran.">
        <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.7, marginBottom: 14 }}>
          {automated ? (
            <>
              When you run the strategy in <strong style={{ color: C.txt }}>Automated Search</strong>, every connected database is searched, the records are
              de-duplicated, and the new ones are imported into <strong style={{ color: C.txt }}>Screening</strong> tagged with the
              <strong style={{ color: C.txt }}> Pecan Search</strong> badge — automatically. Records already in the project are matched (not re-added), and
              ambiguous matches go to duplicate review before you begin title/abstract screening. The saved strategy version is the record of
              what was searched.
            </>
          ) : (
            <>
              In manual mode you run each database&apos;s compiled strategy yourself (see <strong style={{ color: C.txt }}>Database Strategies</strong>),
              export the results, and import them in <strong style={{ color: C.txt }}>Screening</strong>. The import de-duplicates against records already in the
              project, and the saved strategy version is the reproducible record of what was searched where.
            </>
          )}
        </div>

        {!readOnly && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <button type="button" onClick={toggleReady} disabled={busy || ready == null}
              style={ready ? primaryBtn() : ghostBtn()}>
              {busy ? 'Saving…' : ready ? '✓ Marked ready for screening import' : 'Mark strategy ready for screening import'}
            </button>
            <span style={{ fontSize: 11, color: C.muted }}>
              {ready == null ? 'Checking…' : ready ? 'Your team can see this search is finalized and ready to run.' : 'An advisory marker so collaborators know the strategy is settled.'}
            </span>
          </div>
        )}
        {readOnly && ready != null && (
          <Note tone={ready ? 'success' : 'info'}>{ready ? 'This search is marked ready for screening import.' : 'This search has not been marked ready yet.'}</Note>
        )}
        {err && <Note tone="error" role="alert">{err}</Note>}

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <a href={screeningImportHref()} style={{ ...primaryBtn(), textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Icon name="arrowRight" size={14} /> Go to Screening
          </a>
          <span style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, flex: 1, minWidth: 220 }}>
            Opens the screening import view for this project, where imported records and their source runs are listed.
          </span>
        </div>
      </Card>

      {automated && !pecanEnabled && (
        <Note tone="info">
          The automated multi-database run needs the <strong>Pecan Search Engine — Automated Run</strong> (enable it in Ops). Until then,
          open <strong>Database Strategies</strong> to copy each database&apos;s strategy, run it externally, and import the results from the
          Screening stage.
        </Note>
      )}
    </>
  );
}

/* ════════════ RESEARCH QUESTION — PICO summary ════════════ */
function QuestionStage({ pico }) {
  const p = pico || {};
  const hasCore = p.P || p.I || p.C || p.O || p.question;
  const rows = [
    { k: 'P', label: 'Population / Problem', color: C.acc },
    { k: 'I', label: 'Intervention / Exposure', color: C.grn },
    { k: 'C', label: 'Comparator / Control', color: C.yel },
    { k: 'O', label: 'Outcome(s)', color: C.purp },
  ];
  return (
    <Card title="Research question" icon="target" desc="Everything downstream builds on this. Concepts, synonyms and the per-database strategy all come from your PICO — set it in the Protocol stage.">
      {p.question ? (
        <div style={{ background: C.surf, border: `1px solid ${C.brd2}`, borderLeft: `3px solid ${C.acc}`, borderRadius: 10, padding: '12px 14px', marginBottom: hasCore ? 14 : 0, fontSize: 13, color: C.txt, lineHeight: 1.6 }}>
          {p.question}
        </div>
      ) : null}
      {rows.some((r) => p[r.k]) ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {rows.filter((r) => p[r.k]).map((r) => (
            <div key={r.k} style={{ background: C.surf, border: `1px solid ${C.brd2}`, borderLeft: `3px solid ${r.color}`, borderRadius: 9, padding: '10px 12px' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: r.color, letterSpacing: 0.3, marginBottom: 3 }}>{r.k} — {r.label}</div>
              <div style={{ fontSize: 12, color: C.txt2, lineHeight: 1.5 }}>{p[r.k]}</div>
            </div>
          ))}
        </div>
      ) : (
        <Note tone="info">No PICO entered yet. Open the <strong>Protocol</strong> stage to define your Population, Intervention, Comparator and Outcome, then return here — the concept extraction picks up from it.</Note>
      )}
      <div style={{ marginTop: 14, fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
        Next: move to <strong style={{ color: C.txt2 }}>Concepts</strong> to turn this question into searchable concepts.
      </div>
    </Card>
  );
}

/* Small per-stage intro shown above the shared builder so each builder stage has one
   focused framing (progressive disclosure — the builder's own step nav handles detail). */
function StageIntro({ title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, maxWidth: 760 }}>{children}</div>
    </div>
  );
}

/* Stages where the sticky PubMed pulse rides above the stage surface (the builder is
   mounted — hidden — on ALL of them, so its hit machine keeps running). */
const PULSE_STAGES = new Set(['concepts', 'terms', 'mode', 'strategy', 'refine', 'results']);

export default function SearchWorkspace({ projectId, pico, readOnly, pecanEnabled, initialStage, initialSearchMode }) {
  const [stage, setStage] = useState(initialStage || 'question');

  // Live in-memory query reported by the embedded builder — held in a ref so continuous
  // edits never re-render this shell (which would thrash the heavy builder). Snapshotted
  // into state only when entering Results.
  const liveRef = useRef({ concepts: [], filters: { dateFrom: '', dateTo: '', languages: [], pubTypes: [] }, overrides: {}, databases: [] });
  const [runQuery, setRunQuery] = useState(null);
  const [hasConcepts, setHasConcepts] = useState(false);
  // Bump to remount the quality/versions panels when (re)entering Test & Refine so they
  // re-read the current strategy — without ever re-rendering the memoized heavy builder.
  const [panelNonce, setPanelNonce] = useState(0);
  const bumpPanels = useCallback(() => setPanelNonce((n) => n + 1), []);

  // Studio panels are INERT unless searchStrategyStudio && searchEngine && pecanSearch are
  // all on (fail-closed). Effects never run under SSR, so this stays false in tests.
  const [studioEnabled, setStudioEnabled] = useState(false);
  useEffect(() => {
    let dead = false;
    (async () => {
      let on = false;
      try { on = await strategyStudioFlagEnabled(); } catch { on = false; }
      if (!dead) setStudioEnabled(!!on);
    })();
    return () => { dead = true; };
  }, []);

  // ── 73.md P5 — the persisted two-path search mode ('manual'|'automated'|null).
  // `initialSearchMode` is a render-seed (SSR/tests/deep links); the saved module
  // value adopted on mount stays authoritative. ──
  const [searchMode, setSearchMode] = useState(
    initialSearchMode === 'manual' || initialSearchMode === 'automated' ? initialSearchMode : null,
  );
  const [modeBusy, setModeBusy] = useState(false);
  const [modeErr, setModeErr] = useState('');
  useEffect(() => {
    let dead = false;
    (async () => {
      const saved = await loadSearch(projectId).catch(() => null);
      const m = saved && (saved.searchMode === 'manual' || saved.searchMode === 'automated') ? saved.searchMode : null;
      // The saved value is authoritative; a render-seed only survives when nothing is saved.
      if (!dead && (m != null || initialSearchMode == null)) setSearchMode(m);
    })();
    return () => { dead = true; };
  }, [projectId]); // eslint-disable-line
  const changeMode = useCallback(async (mode) => {
    setModeBusy(true); setModeErr('');
    setSearchMode(mode); // local state reflects immediately; persistence is soft-fail
    try {
      await persistSearchModeMerged(loadSearch, saveSearch, projectId, mode);
    } catch {
      setModeErr('Could not save the search mode — it will apply for this session, but try again to keep it for your team.');
    } finally {
      setModeBusy(false);
    }
  }, [projectId]);

  // ── 73.md P3 — hit-state snapshots + the registered "refresh now" trigger ──
  const [hitSnap, setHitSnap] = useState(null);
  const onHitState = useCallback((s) => { setHitSnap(s || null); }, []);
  const hitRefreshRef = useRef(null);
  const onRegisterHitRefresh = useCallback((fn) => { hitRefreshRef.current = fn; }, []);
  const retryHits = useCallback(() => { if (typeof hitRefreshRef.current === 'function') hitRefreshRef.current(); }, []);

  const onLiveQuery = useCallback((s) => {
    liveRef.current = s || liveRef.current;
    const hc = !!(s && Array.isArray(s.concepts) && s.concepts.length > 0);
    setHasConcepts((prev) => (prev === hc ? prev : hc));
  }, []);
  const getLive = useCallback(() => liveRef.current, []);

  const stages = useMemo(() => stagesFor(searchMode), [searchMode]);
  const activeIdx = stages.findIndex((s) => s.id === stage);
  const stageDisabled = useCallback((s) => !!(s.needsConcepts && !hasConcepts && s.id !== stage), [hasConcepts, stage]);

  // ── 73.md P1 — ONE deliberate scroll model: every stage change resets the nearest
  // scrollable ancestor (the Stitch shell's single scroller) so a stage never opens
  // mid-scroll; Results gets a second pass once PecanSearchTab's async content lands.
  const rootRef = useRef(null);
  const resetScroll = useCallback(() => {
    try {
      const sc = findScrollableAncestor(rootRef.current);
      if (sc) sc.scrollTop = 0;
      else if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    } catch { /* never block navigation on scroll */ }
  }, []);
  useEffect(() => {
    resetScroll();
    if (stage !== 'results') return undefined;
    const t = setTimeout(resetScroll, 80);
    return () => clearTimeout(t);
  }, [stage, resetScroll]);

  const goTo = useCallback((id) => {
    const target = stages.find((s) => s.id === id);
    if (!target || stageDisabled(target)) return;
    if (id === 'results') setRunQuery({ ...liveRef.current });
    if (id === 'refine') setPanelNonce((n) => n + 1);
    setStage(id);
  }, [stages, stageDisabled]);

  const statusFor = useCallback((s) => {
    const idx = stages.findIndex((x) => x.id === s.id);
    return {
      active: s.id === stage,
      done: idx < activeIdx,
      disabled: stageDisabled(s),
      reason: DISABLED_REASON,
    };
  }, [stages, stage, activeIdx, stageDisabled]);

  // The persistent Search Builder. Its phase follows the active builder stage; on non-
  // builder stages it stays in 'build' (like the wizard) so stepping around never churns
  // the phase or reloads the strategy. Memoized so snapshotting runQuery never remounts it.
  const builderPhase = stage === 'concepts' ? 'concepts' : stage === 'terms' ? 'terms' : 'build';
  const builderVisible = stage === 'concepts' || stage === 'terms' || stage === 'strategy';
  const builderEl = useMemo(() => (
    <SearchBuilderTab
      projectId={projectId}
      pico={pico}
      api={searchBuilderApi}
      loadSearch={loadSearch}
      saveSearch={saveSearch}
      phase={builderPhase}
      onLiveQuery={onLiveQuery}
      onHitState={onHitState}
      onRegisterHitRefresh={onRegisterHitRefresh}
    />
  ), [projectId, pico, builderPhase, onLiveQuery, onHitState, onRegisterHitRefresh]);

  const modeLabel = searchMode === 'automated' ? 'Automated search' : searchMode === 'manual' ? 'Manual search' : null;

  return (
    <div ref={rootRef} style={{ maxWidth: 1240, margin: '0 auto', fontFamily: FONT, color: C.txt }}>
      {/* ONE unified header */}
      <header style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
          <div aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, color: C.acc, background: alpha(C.acc, '16'), border: `1px solid ${alpha(C.acc, '28')}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="search" size={16} />
          </div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.txt, letterSpacing: -0.3 }}>Pecan Search Engine</h2>
          {/* 73.md P5 — compact mode badge; jumps to the Search Mode stage. */}
          {modeLabel && (
            <button type="button" onClick={() => goTo('mode')} data-testid="search-mode-badge"
              aria-label={`Search mode: ${modeLabel}. Change it in the Search Mode stage.`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: FONT,
                fontSize: 11, fontWeight: 600, color: C.acc, background: alpha(C.acc, '0e'),
                border: `1px solid ${alpha(C.acc, '44')}`, borderRadius: 99, padding: '3px 12px',
              }}>
              {modeLabel} <span style={{ color: C.muted, fontWeight: 500 }}>· Change</span>
            </button>
          )}
        </div>
        <p style={{ margin: 0, paddingLeft: 46, fontSize: 12.5, color: C.muted, lineHeight: 1.6, maxWidth: 820 }}>
          Build one concept-based strategy, test and refine it, then run it — yourself or automatically — and hand the de-duplicated
          results straight to screening. Work through the stages at your own pace — your strategy is saved as you go.
        </p>
      </header>

      {/* 73.md P3 — sticky PubMed pulse (visible on the build/refine/run stages). */}
      {PULSE_STAGES.has(stage) && (
        <PubMedPulse snapshot={hitSnap} hasConcepts={hasConcepts} onRetry={retryHits} />
      )}

      {/* Two-column shell: stage rail (left) + focused stage surface (right).
          73.md P1 — the rail never forces the row height: it aligns to the top and
          scrolls internally when the viewport is short. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 22, flexWrap: 'wrap' }}>
        <aside style={{ flex: '0 0 236px', minWidth: 210, maxWidth: 260, position: 'sticky', top: 12, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 90px)', overflowY: 'auto', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: '6px 8px' }}>
          <StageRail stages={stages} active={stage} onSelect={goTo} statusFor={statusFor} />
        </aside>

        <section style={{ flex: '1 1 560px', minWidth: 0 }} data-testid="search-workspace-stage" data-stage={stage}>
          {/* Persistent builder — mounted once, shown only on builder stages so concept /
              strategy edits survive stage switches (and its autosave completes). All
              siblings below keep FIXED conditional slots so builderEl never remounts. */}
          <div style={{ display: builderVisible ? 'block' : 'none' }}>
            {stage === 'strategy' && searchMode == null && !readOnly && (
              <ModeChooserStrip onChoose={changeMode} busy={modeBusy} goMode={() => goTo('mode')} />
            )}
            {stage === 'concepts' && (
              <StageIntro title="Concepts">
                Turn your question into the handful of core concepts your search is built from. Click the important ideas in your
                question — the compact summary below shows the concept structure; the next stage adds the term detail.
              </StageIntro>
            )}
            {stage === 'terms' && (
              <StageIntro title="Terms & vocabulary">
                Broaden each concept with synonyms and controlled vocabulary. MeSH suggestions are kept separate from free-text terms, so
                you can see exactly what is indexed versus searched as text.
              </StageIntro>
            )}
            {stage === 'strategy' && (
              <StageIntro title="Database strategies">
                Choose your databases and review the compiled, paste-ready strategy for each one — with warnings, vocabulary status and
                run guidance per database, and a live PubMed hit count. Override any database&apos;s query manually when you need to.
              </StageIntro>
            )}
            {/* 73.md P5 — automated mode: the provider translation summary rides FIRST;
                the compiled per-database strategies stay available beneath the divider. */}
            {stage === 'strategy' && searchMode === 'automated' && (
              <div data-testid="automated-strategy-summary">
                <Card title="Automated run — how your strategy is used" icon="globe"
                  desc="PecanRev translates the concept strategy for each connected database when the run starts — nothing to paste.">
                  <div style={{ fontSize: 12, color: C.txt2, lineHeight: 1.65, marginBottom: 12 }}>
                    Each connected database receives its own translated form of this strategy automatically, and every translation is
                    recorded with the run for reproducibility. The compiled strategies below are yours to review — and to run manually in
                    any database (Embase, Scopus, …) the automated run does not cover.
                  </div>
                  <button type="button" onClick={() => goTo('results')} style={primaryBtn()}>
                    Continue to Automated Search →
                  </button>
                </Card>
                <div aria-hidden="true" style={{ borderTop: `1px solid ${C.brd}`, margin: '4px 0 16px' }} />
              </div>
            )}
            {builderEl}
            {stage === 'strategy' && studioEnabled && (
              <div style={{ marginTop: 12 }}>
                <StrategyStudioPanel projectId={projectId} readOnly={readOnly} />
              </div>
            )}
          </div>

          {stage === 'question' && <QuestionStage pico={pico} />}

          {stage === 'mode' && (
            <>
              <StageIntro title="Search mode">
                Decide who executes the search. Both paths share the same question, concepts, terms and limits — and both end with
                de-duplicated records in Screening.
              </StageIntro>
              {readOnly
                ? (
                  <Card title="How do you want to run this search?" icon="settings" desc="Read-only access — the search mode is chosen by an editor.">
                    <Note tone="info">{modeLabel ? `This project uses ${modeLabel.toLowerCase()}.` : 'No search mode has been chosen yet.'}</Note>
                  </Card>
                )
                : <ModeStage searchMode={searchMode} onSelect={changeMode} busy={modeBusy} err={modeErr} pecanEnabled={pecanEnabled} />}
            </>
          )}

          {stage === 'refine' && (
            <>
              <StageIntro title="Test & refine">
                Sanity-check the strategy before you run it: preview how many records it returns per database, review a transparent quality
                breakdown, and compare or restore saved versions.
              </StageIntro>
              <PreviewEstimates projectId={projectId} getLive={getLive} pecanEnabled={pecanEnabled} />
              <div style={{ marginTop: 12 }}>
                <SearchQualityPanel key={`q-${panelNonce}`} projectId={projectId} getLive={getLive} />
                <SearchVersionsPanel key={`v-${panelNonce}`} projectId={projectId} readOnly={readOnly} onAfterRestore={bumpPanels} />
              </div>
            </>
          )}

          {stage === 'results' && (
            searchMode === 'automated' ? (
              pecanEnabled ? (
                <PecanSearchTab
                  projectId={projectId}
                  pico={pico}
                  readOnly={readOnly}
                  embedded
                  initialCanonicalQuery={runQuery ? { concepts: runQuery.concepts, filters: runQuery.filters } : undefined}
                  initialSources={runQuery ? runQuery.databases : undefined}
                  initialOverrides={runQuery ? runQuery.overrides : undefined}
                />
              ) : (
                <Card title="Run the search" icon="globe" desc="Running the strategy across every database needs the Pecan Search Engine — Automated Run.">
                  <Note tone="info">
                    Your strategy is saved. To execute it across PubMed, Europe PMC, ClinicalTrials.gov and the other open databases — and
                    auto-import the de-duplicated results into screening — an administrator must enable the
                    <strong> Pecan Search Engine — Automated Run</strong> in Ops. Until then, open <strong>Database Strategies</strong> to copy
                    each database&apos;s strategy and run it externally, then import from the Screening stage.
                  </Note>
                </Card>
              )
            ) : (
              <>
                {searchMode == null && !readOnly && (
                  <ModeChooserStrip onChoose={changeMode} busy={modeBusy} goMode={() => goTo('mode')} />
                )}
                <ManualRunStage
                  getLive={getLive}
                  readOnly={readOnly}
                  busy={modeBusy}
                  goStrategy={() => goTo('strategy')}
                  onSwitchAutomated={() => changeMode('automated')}
                />
              </>
            )
          )}

          {stage === 'documentation' && (
            <>
              <StageIntro title="Documentation">
                Produce the reproducible record of your search: a ready-to-paste methods paragraph and a PRISMA-S search-reporting export
                for your protocol or manuscript.{' '}
                {searchMode === 'automated'
                  ? 'Automated runs record every per-database translation and count for you.'
                  : 'For manually-run databases, note the run date and any interface-side limits alongside the exported strategy.'}
              </StageIntro>
              <SearchExportPanel projectId={projectId} getLive={getLive} pecanEnabled={pecanEnabled} readOnly={readOnly} strategyStudioEnabled={studioEnabled} />
              {studioEnabled && <RecallReportPanel projectId={projectId} readOnly={readOnly} pecanEnabled={pecanEnabled} />}
            </>
          )}

          {stage === 'screening' && <SendToScreeningStage projectId={projectId} pecanEnabled={pecanEnabled} readOnly={readOnly} searchMode={searchMode} />}

          {/* Footer nav — Back / Next through the stages (progressive, never lossy). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.brd}` }}>
            {activeIdx > 0
              ? <button type="button" onClick={() => goTo(stages[activeIdx - 1].id)} style={ghostBtn()}>← Back</button>
              : <span />}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: C.dim }}>Stage {activeIdx + 1} of {stages.length}</span>
            {activeIdx < stages.length - 1 && (() => {
              const next = stages[activeIdx + 1];
              const blocked = stageDisabled(next);
              return (
                <button type="button" onClick={() => goTo(next.id)} disabled={blocked}
                  title={blocked ? DISABLED_REASON : undefined}
                  style={{ ...primaryBtn(), opacity: blocked ? 0.5 : 1, cursor: blocked ? 'not-allowed' : 'pointer' }}>
                  Next: {next.label} →
                </button>
              );
            })()}
          </div>
        </section>
      </div>
    </div>
  );
}

function primaryBtn() {
  return { padding: '9px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: FONT, background: `linear-gradient(135deg,${C.acc},${C.acc2})`, color: C.accText };
}
function ghostBtn() {
  return { padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 11.5, fontWeight: 600, fontFamily: FONT, background: 'transparent', color: C.txt2, border: `1px solid ${C.brd2}` };
}
