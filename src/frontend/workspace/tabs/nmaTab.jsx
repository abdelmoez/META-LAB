/**
 * nmaTab.jsx — Network Meta-Analysis workspace tab (P2).
 *
 * Integrated into the project workflow (NOT a standalone engine): it reads/writes the
 * network dataset in `project.nma` via the normal blob autosave, validates live with
 * the shared pure engine, and runs the AUTHORITATIVE analysis server-side
 * (POST /api/nma/run — deterministic, audited by the flag, no data leaves the server).
 * Results: overview + warnings, network geometry, league table, per-treatment forest,
 * P-score ranking, inconsistency (node-split + global), contribution matrix, and a
 * methods/reproducibility panel. Gated by the `networkMetaAnalysis` flag — when OFF it
 * shows a disabled note (mirroring Search & Discovery), never a broken UI.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { C } from '../ui/styles.js';
import { fmtNum, fmtInt, normalizePrecision } from '../../../research-engine/format/precision.js';
import { validateNetwork, SUPPORTED_MEASURES } from '../../../research-engine/statistics/nma/index.js';
import { isLogScale } from '../../../research-engine/statistics/nma/contrasts.js';
// 117.md §J.11 / §K.7 (closes 116.md §10.4) — the mini forest below is a SKIN over
// THE shared geometry engine, exactly like the live plot and the publication
// builder. It decides colours and compactness; it never decides a coordinate, a
// tick value or where "no effect" is. See forestLayout.js for the contract.
import { computeForestLayout, measureScale } from '../../../research-engine/charts/forestLayout.js';

const MEASURE_LABEL = { OR: 'Odds ratio', RR: 'Risk ratio', RD: 'Risk difference', MD: 'Mean difference', GENERIC: 'Generic (logHR/log-effect + SE)' };
const ARM_MEASURES = ['OR', 'RR', 'RD', 'MD'];

const DEFAULT_NMA = { sm: 'OR', smallerBetter: false, model: 'random', reference: '', studies: [] };

// A compact, well-known-shaped example (3 treatments, incl. a multi-arm trial).
function exampleDataset() {
  return {
    sm: 'OR', smallerBetter: true, model: 'random', reference: 'Placebo',
    studies: [
      { id: 's1', label: 'Trial 1', arms: [{ treatment: 'Placebo', events: 12, n: 100 }, { treatment: 'DrugA', events: 8, n: 100 }] },
      { id: 's2', label: 'Trial 2', arms: [{ treatment: 'Placebo', events: 20, n: 150 }, { treatment: 'DrugB', events: 12, n: 150 }] },
      { id: 's3', label: 'Trial 3', arms: [{ treatment: 'DrugA', events: 9, n: 120 }, { treatment: 'DrugB', events: 7, n: 120 }] },
      { id: 's4', label: 'Trial 4 (3-arm)', arms: [{ treatment: 'Placebo', events: 18, n: 130 }, { treatment: 'DrugA', events: 11, n: 130 }, { treatment: 'DrugB', events: 9, n: 130 }] },
    ],
  };
}

const uid = (() => { let i = 0; return () => `n${Date.now().toString(36)}${(i++).toString(36)}`; })();

function transform(est, isLog) { return isLog ? Math.exp(est) : est; }
function fx(est, lo, hi, isLog, prec) {
  if (est == null) return '—';
  const e = transform(est, isLog), l = transform(lo, isLog), h = transform(hi, isLog);
  return `${fmtNum(e, prec)} (${fmtNum(Math.min(l, h), prec)}, ${fmtNum(Math.max(l, h), prec)})`;
}

export function NmaTab({ project, updateProject, activeId }) {
  // 116.md §29/§31 — the WHOLE precision object (this used to keep only
  // `.decimals`, silently dropping the project's trailingZeros preference on every
  // NMA number). normalizePrecision applies the same defaults as everywhere else.
  const prec = normalizePrecision(project && project.analysisPrecision);
  const [flagOn, setFlagOn] = useState(null); // null = loading
  const [view, setView] = useState('data');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const abortRef = useRef(null);

  const nma = (project && project.nma) || DEFAULT_NMA;
  const readOnly = !!(project && (project._readOnly || (project._permissions && project._permissions.readOnly)));

  const save = useCallback((patch) => {
    if (readOnly || !updateProject) return;
    updateProject(activeId, (p) => ({ ...p, nma: { ...DEFAULT_NMA, ...(p.nma || {}), ...patch } }));
  }, [updateProject, activeId, readOnly]);

  // Feature flag (mirror Search & Discovery: tab always present, disabled when OFF).
  useEffect(() => {
    let alive = true;
    fetch('/api/settings/public', { credentials: 'include' })
      .then((r) => r.json()).then((s) => { if (alive) setFlagOn(!!(s && s.featureFlags && s.featureFlags.networkMetaAnalysis)); })
      .catch(() => { if (alive) setFlagOn(false); });
    return () => { alive = false; };
  }, []);

  const readiness = useMemo(() => {
    try { return validateNetwork({ sm: nma.sm, smallerBetter: nma.smallerBetter, studies: nma.studies }); }
    catch { return { ok: false, errors: [{ level: 'fatal', msg: 'Could not read the dataset' }], warnings: [], treatments: [] }; }
  }, [nma.sm, nma.smallerBetter, nma.studies]);

  const run = useCallback(async () => {
    setRunError(''); setRunning(true);
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const res = await fetch('/api/nma/run', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ dataset: { sm: nma.sm, smallerBetter: nma.smallerBetter, studies: nma.studies }, model: nma.model, reference: nma.reference || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setRunError(data.error || (res.status === 404 ? 'Network Meta-Analysis is not enabled.' : 'Analysis failed.')); setResult(null); }
      else { setResult(data); setView('overview'); }
    } catch (e) {
      if (e.name !== 'AbortError') setRunError('Analysis failed — please try again.');
    } finally { setRunning(false); }
  }, [nma]);

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  if (flagOn === null) return <div style={{ padding: 24, color: C.sub }}>Loading…</div>;
  if (!flagOn) return <DisabledNote />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Header sm={nma.sm} model={nma.model} readiness={readiness} running={running} onRun={run}
        canRun={readiness.ok && !readOnly} hasResult={!!result} />
      {runError ? <Banner tone="error">{runError}</Banner> : null}
      <ViewTabs view={view} setView={setView} hasResult={!!result} />
      {view === 'data' && <DataEditor nma={nma} save={save} readOnly={readOnly} readiness={readiness} />}
      {view === 'overview' && result && <Overview result={result} prec={prec} />}
      {view === 'network' && result && <NetworkPlot geometry={result.geometry} />}
      {view === 'league' && result && <League result={result} prec={prec} />}
      {view === 'forest' && result && <NmaForest result={result} prec={prec} />}
      {view === 'ranking' && result && <Ranking result={result} prec={prec} />}
      {view === 'consistency' && result && <Consistency result={result} prec={prec} />}
      {view === 'contribution' && result && <Contribution result={result} prec={prec} />}
      {view === 'methods' && result && <Methods result={result} prec={prec} />}
      {view !== 'data' && !result && <Banner tone="info">Run the analysis to see results.</Banner>}
    </div>
  );
}

/* ─────────────────────────────── chrome ─────────────────────────────── */
function DisabledNote() {
  return (
    <div style={{ padding: 28, border: `1px dashed ${C.brd}`, borderRadius: 12, background: C.surf, color: C.sub, maxWidth: 720 }}>
      <div style={{ fontWeight: 700, color: C.text, fontSize: 16, marginBottom: 8 }}>Network Meta-Analysis</div>
      <p style={{ margin: 0, lineHeight: 1.6 }}>
        Compare three or more treatments using direct and indirect evidence — league table, treatment
        ranking (P-scores), network geometry, consistency checks and a contribution matrix.
      </p>
      <p style={{ margin: '12px 0 0', lineHeight: 1.6 }}>
        This feature is currently <strong>disabled</strong>. An administrator can enable it in
        <em> Ops Console › Feature Flags › Network Meta-Analysis</em>.
      </p>
    </div>
  );
}

