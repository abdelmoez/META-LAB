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
              <ReasonList title="Reasons to include" color={C.grn} reasons={e.reasonsInclude} />
              <ReasonList title="Reasons to exclude" color={C.red} reasons={e.reasonsExclude} />
              <PicoMatch breakdown={e.picoBreakdown} />
              {e.similar?.length > 0 && (
                <div>
                  <div style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Similar included records</div>
                  {e.similar.map(s => (
                    <div key={s.recordId} style={{ fontSize: 12, color: C.txt2, display: 'flex', gap: 6, padding: '2px 0' }}>
                      <span style={{ fontFamily: MONO, color: C.teal, fontSize: 10 }}>{Math.round(s.similarity * 100)}%</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.recordId}</span>
                    </div>
                  ))}
                </div>
              )}
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
            <span style={{ color: C.txt2 }}>{v.mode === 'supervised' ? 'trained' : 'cold'}{v.auc != null ? ` · AUC ${v.auc.toFixed(2)}` : ''}</span>
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

/** RightColumn section: model status, training summary, validation, policy. */
export function AiStatusPanel({ ai }) {
  const [val, setVal] = useState(null);
  const s = ai.status;

  useEffect(() => {
    let live = true;
    if (s && s.canConfigure) ai.getValidation().then(v => { if (live && v) setVal(v); });
    return () => { live = false; };
  }, [s?.latestRun?.id, s?.canConfigure]); // eslint-disable-line

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

      {s?.canConfigure && m.drift?.warnings?.length > 0 && <DriftWarnings drift={m.drift} />}
      {s?.canConfigure && m.calibration && <CalibrationBlock cal={m.calibration} />}
      {s?.canConfigure && m.stopping && <StoppingBlock stop={m.stopping} />}
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
