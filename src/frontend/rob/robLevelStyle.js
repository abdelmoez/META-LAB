/**
 * robLevelStyle.js — the ADAPTER between the outputs surface and the RoB
 * judgement palette (115.md decision 11).
 *
 * `judgmentStyle.js` is the owner of the palette. Since W2-A it exposes a
 * SCALE-AWARE resolver — `judgmentStyleOn(scale, value)` over four named scales:
 *
 *   'rob'         low / some / moderate / high / serious / critical / unclear / ni
 *   'concern'     applicability concerns — low / high / unclear
 *   'confidence'  AMSTAR 2 — high / moderate / low / critically-low (HIGH IS GOOD)
 *   'decision'    JBI — include / exclude / seek-further-info
 *
 * The summary/comparison components speak in AXES, because that is what the
 * instrument definitions declare (`domain.applicability.axis`,
 * `instrument.overall.axis`). This file is the one place the two vocabularies
 * meet, so the outputs surface and the assessment renderer can never drift into
 * two different colours for the same judgement.
 *
 * WHY THE MAPPING MATTERS: AMSTAR 2's `high` is the BEST rating (high confidence
 * in the review), while a risk scale's `high` is the WORST. Resolving a level
 * without its scale would paint a well-conducted review in the "high risk of
 * bias" red. Passing the axis through is what prevents that, and it is pinned by
 * tests/unit/robSummaryOutputs.test.jsx.
 *
 * The local FALLBACK map exists only so these components still render if the
 * scale-aware export is unavailable; it is never the preferred path.
 */
import { C, alpha } from '../theme/tokens.js';
import { JUDGMENT_STYLE, judgmentStyleOn } from './judgmentStyle.js';

/** axis (instrument definitions) → scale (judgmentStyle.js). */
export const SCALE_FOR_AXIS = Object.freeze({
  rob: 'rob',
  applicability: 'concern',
  concern: 'concern',
  confidence: 'confidence',
  'appraisal-decision': 'decision',
  decision: 'decision',
});

/** True for the two scales whose levels carry risk severity (and so a symbol). */
export function isSeverityScale(axis) {
  const scale = SCALE_FOR_AXIS[axis] || 'rob';
  return scale === 'rob' || scale === 'concern';
}

/** The "nothing recorded" chip. */
export const NOT_RECORDED = Object.freeze({ ...JUDGMENT_STYLE.na, label: 'Not recorded', short: '—' });

/** Minimal fallback, used only when judgmentStyle.js exposes no scale resolver. */
const FALLBACK = {
  rob: { ...JUDGMENT_STYLE, unclear: { label: 'Unclear', short: 'Unclear', icon: 'info', hex: '#56b4e9', fg: C.teal, bg: alpha(C.teal, 0.14) } },
  concern: {
    low: { label: 'Low concern', short: 'Low', icon: 'circleCheck', hex: '#009e73', fg: C.grn, bg: alpha(C.grn, 0.14) },
    high: { label: 'High concern', short: 'High', icon: 'alertOctagon', hex: '#d55e00', fg: C.red, bg: alpha(C.red, 0.14) },
    unclear: { label: 'Unclear concern', short: 'Unclear', icon: 'info', hex: '#56b4e9', fg: C.teal, bg: alpha(C.teal, 0.14) },
  },
  confidence: {
    high: { label: 'High confidence', short: 'High', icon: 'circleCheck', hex: '#009e73', fg: C.grn, bg: alpha(C.grn, 0.14) },
    moderate: { label: 'Moderate confidence', short: 'Moderate', icon: 'checkSquare', hex: '#0072b2', fg: C.teal, bg: alpha(C.teal, 0.14) },
    low: { label: 'Low confidence', short: 'Low', icon: 'alertTriangle', hex: '#e69f00', fg: C.yel, bg: alpha(C.yel, 0.14) },
    'critically-low': { label: 'Critically low confidence', short: 'Critically low', icon: 'alertOctagon', hex: '#d55e00', fg: C.red, bg: alpha(C.red, 0.14) },
  },
  decision: {
    include: { label: 'Include', short: 'Include', icon: 'circleCheck', hex: '#009e73', fg: C.grn, bg: alpha(C.grn, 0.14) },
    exclude: { label: 'Exclude', short: 'Exclude', icon: 'x', hex: '#d55e00', fg: C.red, bg: alpha(C.red, 0.14) },
    'seek-further-info': { label: 'Seek further info', short: 'Seek', icon: 'alert', hex: '#e69f00', fg: C.yel, bg: alpha(C.yel, 0.14) },
  },
};

/**
 * Resolve a level to its chip style ON ITS OWN AXIS.
 *
 * @param {string} level  the stored value ('low', 'critically-low', 'include', …)
 * @param {{ axis?: string }} [opts]  the instrument's axis for this column
 */
export function levelStyle(level, { axis = 'rob' } = {}) {
  const value = String(level == null ? '' : level);
  if (!value) return NOT_RECORDED;
  const scale = SCALE_FOR_AXIS[axis] || 'rob';
  if (typeof judgmentStyleOn === 'function') {
    const st = judgmentStyleOn(scale, value);
    // The palette answers `na` for a value it does not know; keep the raw value
    // visible rather than silently reporting "Not assessed" for real data.
    if (st && st !== JUDGMENT_STYLE.na) return st;
  }
  const map = FALLBACK[scale] || FALLBACK.rob;
  return map[value] || { ...NOT_RECORDED, label: value, short: value };
}

/** Legend rows for a column's own level list, in the instrument's order. */
export function levelLegend(levels = [], opts = {}) {
  return (Array.isArray(levels) ? levels : []).map(level => ({ level, ...levelStyle(level, opts) }));
}

/**
 * The redundant, colour-free symbol for a SEVERITY level (mirrors
 * RobTrafficLight's set so the table and the plot read identically). Empty for
 * the confidence and decision scales, whose levels are not severities — those
 * chips carry their icon + full label instead.
 */
export const LEVEL_SYMBOL = Object.freeze({
  low: '+', some: '!', high: '×', moderate: '-', serious: '!', critical: '×',
  unclear: '?', ni: '?', na: '?',
});

export function levelSymbol(level, { axis = 'rob' } = {}) {
  if (!isSeverityScale(axis)) return '';
  return LEVEL_SYMBOL[String(level || '')] || '?';
}

export default { SCALE_FOR_AXIS, isSeverityScale, NOT_RECORDED, levelStyle, levelLegend, levelSymbol, LEVEL_SYMBOL };