function Header({ sm, model, readiness, running, onRun, canRun, hasResult }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.text, letterSpacing: '-0.01em' }}>Network Meta-Analysis</div>
        <div style={{ fontSize: 13, color: C.sub, marginTop: 4 }}>
          {MEASURE_LABEL[sm] || sm} · {model === 'common' ? 'common-effect' : 'random-effects'} · {readiness.treatments.length} treatments · {readiness.studyCount || 0} studies
        </div>
      </div>
      <button type="button" onClick={onRun} disabled={!canRun || running}
        style={{ background: canRun && !running ? C.acc : C.brd, color: canRun && !running ? C.accText : C.sub, border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 700, fontSize: 14, cursor: canRun && !running ? 'pointer' : 'not-allowed' }}>
        {running ? 'Running…' : hasResult ? 'Re-run analysis' : 'Run analysis'}
      </button>
    </div>
  );
}

function ViewTabs({ view, setView, hasResult }) {
  const tabs = [
    { id: 'data', label: 'Evidence data' },
    { id: 'overview', label: 'Overview' }, { id: 'network', label: 'Network' },
    { id: 'league', label: 'League table' }, { id: 'forest', label: 'Forest' },
    { id: 'ranking', label: 'Ranking' }, { id: 'consistency', label: 'Consistency' },
    { id: 'contribution', label: 'Contribution' }, { id: 'methods', label: 'Methods' },
  ];
  return (
    <div role="tablist" aria-label="NMA views" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: `1px solid ${C.brd}`, paddingBottom: 2 }}>
      {tabs.map((t) => {
        const disabled = t.id !== 'data' && !hasResult;
        const active = view === t.id;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={active} disabled={disabled} onClick={() => setView(t.id)}
            style={{ border: 'none', background: active ? C.accBg || 'transparent' : 'transparent', borderBottom: active ? `2px solid ${C.acc}` : '2px solid transparent', color: disabled ? C.brd : active ? C.acc : C.sub, fontWeight: active ? 700 : 600, fontSize: 13, padding: '8px 12px', cursor: disabled ? 'not-allowed' : 'pointer' }}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function Banner({ tone, children }) {
  // Theme-aware tints (legacy day/night + Stitch light/dark) via color-mix — no
  // hardcoded light pastels that break in dark mode (56.md §10).
  const bg = tone === 'error' ? `color-mix(in srgb, ${C.red} 12%, transparent)`
    : tone === 'warn' ? `color-mix(in srgb, ${C.yel} 12%, transparent)` : C.surf;
  const col = tone === 'error' ? C.red : tone === 'warn' ? C.yel : C.sub;
  return <div style={{ padding: '10px 14px', borderRadius: 10, background: bg, color: col, fontSize: 13, border: `1px solid ${C.brd}` }}>{children}</div>;
}

function Card({ title, children, right }) {
  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 12, background: C.surf, padding: 16 }}>
      {(title || right) ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>{title}</div>{right}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/* ─────────────────────────────── data editor ─────────────────────────────── */
function DataEditor({ nma, save, readOnly, readiness }) {
  const isArm = ARM_MEASURES.includes(nma.sm);
  const treatments = readiness.treatments;
  const setStudies = (studies) => save({ studies });
  const updateStudy = (sid, patch) => setStudies(nma.studies.map((s) => (s.id === sid ? { ...s, ...patch } : s)));
  const addStudy = () => setStudies([...(nma.studies || []), { id: uid(), label: `Study ${nma.studies.length + 1}`, arms: [{ treatment: '' }, { treatment: '' }] }]);
  const removeStudy = (sid) => setStudies(nma.studies.filter((s) => s.id !== sid));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card title="Analysis settings">
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Effect measure">
            <select disabled={readOnly} value={nma.sm} onChange={(e) => save({ sm: e.target.value })} style={selStyle}>
              {SUPPORTED_MEASURES.map((m) => <option key={m} value={m}>{MEASURE_LABEL[m]}</option>)}
            </select>
          </Field>
          <Field label="Model">
            <select disabled={readOnly} value={nma.model} onChange={(e) => save({ model: e.target.value })} style={selStyle}>
              <option value="random">Random-effects (DerSimonian–Laird)</option>
              <option value="common">Common-effect</option>
            </select>
          </Field>
          <Field label="Reference treatment">
            <select disabled={readOnly} value={nma.reference || ''} onChange={(e) => save({ reference: e.target.value })} style={selStyle}>
              <option value="">(alphabetical)</option>
              {treatments.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Direction">
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, color: C.text }}>
              <input type="checkbox" disabled={readOnly} checked={!!nma.smallerBetter} onChange={(e) => save({ smallerBetter: e.target.checked })} />
              Smaller effect is better
            </label>
          </Field>
        </div>
      </Card>

      <Card title={`Studies (${nma.studies.length})`} right={!readOnly ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <SmallBtn onClick={addStudy}>+ Add study</SmallBtn>
          {nma.studies.length === 0 ? <SmallBtn onClick={() => save(exampleDataset())}>Load example</SmallBtn> : null}
        </div>
      ) : null}>
        {nma.studies.length === 0 ? (
          <div style={{ color: C.sub, fontSize: 13, padding: '8px 0' }}>No studies yet. Add multi-arm studies (each arm = one treatment) or load the example.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {nma.studies.map((s) => (
              <StudyRow key={s.id} study={s} isArm={isArm} sm={nma.sm} readOnly={readOnly}
                onChange={(patch) => updateStudy(s.id, patch)} onRemove={() => removeStudy(s.id)} />
            ))}
          </div>
        )}
      </Card>

      <ReadinessPanel readiness={readiness} />
    </div>
  );
}

