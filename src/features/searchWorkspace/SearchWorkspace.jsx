/**
 * SearchWorkspace.jsx — 71.md. A calmer, guided, progressive-disclosure STAGED
 * workspace for the Search stage. It is a COMPOSITION/arrangement redesign of the
 * existing 3-step SearchWizard: it keeps ALL functional power by REUSING the proven
 * engine components unchanged — it never re-implements search.
 *
 * Shape: a LEFT vertical stage rail (modeled on StitchWorkflowStepper — numbered pips
 * that always show the number, status by icon+colour not colour-only, disabled-with-
 * reason, aria-current, keyboard) with 8 stages, and a RIGHT pane that renders the
 * current stage by composing existing components:
 *
 *   1. Research Question  — PICO/question summary (from the `pico` prop) + helper.
 *   2. Concepts           — <SearchBuilderTab phase="define"/> (keyword + concept steps).
 *   3. Terms & Vocabulary — the same builder define phase (MeSH kept separate from
 *                           free-text, exactly as the builder already does).
 *   4. Strategy Builder   — <SearchBuilderTab phase="build"/> (databases + per-DB Boolean
 *                           + manual override + live PubMed hit count) + (studio)
 *                           <StrategyStudioPanel/>.
 *   5. Test & Refine      — multi-DB preview counts (pecanSearchApi.previewCount) +
 *                           <SearchQualityPanel/> + <SearchVersionsPanel/> (compare/
 *                           restore/mark-final).
 *   6. Results            — <PecanSearchTab/> (run + live monitor + cancel/retry +
 *                           completion + duplicate review + history + per-run exports).
 *   7. Documentation      — <SearchExportPanel/> (methods text + PRISMA-S) + (studio)
 *                           <RecallReportPanel/> (seed studies + recall).
 *   8. Send to Screening  — the readyForScreening marker + a first-class "Go to
 *                           Screening" handoff (the post-run ?tab=screening&screen=import
 *                           deep link), explaining exactly what is sent.
 *
 * State preservation: the heavy Search Builder is mounted ONCE and kept mounted across
 * every stage (hidden when the active stage isn't a builder stage), so concepts /
 * strategy edits survive stage switches — and it autosaves to the `search`
 * WorkflowModuleState regardless. The single source of truth stays that module; this
 * workspace owns no persisted state of its own.
 *
 * Gated behind the `searchWorkspaceV2` flag (OFF by default) at the dispatcher; when
 * OFF the legacy SearchWizard renders unchanged. Reuses the existing components + their
 * existing API calls — no engine forks.
 */
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { C, FONT, alpha } from '../../frontend/theme/tokens.js';
import { Icon } from '../../frontend/components/icons.jsx';
import { SearchBuilderTab, searchBuilderApi, loadSearch, saveSearch } from '../searchBuilder/index.js';
import PecanSearchTab from '../pecanSearch/PecanSearchTab.jsx';
import { pecanSearchApi } from '../pecanSearch/pecanSearchApi.js';
import {
  SearchQualityPanel, SearchVersionsPanel, SearchExportPanel,
  StrategyStudioPanel, RecallReportPanel, strategyStudioFlagEnabled,
} from '../searchWizard/index.js';
import { Card, Note } from '../pecanSearch/components/parts.jsx';

/* The 8 guided stages. `num` drives the always-numbered pip; `builder`/`phase` mark the
   stages that render the (persistent) Search Builder; `needsConcepts` marks stages that
   are only meaningful once a strategy exists (disabled-with-reason until then). */
const STAGES = [
  { id: 'question',      num: 1, label: 'Research Question',  desc: 'Frame the question' },
  { id: 'concepts',      num: 2, label: 'Concepts',           desc: 'Core concepts',        builder: true, phase: 'define' },
  { id: 'terms',         num: 3, label: 'Terms & Vocabulary', desc: 'Synonyms & MeSH',      builder: true, phase: 'define' },
  { id: 'strategy',      num: 4, label: 'Strategy Builder',   desc: 'Databases & Boolean',  builder: true, phase: 'build' },
  { id: 'refine',        num: 5, label: 'Test & Refine',      desc: 'Counts & quality' },
  { id: 'results',       num: 6, label: 'Results',            desc: 'Run & deduplicate',    needsConcepts: true },
  { id: 'documentation', num: 7, label: 'Documentation',      desc: 'Methods & PRISMA-S' },
  { id: 'screening',     num: 8, label: 'Send to Screening',  desc: 'Prepare the import',   needsConcepts: true },
];

