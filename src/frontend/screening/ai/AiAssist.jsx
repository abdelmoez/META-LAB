/**
 * AiAssist.jsx — UI surfaces for the PecanRev Screening Intelligence Engine.
 *
 * Institutional, calm, no gimmicks: a relevance gauge, an honest prediction +
 * confidence, a transparent "why" breakdown (model terms, criteria/PICO matches,
 * similar included records), an active-learning queue selector, and a model /
 * validation status panel. All AI output is ASSISTIVE — the human decision
 * controls are untouched. Components degrade gracefully when AI is unavailable.
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { QUEUE_MODES } from '../../../research-engine/screening/ai/ranking.js';

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

// 66.md P4.3 — citation reasons are duplicated into reasonsInclude/Exclude (kind:'citation')
// AND the dedicated citation block; when the block is present we render them once as a
// chips row, so strip the kind:'citation' entries out of the plain reason lists.
const dropCitation = (reasons, citation) =>
  (citation && (citation.reasons || []).length && Array.isArray(reasons))
    ? reasons.filter(r => r.kind !== 'citation')
    : reasons;
const BAND_COLOR = {
  very_high: C.grn, high: C.grn, medium: C.yel, low: C.red, very_low: C.red, unscored: C.muted,
};
const PRED_LABEL = { include: 'Likely include', exclude: 'Likely exclude', uncertain: 'Uncertain' };
const PRED_COLOR = { include: C.grn, exclude: C.red, uncertain: C.yel };

function Bar({ value, color, height = 6 }) {
  return (
    <div style={{ background: C.card2, borderRadius: 99, height, overflow: 'hidden' }}>
      <div style={{ width: `${Math.round((value || 0) * 100)}%`, height: '100%', background: color, borderRadius: 99, transition: 'width .25s' }} />
    </div>
  );
}

function Chip({ children, color = C.muted, title }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: MONO, fontSize: 10,
      letterSpacing: '.04em', textTransform: 'uppercase', color, background: alpha(color, 0.12),
      border: `1px solid ${alpha(color, 0.4)}`, borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function MiniBtn({ children, onClick, active, disabled, title, color = C.acc }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} style={{
      fontFamily: FONT, fontSize: 12, padding: '5px 9px', borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
      color: active ? C.accText : color, background: active ? color : 'transparent',
      border: `1px solid ${active ? color : alpha(color, 0.45)}`, opacity: disabled ? 0.5 : 1, fontWeight: 500,
    }}>{children}</button>
  );
}

/** Compact score pill for record-list rows. */
export function ScoreBadge({ score, band, prediction }) {
  if (score == null) return null;
  const color = BAND_COLOR[band] || C.muted;
  return (
    <span title={`AI relevance ${pct(score)}${prediction ? ` · ${PRED_LABEL[prediction] || prediction}` : ''}`}
      style={{
        fontFamily: MONO, fontSize: 10, fontWeight: 700, color, background: alpha(color, 0.14),
        border: `1px solid ${alpha(color, 0.45)}`, borderRadius: 5, padding: '1px 5px', letterSpacing: '.02em',
      }}>AI {Math.round(score * 100)}</span>
  );
}