function StudyRow({ study, isArm, sm, readOnly, onChange, onRemove }) {
  const arms = study.arms || [];
  const setArm = (i, patch) => onChange({ arms: arms.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const addArm = () => onChange({ arms: [...arms, { treatment: '' }] });
  const removeArm = (i) => onChange({ arms: arms.filter((_, j) => j !== i) });
  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 10, padding: 12, background: C.bg }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <input disabled={readOnly} value={study.label || ''} placeholder="Study label" onChange={(e) => onChange({ label: e.target.value })}
          style={{ ...inpStyle, flex: 1, fontWeight: 600 }} />
        {!readOnly ? <SmallBtn onClick={onRemove} danger>Remove</SmallBtn> : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {arms.map((a, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input disabled={readOnly} value={a.treatment || ''} placeholder="Treatment" onChange={(e) => setArm(i, { treatment: e.target.value })} style={{ ...inpStyle, width: 150 }} />
            {sm === 'GENERIC' ? (
              <span style={{ fontSize: 12, color: C.sub }}>(define contrasts below — generic 2-arm only)</span>
            ) : isArm && (sm === 'MD') ? (
              <>
                <Num disabled={readOnly} v={a.mean} ph="mean" on={(v) => setArm(i, { mean: v })} />
                <Num disabled={readOnly} v={a.sd} ph="SD" on={(v) => setArm(i, { sd: v })} />
                <Num disabled={readOnly} v={a.n} ph="N" on={(v) => setArm(i, { n: v })} />
              </>
            ) : (
              <>
                <Num disabled={readOnly} v={a.events} ph="events" on={(v) => setArm(i, { events: v })} />
                <Num disabled={readOnly} v={a.n} ph="N" on={(v) => setArm(i, { n: v })} />
              </>
            )}
            {!readOnly && arms.length > 2 ? <SmallBtn onClick={() => removeArm(i)} danger>×</SmallBtn> : null}
          </div>
        ))}
        {!readOnly ? <SmallBtn onClick={addArm}>+ Add arm</SmallBtn> : null}
      </div>
    </div>
  );
}

function ReadinessPanel({ readiness }) {
  const fatal = readiness.errors.filter((e) => e.level === 'fatal');
  const studyErr = readiness.errors.filter((e) => e.level === 'study');
  return (
    <Card title="Readiness">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: readiness.ok ? C.grn : C.red }} />
        <span style={{ fontWeight: 700, color: C.text }}>{readiness.ok ? 'Ready to analyse' : 'Not ready'}</span>
      </div>
      {fatal.map((e, i) => <Banner key={`f${i}`} tone="error">{e.msg}</Banner>)}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {studyErr.map((e, i) => <div key={`s${i}`} style={{ fontSize: 13, color: C.red }}>• {e.label || e.id}: {e.msg}</div>)}
        {readiness.warnings.map((w, i) => <div key={`w${i}`} style={{ fontSize: 13, color: w.level === 'warn' ? C.yel : C.sub }}>• {w.msg}</div>)}
      </div>
    </Card>
  );
}

