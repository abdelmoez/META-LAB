/**
 * features/publicSynthesis/InteractiveForest.jsx — 68.md (P8), rebased onto the
 * shared geometry engine by 117.md §J.11 / §K.7 (closing 116.md §10.4).
 *
 * A SELF-CONTAINED interactive forest plot for the PUBLIC synthesis page. It still
 * imports no workspace chart code and no theme/auth context — a public visitor has
 * neither — but it no longer owns its own GEOMETRY. Coordinates, the visible
 * domain, ticks, truncation flags and the no-effect line all come from
 * `computeForestLayout` (research-engine/charts/forestLayout.js), the same pure,
 * framework-free module the live plot and the publication builder use. This file
 * is a SKIN: it decides colours, ink and interaction, never a coordinate.
 *
 * ── What the rebase FIXES ──────────────────────────────────────────────────
 * The hand-rolled geometry drew a dashed "null" line at stored 0 unconditionally:
 *   • PROP (single-arm proportion) has NO no-effect value — ES_TYPES.PROP.nullVal
 *     is `null` — and stored 0 is logit 0, i.e. 50%. The public page therefore
 *     drew a reference line reading as though half the studies "favoured"
 *     something, on a measure where that sentence is meaningless.
 *   • AUC's no-effect value is 0.5, not 0 (ES_TYPES.AUC.nullVal). The line was
 *     drawn at 0 — a value outside the range of the statistic — and dragged the
 *     domain with it.
 * `ES_TYPES.nullVal`, read through `measureScale`, is now the ONLY authority.
 * The same rebase brings the three other invariants the public page never had:
 * the null is always INSIDE the frame with a margin (never pinned to an edge), a
 * value outside the visible domain gets an explicit truncation arrow instead of
 * being silently squashed onto the frame, and the axis carries measure-aware
 * ticks (clinical 0.5/1/2/5 for ratios, percent ticks through logit for
 * proportions, a 1-2-5 nice step otherwise).
 *
 * ── Two deliberate boundaries ──────────────────────────────────────────────
 * 1. FROZEN PAYLOADS. A published synthesis is a read-only snapshot taken at
 *    publish time and served verbatim for as long as the link lives. This
 *    renderer therefore treats EVERY field as optional and soft-defaults it: a
 *    payload written by an older release (no `weight`, no `method`, no `k`, a
 *    missing bound) must still draw, never throw and never invent a number.
 * 2. NO PROJECT-DEPENDENT CONFIG. `resolveForestFigure` / the persisted
 *    presentation record (117.md §23-§25) stay OUT of this file on purpose: the
 *    forest presentation controls are a WORKSPACE feature and the shipped product
 *    decision is that they do not reach public pages. A public visitor has no
 *    project, and a snapshot must not start re-reading live project settings
 *    years after it was published. The only geometry this file sets is the local
 *    `PUBLIC_METRICS` pack below, which goes through the engine's own bounds table
 *    like any other override.
 *
 * Honesty about scale: ratio measures (OR/RR/HR/…) are pooled on the LOG scale and
 * proportions on the LOGIT scale by the engine, so `es/lo/hi` in the payload are
 * already stored-scale values. Geometry sits on the stored scale (correct) and
 * every DISPLAYED number is back-transformed through the measure's own transform,
 * with a footer note naming the analysis scale so nobody misreads a log CI.
 */
import { useMemo, useState } from 'react';
import { computeForestLayout, measureScale } from '../../research-engine/charts/forestLayout.js';

const ACCENT = '#6d28d9';
const INK = '#1e2233';
const MUTE = '#5b6178';
const LINE = '#d7dae5';
const DIAMOND = '#4c1d95';

/**
 * 117.md §J.11 — the ONLY geometry this page sets, and it still goes through
 * `clampForestMetrics` inside the engine. These two values reproduce the public
 * page's historical proportions (a wide study-label column and roomy 30px rows,
 * which read better at the phone/embed widths a shared link actually gets) on top
 * of the shared metric pack. Everything else — plot width, column sizing, fonts,
 * tick spacing — is the engine's.
 */
const PUBLIC_METRICS = Object.freeze({ nameW: 190, ROW: 30, diamondH: 9 });

/**
 * A number, or NaN. `Number(null)`, `Number('')` and `Number(true)` are all finite,
 * so a bare `Number()` would turn a MISSING bound in an old payload into a real
 * value at 0 — which is exactly where the no-effect line sits for most measures.
 */
