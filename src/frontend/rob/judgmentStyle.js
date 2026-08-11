/**
 * judgmentStyle.js — the RoB judgement visual language (rob.md §6.2).
 *
 * Color-blind-safe + REDUNDANT encoding: every judgement is shown as colour +
 * icon + text label, NEVER colour alone.
 *
 *   RoB 2 (3-level):      low = teal/green · some = amber · high = red
 *   ROBINS-I (5-level):   low · moderate · serious · critical · ni (No information)
 *   na = neutral gray (Not assessed — used by BOTH instruments for an
 *        unanswered/incomplete domain).
 *
 * P14 — the map now covers ROBINS-I's `moderate` / `serious` / `critical` / `ni`
 * levels IN ADDITION to RoB 2's `low` / `some` / `high` (kept byte-identical). The
 * two instruments never mix levels in one plot, so re-using the amber/vermillion
 * hues across analogous levels (some↔moderate, high↔serious) is intentional; the
 * distinct LABELS + the traffic-light SYMBOLS keep them unambiguous, and `critical`
 * escalates to a darker vermillion beyond `serious`.
 *
 * Two colour channels, by use:
 *   · `hex` — ABSOLUTE Okabe–Ito hex (no CSS vars). Used by the SVG/PNG export
 *     (RobTrafficLight) which the canvas rasteriser renders OFF the DOM, so it
 *     cannot resolve `var(--t-*)`. Never change these to tokens.
 *   · `fg` / `bg` — THEME-AWARE on-screen pill foreground/background (token-based,
 *     `var(--t-*)`). 56.md §10: these now flip with the active theme so the RoB
 *     judgement pills harmonise in BOTH the legacy night theme and the Stitch
 *     light/dark themes instead of staying fixed light pastels. On-screen only.
 */
import { C, OKABE_ITO, alpha } from '../theme/tokens.js';

export const JUDGMENT_STYLE = {
  // ── RoB 2 (3-level) — UNCHANGED ────────────────────────────────────────────
  low:  { label: 'Low',           short: 'Low',  icon: 'circleCheck',   hex: OKABE_ITO.bluishGreen, fg: C.grn,   bg: alpha(C.grn, 0.14) },
  some: { label: 'Some concerns', short: 'Some', icon: 'alertTriangle', hex: OKABE_ITO.orange,      fg: C.yel,   bg: alpha(C.yel, 0.14) },
  high: { label: 'High',          short: 'High', icon: 'alertOctagon',  hex: OKABE_ITO.vermillion,  fg: C.red,   bg: alpha(C.red, 0.14) },
  // ── ROBINS-I (5-level) — P14 ───────────────────────────────────────────────
  moderate: { label: 'Moderate', short: 'Moderate', icon: 'alertTriangle', hex: OKABE_ITO.orange,     fg: C.yel,  bg: alpha(C.yel, 0.14) },
  serious:  { label: 'Serious',  short: 'Serious',  icon: 'alertOctagon',  hex: OKABE_ITO.vermillion, fg: C.red,  bg: alpha(C.red, 0.14) },
  // Critical escalates BEYOND serious — a darker vermillion (same hue family) +
  // a heavier tint so it reads as the most severe level without colour alone.
  critical: { label: 'Critical', short: 'Critical', icon: 'alertOctagon',  hex: '#7a1600',            fg: C.red,  bg: alpha(C.red, 0.24) },
  // "No information" is distinct from "Not assessed": a cool sky-blue (Okabe–Ito)
  // with an info icon, so a genuinely uninformative domain reads differently from
  // one that simply has not been assessed yet.
  ni:       { label: 'No information', short: 'No info', icon: 'info',      hex: OKABE_ITO.skyBlue,    fg: C.teal, bg: alpha(C.teal, 0.14) },
  // ── Shared neutral ─────────────────────────────────────────────────────────
  na:   { label: 'Not assessed',  short: '—',    icon: 'minus',         hex: '#9aa0a6',             fg: C.muted, bg: alpha(C.muted, 0.12) },
};

/** Resolve a judgement code to its style; unknown/empty → na. */
export function judgmentStyle(j) {
  return JUDGMENT_STYLE[j] || JUDGMENT_STYLE.na;
}

/** RoB 2 legend rows (low/some/high/na). Kept as the default `JUDGMENT_LEGEND`. */
export const ROB2_LEGEND = ['low', 'some', 'high', 'na'].map(k => ({ key: k, ...JUDGMENT_STYLE[k] }));

/** ROBINS-I legend rows (low/moderate/serious/critical/ni). */
export const ROBINSI_LEGEND = ['low', 'moderate', 'serious', 'critical', 'ni'].map(k => ({ key: k, ...JUDGMENT_STYLE[k] }));

/** Default legend (RoB 2) — preserved for existing importers. */
export const JUDGMENT_LEGEND = ROB2_LEGEND;

/**
 * Legend rows for a given instrument id. ROBINS-I → 5-level; anything else
 * (RoB2 / undefined) → the 3-level RoB 2 legend. Instrument-agnostic callers
 * (the traffic-light + workspace) use this so the legend matches the plot.
 */
export function legendFor(instrumentId) {
  return instrumentId === 'ROBINS-I' ? ROBINSI_LEGEND : ROB2_LEGEND;
}