/* ─────────────────────────────── result views ─────────────────────────────── */
function Overview({ result, prec }) {
  const h = result.heterogeneity;
  const stat = (label, val) => (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 10, padding: '12px 14px', background: C.surf, minWidth: 130 }}>
      <div style={{ fontSize: 12, color: C.sub }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>{val}</div>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {stat('Treatments', fmtInt(result.counts.treatments))}
        {stat('Studies', fmtInt(result.counts.studies))}
        {stat('Direct comparisons', fmtInt(result.counts.directComparisons))}
        {stat('Participants', fmtInt(result.counts.participants))}
        {stat('τ²', fmtNum(h.tau2, prec))}
        {stat('I²', `${fmtNum(h.I2, 1)}%`)}
      </div>
      {result.excludedTreatments && result.excludedTreatments.length ? (
        <Banner tone="warn">Disconnected network — only the largest connected component was analysed. Excluded: {result.excludedTreatments.join(', ')}.</Banner>
      ) : null}
      <Card title="Transparency & certainty signals">
        {result.warnings.length === 0 ? <div style={{ color: C.sub, fontSize: 13 }}>No major warnings flagged.</div> : (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {result.warnings.map((w, i) => <li key={i} style={{ fontSize: 13, color: C.text }}><strong style={{ color: C.sub, textTransform: 'capitalize' }}>{w.kind}:</strong> {w.msg}</li>)}
          </ul>
        )}
        <div style={{ fontSize: 12, color: C.sub, marginTop: 10 }}>A high rank does not mean a treatment is definitively best — read alongside the evidence, heterogeneity and inconsistency.</div>
      </Card>
    </div>
  );
}