const DISABLED_REASON = 'Build a strategy with at least one concept first';

/* ════════════ LEFT RAIL ════════════
   Vertical numbered stepper (modeled on StitchWorkflowStepper): the pip ALWAYS shows the
   number; status is a SECONDARY treatment (colour + a right-side icon, never colour
   alone). Continuous connector via two absolutely-positioned segments around a fixed pip
   centre. Disabled stages announce their reason in the aria-label + title. */
const RAIL_PIP = 26;
const RAIL_PAD_TOP = 11;
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

/* ════════════ SEND TO SCREENING — first-class handoff ════════════
   Surfaces the advisory `readyForScreening` marker (read + toggle via the SAME
   search-builder module the builder persists) and the "Go to Screening" handoff. */
function SendToScreeningStage({ projectId, pecanEnabled, readOnly }) {
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

  return (
    <>
      <Card title="Send to screening" icon="arrowRight" desc="Hand the de-duplicated search results to this project's screening workspace, with a reproducible record of exactly what ran.">
        <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.7, marginBottom: 14 }}>
          When you run the strategy in <strong style={{ color: C.txt }}>Results</strong>, every database is searched, the records are
          de-duplicated, and the new ones are imported into <strong style={{ color: C.txt }}>Screening</strong> tagged with the
          <strong style={{ color: C.txt }}> Pecan Search</strong> badge. Records already in the project are matched (not re-added), and
          ambiguous matches go to duplicate review before you begin title/abstract screening. The saved strategy version is the record of
          what was searched.
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

      {!pecanEnabled && (
        <Note tone="info">
          The automated multi-database run needs the <strong>Pecan Search Engine — Automated Run</strong> (enable it in Ops). Until then,
          open <strong>Strategy Builder</strong> to copy each database&apos;s strategy, run it externally, and import the results from the
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

export default function SearchWorkspace({ projectId, pico, readOnly, pecanEnabled, initialStage }) {
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

  const onLiveQuery = useCallback((s) => {
    liveRef.current = s || liveRef.current;
    const hc = !!(s && Array.isArray(s.concepts) && s.concepts.length > 0);
    setHasConcepts((prev) => (prev === hc ? prev : hc));
  }, []);
  const getLive = useCallback(() => liveRef.current, []);

  const activeIdx = STAGES.findIndex((s) => s.id === stage);
  const stageDisabled = useCallback((s) => !!(s.needsConcepts && !hasConcepts && s.id !== stage), [hasConcepts, stage]);

  const goTo = useCallback((id) => {
    const target = STAGES.find((s) => s.id === id);
    if (!target || stageDisabled(target)) return;
    if (id === 'results') setRunQuery({ ...liveRef.current });
    if (id === 'refine') setPanelNonce((n) => n + 1);
    setStage(id);
  }, [stageDisabled]);

  const statusFor = useCallback((s) => {
    const idx = STAGES.findIndex((x) => x.id === s.id);
    return {
      active: s.id === stage,
      done: idx < activeIdx,
      disabled: stageDisabled(s),
      reason: DISABLED_REASON,
    };
  }, [stage, activeIdx, stageDisabled]);

  // The persistent Search Builder. Its phase follows the active builder stage; on non-
  // builder stages it stays in 'build' (like the wizard) so stepping around never churns
  // the phase or reloads the strategy. Memoized so snapshotting runQuery never remounts it.
  const builderPhase = (stage === 'concepts' || stage === 'terms') ? 'define' : 'build';
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
    />
  ), [projectId, pico, builderPhase, onLiveQuery]);

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', fontFamily: FONT, color: C.txt }}>
      {/* ONE unified header */}
      <header style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, color: C.acc, background: alpha(C.acc, '16'), border: `1px solid ${alpha(C.acc, '28')}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="search" size={16} />
          </div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.txt, letterSpacing: -0.3 }}>Pecan Search Engine</h2>
        </div>
        <p style={{ margin: 0, paddingLeft: 46, fontSize: 12.5, color: C.muted, lineHeight: 1.6, maxWidth: 820 }}>
          Build one concept-based strategy, test and refine it, then run it across every database and hand the de-duplicated results
          straight to screening. Work through the stages at your own pace — your strategy is saved as you go.
        </p>
      </header>

      {/* Two-column shell: stage rail (left) + focused stage surface (right) */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 22, flexWrap: 'wrap' }}>
        <aside style={{ flex: '0 0 236px', minWidth: 210, maxWidth: 260, position: 'sticky', top: 12, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: '8px 8px' }}>
          <StageRail stages={STAGES} active={stage} onSelect={goTo} statusFor={statusFor} />
        </aside>

        <section style={{ flex: '1 1 560px', minWidth: 0 }} data-testid="search-workspace-stage" data-stage={stage}>
          {/* Persistent builder — mounted once, shown only on builder stages so concept /
              strategy edits survive stage switches (and its autosave completes). */}
          <div style={{ display: builderVisible ? 'block' : 'none' }}>
            {stage === 'concepts' && (
              <StageIntro title="Concepts">
                Turn your question into the handful of core concepts your search is built from. Add each concept and its terms — the
                builder&apos;s steps 1–2 (Select Keywords → Organize Concepts) guide you.
              </StageIntro>
            )}
            {stage === 'terms' && (
              <StageIntro title="Terms & vocabulary">
                Broaden each concept with synonyms and controlled vocabulary. MeSH suggestions are kept separate from free-text terms, so
                you can see exactly what is indexed versus searched as text.
              </StageIntro>
            )}
            {stage === 'strategy' && (
              <StageIntro title="Strategy builder">
                Choose your databases and review the Boolean strategy generated for each — with a live PubMed hit count. Override any
                database&apos;s query manually when you need to.
              </StageIntro>
            )}
            {builderEl}
            {stage === 'strategy' && studioEnabled && (
              <div style={{ marginTop: 12 }}>
                <StrategyStudioPanel projectId={projectId} readOnly={readOnly} />
              </div>
            )}
          </div>

          {stage === 'question' && <QuestionStage pico={pico} />}

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
            pecanEnabled ? (
              <PecanSearchTab
                projectId={projectId}
                pico={pico}
                readOnly={readOnly}
                initialCanonicalQuery={runQuery ? { concepts: runQuery.concepts, filters: runQuery.filters } : undefined}
                initialSources={runQuery ? runQuery.databases : undefined}
                initialOverrides={runQuery ? runQuery.overrides : undefined}
              />
            ) : (
              <Card title="Run the search" icon="globe" desc="Running the strategy across every database needs the Pecan Search Engine — Automated Run.">
                <Note tone="info">
                  Your strategy is saved. To execute it across PubMed, Europe PMC, ClinicalTrials.gov and the other open databases — and
                  auto-import the de-duplicated results into screening — an administrator must enable the
                  <strong> Pecan Search Engine — Automated Run</strong> in Ops. Until then, open <strong>Strategy Builder</strong> to copy
                  each database&apos;s strategy and run it externally, then import from the Screening stage.
                </Note>
              </Card>
            )
          )}

          {stage === 'documentation' && (
            <>
              <StageIntro title="Documentation">
                Produce the reproducible record of your search: a ready-to-paste methods paragraph and a PRISMA-S search-reporting export
                for your protocol or manuscript.
              </StageIntro>
              <SearchExportPanel projectId={projectId} getLive={getLive} pecanEnabled={pecanEnabled} readOnly={readOnly} strategyStudioEnabled={studioEnabled} />
              {studioEnabled && <RecallReportPanel projectId={projectId} readOnly={readOnly} pecanEnabled={pecanEnabled} />}
            </>
          )}

          {stage === 'screening' && <SendToScreeningStage projectId={projectId} pecanEnabled={pecanEnabled} readOnly={readOnly} />}

          {/* Footer nav — Back / Next through the stages (progressive, never lossy). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.brd}` }}>
            {activeIdx > 0
              ? <button type="button" onClick={() => goTo(STAGES[activeIdx - 1].id)} style={ghostBtn()}>← Back</button>
              : <span />}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: C.dim }}>Stage {activeIdx + 1} of {STAGES.length}</span>
            {activeIdx < STAGES.length - 1 && (() => {
              const next = STAGES[activeIdx + 1];
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