/* ── 115.md — SCALE-AWARE judgement styling ──────────────────────────────────
 *
 * The map above is a single flat vocabulary, which was safe while every level
 * belonged to a risk-of-bias scale: `high` meant "high risk of bias" and was red
 * everywhere. The 2026 tool set breaks that assumption outright:
 *
 *   · AMSTAR 2's overall is CONFIDENCE IN THE REVIEW — "High" is the BEST result
 *     and "Critically low" the worst. Painting AMSTAR's High red (and its
 *     Critically low green-adjacent) would invert the meaning of the tool.
 *   · A JBI overall is an appraisal DECISION (include / exclude / seek further
 *     info), not a severity at all.
 *   · QUADAS-2 / PROBAST add `unclear`, which — like ROBINS-I's `ni` — means
 *     "the study does not say", not "somewhere in the middle".
 *
 * So a level is only meaningful together with the SCALE it was drawn from, and
 * the renderer passes that scale explicitly. `judgmentStyle` is untouched and
 * still means the risk-of-bias scale, so every existing caller is unchanged.
 *
 *   'rob'         low / some / moderate / high / serious / critical / unclear / ni
 *   'concern'     applicability concerns — low / high / unclear
 *   'confidence'  AMSTAR 2 — high / moderate / low / critically-low (HIGH IS GOOD)
 *   'decision'    JBI — include / exclude / seek-further-info
 */

/** `unclear` — the study does not report enough to judge. Never a middle value. */
const UNCLEAR_STYLE = { label: 'Unclear', short: 'Unclear', icon: 'info', hex: OKABE_ITO.skyBlue, fg: C.teal, bg: alpha(C.teal, 0.14) };

export const ROB_SCALE_STYLE = {
  ...JUDGMENT_STYLE,
  unclear: UNCLEAR_STYLE,
};

export const CONCERN_SCALE_STYLE = {
  low:     { label: 'Low concern',     short: 'Low',     icon: 'circleCheck',   hex: OKABE_ITO.bluishGreen, fg: C.grn,   bg: alpha(C.grn, 0.14) },
  high:    { label: 'High concern',    short: 'High',    icon: 'alertOctagon',  hex: OKABE_ITO.vermillion,  fg: C.red,   bg: alpha(C.red, 0.14) },
  unclear: { label: 'Unclear concern', short: 'Unclear', icon: 'info',          hex: OKABE_ITO.skyBlue,     fg: C.teal,  bg: alpha(C.teal, 0.14) },
  na:      JUDGMENT_STYLE.na,
};

// AMSTAR 2 confidence — the polarity is REVERSED relative to a risk scale.
export const CONFIDENCE_SCALE_STYLE = {
  high:             { label: 'High confidence',            short: 'High',            icon: 'circleCheck',   hex: OKABE_ITO.bluishGreen, fg: C.grn,  bg: alpha(C.grn, 0.14) },
  moderate:         { label: 'Moderate confidence',        short: 'Moderate',        icon: 'checkSquare',   hex: OKABE_ITO.blue,        fg: C.teal, bg: alpha(C.teal, 0.14) },
  low:              { label: 'Low confidence',             short: 'Low',             icon: 'alertTriangle', hex: OKABE_ITO.orange,      fg: C.yel,  bg: alpha(C.yel, 0.14) },
  'critically-low': { label: 'Critically low confidence',  short: 'Critically low',  icon: 'alertOctagon',  hex: OKABE_ITO.vermillion,  fg: C.red,  bg: alpha(C.red, 0.14) },
  na:               JUDGMENT_STYLE.na,
};

// JBI overall appraisal decision — a decision, not a severity.
export const DECISION_SCALE_STYLE = {
  include:             { label: 'Include',           short: 'Include', icon: 'circleCheck',   hex: OKABE_ITO.bluishGreen, fg: C.grn,  bg: alpha(C.grn, 0.14) },
  exclude:             { label: 'Exclude',           short: 'Exclude', icon: 'x',             hex: OKABE_ITO.vermillion,  fg: C.red,  bg: alpha(C.red, 0.14) },
  'seek-further-info': { label: 'Seek further info', short: 'Seek',    icon: 'alert',         hex: OKABE_ITO.orange,      fg: C.yel,  bg: alpha(C.yel, 0.14) },
  na:                  JUDGMENT_STYLE.na,
};

const SCALE_STYLES = {
  rob: ROB_SCALE_STYLE,
  concern: CONCERN_SCALE_STYLE,
  confidence: CONFIDENCE_SCALE_STYLE,
  decision: DECISION_SCALE_STYLE,
};

/**
 * Resolve a level on a NAMED scale. Unknown scale → the risk-of-bias scale (the
 * historical behaviour); unknown/empty level → `na` (Not assessed).
 */
export function judgmentStyleOn(scale, value) {
  const map = SCALE_STYLES[scale] || ROB_SCALE_STYLE;
  return map[value] || map.na || JUDGMENT_STYLE.na;
}

/**
 * Which scale an instrument's OVERALL judgement is drawn from, read from the
 * definition's own `overall.axis` (shared.js contract) rather than from a list of
 * instrument ids: 'confidence' (AMSTAR 2), 'appraisal-decision' (JBI) or 'rob'.
 * `null` when the instrument declares it has no overall at all (QUADAS-2).
 */
export function overallScaleOf(instrument) {
  if (!instrument) return 'rob';
  if ('overall' in instrument && instrument.overall == null) return null;
  const axis = instrument.overall && instrument.overall.axis;
  if (axis === 'confidence') return 'confidence';
  if (axis === 'appraisal-decision') return 'decision';
  return 'rob';
}

/** Legend rows for any explicit level list `[{value,label}]` on a named scale. */
export function legendForLevels(levels, scale = 'rob') {
  return (Array.isArray(levels) ? levels : [])
    .map(l => (typeof l === 'string' ? l : l && l.value))
    .filter(Boolean)
    .map(v => ({ key: v, ...judgmentStyleOn(scale, v) }));
}
