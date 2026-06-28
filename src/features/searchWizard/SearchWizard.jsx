/**
 * SearchWizard.jsx — prompt60. ONE guided "Search" stage that unifies the two
 * former search tabs (Search Builder + Search & Discovery) into a linear 3-step
 * flow: Define → Build → Run.
 *
 * It is an ORCHESTRATOR, not a re-implementation: it embeds the proven feature
 * engines unchanged —
 *   • SearchBuilderTab (src/features/searchBuilder) renders Define (keywords +
 *     concepts + Limits) and Build (databases + per-database strategy + manual
 *     override) via its additive `phase` prop, reporting its live query up through
 *     `onLiveQuery`;
 *   • PecanSearchTab (src/features/pecanSearch) renders Run, PRE-FILLED from the
 *     live in-memory query (no separate "load strategy" round-trip).
 *
 * The single source of truth stays the `search` WorkflowModuleState module
 * (GET/PUT /api/search-builder/:pid) — the wizard owns no persisted state of its
 * own; the builder autosaves the strategy and the wizard just reads its live shape.
 *
 * Flag co-dependency (prompt60): Define + Build work whenever the Search Builder
 * Engine is on; the Run step needs Search & Discovery (`pecanSearch`, which itself
 * requires `searchEngine`). When it is off, Run shows a clear "enable in Ops" note
 * instead of mounting the engine (no silent 404).
 */
import { useState, useRef, useCallback, useMemo } from 'react';
import { C, FONT, alpha } from '../../frontend/theme/tokens.js';
import { Icon } from '../../frontend/components/icons.jsx';
import { SearchBuilderTab, searchBuilderApi, loadSearch, saveSearch } from '../searchBuilder/index.js';
import PecanSearchTab from '../pecanSearch/PecanSearchTab.jsx';
import { pecanSearchApi } from '../pecanSearch/pecanSearchApi.js';

const STEPS = [
  { id: 'define', n: 1, label: 'Define', hint: 'Pick your concepts, synonyms and limits' },
  { id: 'build', n: 2, label: 'Build', hint: 'Generate the per-database strategy (auto or manual)' },
  { id: 'run', n: 3, label: 'Run', hint: 'Search every database and send results to screening' },
];

/* The 3-step header. Stitch-native via the app's --t-* tokens. Steps are clickable
   (so the user can jump back); the active step is highlighted, completed steps get a
   check, and a short hint sits below. */