function num(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return NaN;
  const s = typeof v === 'string' ? v.trim() : v;
  if (s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Display value for a STORED-scale number, back-transformed through the measure's
 * own transform. Proportions print as percentages; everything else keeps the
 * public page's historical 2 dp / 1 dp rule.
 */
export function formatPublicValue(v, scale) {
  const n = num(v);
  if (!Number.isFinite(n)) return '—';
  const x = scale.backTransform(n);
  if (!Number.isFinite(x)) return '—';
  if (scale.isProp) return `${(x * 100).toFixed(1)}%`;
  const abs = Math.abs(x);
  const dp = abs !== 0 && abs < 1 ? 2 : (abs < 10 ? 2 : 1);
  return x.toFixed(dp);
}

/**
 * adaptPublicOutcome(outcome) — the frozen public payload → the `result` shape
 * `computeForestLayout` reads (116.md §124: values are RENDERED, never recomputed).
 *
 * The payload carries ONE pooled estimate plus `method`, not the workspace's pair
 * of fixed/random fits, so exactly one diamond is produced and it is keyed by the
 * method the snapshot was published with. Per-study rows carry a single `weight`
 * (the random-effects weight `deriveMa` published), which drives the marker area.
 * Exported for tests.
 */
export function adaptPublicOutcome(outcome) {
  const o = outcome && typeof outcome === 'object' ? outcome : {};
  const rows = Array.isArray(o.studies) ? o.studies : [];
  const studies = rows.map((r, i) => {
    const row = r && typeof r === 'object' ? r : {};
    const w = num(row.weight);
    const pct = Number.isFinite(w) ? w : 0;
    return {
      id: i,
      // studyDisplayName() is author + year; the payload publishes ONE label
      // string ("Smith 2019") that is already the display name.
      author: String(row.label == null ? '' : row.label).trim() || 'Study',
      year: '',
      _es: num(row.es), _lo: num(row.lo), _hi: num(row.hi),
      _pct: pct, _wFixedPct: pct, _wRandomPct: pct,
    };
  });
  const es = num(o.es), lo = num(o.lo), hi = num(o.hi);
  const pooled = (Number.isFinite(es) && Number.isFinite(lo) && Number.isFinite(hi))
    ? { es, lo, hi } : null;
  const method = o.method === 'fixed' ? 'fixed' : 'random';
  return {
    studies,
    fixed: method === 'fixed' ? pooled : null,
    random: method === 'fixed' ? null : pooled,
    method,
  };
}

/** The layout for one published outcome, or null when there is nothing to draw. */
export function buildPublicForestLayout(outcome, scale) {
  const sc = scale || measureScale(outcome && outcome.esType);
  return computeForestLayout(adaptPublicOutcome(outcome), {
    variant: 'live',
    esType: sc.esType,
    // A published forest is a compact figure: the counts and weight columns are
    // the workspace's reviewer view, and the weight is already in the tooltip.
    showCounts: false,
    showWeights: false,
    showPI: false,
    metrics: PUBLIC_METRICS,
    // Invariant 5 — the string the engine MEASURES (and sizes the effect column
    // around) is the string printed below.
    formatValue: (v) => formatPublicValue(v, sc),
  });
}

/** A single pooled outcome group rendered as an interactive forest plot. */
export default function InteractiveForest({ outcome }) {
  const [hover, setHover] = useState(null);   // index of the hovered/focused study
  const [selected, setSelected] = useState(null); // clicked study (detail line)

  // 117.md §J.11 — the measure registry is the authority; an unknown/absent
  // esType falls back to the registry's linear default rather than to a guess.
  const scale = useMemo(() => measureScale(outcome && outcome.esType), [outcome]);
  const L = useMemo(() => buildPublicForestLayout(outcome, scale), [outcome, scale]);

  const rows = Array.isArray(outcome && outcome.studies) ? outcome.studies : [];
  const fmt = (v) => formatPublicValue(v, scale);
  const fmtCI = (lo, hi) => `${fmt(lo)} to ${fmt(hi)}`;
  const kNum = num(outcome && outcome.k);
  const pooledLabel = Number.isFinite(kNum) ? `Pooled (k=${kNum})` : 'Pooled';
  const scaleNote = scale.isProp
    ? ' · (analysis scale: logit — displayed values back-transformed to %)'
    : scale.isLog ? ' · (analysis scale: log — displayed values back-transformed)' : '';

  // A frozen payload with no per-study rows still has a pooled estimate worth
  // publishing — say it in text rather than drawing an empty frame.
  if (!L) {
    const es = num(outcome && outcome.es);
    return (
      <div style={{ fontSize: 12.5, color: MUTE, lineHeight: 1.6 }}>
        {Number.isFinite(es)
          ? <>Pooled estimate <strong style={{ color: INK }}>{fmt(outcome.es)}</strong>{' '}
            [95% CI {fmtCI(outcome.lo, outcome.hi)}]{scaleNote}</>
          : 'No pooled result was published for this outcome.'}
      </div>
    );
  }

  const { columns: CO, rowsGeom: RG, metrics: M, ticks, favours, axisLabel } = L;
  const W = L.W, H = L.H;
  const effHead = scale.isProp ? 'Proportion [95% CI]'
    : scale.isLog ? `${scale.esType || 'Effect'} [95% CI]` : 'Estimate [95% CI]';

  /* 116.md §22 (c) — an interval end outside the visible domain gets the
     conventional truncation arrow. It is NEVER silently clamped onto the frame as
     if the confidence interval had stopped there. */
  const endCap = (p, cy, color, key) => (p.off ? null : (p.clamped
    ? <polygon key={key} fill={color}
      points={p.clamped < 0
        ? `${p.x},${cy} ${p.x + 7},${cy - 4} ${p.x + 7},${cy + 4}`
        : `${p.x},${cy} ${p.x - 7},${cy - 4} ${p.x - 7},${cy + 4}`} />
    : <line key={key} x1={p.x} y1={cy - 4} x2={p.x} y2={cy + 4} stroke={color} strokeWidth={1.5} />));
  const favTri = (f) => (
    <polygon fill={MUTE}
      points={`${f.arrowX},${favours.y - 3} ${f.arrowX + f.dir * 6},${favours.y - 6.5} ${f.arrowX + f.dir * 6},${favours.y + 0.5}`} />
  );

  const detail = selected != null && L.rows[selected] ? L.rows[selected] : null;
  const weightOf = (i) => num(rows[i] && rows[i].weight);

  return (
    <div style={{ position: 'relative', overflowX: 'auto' }}>
      <svg
        role="img"
        aria-label={`Forest plot for ${(outcome && outcome.outcome) || 'the primary outcome'}`}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxWidth: W, fontFamily: 'inherit', display: 'block' }}
      >
        {/* header row */}
        <text x={CO.xName} y={RG.headBottom - 6} fontSize={M.headMainSize} fontWeight={700} fill={MUTE}>Study</text>
        {/* the effect column header prints at its COLUMN's own size (cellSize),
            matching the live plot — the layout measured that column against the
            cell strings, so a bigger header would be the one thing that can
            overrun a width nothing measured. */}
        <text x={CO.xEff} y={RG.headBottom - 6} fontSize={M.cellSize} fontWeight={700} fill={MUTE}>{effHead}</text>

        {/* no-effect reference line — drawn ONLY when the measure HAS one
            (ES_TYPES.nullVal; PROP has none) and always inside the frame. */}
        {L.nullLine.show && (
          <line x1={L.nullLine.x} y1={RG.headBottom - 4} x2={L.nullLine.x} y2={RG.yPI + 8}
            stroke={LINE} strokeWidth={1} strokeDasharray="3 3" />
        )}

        {L.rows.map((r, i) => {
          const cy = r.markerY;
          const sq = r.size;
          const active = hover === i || selected === i;
          return (
            <g key={r.id}
              tabIndex={0}
              role="button"
              aria-label={`${r.nameFull}: ${fmt(r.es.v)} (95% CI ${fmtCI(r.lo.v, r.hi.v)})`}
              style={{ cursor: 'pointer', outline: 'none' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => setSelected(selected === i ? null : i)}
            >
              {/* full-width hover target */}
              <rect x={0} y={cy - RG.ROW / 2} width={W} height={RG.ROW}
                fill={active ? 'rgba(109,40,217,0.06)' : 'transparent'} />
              <text x={CO.xName} y={r.y} fontSize={M.nameSize} fill={INK}
                fontWeight={active ? 700 : 500}>{r.name}</text>
              {/* CI whisker + explicit out-of-scale arrows */}
              {!r.lo.off && !r.hi.off && (
                <line x1={r.lo.x} y1={cy} x2={r.hi.x} y2={cy}
                  stroke={active ? ACCENT : MUTE} strokeWidth={active ? 2 : 1.5} />
              )}
              {endCap(r.lo, cy, active ? ACCENT : MUTE, 'lo')}
              {endCap(r.hi, cy, active ? ACCENT : MUTE, 'hi')}
              {/* point estimate, sized by weight; a triangle when it is off-scale */}
              {!r.es.off && (r.es.clamped
                ? <polygon fill={active ? ACCENT : INK}
                  points={r.es.clamped < 0
                    ? `${r.es.x},${cy} ${r.es.x + sq},${cy - sq / 2} ${r.es.x + sq},${cy + sq / 2}`
                    : `${r.es.x},${cy} ${r.es.x - sq},${cy - sq / 2} ${r.es.x - sq},${cy + sq / 2}`} />
                : <rect x={r.es.x - sq / 2} y={cy - sq / 2} width={sq} height={sq}
                  fill={active ? ACCENT : INK} rx={1.5} />)}
              {/* numeric column */}
              <text x={CO.xEff} y={r.y} fontSize={M.cellSize} fill={MUTE} fontFamily="ui-monospace, monospace">
                {r.esText}
              </text>
            </g>
          );
        })}

        {/* pooled diamond — the payload publishes ONE estimate, labelled here. */}
        {L.diamonds.map((d) => (
          <g key={d.key} aria-label={`Pooled estimate ${fmt(d.value.es)} (95% CI ${fmtCI(d.value.lo, d.value.hi)})`}>
            <polygon fill={DIAMOND} stroke={DIAMOND}
              points={`${d.lo.x},${d.markerY} ${d.es.x},${d.markerY - d.height} ${d.hi.x},${d.markerY} ${d.es.x},${d.markerY + d.height}`} />
            <text x={CO.xName} y={d.y} fontSize={M.nameSize} fontWeight={800} fill={DIAMOND}>{pooledLabel}</text>
            <text x={CO.xEff} y={d.y} fontSize={M.cellSize} fontWeight={700} fill={DIAMOND} fontFamily="ui-monospace, monospace">
              {d.esText}
            </text>
          </g>
        ))}

        {/* x-axis with measure-aware, de-collided ticks (the public page had none:
            a forest plot with no axis cannot be read off) */}
        <line x1={CO.xPlot} y1={RG.axisY} x2={CO.xPlotEnd} y2={RG.axisY} stroke={MUTE} strokeWidth={1} />
        {ticks.map((t) => (
          <g key={`tk${t.v}`}>
            <line x1={t.x} y1={RG.axisY} x2={t.x} y2={RG.axisY + 4} stroke={MUTE} strokeWidth={0.9} />
            <text x={t.x} y={RG.tickLabelY} textAnchor="middle" fontSize={M.tickSize} fill={MUTE}>{t.label}</text>
          </g>
        ))}
        {/* favours labels — direction-descriptive only, and suppressed entirely for
            a measure with no no-effect value (there is no direction to state). */}
        {favours.show && (
          <g>
            {favTri(favours.low)}
            <text x={favours.low.x} y={favours.y} textAnchor={favours.low.anchor} fontSize={M.favSize} fill={MUTE}>{favours.low.text}</text>
            {favTri(favours.high)}
            <text x={favours.high.x} y={favours.y} textAnchor={favours.high.anchor} fontSize={M.favSize} fill={MUTE}>{favours.high.text}</text>
          </g>
        )}
        <text x={CO.xPlot + CO.plotW / 2} y={RG.axisLabelY} textAnchor="middle"
          fontSize={M.axisLabelSize} fill={INK} fontWeight={700}>{axisLabel}</text>
      </svg>

      {/* Hover tooltip (SSR-safe: rendered in-flow only when hover is set) */}
      {hover != null && L.rows[hover] && (
        <div style={{
          position: 'absolute', top: 4, right: 4, maxWidth: 260, zIndex: 2,
          background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8,
          padding: '8px 10px', boxShadow: '0 4px 14px rgba(20,20,40,0.12)',
          fontSize: 12, color: INK, pointerEvents: 'none',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>{L.rows[hover].nameFull}</div>
          <div>{fmt(L.rows[hover].es.v)} [95% CI {fmtCI(L.rows[hover].lo.v, L.rows[hover].hi.v)}]</div>
          {Number.isFinite(weightOf(hover)) && (
            <div style={{ color: MUTE, marginTop: 2 }}>Weight {weightOf(hover).toFixed(1)}%</div>
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
          <strong>{detail.nameFull}</strong>: {fmt(detail.es.v)}{' '}
          [95% CI {fmtCI(detail.lo.v, detail.hi.v)}]
          {Number.isFinite(weightOf(selected)) ? ` · weight ${weightOf(selected).toFixed(1)}%` : ''}
        </div>
      )}

      {/* Method / heterogeneity footer with the honest scale note */}
      <div style={{ marginTop: 8, fontSize: 12, color: MUTE, lineHeight: 1.5 }}>
        {Number.isFinite(num(outcome && outcome.i2)) && <>I² = <strong style={{ color: INK }}>{outcome.i2}%</strong> · </>}
        {outcome && outcome.method ? <>{outcome.method} model · </> : null}
        k = {Number.isFinite(kNum) ? kNum : L.k}
        {scaleNote ? <span>{scaleNote}</span> : null}
      </div>
    </div>
  );
}
