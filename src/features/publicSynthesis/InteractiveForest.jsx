/**
 * features/publicSynthesis/InteractiveForest.jsx — 68.md (P8). A SELF-CONTAINED
 * interactive forest plot for the PUBLIC synthesis page. Deliberately does NOT
 * import any workspace chart code: a public visitor has no auth/theme context, so
 * everything here is plain inline-styled SVG + a couple of local hooks.
 *
 * Honesty about scale: ratio measures (OR/RR/HR) are pooled on the LOG scale by the
 * engine, so `es/lo/hi` in the payload are already log-space values. We plot on the
 * log axis (correct geometry) but DISPLAY back-transformed values via Math.exp, and
 * label the axis '(analysis scale: log)' so nobody misreads a log CI as a raw one.
 * The null line sits at log(1)=0 for ratios and at 0 for mean-difference measures.
 */
import { useMemo, useState } from 'react';

const ACCENT = '#6d28d9';
const INK = '#1e2233';
const MUTE = '#5b6178';
const LINE = '#d7dae5';
const DIAMOND = '#4c1d95';

const RATIO_TYPES = new Set(['OR', 'RR', 'HR', 'IRR', 'or', 'rr', 'hr']);

/** Is this a ratio measure (pooled on the log scale)? */
function isRatio(esType) {
  return RATIO_TYPES.has(String(esType || '').trim());
}

/** Display value: back-transform ratio measures out of log space; round to 2 dp. */
function fmtDisplay(v, ratio) {
  if (v == null || !Number.isFinite(v)) return '—';
  const x = ratio ? Math.exp(v) : v;
  if (!Number.isFinite(x)) return '—';
  const abs = Math.abs(x);
  const dp = abs !== 0 && abs < 1 ? 2 : (abs < 10 ? 2 : 1);
  return x.toFixed(dp);
}

function fmtCI(lo, hi, ratio) {
  return `${fmtDisplay(lo, ratio)} to ${fmtDisplay(hi, ratio)}`;
}