function WizardSteps({ step, onStep }) {
  const idx = STEPS.findIndex((s) => s.id === step);
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 6 }}>
        {STEPS.map((s, i) => {
          const active = s.id === step;
          const done = i < idx;
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', flex: '1 1 0', minWidth: 0 }}>
              <button
                type="button"
                onClick={() => onStep(s.id)}
                aria-current={active ? 'step' : undefined}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9, cursor: 'pointer',
                  fontFamily: FONT, textAlign: 'left', minWidth: 0,
                  border: active ? `1px solid ${alpha(C.acc, '66')}` : '1px solid transparent',
                  background: active ? alpha(C.acc, '14') : 'transparent',
                }}
              >
                <span style={{
                  width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700,
                  background: active ? C.acc : done ? alpha(C.grn, '22') : C.card2,
                  color: active ? C.accText : done ? C.grn : C.muted,
                  border: done ? `1px solid ${alpha(C.grn, '55')}` : 'none',
                }}>{done ? '✓' : s.n}</span>
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: active ? C.txt : C.txt2 }}>{s.label}</span>
                  <span style={{ fontSize: 10.5, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.hint}</span>
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <span aria-hidden="true" style={{ width: 18, height: 2, background: i < idx ? alpha(C.grn, '66') : C.brd, flexShrink: 0 }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* prompt60 Step 2 — on-demand per-source estimated counts for the Build step. Honest
   and best-effort: it asks the Pecan engine to translate + count the LIVE strategy for
   the databases the user selected that actually have a connector; databases without one
   simply don't appear (they remain "copy & run externally" rows in the Run step).
   Graceful "—" / a quiet note when Search & Discovery is off. */
function BuildEstimates({ projectId, getLive, pecanEnabled }) {
  const [state, setState] = useState('idle'); // idle | loading | ready | error
  const [counts, setCounts] = useState({});
  const [err, setErr] = useState('');

  const estimate = useCallback(async () => {
    const live = getLive() || {};
    const concepts = Array.isArray(live.concepts) ? live.concepts : [];
    const databases = Array.isArray(live.databases) ? live.databases : [];
    if (!concepts.length || !databases.length) { setErr('Add concepts and choose databases first.'); setState('error'); return; }
    setState('loading'); setErr('');
    try {
      const canonicalQuery = { concepts, filters: live.filters || {} };
      const sources = databases.map((id) => ({ provider: id }));
      const out = await pecanSearchApi.previewCount(projectId, { canonicalQuery, sources, overrides: live.overrides || {} });
      setCounts((out && out.counts) || {});
      setState('ready');
    } catch (e) {
      setErr((e && e.message) || 'Could not estimate counts.'); setState('error');
    }
  }, [projectId, getLive]);

  if (!pecanEnabled) {
    return (
      <div style={{ marginTop: 12, fontSize: 11.5, color: C.muted, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 12px' }}>
        Live result estimates and the actual multi-database run need <strong style={{ color: C.txt2 }}>Search &amp; Discovery</strong> (enable it in Ops). You can still build and copy the strategy.
      </div>
    );
  }
  const ids = Object.keys(counts);
  const fmt = (c) => {
    if (!c || c.count == null) return '—';
    if (c.kind === 'unsupported' || c.kind === 'unavailable') return '—';
    return Number(c.count).toLocaleString() + (c.kind === 'estimate' ? '*' : '');
  };
  return (
    <div style={{ marginTop: 12, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: ids.length ? 10 : 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>Estimated results per database</span>
        <button type="button" onClick={estimate} disabled={state === 'loading'}
          style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.brd2}`, background: 'transparent', color: C.txt2, fontSize: 11, fontWeight: 600, cursor: state === 'loading' ? 'default' : 'pointer', fontFamily: FONT }}>
          {state === 'loading' ? 'Estimating…' : ids.length ? 'Refresh estimates' : 'Estimate results'}
        </button>
      </div>
      {state === 'error' && <div style={{ fontSize: 11.5, color: C.yel }}>{err}</div>}
      {ids.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ids.map((id) => (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8, padding: '5px 10px', fontSize: 11.5 }}>
              <span style={{ color: C.txt2, fontWeight: 600 }}>{id}</span>
              <span style={{ color: C.acc, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace' }}>{fmt(counts[id])}</span>
            </span>
          ))}
          <span style={{ alignSelf: 'center', fontSize: 10, color: C.dim }}>* estimated</span>
        </div>
      )}
    </div>
  );
}

export default function SearchWizard({ projectId, pico, readOnly, pecanEnabled }) {
  const [step, setStep] = useState('define');
  // The live in-memory query reported by the embedded builder. Held in a ref so
  // continuous edits never re-render the wizard (which would thrash the heavy
  // builder); snapshotted into state only when we enter the Run step.
  const liveRef = useRef({ concepts: [], filters: { dateFrom: '', dateTo: '', languages: [], pubTypes: [] }, overrides: {}, databases: [] });
  const [runQuery, setRunQuery] = useState(null);
  const onLiveQuery = useCallback((s) => { liveRef.current = s || liveRef.current; }, []);
  const getLive = useCallback(() => liveRef.current, []);

  const goTo = useCallback((id) => {
    if (id === 'run') setRunQuery({ ...liveRef.current });
    setStep(id);
  }, []);

  // Memoize the builder element so that snapshotting runQuery (state) on entering Run
  // never re-renders/​remounts the builder. It re-renders only when projectId, pico, or
  // the phase actually change — preserving the user's in-progress edits. Run keeps the
  // 'build' phase (the builder is merely hidden during Run), so stepping Build→Run→Build
  // never churns the phase or reloads the strategy.
  const builderPhase = step === 'define' ? 'define' : 'build';
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

  const hasConcepts = (liveRef.current.concepts || []).length > 0;

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', fontFamily: FONT, color: C.txt }}>
      {/* Header */}
      <header style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, color: C.acc, background: alpha(C.acc, '16'), border: `1px solid ${alpha(C.acc, '28')}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="search" size={16} />
          </div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.txt, letterSpacing: -0.3 }}>Search</h2>
        </div>
        <p style={{ margin: 0, paddingLeft: 46, fontSize: 12.5, color: C.muted, lineHeight: 1.6, maxWidth: 760 }}>
          Build one concept-based strategy, then run it across every database and send the de-duplicated results straight to screening — Define, Build, Run.
        </p>
      </header>

      <WizardSteps step={step} onStep={goTo} />

      {/* Body — the builder stays MOUNTED (hidden) during Run so its debounced autosave
          completes and the in-progress strategy is preserved when the user steps back. */}
      <div style={{ display: step === 'run' ? 'none' : 'block' }}>
        {builderEl}
        {step === 'build' && <BuildEstimates projectId={projectId} getLive={getLive} pecanEnabled={pecanEnabled} />}
      </div>

      {step === 'run' && (
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
          <div style={{ maxWidth: 760, margin: '8px auto', padding: '40px 24px', textAlign: 'center' }}>
            <div aria-hidden="true" style={{ fontSize: 30, marginBottom: 10, color: C.muted }}>🌐</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 8 }}>Running the search needs Search &amp; Discovery</div>
            <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '16px 18px', fontSize: 13, lineHeight: 1.7, color: C.txt2 }}>
              Steps 1–2 are ready and your strategy is saved. To execute it across PubMed, Europe PMC, ClinicalTrials.gov and the other open databases — and auto-import the de-duplicated results into screening — an administrator must enable the <strong style={{ color: C.txt }}>Pecan Search Engine</strong> in the Ops console. Until then, open <strong style={{ color: C.txt }}>Build</strong> to copy each database&apos;s strategy and run it externally, then import the results from the Screening stage.
            </div>
          </div>
        )
      )}

      {/* Footer nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.brd}` }}>
        {step !== 'define'
          ? <button type="button" onClick={() => goTo(step === 'run' ? 'build' : 'define')} style={ghostBtn()}>← Back</button>
          : <span />}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: C.dim }}>Step {STEPS.findIndex((s) => s.id === step) + 1} of {STEPS.length}</span>
        {step === 'define' && (
          <button type="button" onClick={() => goTo('build')} style={primaryBtn()}>Next: Build →</button>
        )}
        {step === 'build' && (
          <button type="button" onClick={() => goTo('run')} disabled={!hasConcepts} style={{ ...primaryBtn(), opacity: hasConcepts ? 1 : 0.5, cursor: hasConcepts ? 'pointer' : 'not-allowed' }}>
            Run &amp; send to screening →
          </button>
        )}
      </div>
    </div>
  );
}

function primaryBtn() {
  return { padding: '9px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: FONT, background: `linear-gradient(135deg,${C.acc},${C.acc2})`, color: C.accText };
}
function ghostBtn() {
  return { padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: FONT, background: 'transparent', color: C.muted, border: `1px solid ${C.brd2}` };
}