function NetworkPlot({ geometry }) {
  const W = 560, H = 420, cx = W / 2, cy = H / 2, R = 150;
  const nodes = geometry.nodes;
  const pos = {};
  nodes.forEach((n, i) => { const ang = (2 * Math.PI * i) / nodes.length - Math.PI / 2; pos[n.id] = { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) }; });
  const maxStudies = Math.max(1, ...geometry.edges.map((e) => e.studies));
  const maxPart = Math.max(1, ...nodes.map((n) => n.participants || 1));
  return (
    <Card title="Network geometry" right={<span style={{ fontSize: 12, color: C.sub }}>node size ∝ participants · edge width ∝ studies</span>}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Network geometry plot" style={{ maxWidth: 620 }}>
        {geometry.edges.map((e, i) => {
          const a = pos[e.t1], b = pos[e.t2]; if (!a || !b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={C.acc} strokeOpacity={0.45} strokeWidth={1 + (5 * e.studies) / maxStudies}><title>{`${e.t1} ↔ ${e.t2}: ${e.studies} study(ies)`}</title></line>;
        })}
        {nodes.map((n) => {
          const p = pos[n.id]; const r = 10 + 18 * Math.sqrt((n.participants || 1) / maxPart);
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r={r} fill={C.acc} fillOpacity={0.85}><title>{`${n.id}: ${n.studies} study(ies), ${n.participants} participants`}</title></circle>
              <text x={p.x} y={p.y - r - 4} textAnchor="middle" fontSize="12" fontWeight="700" fill={C.text}>{n.id}</text>
            </g>
          );
        })}
      </svg>
      <AccessibleTable caption="Network nodes" head={['Treatment', 'Studies', 'Participants']} rows={nodes.map((n) => [n.id, n.studies, n.participants])} />
    </Card>
  );
}