/** The main record-detail AI card: score, prediction, confidence, and "why". */
export function AiScoreCard({ ai, record, decided }) {
  const [open, setOpen] = useState(false);
  const [fb, setFb] = useState('');
  const [fetched, setFetched] = useState(null);        // Layer-1 fallback fetch result
  const [explState, setExplState] = useState('idle');  // idle | loading | error | timeout
  const rid = record?.id;
  const score = rid ? (record?.aiScore || ai.scores[rid]) : null;
  const blind = ai.status?.project?.blindFromAi;

  // se2.md §5 — Layer 1 (instant): the explanation is served INLINE with the record
  // (server attaches the persisted ScreenAiScore.explanation), so "Why this score?"
  // renders immediately with no round-trip. The fetch below is a rare fallback.
  const inlineExpl = (score && score.explanation && Object.keys(score.explanation).length) ? score.explanation : null;
  const e = inlineExpl || fetched;

  // Reset per record.
  useEffect(() => { setOpen(false); setFb(''); setFetched(null); setExplState('idle'); }, [rid]);

  // Fallback fetch ONLY when expanded and no inline explanation. Abortable + timed
  // out so the panel never sticks on "Loading…"; cancelled when the panel closes.
  useEffect(() => {
    if (!open || inlineExpl || !rid || !ai.enabled) return;
    if (blind && !decided) return;
    let live = true;
    setExplState('loading');
    const timer = setTimeout(() => { if (live) setExplState('timeout'); }, 8000);
    ai.getExplanation(rid).then(res => {
      if (!live) return;
      clearTimeout(timer);
      if (res && res.explanation) { setFetched(res.explanation); setExplState('idle'); }
      else setExplState('error');
    });
    return () => { live = false; clearTimeout(timer); };
  }, [open, inlineExpl, rid, ai.enabled, blind, decided]); // eslint-disable-line

  const retry = () => { setFetched(null); setExplState('loading'); ai.refreshExplanation?.(rid); setOpen(false); setTimeout(() => setOpen(true), 0); };

  if (!ai.enabled) return null;

  const card = (children) => (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 14, fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.acc, fontWeight: 700 }}>AI relevance</span>
        <span style={{ flex: 1 }} />
        {/* 58.md §8 — clearly flag (+ allow reverting) the admin testing override that
            shows scores below the 50-screened threshold. */}
        {ai.gate?.overrideApplied ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Chip color={C.gold} title="An admin is previewing AI scores before the threshold is reached (testing).">Admin preview</Chip>
            <button type="button" onClick={() => ai.setOverride?.(false)}
              title="Re-apply the threshold and hide scores again"
              style={{ background: 'none', border: 'none', color: C.muted, fontSize: 11, fontFamily: FONT, cursor: 'pointer', textDecoration: 'underline' }}>Hide</button>
          </span>
        ) : null}
        {ai.status?.latestRun && <Chip color={C.muted}>{ai.status.latestRun.mode === 'supervised' ? 'Trained model' : 'Cold-start'}</Chip>}
      </div>
      {children}
    </div>
  );

  // 58.md §8 — below the screened-decisions threshold the server withholds scores;
  // show honest progress toward the threshold (+ an admin-only testing override).
  if (ai.gate?.scoresHidden) {
    return card(
      <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.5 }}>
        AI relevance scores appear once {ai.gate.threshold} articles have been screened — they
        need enough human decisions to be reliable.
        <span style={{ fontFamily: MONO, color: C.acc, fontWeight: 700 }}> {ai.gate.screenedCount}/{ai.gate.threshold} screened.</span>
        {ai.gate.canOverride ? (
          <button type="button" onClick={() => ai.setOverride?.(true)}
            style={{ display: 'block', marginTop: 9, background: 'none', border: `1px solid ${C.brd2}`, color: C.muted, borderRadius: 6, padding: '4px 10px', fontSize: 11, fontFamily: FONT, cursor: 'pointer' }}>
            Admin: show score before {ai.gate.threshold} screened (testing)
          </button>
        ) : null}
      </div>
    );
  }

  if (blind && !decided) {
    return card(
      <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.5 }}>
        AI suggestions are hidden until you record your own decision (independent screening is enabled for this project).
      </div>
    );
  }

  if (!score) {
    return card(
      <div style={{ fontSize: 12.5, color: C.muted }}>
        No AI score yet. {ai.status?.canRun ? 'Run AI scoring from the AI Screening panel.' : 'Ask a project leader to run AI scoring.'}
      </div>
    );
  }

  const predColor = PRED_COLOR[score.prediction] || C.muted;

  return card(
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontSize: 30, fontWeight: 700, fontFamily: MONO, color: BAND_COLOR[score.band] || C.txt, lineHeight: 1 }} title="Ranking score — the worklist ordering signal, not a probability.">{Math.round(score.score * 100)}</div>
        <div style={{ fontSize: 12, color: C.muted }}>/ 100 ranking</div>
        <span style={{ flex: 1 }} />
        <Chip color={predColor}>{PRED_LABEL[score.prediction] || score.prediction}</Chip>
      </div>

      {score.calibratedProba != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, background: alpha(C.acc, 0.06), border: `1px solid ${alpha(C.acc, 0.25)}`, borderRadius: 7, padding: '6px 9px' }}>
          <span style={{ color: C.txt2 }} title="Calibrated probability that this record meets the inclusion criteria, learned from your decisions via out-of-fold cross-validation. Distinct from the ranking score.">Calibrated inclusion probability</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: MONO, fontWeight: 700, color: C.acc }}>{pct(score.calibratedProba)}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: C.muted, marginBottom: 3 }}><span>CONFIDENCE</span><span>{pct(score.confidence)}</span></div>
          <Bar value={score.confidence} color={C.acc} />
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: C.muted, marginBottom: 3 }}><span>UNCERTAINTY</span><span>{pct(score.uncertainty)}</span></div>
          <Bar value={score.uncertainty} color={C.yel} />
        </div>
      </div>

      {score.missingAbstract && <Chip color={C.gold} title="No abstract — title-only, low confidence">No abstract — title only</Chip>}
      {score.lowConfidence && <div style={{ fontSize: 11.5, color: C.gold }}>Low-confidence prior — no model trained and no criteria configured yet.</div>}

      <button type="button" onClick={() => setOpen(o => !o)} style={{
        background: 'transparent', border: 'none', color: C.acc, fontFamily: FONT, fontSize: 12, cursor: 'pointer',
        textAlign: 'left', padding: 0, fontWeight: 500,
      }}>{open ? '▾ Hide reasons' : '▸ Why this score?'}</button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${C.brd}`, paddingTop: 10 }}>
          {!e && explState === 'loading' && (
            <div aria-label="Loading explanation" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[80, 60, 70].map((w, i) => (
                <div key={i} style={{ height: 9, width: `${w}%`, borderRadius: 4, background: alpha(C.muted, 0.18), animation: 'sift-fade 0.6s ease infinite alternate' }} />
              ))}
            </div>
          )}
          {!e && (explState === 'error' || explState === 'timeout') && (
            <div style={{ fontSize: 12, color: C.gold, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{explState === 'timeout' ? 'Explanation timed out.' : 'Explanation unavailable for this record.'}</span>
              <MiniBtn color={C.acc} onClick={retry}>Retry</MiniBtn>
            </div>
          )}
          {e && (
            <>
              {e.uncertaintyNote && <div style={{ fontSize: 11.5, color: C.txt2, fontStyle: 'italic', lineHeight: 1.5 }}>{e.uncertaintyNote}</div>}
              {/* 66.md P4.3 — citation reasons already flow into reasonsInclude/Exclude
                  (kind:'citation'); pull them out into a dedicated compact chips row so
                  they aren't shown twice, and strip them from the plain reason lists. */}
              <ReasonList title="Reasons to include" color={C.grn} reasons={dropCitation(e.reasonsInclude, e.citation)} />
              <ReasonList title="Reasons to exclude" color={C.red} reasons={dropCitation(e.reasonsExclude, e.citation)} />
              <CitationSignals citation={e.citation} />
              <SubScoreBreakdown subScores={e.subScores} />
              <PicoMatch breakdown={e.picoBreakdown} />
              <SimilarList title="Similar included records" color={C.teal} items={e.similar} />
              {/* 65.md SCR-6 — symmetric counter-examples from the excluded side. */}
              <SimilarList title="Similar excluded records" color={C.red} items={e.similarExcluded} />
              {/* 66.md P4.10 — which signals actually fed this project's scores. */}
              <ProvenanceChips ai={ai} />
              {/* 65.md SCR-6 — score provenance: honest about in-sample vs held-out. */}
              <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5, borderTop: `1px solid ${C.brd}`, paddingTop: 8 }}>
                This is the live model score, computed on the project's current decisions (in-sample).
                Validation-grade held-out (cross-validated) scores are included in the CSV export.
                {ai.status?.engineConfig?.activeLabel ? <> Engine config: <span style={{ fontFamily: MONO }}>{ai.status.engineConfig.activeLabel}</span>.</> : null}
              </div>
            </>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <span style={{ fontSize: 11, color: C.muted }}>Was this helpful?</span>
            <MiniBtn color={C.grn} active={fb === 'helpful'} onClick={() => { setFb('helpful'); ai.sendFeedback(rid, { rating: 'helpful', humanDecision: decided || '' }); }}>Yes</MiniBtn>
            <MiniBtn color={C.red} active={fb === 'not_helpful'} onClick={() => { setFb('not_helpful'); ai.sendFeedback(rid, { rating: 'not_helpful', humanDecision: decided || '' }); }}>No</MiniBtn>
            {fb && <span style={{ fontSize: 11, color: C.muted }}>Thanks — logged.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Nearest labelled neighbours (included or excluded side) — 65.md SCR-6. */
function SimilarList({ title, color, items }) {
  if (!items || !items.length) return null;
  return (
    <div>
      <div style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{title}</div>
      {items.map(s => (
        <div key={s.recordId} style={{ fontSize: 12, color: C.txt2, display: 'flex', gap: 6, padding: '2px 0' }}>
          <span style={{ fontFamily: MONO, color, fontSize: 10 }}>{Math.round(s.similarity * 100)}%</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.recordId}</span>
        </div>
      ))}
    </div>
  );
}

/** Compact "Citation signals" chips row (66.md P4.3). Each reason is grounded in a
 *  real citation link; skipped entirely when there are none. */
function CitationSignals({ citation }) {
  const reasons = (citation && citation.reasons) || [];
  if (!reasons.length) return null;
  return (
    <div>
      <div style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Citation signals</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {reasons.slice(0, 4).map((r, i) => (
          <Chip key={i} color={/excluded than included/.test(r) ? C.red : C.teal} title={r}>{r}</Chip>
        ))}
      </div>
    </div>
  );
}

/** Named sub-score contributions (label + value) for the "why" breakdown. Only the
 *  signals that actually contributed to this record are shown; `citation` included
 *  when non-null (66.md P4.3). */
const SUBSCORE_LABELS = { classifier: 'Trained model', coldStart: 'Criteria/PICO', semantic: 'Semantic', keyword: 'Keywords', citation: 'Citation graph' };
function SubScoreBreakdown({ subScores }) {
  if (!subScores || typeof subScores !== 'object') return null;
  const rows = Object.keys(SUBSCORE_LABELS)
    .filter(k => typeof subScores[k] === 'number' && Number.isFinite(subScores[k]))
    .map(k => [SUBSCORE_LABELS[k], subScores[k]]);
  if (!rows.length) return null;
  return (
    <div>
      <div style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Signal breakdown</div>
      {rows.map(([label, v]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
          <span style={{ fontSize: 11.5, color: C.txt2, width: 96, flexShrink: 0 }}>{label}</span>
          <span style={{ flex: 1 }}><Bar value={v} color={C.acc} height={5} /></span>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted, width: 34, textAlign: 'right' }}>{pct(v)}</span>
        </div>
      ))}
    </div>
  );
}

function ReasonList({ title, color, reasons }) {
  if (!reasons || !reasons.length) return null;
  return (
    <div>
      <div style={{ fontSize: 10.5, color, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4, fontWeight: 600 }}>{title}</div>
      {reasons.slice(0, 6).map((r, i) => (
        <div key={i} style={{ fontSize: 12, color: C.txt2, display: 'flex', gap: 6, padding: '1px 0', lineHeight: 1.4 }}>
          <span style={{ color, marginTop: 1 }}>•</span><span>{r.text}</span>
        </div>
      ))}
    </div>
  );
}

function PicoMatch({ breakdown }) {
  if (!breakdown || !breakdown.some(d => d.match != null)) return null;
  return (
    <div>
      <div style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>PICO match</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {breakdown.map(d => d.match == null ? null : (
          <Chip key={d.dimension} color={d.match > 0.001 ? C.teal : C.muted} title={(d.matched || []).join(', ')}>
            {d.dimension[0].toUpperCase()} {pct(d.match)}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/** Compact provenance chips (66.md P4.10) — which signals fed this project's scores.
 *  Subtle, one muted row; each part is honest about whether it was actually applied. */
function ProvenanceChips({ ai }) {
  const s = ai?.status;
  const emb = s?.embedding || {};
  const semantic = emb.provider && emb.provider !== 'lexical' && (emb.configured || emb.endpointConfigured);
  const citationAvail = !!s?.latestRun?.metrics?.citation?.available;
  const calMethod = s?.latestRun?.metrics?.calibration?.method;
  const calibrated = calMethod && calMethod !== 'none';
  const parts = ['lexical'];
  if (semantic) parts.push('+semantic (embeddings)');
  if (citationAvail) parts.push('+citation');
  if (calibrated) parts.push('calibrated');
  return (
    <div style={{ fontSize: 10, color: C.muted, fontFamily: MONO, letterSpacing: '.02em' }}>
      Signals: {parts.join(' ')}
    </div>
  );
}

/** Active-learning queue selector + Run control for the list header. */
export function AiQueueBar({ ai, mode, onMode, band, onBand, onRefreshRankings }) {
  if (!ai.enabled) return null;
  // AI-blinding: a non-leader reviewer must not get AI-ordered/filtered worklists
  // (the order leaks the model's opinion). Server enforces this too; leaders exempt.
  if (ai.status?.project?.blindFromAi && !ai.status?.canConfigure) return null;
  const sel = {
    fontFamily: FONT, fontSize: 12, color: C.txt, background: C.card, border: `1px solid ${C.brd}`,
    borderRadius: 6, padding: '5px 7px', cursor: 'pointer',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontFamily: MONO, fontSize: 10, color: C.acc, letterSpacing: '.06em' }}>AI QUEUE</span>
      <select value={mode} onChange={e => onMode(e.target.value)} style={sel} title="Reorder the worklist by AI signal">
        {QUEUE_MODES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
      </select>
      <select value={band || 'all'} onChange={e => onBand(e.target.value)} style={sel} title="Filter loaded records by AI score band">
        <option value="all">All scores</option>
        <option value="very_high">Very high (80+)</option>
        <option value="high">High (60–80)</option>
        <option value="medium">Medium (40–60)</option>
        <option value="low">Low (&lt;40)</option>
        <option value="uncertain">Uncertain band</option>
      </select>
      {ai.status?.canRun && (() => {
        // 62.md — scoring runs in the background; keep the button busy (and prevent a
        // duplicate run) while a job is queued or running, not just during the enqueue.
        const aiBusy = ai.running || ai.jobStatus?.running || ai.jobStatus?.state === 'updating' || ai.jobStatus?.state === 'queued';
        const pct = ai.jobStatus?.total > 0 ? ai.jobStatus.progress : null;
        return (
          <MiniBtn onClick={() => ai.run()} disabled={aiBusy} title="Train on current decisions and re-score all records (runs in the background)">
            {aiBusy ? (pct != null ? `Scoring… ${pct}%` : 'Scoring…') : 'Run AI scoring'}
          </MiniBtn>
        );
      })()}
      {/* se2.md §6 / 62.md — background scoring state + position-preserving refresh */}
      {(ai.jobStatus?.state === 'updating' || (ai.jobStatus?.running)) && (
        <span title={`${ai.jobStatus.pending || 0} new decision(s) being incorporated`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.teal }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.teal, animation: 'sift-fade .8s ease infinite alternate' }} />
          Scores updating{ai.jobStatus?.total > 0 ? ` (${ai.jobStatus.progress}%)` : (ai.jobStatus.pending ? ` (${ai.jobStatus.pending})` : '')}…
        </span>
      )}
      {ai.rankingsAvailable && ai.jobStatus?.state !== 'updating' && (
        <MiniBtn color={C.teal} onClick={() => onRefreshRankings && onRefreshRankings()} title="Apply the freshly-computed rankings (keeps your current record)">
          ↻ Refresh rankings
        </MiniBtn>
      )}
    </div>
  );
}

const numFmt = (x, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—');

function SubHeader({ children }) {
  return <div style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{children}</div>;
}
function KV({ label, value, color, title }) {
  return (
    <div title={title} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
      <span style={{ color: C.muted }}>{label}</span><span style={{ fontFamily: MONO, color: color || C.txt }}>{value}</span>
    </div>
  );
}

/** Reliability diagram (predicted vs observed) — small inline SVG. se2.md §8. */
function ReliabilityCurve({ bins }) {
  const pts = (bins || []).filter(b => b.count > 0 && b.meanPredicted != null && b.observedRate != null);
  if (pts.length < 2) return null;
  const W = 180, H = 120, pad = 18;
  const x = v => pad + v * (W - 2 * pad);
  const y = v => H - pad - v * (H - 2 * pad);
  const maxCount = Math.max(...pts.map(p => p.count));
  return (
    <svg width={W} height={H} role="img" aria-label="Calibration reliability curve" style={{ marginTop: 6 }}>
      <rect x={0} y={0} width={W} height={H} fill={alpha(C.muted, 0.04)} rx={6} />
      {/* ideal diagonal */}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke={alpha(C.muted, 0.5)} strokeDasharray="3 3" />
      {/* observed polyline */}
      <polyline fill="none" stroke={C.acc} strokeWidth={1.5}
        points={pts.map(p => `${x(p.meanPredicted)},${y(p.observedRate)}`).join(' ')} />
      {pts.map((p, i) => (
        <circle key={i} cx={x(p.meanPredicted)} cy={y(p.observedRate)} r={2 + 3 * (p.count / maxCount)} fill={C.acc} fillOpacity={0.8} />
      ))}
      <text x={pad} y={H - 4} fontSize={8} fill={C.muted}>predicted →</text>
      <text x={2} y={pad} fontSize={8} fill={C.muted} transform={`rotate(-90 8,${pad})`}>observed →</text>
    </svg>
  );
}

/** Calibration quality block (leader view). */
function CalibrationBlock({ cal }) {
  if (!cal) return null;
  const m = cal.metrics || {};
  // Metrics are now measured on HELD-OUT predictions (nested CV) — honest, not the
  // optimistic apparent ECE≈0. When the sample is too small for a nested split the
  // engine returns null metrics with a reason; the calibrator is still applied.
  const heldOut = !!(cal.heldOut || m.heldOut);
  const heldOutUncomputed = heldOut && m.ece == null;
  const suffix = heldOut ? ' (held-out)' : '';
  return (
    <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 8 }}>
      <SubHeader>Probability calibration</SubHeader>
      {cal.method === 'none' ? (
        <div style={{ fontSize: 11.5, color: C.gold, lineHeight: 1.5 }}>{cal.reason}</div>
      ) : (
        <>
          <KV label="Method" value={cal.method === 'platt' ? 'Platt scaling' : 'Isotonic regression'} />
          {heldOutUncomputed ? (
            <div style={{ fontSize: 11.5, color: C.gold, lineHeight: 1.5, marginTop: 2 }}>{m.reason || 'Not enough labels for a held-out calibration estimate yet.'}</div>
          ) : (
            <>
              <KV label="Brier score" value={numFmt(m.brier, 3)} title="Mean squared error of the calibrated probabilities (lower is better)." />
              <KV label="Log loss" value={numFmt(m.logLoss, 3)} />
              <KV label={`ECE${suffix}`} value={numFmt(m.ece, 3)} title="Expected calibration error — mean gap between predicted and observed inclusion rate, measured on held-out predictions (nested cross-validation)." color={m.ece > 0.15 ? C.gold : C.txt} />
              <KV label={`Calibration slope${suffix}`} value={numFmt(m.slope, 2)} title="≈1 is well-calibrated; <1 over-confident." />
              <KV label={`Calibration intercept${suffix}`} value={numFmt(m.intercept, 2)} title="≈0 is unbiased." />
              <ReliabilityCurve bins={m.reliability} />
            </>
          )}
          <div style={{ fontSize: 10, color: C.muted, marginTop: 4, lineHeight: 1.4 }}>
            {heldOut
              ? `Calibrator fitted on out-of-fold predictions (${cal.n ?? '—'} labels); ECE/slope measured on held-out predictions via nested cross-validation (honest, not in-sample).`
              : `Fitted on out-of-fold predictions (${cal.n ?? '—'} labels).`}
          </div>
        </>
      )}
    </div>
  );
}

/** Stopping-rule estimate block (leader view). se2.md §9 — cautious by design. */
function StoppingBlock({ stop }) {
  if (!stop) return null;
  const e = stop.estimate || {};
  const headColor = !stop.available ? C.muted : (stop.recommendStop ? C.grn : C.gold);
  return (
    <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 8 }}>
      <SubHeader>Stopping estimate</SubHeader>
      <div style={{ fontSize: 12.5, color: headColor, fontWeight: 600, lineHeight: 1.45, marginBottom: 6 }}>{stop.headline}</div>
      {stop.available ? (
        <>
          <KV label="Target recall" value={pct(stop.targetRecall)} />
          <KV label="Estimated recall" value={e.estimatedRecall != null ? pct(e.estimatedRecall) : '—'} color={C.acc} />
          <KV label="95% interval" value={e.recallLo != null ? `${pct(e.recallLo)} – ${pct(e.recallHi)}` : '—'} title="Judged against the lower bound (conservative)." />
          <KV label="Eligible found" value={e.foundPositives ?? '—'} />
          <KV label="Est. remaining" value={e.estimatedRemainingPositives != null ? `${e.estimatedRemainingPositives.toFixed(1)} (${e.remainingLo?.toFixed(1)}–${e.remainingHi?.toFixed(1)})` : '—'} />
          {stop.recentYield?.yield != null && <KV label="Recent include rate" value={`${pct(stop.recentYield.yield)} of last ${stop.recentYield.window}`} />}
        </>
      ) : (
        <ul style={{ margin: '0 0 6px', paddingLeft: 16, fontSize: 11.5, color: C.gold, lineHeight: 1.5 }}>
          {(stop.preconditions?.reasons || []).map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      {stop.retrospective?.wssAtTarget != null && (
        <KV label="WSS@95 (retrospective)" value={numFmt(stop.retrospective.wssAtTarget, 2)} color={C.teal} title="Work that ranking would have saved at the target recall, on held-out pairs." />
      )}
      {stop.coverage?.capped && (
        <div style={{ fontSize: 10, color: C.gold, marginTop: 4, lineHeight: 1.4 }}>
          Estimate covers the {stop.coverage.scoredRecords} most-recent scored records (project exceeds the per-run cap).
        </div>
      )}
      <div style={{ fontSize: 10, color: C.muted, marginTop: 4, lineHeight: 1.4 }}>{stop.caveat}</div>
    </div>
  );
}

/** Model drift warnings vs the previous version (se2.md §11). */
function DriftWarnings({ drift }) {
  const w = drift?.warnings || [];
  if (!w.length) return null;
  return (
    <div style={{ border: `1px solid ${alpha(C.gold, '55')}`, background: alpha(C.gold, '10'), borderRadius: 8, padding: '8px 11px' }}>
      <div style={{ fontSize: 10.5, color: C.gold, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>⚠ Model drift vs previous version</div>
      {w.map((x, i) => <div key={i} style={{ fontSize: 11.5, color: C.txt2, lineHeight: 1.45 }}>• {x}</div>)}
    </div>
  );
}

/** Model version history + rollback (leader; se2.md §11). */
function ModelHistory({ ai }) {
  const [versions, setVersions] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(() => { ai.getVersions().then(d => setVersions(d?.versions || [])).catch(() => setVersions([])); }, [ai]);
  // Re-fetch only when the active run changes — NOT on every render (load's identity
  // changes each render; including it here would loop via setVersions → re-render).
  useEffect(() => { load(); }, [ai.status?.latestRun?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const doRollback = async (id) => {
    if (busy) return;
    setBusy(id); setErr('');
    try { await ai.rollback(id); load(); } catch (e) { setErr(e.message || 'Rollback failed'); } finally { setBusy(''); }
  };
  if (!versions || versions.length < 2) return null; // nothing to compare/roll back to yet
  return (
    <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 8 }}>
      <SubHeader>Model versions</SubHeader>
      {err && <div style={{ fontSize: 11, color: C.red, marginBottom: 4 }}>{err}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {versions.slice(0, 8).map(v => (
          <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: v.isActive ? C.grn : C.brd2, flexShrink: 0 }} />
            <span style={{ fontFamily: MONO, color: v.isActive ? C.grn : C.muted, width: 52 }}>{v.isActive ? 'active' : v.status}</span>
            <span style={{ color: C.muted, fontFamily: MONO, fontSize: 10 }}>{(v.snapshotHash || v.id).slice(0, 8)}</span>
            <span style={{ color: C.txt2 }}>{v.mode === 'supervised' ? 'trained' : 'cold'}{v.auc != null ? ` · AUC ${v.auc.toFixed(2)}` : ''}{v.wss95 != null ? ` · WSS ${v.wss95.toFixed(2)}` : ''}</span>
            {v.engineConfigLabel && <span title="Engine config version this run was scored under" style={{ color: C.muted, fontSize: 10 }}>{v.engineConfigLabel}</span>}
            {v.trigger === 'rollback' && <Chip color={C.teal}>rollback</Chip>}
            {v.driftWarnings?.length > 0 && <span title={v.driftWarnings.join('\n')} style={{ color: C.gold }}>⚠{v.driftWarnings.length}</span>}
            <span style={{ flex: 1 }} />
            {!v.isActive && v.status === 'completed' && (
              <MiniBtn color={C.teal} disabled={!!busy} onClick={() => doRollback(v.id)}>{busy === v.id ? '…' : 'Roll back'}</MiniBtn>
            )}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 5, lineHeight: 1.4 }}>
        Rollback re-scores current records with the selected version's configuration — it reverts the model config, not the exact past scores (the engine reflects current decisions). Human decisions and prior versions are preserved.
      </div>
    </div>
  );
}

/** Embedding provider + citation-enrichment status (66.md P4.3/P4.10). Sits inside
 *  the model-status area; both signals degrade to nothing when unavailable. */
function ModelSourcesBlock({ ai, embedding, citation, canRun }) {
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [err, setErr] = useState('');
  const emb = embedding || {};
  // hosted provider needs a configured endpoint to actually run; otherwise it silently
  // falls back to the in-process lexical signal — say so honestly.
  const hosted = emb.provider === 'hosted';
  const hostedOk = hosted && !!(emb.configured || emb.endpointConfigured);
  const providerLabel =
    emb.provider === 'hosted' ? 'Hosted embeddings' :
    emb.provider === 'hashing' ? 'Hashing embeddings' : 'Lexical (in-process)';

  const c = citation || null;
  const enriching = busy || ai.citationEnriching;
  const doEnrich = async () => {
    if (enriching) return;
    setBusy(true); setErr('');
    try { await ai.startCitationEnrichment(); setQueued(true); }
    catch (e) { setErr(e.message || 'Could not start enrichment'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 8 }}>
      <SubHeader>Signal sources</SubHeader>
      <KV label="Embeddings" value={providerLabel} title="Semantic similarity signal source. Lexical needs no external service; hosted uses a configured embedding endpoint." />
      {hosted && (
        <div style={{ fontSize: 10.5, color: hostedOk ? C.muted : C.gold, marginTop: 1, lineHeight: 1.4 }}>
          {emb.model ? <span style={{ fontFamily: MONO }}>{emb.model}</span> : null}{emb.model ? ' · ' : ''}
          {hostedOk ? 'configured' : 'not configured — using lexical fallback'}
        </div>
      )}
      {c && (c.totalRecords || 0) > 0 && (
        <>
          <KV
            label="Citation data"
            value={`${c.enriched ?? c.withIdentifier ?? 0} of ${c.totalRecords} enriched (${pct(c.coverage)})`}
            color={(c.coverage || 0) > 0 ? C.teal : C.muted}
            title="Records with fetched citation-graph metadata (from public DOI/PMID lookups). Feeds the citation signal when a run scores."
          />
          {(c.pending || 0) > 0 && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>{c.pending} pending · {c.notFound || 0} not found</div>}
        </>
      )}
      {c && (c.totalRecords || 0) > 0 && canRun && (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <MiniBtn color={C.teal} disabled={enriching} onClick={doEnrich}
            title={c.mailtoConfigured === false ? 'Runs a public citation lookup (no contact email configured — some providers may throttle).' : 'Fetch citation-graph metadata for records with a DOI/PMID (only public identifiers are sent).'}>
            {enriching ? 'Enrichment queued…' : 'Fetch citation data'}
          </MiniBtn>
          {queued && !enriching && <span style={{ fontSize: 11, color: C.teal }}>Queued — scores refresh when it finishes.</span>}
        </div>
      )}
      {err && <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{err}</div>}
    </div>
  );
}

/** Recall-targeted operating point (66.md P4.5). Screening is recall-first: when the
 *  held-out operating point is reliable, predictions use this threshold. */
function OperatingPointBlock({ op, metrics, predictionPolicy }) {
  if (!op) return null;
  const heldOut = !!(metrics?.crossVal?.heldOut);
  const wss95 = metrics?.crossVal?.wss95;
  return (
    <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 8 }}>
      <SubHeader>Operating point</SubHeader>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 12.5, color: C.txt2, fontWeight: 600 }}>Recall-targeted threshold</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: MONO, color: C.acc, fontWeight: 700 }}>{op.threshold != null ? op.threshold.toFixed(2) : '—'}</span>
        {op.preliminary && <Chip color={C.gold} title="Too few held-out labels for a stable estimate — expect this to move as you label more.">Preliminary estimate — label more records</Chip>}
      </div>
      <KV label="Estimated recall" value={op.achievedRecall != null ? `≥ ${pct(op.achievedRecall)} (target ${pct(op.targetRecall)})` : '—'} color={C.acc}
        title="Fraction of eligible records the threshold is estimated to keep, judged on held-out predictions." />
      {op.workSavedFraction != null && <KV label="Work saved at 95% recall" value={pct(op.workSavedFraction)} color={C.teal} />}
      {typeof wss95 === 'number' && <KV label="WSS@95 (held-out)" value={numFmt(wss95, 2)} color={C.teal} title="Work saved over random screening at 95% recall, on held-out predictions." />}
      {op.specificity != null && <KV label="Specificity" value={pct(op.specificity)} />}
      {op.precision != null && <KV label="Precision" value={pct(op.precision)} />}
      <div style={{ fontSize: 10, color: C.muted, marginTop: 4, lineHeight: 1.4 }}>
        {heldOut ? 'Cross-validated (held-out) estimate. ' : ''}
        {predictionPolicy === 'recall_targeted'
          ? 'Predictions use this threshold.'
          : 'Not enough held-out labels — conservative bands in use.'}
      </div>
    </div>
  );
}

/** Representative validation sample (66.md P4.6). Prioritized screening biases
 *  metrics; a seeded random sample yields unbiased estimates. */
function ValidationSampleBlock({ ai, canConfigure, unbiasedCV }) {
  const [data, setData] = useState(undefined);   // undefined = loading, null = none
  const [size, setSize] = useState(100);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    ai.getValidationSample().then(d => setData(d || null)).catch(() => setData(null));
  }, [ai]);
  useEffect(() => { load(); }, [ai.status?.latestRun?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (data === undefined) return null;                 // silent while first fetch is in flight
  const sample = data?.sample || null;
  const source = data?.validationSource || 'none';

  const doGenerate = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try { await ai.createValidationSample({ size: Math.max(10, Number(size) || 100) }); load(); }
    catch (e) { setErr(e.message || 'Could not generate sample'); }
    finally { setBusy(false); }
  };

  const sourceBadge =
    source === 'random' ? <Chip color={C.grn} title="All labeled records come from a random sample — metrics are unbiased.">Unbiased</Chip> :
    source === 'mixed' ? <Chip color={C.gold} title="Some labeled records are from the random sample, some from prioritized screening.">Mixed</Chip> :
    source === 'prioritized' ? <Chip color={C.gold} title="Labels come from prioritized (AI-ordered) screening — metrics may be optimistic.">Prioritized — may be biased</Chip> :
    null;

  return (
    <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>Representative validation</span>
        <span style={{ flex: 1 }} />
        {sourceBadge}
      </div>
      {!sample ? (
        <>
          <div style={{ fontSize: 11.5, color: C.txt2, lineHeight: 1.5 }}>
            Label a random sample first to obtain unbiased model estimates. Metrics from prioritized screening may be biased.
          </div>
          {canConfigure && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <label style={{ fontSize: 11.5, color: C.muted, display: 'flex', alignItems: 'center', gap: 5 }}>
                Size
                <input type="number" min={10} value={size} disabled={busy}
                  onChange={e => setSize(e.target.value)}
                  style={{ width: 62, fontFamily: MONO, fontSize: 12, color: C.txt, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 6px' }} />
              </label>
              <MiniBtn color={C.acc} disabled={busy} onClick={doGenerate}>{busy ? 'Generating…' : 'Generate random sample'}</MiniBtn>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, marginBottom: 3 }}>
            <span>{sample.labeled}/{sample.size} sample records labeled</span>
            <span>{pct(sample.size ? sample.labeled / sample.size : 0)}</span>
          </div>
          <Bar value={sample.size ? sample.labeled / sample.size : 0} color={source === 'random' ? C.grn : C.acc} />
          <div style={{ fontSize: 10, color: C.muted, marginTop: 5, lineHeight: 1.4 }}>
            seed <span style={{ fontFamily: MONO }}>{sample.seed}</span> · {sample.method}
            {sample.createdAt ? ` · ${new Date(sample.createdAt).toLocaleDateString()}` : ''}
            {sample.createdByName ? ` · ${sample.createdByName}` : ''}
          </div>
          {unbiasedCV && (unbiasedCV.auc != null || unbiasedCV.wss95 != null) && (
            <div style={{ marginTop: 6 }}>
              {unbiasedCV.auc != null && <KV label="Unbiased (random-sample) AUC" value={numFmt(unbiasedCV.auc)} color={C.grn} title="AUC cross-validated within the random sample only — free of prioritized-screening bias." />}
              {unbiasedCV.wss95 != null && <KV label="Unbiased (random-sample) WSS@95" value={numFmt(unbiasedCV.wss95, 2)} color={C.grn} />}
            </div>
          )}
        </>
      )}
      {err && <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{err}</div>}
    </div>
  );
}

/** RightColumn section: model status, training summary, validation, policy. */
export function AiStatusPanel({ ai }) {
  const [val, setVal] = useState(null);
  const [citation, setCitation] = useState(null);
  const s = ai.status;

  useEffect(() => {
    let live = true;
    if (s && s.canConfigure) ai.getValidation().then(v => { if (live && v) setVal(v); });
    return () => { live = false; };
  }, [s?.latestRun?.id, s?.canConfigure]); // eslint-disable-line

  // 66.md P4.3 — citation-enrichment coverage. Prefer the fresh dedicated endpoint
  // over status.citation (which can be stale between runs); both fail silently.
  useEffect(() => {
    let live = true;
    if (s && s.enabled) ai.getCitationStatus().then(c => { if (live && c) setCitation(c); });
    return () => { live = false; };
  }, [s?.enabled, s?.latestRun?.id, ai.citationEnriching]); // eslint-disable-line

  if (!ai.ready) return null;
  if (!ai.enabled) return null;

  const run = s?.latestRun;
  const lc = run?.labelCounts || {};
  const m = (val?.metrics) || run?.metrics || {};
  const num = (x, d = 2) => (typeof x === 'number' ? x.toFixed(d) : '—');

  const row = (label, value, color) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
      <span style={{ color: C.muted }}>{label}</span><span style={{ fontFamily: MONO, color: color || C.txt }}>{value}</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Chip color={run?.mode === 'supervised' ? C.grn : C.yel}>{run ? (run.mode === 'supervised' ? 'Trained model' : 'Cold-start') : 'Not run'}</Chip>
        {s?.scoreCount > 0 && <span style={{ fontSize: 11, color: C.muted }}>{s.scoreCount} scored</span>}
        {s?.canConfigure && s?.engineConfig?.activeLabel && (
          <span title="Active screening engine config version" style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}>· {s.engineConfig.activeLabel}</span>
        )}
        <span style={{ flex: 1 }} />
        {s?.canRun && (() => {
          const aiBusy = ai.running || ai.jobStatus?.running || ai.jobStatus?.state === 'updating' || ai.jobStatus?.state === 'queued';
          const pct = ai.jobStatus?.total > 0 ? ai.jobStatus.progress : null;
          return <MiniBtn onClick={() => ai.run()} disabled={aiBusy}>{aiBusy ? (pct != null ? `Scoring… ${pct}%` : 'Scoring…') : 'Run scoring'}</MiniBtn>;
        })()}
      </div>

      {ai.error && <div style={{ fontSize: 11.5, color: C.red }}>{ai.error}</div>}

      {run && (
        <div>
          <div style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Training set</div>
          {row('Includes', lc.include ?? 0, C.grn)}
          {row('Excludes', lc.exclude ?? 0, C.red)}
          {row('Class balance', lc.classBalance != null ? pct(lc.classBalance) : '—')}
          {run.mode !== 'supervised' && <div style={{ fontSize: 11, color: C.gold, marginTop: 4 }}>Add more decisions to train a model (≥10 labels, ≥3 of each class).</div>}
        </div>
      )}

      {run && run.mode === 'supervised' && (() => {
        const cv = m.crossVal && m.crossVal.heldOut ? m.crossVal : null;
        const v = cv || m;                       // prefer honest held-out metrics
        const label = cv ? `Validation (held-out ${cv.k}-fold CV)` : 'Validation (in-sample)';
        const ci = v.ci || {};
        const fmtCI = (c, fmt) => (c && c.lo != null && c.hi != null) ? ` (${fmt(c.lo)}–${fmt(c.hi)})` : '';
        return (
          <div>
            <div style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{label}</div>
            {row('AUC', num(v.auc) + fmtCI(ci.auc, num))}
            {row('Sensitivity', (v.sensitivity != null ? pct(v.sensitivity) : '—') + fmtCI(ci.sensitivity, pct))}
            {row('Specificity', v.specificity != null ? pct(v.specificity) : '—')}
            {row('WSS@95', (v.wss95 != null ? num(v.wss95) : '—') + fmtCI(ci.wss95, num), C.teal)}
            {row('Recall@10', v.recallAt10 != null ? pct(v.recallAt10) : '—')}
            {ci.auc && ci.auc.lo != null && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>95% bootstrap CI in parentheses.</div>}
            {v.sampleWarning?.warn && <div style={{ fontSize: 11, color: C.gold, marginTop: 4, lineHeight: 1.4 }}>{v.sampleWarning.reason}</div>}
            {cv && m.crossVal?.insufficient && <div style={{ fontSize: 11, color: C.gold, marginTop: 4 }}>{m.crossVal.reason}</div>}
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, lineHeight: 1.4 }}>
              {cv ? `Out-of-sample ${cv.k}-fold cross-validation vs human decisions.` : 'Apparent (in-sample) performance vs human decisions. More labels unlock held-out cross-validation.'}
            </div>
          </div>
        );
      })()}

      {/* 66.md P4.3/P4.10 — embedding provider + citation-enrichment status. Visible
          to anyone who can see the panel; the fetch button itself is gated by canRun. */}
      <ModelSourcesBlock ai={ai} embedding={s?.embedding} citation={citation || s?.citation} canRun={!!s?.canRun} />

      {/* 66.md P4.5 — recall-targeted operating point (leader view). */}
      {s?.canConfigure && m.operatingPoint && <OperatingPointBlock op={m.operatingPoint} metrics={m} predictionPolicy={m.predictionPolicy} />}

      {s?.canConfigure && m.drift?.warnings?.length > 0 && <DriftWarnings drift={m.drift} />}
      {s?.canConfigure && m.calibration && <CalibrationBlock cal={m.calibration} />}
      {s?.canConfigure && m.stopping && <StoppingBlock stop={m.stopping} />}

      {/* 66.md P4.6 — representative validation sample + unbiased metrics (leader view). */}
      {s?.canConfigure && <ValidationSampleBlock ai={ai} canConfigure={!!s?.canConfigure} unbiasedCV={m.crossValUnbiased} />}

      {s?.canConfigure && <ModelHistory ai={ai} />}

      {s?.canConfigure && <AiPolicyControls ai={ai} />}

      <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5, borderTop: `1px solid ${C.brd}`, paddingTop: 8 }}>
        AI suggestions are assistive. Every record still requires the project's normal human review — the engine never includes or excludes on its own.
      </div>
    </div>
  );
}

function AiPolicyControls({ ai }) {
  const p = ai.status?.project || {};
  const [busy, setBusy] = useState(false);
  const set = async (patch) => { setBusy(true); try { await ai.updateSettings(patch); } finally { setBusy(false); } };
  const sel = { fontFamily: FONT, fontSize: 12, color: C.txt, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 6, padding: '4px 6px' };

  return (
    <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 8 }}>
      <div style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Project AI policy</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.txt2, marginBottom: 6, cursor: 'pointer' }}>
        <input type="checkbox" checked={!!p.enabled} disabled={busy} onChange={e => set({ enabled: e.target.checked })} />
        AI screening enabled for this project
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.txt2, marginBottom: 6, cursor: 'pointer' }}>
        <input type="checkbox" checked={!!p.blindFromAi} disabled={busy} onChange={e => set({ blindFromAi: e.target.checked })} />
        Hide AI scores until the reviewer decides (independent screening)
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.txt2 }}>
        <span>Policy</span>
        <select value={p.policy || 'assist'} disabled={busy} onChange={e => set({ policy: e.target.value })} style={sel}>
          <option value="assist">Assist (suggest only)</option>
          <option value="prioritize">Prioritize (reorder queue)</option>
        </select>
      </div>
    </div>
  );
}
