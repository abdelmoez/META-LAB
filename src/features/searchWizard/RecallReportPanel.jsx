/**
 * RecallReportPanel.jsx — P11. Seed-study coverage + recall estimate, mounted in the
 * wizard's Run step (gated on searchStrategyStudio && searchEngine && pecanSearch).
 *
 * Two calm, summary-first sections:
 *  1. Seed studies — a small "known relevant" set the search should catch. Add by title /
 *     DOI / PMID, list, remove.
 *  2. Recall estimate — checks the current search (live "probe", or the latest run) against
 *     the seeds and reports found / not-found / estimated recall, with a per-missing-study
 *     analysis and suggested improvements tucked behind expanders.
 *
 * SSR-safe: the seed list loads in an effect (skipped under renderToStaticMarkup) and
 * everything else is click-driven. The pure leaves (SeedList, RecallSummary) are exported
 * and unit-tested from props.
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../../frontend/theme/tokens.js';
import { strategyStudioApi } from './strategyStudioApi.js';

/** Pure leaf: the seed-study list with per-row remove. Exported for tests. */
export function SeedList({ seeds, readOnly, onRemove, busyId }) {
  const list = Array.isArray(seeds) ? seeds : [];
  if (!list.length) {
    return <div style={{ fontSize: 11.5, color: C.muted, padding: '6px 2px' }}>No seed studies yet. Add a few known-relevant papers so we can estimate how much of them your search catches.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {list.map((s) => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8 }}>
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', flex: 1 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.doi || s.pmid || 'Untitled study'}</span>
            <span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}>
              {[s.doi ? `DOI ${s.doi}` : '', s.pmid ? `PMID ${s.pmid}` : '', s.source ? String(s.source) : ''].filter(Boolean).join(' · ')}
            </span>
          </span>
          {!readOnly && (
            <button type="button" onClick={() => onRemove && onRemove(s)} disabled={busyId === s.id} style={miniBtn()}>Remove</button>
          )}
        </div>
      ))}
    </div>
  );
}

function pct(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `${Math.round(Number(v) * 100)}%`;
}