/** A single pooled outcome group rendered as an interactive forest plot. */
export default function InteractiveForest({ outcome }) {
  const [hover, setHover] = useState(null);   // index of the hovered/focused study
  const [selected, setSelected] = useState(null); // clicked study (detail line)

  const ratio = isRatio(outcome && outcome.esType);
  const nullValue = ratio ? 0 : 0; // log(1)=0 for ratios; 0 for mean differences

  const rows = Array.isArray(outcome && outcome.studies) ? outcome.studies : [];

  // Axis domain across every study CI + the pooled diamond + the null line.
  const domain = useMemo(() => {
    const xs = [];
    for (const r of rows) {
      if (Number.isFinite(r.lo)) xs.push(r.lo);
      if (Number.isFinite(r.hi)) xs.push(r.hi);
      if (Number.isFinite(r.es)) xs.push(r.es);
    }
    if (Number.isFinite(outcome.lo)) xs.push(outcome.lo);
    if (Number.isFinite(outcome.hi)) xs.push(outcome.hi);
    xs.push(nullValue);
    if (!xs.length) return [-1, 1];
    let min = Math.min(...xs);
    let max = Math.max(...xs);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.08 || 0.5;
    return [min - pad, max + pad];
  }, [rows, outcome, nullValue]);

  // Layout geometry.
  const width = 640;
  const labelW = 190;
  const plotL = labelW;
  const plotR = width - 96;      // right gutter reserved for the numeric column
  const rowH = 30;
  const headH = 26;
  const topPad = 8;
  const diamondH = 34;
  const plotW = plotR - plotL;

  const xScale = (v) => {
    const [d0, d1] = domain;
    if (!Number.isFinite(v)) return plotL;
    return plotL + ((v - d0) / (d1 - d0)) * plotW;
  };

  const height = topPad + headH + rows.length * rowH + diamondH + 16;
  const nullX = xScale(nullValue);

  // Square size ∝ weight (bounded so a dominant study never swamps the plot).
  const maxW = Math.max(1, ...rows.map((r) => (Number.isFinite(r.weight) ? r.weight : 0)));
  const sqSize = (w) => {
    const t = maxW > 0 && Number.isFinite(w) ? w / maxW : 0.3;
    return 6 + Math.sqrt(Math.max(0, t)) * 10; // 6..16 px
  };

  const detail = selected != null && rows[selected] ? rows[selected] : null;

  return (
    <div style={{ position: 'relative', overflowX: 'auto' }}>
      <svg
        role="img"
        aria-label={`Forest plot for ${outcome.outcome || 'the primary outcome'}`}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ maxWidth: width, fontFamily: 'inherit', display: 'block' }}
      >
        {/* header row */}
        <text x={8} y={topPad + 15} fontSize={11} fontWeight={700} fill={MUTE}>Study</text>
        <text x={plotR + 8} y={topPad + 15} fontSize={11} fontWeight={700} fill={MUTE}>
          {ratio ? `${outcome.esType || 'Estimate'} [95% CI]` : 'Estimate [95% CI]'}
        </text>

        {/* null reference line */}
        <line x1={nullX} y1={topPad + headH - 4} x2={nullX} y2={height - diamondH - 6}
          stroke={LINE} strokeWidth={1} strokeDasharray="3 3" />

        {rows.map((r, i) => {
          const y = topPad + headH + i * rowH + rowH / 2;
          const cx = xScale(r.es);
          const x1 = xScale(r.lo);
          const x2 = xScale(r.hi);
          const s = sqSize(r.weight);
          const active = hover === i || selected === i;
          return (
            <g key={i}
              tabIndex={0}
              role="button"
              aria-label={`${r.label}: ${fmtDisplay(r.es, ratio)} (95% CI ${fmtCI(r.lo, r.hi, ratio)})`}
              style={{ cursor: 'pointer', outline: 'none' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => setSelected(selected === i ? null : i)}
            >
              {/* full-width hover target */}
              <rect x={0} y={y - rowH / 2} width={width} height={rowH}
                fill={active ? 'rgba(109,40,217,0.06)' : 'transparent'} />
              <text x={8} y={y + 4} fontSize={12} fill={INK}
                fontWeight={active ? 700 : 500}>{truncate(r.label, 26)}</text>
              {/* CI whisker */}
              {Number.isFinite(r.lo) && Number.isFinite(r.hi) && (
                <line x1={x1} y1={y} x2={x2} y2={y} stroke={active ? ACCENT : MUTE} strokeWidth={active ? 2 : 1.5} />
              )}
              {/* point estimate square, sized by weight */}
              {Number.isFinite(r.es) && (
                <rect x={cx - s / 2} y={y - s / 2} width={s} height={s}
                  fill={active ? ACCENT : INK} rx={1.5} />
              )}
              {/* numeric column */}
              <text x={plotR + 8} y={y + 4} fontSize={11} fill={MUTE} fontFamily="ui-monospace, monospace">
                {fmtDisplay(r.es, ratio)} [{fmtCI(r.lo, r.hi, ratio)}]
              </text>
            </g>
          );
        })}

        {/* pooled diamond */}
        {Number.isFinite(outcome.es) && Number.isFinite(outcome.lo) && Number.isFinite(outcome.hi) && (() => {
          const yb = topPad + headH + rows.length * rowH + diamondH / 2 + 2;
          const xc = xScale(outcome.es);
          const xl = xScale(outcome.lo);
          const xr = xScale(outcome.hi);
          const h = 9;
          return (
            <g aria-label={`Pooled estimate ${fmtDisplay(outcome.es, ratio)} (95% CI ${fmtCI(outcome.lo, outcome.hi, ratio)})`}>
              <polygon points={`${xl},${yb} ${xc},${yb - h} ${xr},${yb} ${xc},${yb + h}`}
                fill={DIAMOND} stroke={DIAMOND} />
              <text x={8} y={yb + 4} fontSize={12} fontWeight={800} fill={DIAMOND}>Pooled (k={outcome.k})</text>
              <text x={plotR + 8} y={yb + 4} fontSize={11} fontWeight={700} fill={DIAMOND} fontFamily="ui-monospace, monospace">
                {fmtDisplay(outcome.es, ratio)} [{fmtCI(outcome.lo, outcome.hi, ratio)}]
              </text>
            </g>
          );
        })()}
      </svg>

      {/* Hover tooltip (SSR-safe: rendered in-flow only when hover is set) */}
      {hover != null && rows[hover] && (
        <div style={{
          position: 'absolute', top: 4, right: 4, maxWidth: 260, zIndex: 2,
          background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8,
          padding: '8px 10px', boxShadow: '0 4px 14px rgba(20,20,40,0.12)',
          fontSize: 12, color: INK, pointerEvents: 'none',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>{rows[hover].label}</div>
          <div>{fmtDisplay(rows[hover].es, ratio)} [95% CI {fmtCI(rows[hover].lo, rows[hover].hi, ratio)}]</div>
          {Number.isFinite(rows[hover].weight) && (
            <div style={{ color: MUTE, marginTop: 2 }}>Weight {rows[hover].weight.toFixed(1)}%</div>
          )}
        </div>
      )}

      {/* Clicked-study detail line */}
      {detail && (
        <div style={{
          marginTop: 6, fontSize: 12.5, color: INK,
          background: 'rgba(109,40,217,0.06)', border: `1px solid ${LINE}`,
          borderRadius: 8, padding: '7px 11px',
        }}>
          <strong>{detail.label}</strong>: {fmtDisplay(detail.es, ratio)}{' '}
          [95% CI {fmtCI(detail.lo, detail.hi, ratio)}]
          {Number.isFinite(detail.weight) ? ` · weight ${detail.weight.toFixed(1)}%` : ''}
        </div>
      )}

      {/* Method / heterogeneity footer with the honest scale note */}
      <div style={{ marginTop: 8, fontSize: 12, color: MUTE, lineHeight: 1.5 }}>
        {Number.isFinite(outcome.i2) && <>I² = <strong style={{ color: INK }}>{outcome.i2}%</strong> · </>}
        {outcome.method ? <>{outcome.method} model · </> : null}
        k = {outcome.k}
        {ratio && <span> · (analysis scale: log — displayed values back-transformed)</span>}
      </div>
    </div>
  );
}

function truncate(s, n) {
  const str = String(s == null ? '' : s);
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}