function League({ result, prec }) {
  const T = result.league.treatments; const cells = result.league.cells; const isLog = result.isLog;
  return (
    <Card title="League table" right={<DownloadCsv name="nma-league.csv" rows={leagueCsv(result)} />}>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 10 }}>Cell = effect of the <strong>column</strong> treatment versus the <strong>row</strong> treatment ({MEASURE_LABEL[result.sm]}{isLog ? ', shown on the natural scale' : ''}), with 95% CI.</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}></th>{T.map((t) => <th key={t} style={thStyle}>{t}</th>)}</tr></thead>
          <tbody>
            {T.map((r) => (
              <tr key={r}>
                <th style={{ ...thStyle, textAlign: 'left' }}>{r}</th>
                {T.map((c) => {
                  if (r === c) return <td key={c} style={{ ...tdStyle, background: C.bg, fontWeight: 700 }}>{r}</td>;
                  const cell = cells[r][c];
                  return <td key={c} style={tdStyle}>{cell ? fx(cell.est, cell.lo, cell.hi, isLog, prec) : '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * 117.md §J.11 / §K.7 — the NMA measure code → the ES_TYPES key whose `nullVal`,
 * stored scale and back-transform the shared geometry engine reads.
 *
 * The two registries are deliberately separate (NMA supports five measures; the
 * pairwise engine supports fourteen), so the mapping is stated once, here, instead
 * of each renderer re-deciding what "log scale" means. NMA's `GENERIC` is a
 * LOG-scale generic effect (contrasts.js `isLogScale` returns true for it), which
 * in ES_TYPES is `GENERIC_LOG` — `GENERIC` there is the log-FREE one, so mapping
 * by name would have silently produced a linear axis for pre-computed log hazard
 * ratios. Anything unrecognised falls through to the code itself, so a measure the
 * ES_TYPES registry already knows keeps its own null value rather than defaulting.
 */
const NMA_ES_TYPE = Object.freeze({ OR: 'OR', RR: 'RR', RD: 'RD', MD: 'MD', GENERIC: 'GENERIC_LOG' });
export function nmaEsType(sm) {
  const key = String(sm == null ? '' : sm).trim().toUpperCase();
  return NMA_ES_TYPE[key] || key;
}

/**
 * A COMPACT metric pack for the mini forest (117.md §J.11).
 *
 * `opts.metrics` rather than a third FOREST_METRICS variant: only the four column
 * widths differ from the live plot, every one of them is already a bounded,
 * engine-validated control, and a new variant key would have to be kept in sync
 * with the live pack forever for no gain. The engine clamps these through the same
 * bounds table any persisted override goes through.
 */
const NMA_FOREST_METRICS = Object.freeze({ nameW: 140, plotW: 260, ROW: 26 });

/**
 * buildNmaForestLayout(result) — the per-treatment-vs-reference rows through the
 * ONE shared geometry engine (116.md §22-§25, closing §10.4).
 *
 * Each row is its own network contrast, so there is deliberately NO pooled
 * diamond and no prediction interval: `fixed`/`random` are null and the domain is
 * anchored by the measure's no-effect value plus the rows themselves. Exported for
 * tests.
 */
export function buildNmaForestLayout(result, prec) {
  const rows = Array.isArray(result && result.forest) ? result.forest.filter(Boolean) : [];
  const esType = nmaEsType(result && result.sm);
  const scale = measureScale(esType);
  const studies = rows.map((r, i) => ({
    id: r.t2 == null ? i : r.t2,
    author: String(r.t2 == null ? '' : r.t2) || 'Treatment',
    year: '',
    _es: Number(r.est), _lo: Number(r.lo), _hi: Number(r.hi),
    // A network contrast has no study weight; the marker is a fixed dot.
    _pct: 0, _wFixedPct: 0, _wRandomPct: 0,
  }));
  const layout = computeForestLayout({ studies, fixed: null, random: null, method: 'random' }, {
    variant: 'live',
    esType,
    showCounts: false,
    showWeights: false,
    showPI: false,
    metrics: NMA_FOREST_METRICS,
    // The same formatter that PRINTS, so the effect column sizes itself to the
    // strings actually drawn (forestLayout invariant 5). Back-transformed through
    // the MEASURE's own transform rather than a local `isLog ? exp : identity`,
    // so a measure whose stored scale is neither log nor raw cannot print a
    // stored-scale number as if it were a displayed one.
    formatValue: (v) => fmtNum(scale.backTransform(v), prec),
  });
  return { layout, scale };
}

/** Exported so the unified geometry can be pinned without mounting the whole tab. */
export function NmaForest({ result, prec }) {
  const { layout: L, scale } = buildNmaForestLayout(result, prec);
  if (!L) return <Card title={`Per-treatment forest (vs ${result.reference})`}><Banner tone="info">No treatment contrasts to plot.</Banner></Card>;
  const { columns: CO, rowsGeom: RG, metrics: M, ticks, favours, axisLabel } = L;
  const W = L.W;
  /* 116.md §22 (c) — an interval end outside the visible domain gets the
     conventional truncation arrow instead of being squashed onto the frame. The
     hand-rolled geometry this replaced could not express "off scale" at all: it
     built its domain from min(lo,0)/max(hi,0), which also pinned the no-effect
     line to an EDGE whenever every treatment sat on one side of the reference. */
  const endCap = (p, cy, key) => (p.off ? null : (p.clamped
    ? <polygon key={key} fill={C.acc}
      points={p.clamped < 0
        ? `${p.x},${cy} ${p.x + 6},${cy - 3.5} ${p.x + 6},${cy + 3.5}`
        : `${p.x},${cy} ${p.x - 6},${cy - 3.5} ${p.x - 6},${cy + 3.5}`} />
    : <line key={key} x1={p.x} y1={cy - 3.5} x2={p.x} y2={cy + 3.5} stroke={C.acc} strokeWidth={1.5} />));
  return (
    <Card title={`Per-treatment forest (vs ${result.reference})`}>
      <svg viewBox={`0 0 ${W} ${L.H}`} width="100%" role="img" aria-label="Forest plot" style={{ maxWidth: 640 }}>
        {/* No-effect line — from the measure registry, never assumed at 0, and
            guaranteed by the engine to sit inside the frame with a margin. */}
        {L.nullLine.show && (
          <line x1={L.nullLine.x} y1={RG.rowsTop} x2={L.nullLine.x} y2={RG.bandBottom} stroke={C.brd} strokeDasharray="4 3" />
        )}
        {L.rows.map((r) => {
          const cy = r.markerY;
          return (
            <g key={r.id}>
              <text x={CO.xName} y={r.y} fontSize={M.nameSize} fontWeight="600" fill={C.text}>{r.name}</text>
              {!r.lo.off && !r.hi.off && <line x1={r.lo.x} y1={cy} x2={r.hi.x} y2={cy} stroke={C.acc} strokeWidth={2} />}
              {endCap(r.lo, cy, 'lo')}
              {endCap(r.hi, cy, 'hi')}
              {!r.es.off && (r.es.clamped
                ? <polygon fill={C.acc}
                  points={r.es.clamped < 0
                    ? `${r.es.x},${cy} ${r.es.x + 8},${cy - 4} ${r.es.x + 8},${cy + 4}`
                    : `${r.es.x},${cy} ${r.es.x - 8},${cy - 4} ${r.es.x - 8},${cy + 4}`} />
                : <circle cx={r.es.x} cy={cy} r={4} fill={C.acc} />)}
              <text x={CO.xEff} y={r.y} fontSize={M.cellSize} fill={C.sub}>{r.esText}</text>
            </g>
          );
        })}
        {/* Measure-aware axis (clinical ratio ticks / a 1-2-5 nice step), de-collided
            against real label widths — the mini forest previously had no axis at all. */}
        <line x1={CO.xPlot} y1={RG.axisY} x2={CO.xPlotEnd} y2={RG.axisY} stroke={C.sub} strokeWidth={1} />
        {ticks.map((t) => (
          <g key={`tk${t.v}`}>
            <line x1={t.x} y1={RG.axisY} x2={t.x} y2={RG.axisY + 4} stroke={C.sub} strokeWidth={0.9} />
            <text x={t.x} y={RG.tickLabelY} textAnchor="middle" fontSize={M.tickSize} fill={C.sub}>{t.label}</text>
          </g>
        ))}
        {favours.show && (
          <g>
            <text x={favours.low.x} y={favours.y} textAnchor={favours.low.anchor} fontSize={M.favSize} fill={C.sub}>{favours.low.text}</text>
            <text x={favours.high.x} y={favours.y} textAnchor={favours.high.anchor} fontSize={M.favSize} fill={C.sub}>{favours.high.text}</text>
          </g>
        )}
        <text x={CO.xPlot + CO.plotW / 2} y={RG.axisLabelY} textAnchor="middle" fontSize={M.axisLabelSize} fontWeight={700} fill={C.text}>{axisLabel}</text>
      </svg>
      <div style={{ fontSize: 12, color: C.sub, marginTop: 8 }}>
        Each row is the network estimate of that treatment versus {result.reference}
        {scale.isLog ? ' (pooled on the log scale; displayed values are back-transformed)' : ''}.
      </div>
    </Card>
  );
}

function Ranking({ result, prec }) {
  return (
    <Card title="Treatment ranking — P-scores" right={<DownloadCsv name="nma-ranking.csv" rows={[['treatment', 'pScore', 'rank'], ...result.ranking.map((r) => [r.treatment, r.pScore == null ? '' : r.pScore.toFixed(4), r.rank ?? ''])]} />}>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 10 }}>P-score (Rücker &amp; Schwarzer) — a frequentist analogue of SUCRA; higher = ranked better. NOT a probability of being best, and NOT a clinical recommendation.</div>
      <AccessibleTable caption="Ranking" head={['Rank', 'Treatment', 'P-score']}
        rows={result.ranking.map((r) => [r.rank ?? '—', r.treatment, r.pScore == null ? '—' : fmtNum(r.pScore, { ...prec, decimals: Math.max(prec.decimals, 3) })])} />
    </Card>
  );
}

function Consistency({ result, prec }) {
  const isLog = result.isLog; const splits = result.inconsistency.local; const g = result.inconsistency.global;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card title="Global inconsistency (design-by-treatment Q decomposition)">
        {g.ok ? (
          <>
            <AccessibleTable caption="Q decomposition" head={['Component', 'Q', 'df', 'p']} rows={[
              ['Total', fmtNum(g.Qtotal, 2), g.dfTotal, ''],
              ['Within-design (heterogeneity)', fmtNum(g.Qhet, 2), g.dfHet, ''],
              ['Between-design (inconsistency)', fmtNum(g.Qinc, 2), g.dfInc, g.pInc == null ? '—' : fmtNum(g.pInc, 3)],
            ]} />
            <div style={{ fontSize: 12, color: C.sub, marginTop: 8 }}>{g.note}</div>
          </>
        ) : <Banner tone="info">{g.error || 'Global inconsistency is not estimable for this network.'}</Banner>}
      </Card>
      <Card title="Local inconsistency (node-splitting: direct vs indirect)">
        <AccessibleTable caption="Node split" head={['Comparison', 'Direct', 'Indirect', 'Difference', 'p']}
          rows={splits.map((s) => [
            `${s.t2} vs ${s.t1}`,
            s.direct ? fx(s.direct.est, s.direct.lo, s.direct.hi, isLog, prec) : '—',
            s.indirect ? fx(s.indirect.est, s.indirect.lo, s.indirect.hi, isLog, prec) : 'not estimable',
            s.diff ? fmtNum(s.diff.est, prec) : '—',
            s.pval == null ? '—' : fmtNum(s.pval, 3),
          ])} />
        <div style={{ fontSize: 12, color: C.sub, marginTop: 8 }}>A non-significant test does not prove consistency; power is often low in sparse networks. Multi-arm studies are excluded whole when splitting (conservative).</div>
      </Card>
    </div>
  );
}

function Contribution({ result, prec }) {
  const cm = result.contribution;
  if (!cm || !cm.ok) return <Banner tone="info">Contribution matrix is not estimable for this network.</Banner>;
  return (
    <Card title="Contribution matrix" right={<span style={{ fontSize: 12, color: C.sub }}>row = network estimate · value = share of each direct comparison</span>}>
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>estimate \ direct</th>{cm.labels.map((l) => <th key={l} style={thStyle}>{l}</th>)}</tr></thead>
          <tbody>
            {cm.matrix.map((row, i) => (
              <tr key={i}>
                <th style={{ ...thStyle, textAlign: 'left' }}>{cm.labels[i]}</th>
                {row.map((v, j) => <td key={j} style={{ ...tdStyle, background: `rgba(99,102,241,${0.08 + 0.5 * v})` }}>{(v * 100).toFixed(0)}%</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Methods({ result, prec }) {
  const p = result.provenance;
  const text = methodsText(result);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card title="Methods (auto-generated)"><p style={{ margin: 0, lineHeight: 1.7, fontSize: 14, color: C.text }}>{text}</p></Card>
      <Card title="Reproducibility manifest" right={<DownloadJson name="nma-result.json" obj={result} />}>
        <AccessibleTable caption="Provenance" head={['Field', 'Value']} rows={[
          ['Engine version', p.engineVersion], ['Effect measure', result.sm], ['Model', result.model],
          ['Heterogeneity estimator', p.heterogeneityEstimator], ['Reference', result.reference],
          ['Data hash', p.dataHash], ['Config hash', p.configHash],
        ]} />
      </Card>
    </div>
  );
}

/* ─────────────────────────────── small pieces ─────────────────────────────── */
const selStyle = { padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.brd}`, background: C.bg, color: C.text, fontSize: 13 };
const inpStyle = { padding: '6px 9px', borderRadius: 8, border: `1px solid ${C.brd}`, background: C.surf, color: C.text, fontSize: 13 };
const tableStyle = { borderCollapse: 'collapse', fontSize: 12.5, width: '100%' };
const thStyle = { border: `1px solid ${C.brd}`, padding: '6px 9px', background: C.bg, color: C.text, fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' };
const tdStyle = { border: `1px solid ${C.brd}`, padding: '6px 9px', color: C.text, textAlign: 'center', whiteSpace: 'nowrap' };

function Field({ label, children }) { return <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: C.sub }}><span>{label}</span>{children}</label>; }
function Num({ v, ph, on, disabled }) { return <input disabled={disabled} value={v ?? ''} placeholder={ph} inputMode="decimal" onChange={(e) => on(e.target.value === '' ? undefined : Number(e.target.value))} style={{ ...inpStyle, width: 80 }} />; }
function SmallBtn({ children, onClick, danger }) { return <button type="button" onClick={onClick} style={{ border: `1px solid ${danger ? '#f2c0bb' : C.brd}`, background: C.surf, color: danger ? '#b42318' : C.text, borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{children}</button>; }

function AccessibleTable({ caption, head, rows }) {
  return (
    <table style={tableStyle}>
      <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{caption}</caption>
      <thead><tr>{head.map((h, i) => <th key={i} style={{ ...thStyle, textAlign: i === 0 ? 'left' : 'center' }}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ ...tdStyle, textAlign: j === 0 ? 'left' : 'center' }}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

function downloadBlob(name, text, type) {
  const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function DownloadCsv({ name, rows }) { return <SmallBtn onClick={() => downloadBlob(name, rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv')}>Export CSV</SmallBtn>; }
function DownloadJson({ name, obj }) { return <SmallBtn onClick={() => downloadBlob(name, JSON.stringify(obj, null, 2), 'application/json')}>Export JSON</SmallBtn>; }

function leagueCsv(result) {
  const T = result.league.treatments; const cells = result.league.cells; const isLog = result.isLog;
  const head = ['row\\col', ...T];
  const body = T.map((r) => [r, ...T.map((c) => (r === c ? r : (cells[r][c] ? fx(cells[r][c].est, cells[r][c].lo, cells[r][c].hi, isLog, 4) : '')))]);
  return [head, ...body];
}

function methodsText(result) {
  const h = result.heterogeneity;
  return `A ${result.model === 'common' ? 'common-effect' : 'random-effects'} frequentist network meta-analysis was performed within a graph-theoretical (generalized least-squares) consistency model, comparing ${result.counts.treatments} treatments across ${result.counts.studies} studies (${result.counts.directComparisons} direct comparisons; ${result.counts.participants} participants). The effect measure was the ${MEASURE_LABEL[result.sm].toLowerCase()} with ${result.reference} as the reference treatment. Between-study heterogeneity was estimated with the DerSimonian–Laird method (τ² = ${fmtNum(h.tau2, 4)}; I² = ${fmtNum(h.I2, 1)}%). Treatments were ranked using P-scores. Local inconsistency was assessed by node-splitting and global inconsistency by a design-by-treatment Q decomposition. Analysis was produced by the PecanRev NMA engine v${result.engineVersion} (deterministic; data hash ${result.provenance.dataHash}). Rankings reflect relative evidence and uncertainty, not clinical recommendations.`;
}

export default NmaTab;