/** Pure leaf: the recall estimate summary (found / not-found / missing analysis / suggestions). Exported for tests. */
export function RecallSummary({ report }) {
  const r = report || {};
  const found = Array.isArray(r.found) ? r.found : [];
  const notFound = Array.isArray(r.notFound) ? r.notFound : [];
  const missing = Array.isArray(r.missingAnalysis) ? r.missingAnalysis : [];
  const suggestions = Array.isArray(r.suggestions) ? r.suggestions : [];
  const total = r.seedTotal != null ? r.seedTotal : found.length + notFound.length;
  const foundCount = r.foundCount != null ? r.foundCount : found.length;
  const strong = r.estimatedRecall != null && Number(r.estimatedRecall) >= 0.8;

  const seedTitle = (s) => (s && (s.title || s.doi || s.pmid)) || 'study';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', padding: '10px 12px', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>
          Found {foundCount} of {total} seed studies
        </span>
        {r.estimatedRecall != null && (
          <span style={{ fontSize: 11.5, fontWeight: 700, color: strong ? C.grn : C.yel, background: alpha(strong ? C.grn : C.yel, '16'), border: `1px solid ${alpha(strong ? C.grn : C.yel, '44')}`, borderRadius: 6, padding: '2px 9px' }}>
            estimated recall {pct(r.estimatedRecall)}
          </span>
        )}
      </div>

      {found.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 600, color: C.grn, listStyle: 'none' }}>Found ({found.length})</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {found.map((s, i) => <div key={i} style={{ fontSize: 11.5, color: C.txt2 }}>✓ {seedTitle(s)}</div>)}
          </div>
        </details>
      )}

      {(notFound.length > 0 || missing.length > 0) && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 600, color: C.yel, listStyle: 'none' }}>Not found ({notFound.length})</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            {notFound.map((s, i) => <div key={i} style={{ fontSize: 11.5, color: C.txt2 }}>• {seedTitle(s)}</div>)}
            {missing.map((m, i) => (
              <div key={`m${i}`} style={{ fontSize: 11.5, color: C.txt2, lineHeight: 1.5, paddingLeft: 10, borderLeft: `2px solid ${alpha(C.yel, '66')}` }}>
                <span style={{ fontWeight: 600, color: C.txt }}>{seedTitle(m.seed)}</span>
                {m.likelyReason && <span style={{ display: 'block', color: C.muted }}>{m.likelyReason}</span>}
              </div>
            ))}
          </div>
        </details>
      )}

      {suggestions.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 5 }}>Suggested improvements</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {suggestions.map((s, i) => (
              <div key={i} style={{ fontSize: 11.5, color: C.txt2, lineHeight: 1.5 }}>
                <span style={{ color: C.acc, fontWeight: 700, marginRight: 5 }}>→</span>
                {typeof s === 'string' ? s : (s && s.suggestion) || ''}
                {s && s.rationale && <span style={{ display: 'block', color: C.muted, paddingLeft: 16 }}>{s.rationale}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RecallReportPanel({ projectId, readOnly, pecanEnabled }) {
  const [seeds, setSeeds] = useState([]);
  const [seedState, setSeedState] = useState('idle'); // idle | ready | unavailable
  const [busyId, setBusyId] = useState(null);
  const [form, setForm] = useState({ title: '', doi: '', pmid: '' });
  const [adding, setAdding] = useState(false);
  const [seedErr, setSeedErr] = useState('');

  const [source, setSource] = useState('probe'); // probe | run
  const [estState, setEstState] = useState('idle'); // idle | loading | ready | error
  const [estErr, setEstErr] = useState('');
  const [report, setReport] = useState(null);

  const refreshSeeds = useCallback(async () => {
    const out = await strategyStudioApi.listSeeds(projectId);
    setSeeds(out.seeds);
    setSeedState(out.available ? 'ready' : 'unavailable');
  }, [projectId]);

  useEffect(() => { refreshSeeds(); }, [refreshSeeds]);

  const addSeed = useCallback(async () => {
    const title = form.title.trim(), doi = form.doi.trim(), pmid = form.pmid.trim();
    if (!title && !doi && !pmid) { setSeedErr('Enter a title, DOI or PMID.'); return; }
    setAdding(true); setSeedErr('');
    try {
      await strategyStudioApi.addSeeds(projectId, [{ title: title || undefined, doi: doi || undefined, pmid: pmid || undefined }]);
      setForm({ title: '', doi: '', pmid: '' });
      await refreshSeeds();
    } catch (e) {
      setSeedErr(`Could not add: ${(e && e.message) || 'error'}`);
    } finally {
      setAdding(false);
    }
  }, [projectId, form, refreshSeeds]);

  const removeSeed = useCallback(async (s) => {
    setBusyId(s.id); setSeedErr('');
    try { await strategyStudioApi.removeSeed(projectId, s.id); await refreshSeeds(); }
    catch (e) { setSeedErr(`Could not remove: ${(e && e.message) || 'error'}`); }
    finally { setBusyId(null); }
  }, [projectId, refreshSeeds]);

  const estimate = useCallback(async () => {
    setEstState('loading'); setEstErr('');
    try {
      const out = await strategyStudioApi.recallEstimate(projectId, { source });
      setReport(out); setEstState('ready');
    } catch (e) {
      setEstErr((e && e.message) || 'Could not estimate recall.'); setEstState('error');
    }
  }, [projectId, source]);

  return (
    <div style={{ marginTop: 16, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, marginBottom: 4 }}>Recall check</div>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
        List a handful of known-relevant papers, then estimate how many your search catches — a practical validity check for a systematic review.
      </div>

      {/* Seed studies */}
      {seedState === 'unavailable' ? (
        <div style={{ fontSize: 11.5, color: C.muted, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8, padding: '9px 11px' }}>
          Seed studies aren’t available — this needs the guided search tools enabled in Ops.
        </div>
      ) : (
        <>
          <SeedList seeds={seeds} readOnly={readOnly} onRemove={removeSeed} busyId={busyId} />
          {!readOnly && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Title" style={{ ...input(), flex: '2 1 200px' }} />
              <input value={form.doi} onChange={(e) => setForm((f) => ({ ...f, doi: e.target.value }))} placeholder="DOI" style={{ ...input(), flex: '1 1 120px' }} />
              <input value={form.pmid} onChange={(e) => setForm((f) => ({ ...f, pmid: e.target.value }))} placeholder="PMID" style={{ ...input(), flex: '0 1 100px' }} />
              <button type="button" onClick={addSeed} disabled={adding} style={btn()}>{adding ? 'Adding…' : 'Add seed study'}</button>
            </div>
          )}
          {seedErr && <div style={{ marginTop: 8, fontSize: 11.5, color: C.red }}>{seedErr}</div>}
        </>
      )}

      {/* Recall estimate */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.brd}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.txt }}>Estimate recall</span>
          <select value={source} onChange={(e) => setSource(e.target.value)} style={sel()}>
            <option value="probe">against the live strategy</option>
            {pecanEnabled && <option value="run">against the latest run</option>}
          </select>
          <button type="button" onClick={estimate} disabled={estState === 'loading' || !seeds.length} style={{ ...primary(), marginLeft: 'auto', opacity: seeds.length ? 1 : 0.5, cursor: seeds.length ? 'pointer' : 'not-allowed' }}>
            {estState === 'loading' ? 'Estimating…' : 'Estimate recall'}
          </button>
        </div>
        {!seeds.length && seedState !== 'unavailable' && (
          <div style={{ fontSize: 11.5, color: C.muted }}>Add at least one seed study to run a recall estimate.</div>
        )}
        {estState === 'error' && <div style={{ fontSize: 11.5, color: C.red, marginBottom: 8 }}>{estErr}</div>}
        {estState === 'ready' && report && <RecallSummary report={report} />}
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
function miniBtn() {
  return { padding: '4px 9px', borderRadius: 7, border: `1px solid ${C.brd2}`, background: 'transparent', color: C.txt2, fontSize: 10.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
}
function input() {
  return { padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.brd2}`, background: C.surf, color: C.txt, fontSize: 12, fontFamily: FONT, minWidth: 0 };
}
function sel() {
  return { padding: '6px 9px', borderRadius: 8, border: `1px solid ${C.brd2}`, background: C.surf, color: C.txt, fontSize: 11.5, fontFamily: FONT };
}
