/**
 * EligibilityValidationPanel.jsx — how the Criteria Screener's suggestions compare
 * against reviewers' recorded decisions (leader view, optional-open).
 *
 * Recall / precision / specificity / accuracy + a 2×2 confusion matrix + a
 * per-criterion agreement table, plus an "Export CSV" download (hits ?format=csv).
 * Mirrors how the AI validation block is shown; honest, no invented calibration.
 * NO user-facing "AI".
 *
 * Container loads via the hook; ValidationMetricsView is a pure, SSR-safe view.
 */
import { useState, useEffect } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { Spinner } from '../ui/components.jsx';

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const num = (x, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—');

// Below this many decided records the metrics are too small to be stable, so we
// label them preliminary instead of presenting them as a settled baseline.
const PRELIM_MIN = 30;

function Metric({ label, value, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '9px 11px' }}>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: MONO, color: color || C.txt, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
    </div>
  );
}

function ConfusionCell({ label, value, color }) {
  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 6, padding: '7px 9px', textAlign: 'center', background: alpha(color || C.muted, 0.08) }}>
      <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: color || C.txt }}>{value ?? 0}</div>
      <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
}

/** Pure, SSR-safe metrics view. */
export function ValidationMetricsView({ metrics, csvUrl }) {
  if (!metrics) {
    return <div style={{ fontSize: 12, color: C.muted, fontFamily: FONT }}>No validation available yet.</div>;
  }
  if (!metrics.n) {
    return (
      <div style={{ fontSize: 12, color: C.muted, fontFamily: FONT, lineHeight: 1.5 }}>
        Not enough reviewer decisions yet to compare against — record some include/exclude decisions first.
      </div>
    );
  }
  const cm = metrics.confusionMatrix || {};
  const per = Array.isArray(metrics.perCriterion) ? metrics.perCriterion : [];
  const preliminary = metrics.n < PRELIM_MIN;
  return (
    <div style={{ fontFamily: FONT, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {preliminary && (
        <div style={{
          fontSize: 11, color: C.txt2, fontFamily: FONT, lineHeight: 1.5,
          background: alpha(C.yel, 0.09), border: `1px solid ${alpha(C.yel, 0.4)}`,
          borderRadius: 8, padding: '8px 11px',
        }}>
          <strong style={{ color: C.txt }}>Preliminary</strong> — based on only {metrics.n} decided
          record{metrics.n === 1 ? '' : 's'}. Record about {PRELIM_MIN - metrics.n} more include/exclude
          decision{PRELIM_MIN - metrics.n === 1 ? '' : 's'} for a more stable comparison.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{metrics.n} decided record{metrics.n === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        {csvUrl && (
          <a href={csvUrl} download style={{
            fontSize: 11.5, fontFamily: FONT, color: C.acc, textDecoration: 'none',
            border: `1px solid ${alpha(C.acc, 0.45)}`, borderRadius: 6, padding: '5px 11px',
          }}>Export CSV</a>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Metric label="Recall" value={pct(metrics.recall)} color={C.grn} />
        <Metric label="Precision" value={pct(metrics.precision)} color={C.acc} />
        <Metric label="Specificity" value={pct(metrics.specificity)} />
        <Metric label="Accuracy" value={pct(metrics.accuracy)} />
      </div>
      {metrics.auc != null && (
        <div style={{ fontSize: 11.5, color: C.muted, fontFamily: MONO }}>AUC {num(metrics.auc)} · threshold {num(metrics.threshold)}</div>
      )}

      <div>
        <div style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Confusion matrix</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <ConfusionCell label="True include (TP)" value={cm.tp} color={C.grn} />
          <ConfusionCell label="False include (FP)" value={cm.fp} color={C.yel} />
          <ConfusionCell label="Missed include (FN)" value={cm.fn} color={C.red} />
          <ConfusionCell label="True exclude (TN)" value={cm.tn} color={C.teal} />
        </div>
      </div>

      {per.length > 0 && (
        <div>
          <div style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Per-criterion agreement</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {per.map((p, i) => (
              <div key={p.key || i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                <span style={{ flex: 1, minWidth: 0, color: C.txt2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.key}>
                  {p.key}{p.category ? ` · ${p.category}` : ''}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 10, color: p.kind === 'exclude' ? C.red : C.grn }}>{p.kind}</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted, width: 40, textAlign: 'right' }}>{p.decisive}/{p.n}</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: p.agreement == null ? C.muted : (p.agreement >= 0.7 ? C.grn : C.yel), width: 44, textAlign: 'right' }}>
                  {p.agreement == null ? '—' : pct(p.agreement)}
                </span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 9.5, color: C.muted, marginTop: 6, lineHeight: 1.4 }}>
            Agreement = share of confident (decisive) answers that match reviewer decisions.
          </div>
        </div>
      )}
    </div>
  );
}

/** Container — loads validation from the hook on mount (leader-gated server-side). */
export default function EligibilityValidationPanel({ elig }) {
  const [metrics, setMetrics] = useState(undefined); // undefined = loading
  useEffect(() => {
    let live = true;
    elig.getValidation().then(m => { if (live) setMetrics(m); });
    return () => { live = false; };
  }, [elig]);

  if (metrics === undefined) {
    return <div style={{ padding: 16, textAlign: 'center' }}><Spinner size={16} /></div>;
  }
  return <ValidationMetricsView metrics={metrics} csvUrl={elig.validationCsvUrl} />;
}
