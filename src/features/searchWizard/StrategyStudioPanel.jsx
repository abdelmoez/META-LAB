/**
 * StrategyStudioPanel.jsx — P11. The guided Boolean strategy generator↔critic workspace,
 * mounted in the wizard's Build step (gated on searchStrategyStudio && searchEngine &&
 * pecanSearch). Two actions over the saved strategy:
 *
 *  1. "Generate strategies" — per-database candidate cards. Each card reads as concept
 *     BLOCKS (Population / Intervention / Comparator / Outcome), with controlled
 *     vocabulary (MeSH) separated from free-text, field tags explained subtly, a short
 *     per-block explanation, and any warnings surfaced calmly. The raw Boolean string is
 *     tucked into a <details> expander (progressive disclosure).
 *
 *  2. "Optimize" — runs the iteration-bounded generator↔critic loop (synchronous, ~25s)
 *     and renders an iteration timeline: version → hit count → critic notes (on demand)
 *     → what changed, before/after.
 *
 * SSR-safe: the only auto-load is a soft `iterations()` history read in an effect (skipped
 * under renderToStaticMarkup); everything else is click-driven. The pure leaves
 * (StrategyCard, IterationTimeline) are exported and unit-tested from props.
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../../frontend/theme/tokens.js';
import { strategyStudioApi } from './strategyStudioApi.js';

const PICO_LABEL = { P: 'Population', I: 'Intervention', C: 'Comparator', O: 'Outcome', S: 'Study design' };
const PROFILE = {
  broad:    { label: 'Broad', hint: 'higher recall', color: C.teal },
  balanced: { label: 'Balanced', hint: 'recall ↔ precision', color: C.acc },
  precise:  { label: 'Precise', hint: 'higher precision', color: C.purp },
};

function labelFor(picoField, concept) {
  if (concept && String(concept).trim()) return String(concept);
  return PICO_LABEL[picoField] || 'Concept';
}

function fmtHits(count, kind) {
  if (count == null) return '—';
  const n = Number(count).toLocaleString();
  if (kind === 'estimate' || kind === 'estimated') return `≈ ${n}`;
  return n;
}

/** Pure leaf: one concept block inside a strategy card. */
function StrategyBlock({ block }) {
  const b = block || {};
  const mesh = Array.isArray(b.mesh) ? b.mesh : [];
  const freeText = Array.isArray(b.freeText) && b.freeText.length ? b.freeText
    : (Array.isArray(b.terms) ? b.terms.map((t) => (t && t.text) || t).filter(Boolean) : []);
  const fieldTags = Array.isArray(b.fieldTags) ? b.fieldTags : [];
  return (
    <div style={{ padding: '9px 11px', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.txt }}>{labelFor(b.picoField, b.concept)}</span>
        {b.picoField && (
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: C.acc, background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '33')}`, borderRadius: 5, padding: '1px 6px' }}>
            {PICO_LABEL[b.picoField] || b.picoField}
          </span>
        )}
      </div>
      {mesh.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.3, minWidth: 108 }}>Controlled vocab (MeSH)</span>
          <span style={{ fontSize: 11.5, color: C.txt2, fontFamily: MONO }}>{mesh.join(' · ')}</span>
        </div>
      )}
      {freeText.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.3, minWidth: 108 }}>Free-text terms</span>
          <span style={{ fontSize: 11.5, color: C.txt2 }}>{freeText.join(' OR ')}</span>
        </div>
      )}
      {fieldTags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }} title="Field tags restrict where each term is searched (e.g. title/abstract).">
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.3, minWidth: 108 }}>Searched in</span>
          {fieldTags.map((t, i) => (
            <span key={i} style={{ fontSize: 10.5, color: C.txt2, background: C.card2, border: `1px solid ${C.brd2}`, borderRadius: 5, padding: '1px 6px', fontFamily: MONO }}>{t}</span>
          ))}
        </div>
      )}
      {b.explanation && (
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, marginTop: 2 }}>{b.explanation}</div>
      )}
    </div>
  );
}

/** Pure leaf: one generated candidate strategy card (readable blocks + warnings). Exported for tests. */
export function StrategyCard({ strategy }) {
  const s = strategy || {};
  const blocks = Array.isArray(s.blocks) ? s.blocks : [];
  const warnings = Array.isArray(s.warnings) ? s.warnings : [];
  const prof = PROFILE[s.profile] || null;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 11, padding: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.txt }}>{s.database || 'Database'}</span>
        {prof && (
          <span style={{ fontSize: 10, fontWeight: 700, color: prof.color, background: alpha(prof.color, '16'), border: `1px solid ${alpha(prof.color, '44')}`, borderRadius: 6, padding: '2px 8px' }}>
            {prof.label} · {prof.hint}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {blocks.length
          ? blocks.map((b, i) => <StrategyBlock key={i} block={b} />)
          : <div style={{ fontSize: 11.5, color: C.muted }}>No concept blocks in this candidate.</div>}
      </div>

      {warnings.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5, color: C.txt2, background: alpha(C.yel, '12'), border: `1px solid ${alpha(C.yel, '3a')}`, borderRadius: 8, padding: '6px 9px' }}>
              <span aria-hidden="true" style={{ color: C.yel, fontWeight: 800, flexShrink: 0 }}>!</span>
              <span style={{ lineHeight: 1.5 }}>{w.message}{w.term ? <> <span style={{ fontFamily: MONO, color: C.txt }}>“{w.term}”</span></> : null}</span>
            </div>
          ))}
        </div>
      )}

      {s.searchString && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 600, color: C.acc, listStyle: 'none' }}>Show Boolean query</summary>
          <pre style={{ margin: '8px 0 0', padding: 10, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8, fontSize: 11, lineHeight: 1.6, color: C.txt2, fontFamily: MONO, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto' }}>{s.searchString}</pre>
        </details>
      )}
    </div>
  );
}

const SEV = {
  critical: { color: C.red },
  warning:  { color: C.yel },
  info:     { color: C.acc },
};

/** Pure leaf: the generator↔critic iteration timeline. Exported for tests. */
export function IterationTimeline({ iterations }) {
  const list = Array.isArray(iterations) ? iterations : [];
  if (!list.length) {
    return <div style={{ fontSize: 11.5, color: C.muted }}>Run Optimize to see the strategy refined step by step.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {list.map((it, idx) => {
        const critic = it.critic || {};
        const issues = Array.isArray(critic.issues) ? critic.issues : [];
        return (
          <div key={idx} style={{ position: 'relative', paddingLeft: 16 }}>
            <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 5, width: 8, height: 8, borderRadius: '50%', background: C.acc, border: `2px solid ${alpha(C.acc, '33')}` }} />
            {idx < list.length - 1 && <span aria-hidden="true" style={{ position: 'absolute', left: 3.5, top: 15, bottom: -10, width: 1, background: C.brd }} />}
            <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: issues.length || it.changes ? 8 : 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.acc, fontFamily: MONO }}>Iteration {it.iteration != null ? it.iteration : idx + 1}</span>
                {it.database && <span style={{ fontSize: 11, color: C.muted }}>{it.database}</span>}
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 10, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 11, color: C.txt2 }}>hits <strong style={{ color: C.txt, fontFamily: MONO }}>{fmtHits(it.hitCount, it.hitKind)}</strong></span>
                  {critic.score != null && (
                    <span style={{ fontSize: 11, color: C.txt2 }}>score <strong style={{ color: C.txt, fontFamily: MONO }}>{critic.score}</strong></span>
                  )}
                </span>
              </div>

              {it.changes && (
                <div style={{ fontSize: 11.5, color: C.txt2, lineHeight: 1.5, marginBottom: issues.length ? 8 : 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.3, textTransform: 'uppercase', marginRight: 6 }}>Changed</span>
                  {typeof it.changes === 'string' ? it.changes : (Array.isArray(it.changes) ? it.changes.join('; ') : '')}
                </div>
              )}

              {issues.length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 600, color: C.acc, listStyle: 'none' }}>
                    Critic notes ({issues.length})
                  </summary>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 7 }}>
                    {issues.map((is, i) => {
                      const sv = SEV[is.severity] || SEV.info;
                      return (
                        <div key={i} style={{ fontSize: 11.5, color: C.txt2, lineHeight: 1.5, paddingLeft: 10, borderLeft: `2px solid ${alpha(sv.color, '66')}` }}>
                          <span style={{ fontWeight: 700, color: sv.color, textTransform: 'capitalize', marginRight: 5 }}>{is.severity || 'note'}:</span>
                          {is.message}
                          {is.suggestion && <span style={{ display: 'block', color: sv.color }}>→ {is.suggestion}</span>}
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}

              {it.searchString && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 600, color: C.muted, listStyle: 'none' }}>Show query at this step</summary>
                  <pre style={{ margin: '7px 0 0', padding: 9, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8, fontSize: 10.5, lineHeight: 1.55, color: C.txt2, fontFamily: MONO, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto' }}>{it.searchString}</pre>
                </details>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function StrategyStudioPanel({ projectId, readOnly }) {
  const [genState, setGenState] = useState('idle'); // idle | loading | ready | error
  const [genErr, setGenErr] = useState('');
  const [strategies, setStrategies] = useState([]);
  const [notes, setNotes] = useState([]);

  const [optState, setOptState] = useState('idle'); // idle | loading | ready | error
  const [optErr, setOptErr] = useState('');
  const [iterations, setIterations] = useState([]);
  const [finalStrategy, setFinalStrategy] = useState(null);

  // Soft: surface any stored iteration history for a returning user (effect never runs under SSR).
  useEffect(() => {
    let dead = false;
    (async () => {
      const out = await strategyStudioApi.iterations(projectId);
      if (!dead && out.available && out.iterations.length) setIterations(out.iterations);
    })();
    return () => { dead = true; };
  }, [projectId]);

  const generate = useCallback(async () => {
    setGenState('loading'); setGenErr('');
    try {
      const out = await strategyStudioApi.generate(projectId, {});
      setStrategies(out.strategies); setNotes(out.notes); setGenState('ready');
    } catch (e) {
      setGenErr((e && e.message) || 'Could not generate strategies.'); setGenState('error');
    }
  }, [projectId]);

  const optimize = useCallback(async () => {
    setOptState('loading'); setOptErr('');
    try {
      const out = await strategyStudioApi.optimize(projectId, {});
      setIterations(out.iterations); setFinalStrategy(out.finalStrategy); setOptState('ready');
    } catch (e) {
      setOptErr((e && e.message) || 'Could not optimize the strategy.'); setOptState('error');
    }
  }, [projectId]);

  return (
    <div style={{ marginTop: 12, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, marginBottom: 4 }}>Strategy Studio</div>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
        Generate guided Boolean strategies per database, then refine them with the search critic. Suggestions build on your saved concepts — you stay in control.
      </div>

      {/* Generate */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {!readOnly && (
          <button type="button" onClick={generate} disabled={genState === 'loading'} style={primary()}>
            {genState === 'loading' ? 'Generating…' : strategies.length ? 'Regenerate strategies' : 'Generate strategies'}
          </button>
        )}
        {genState === 'error' && <span style={{ fontSize: 11.5, color: C.red }}>{genErr}</span>}
      </div>

      {notes.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: C.txt2, lineHeight: 1.6 }}>
          {notes.map((n, i) => <div key={i}>• {typeof n === 'string' ? n : (n && n.message) || ''}</div>)}
        </div>
      )}

      {genState === 'loading' && !strategies.length && (
        <div style={{ marginTop: 12, fontSize: 12, color: C.muted }}>Building candidate strategies for each database…</div>
      )}
      {genState !== 'loading' && !strategies.length && genState !== 'error' && (
        <div style={{ marginTop: 12, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
          No generated strategies yet. Generate candidate Boolean strategies — each shown as readable concept blocks with controlled vocabulary and free-text separated.
        </div>
      )}
      {strategies.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {strategies.map((s, i) => <StrategyCard key={i} strategy={s} />)}
        </div>
      )}

      {/* Optimize */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.brd}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.txt }}>Search Optimizer</span>
          {!readOnly && (
            <button type="button" onClick={optimize} disabled={optState === 'loading'} style={{ ...btn(), marginLeft: 'auto' }}>
              {optState === 'loading' ? 'Refining…' : 'Optimize strategy'}
            </button>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>
          The critic reviews each draft against your seed studies and coverage, then revises — repeating a few times. This runs live and can take up to ~25 seconds.
        </div>
        {optState === 'loading' && (
          <div style={{ fontSize: 12, color: C.txt2, marginBottom: 10 }}>
            Refining the strategy step by step… this can take a few seconds.
          </div>
        )}
        {optState === 'error' && <div style={{ fontSize: 11.5, color: C.red, marginBottom: 10 }}>{optErr}</div>}
        <IterationTimeline iterations={iterations} />
        {finalStrategy && (finalStrategy.searchString || finalStrategy.database) && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 700, color: C.grn, listStyle: 'none' }}>Final refined strategy</summary>
            <div style={{ marginTop: 8 }}><StrategyCard strategy={finalStrategy} /></div>
          </details>
        )}
      </div>
    </div>
  );
}

function primary() {
  return { padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: FONT, background: `linear-gradient(135deg,${C.acc},${C.acc2})`, color: C.accText };
}
function btn() {
  return { padding: '7px 13px', borderRadius: 8, border: `1px solid ${C.brd2}`, background: 'transparent', color: C.txt2, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
}
