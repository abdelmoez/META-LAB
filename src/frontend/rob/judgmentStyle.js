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
