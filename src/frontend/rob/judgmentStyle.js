/**
 * judgmentStyle.js — the RoB judgement visual language (rob.md §6.2).
 *
 * Color-blind-safe + REDUNDANT encoding: every judgement is shown as colour +
 * icon + text label, NEVER colour alone.
 *   low  = teal/green  · circleCheck
 *   some = amber       · alertTriangle
 *   high = red         · alertOctagon
 *   na   = neutral gray· minus
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
  low:  { label: 'Low',           short: 'Low',  icon: 'circleCheck',   hex: OKABE_ITO.bluishGreen, fg: C.grn,   bg: alpha(C.grn, 0.14) },
  some: { label: 'Some concerns', short: 'Some', icon: 'alertTriangle', hex: OKABE_ITO.orange,      fg: C.yel,   bg: alpha(C.yel, 0.14) },
  high: { label: 'High',          short: 'High', icon: 'alertOctagon',  hex: OKABE_ITO.vermillion,  fg: C.red,   bg: alpha(C.red, 0.14) },
  na:   { label: 'Not assessed',  short: '—',    icon: 'minus',         hex: '#9aa0a6',             fg: C.muted, bg: alpha(C.muted, 0.12) },
};

/** Resolve a judgement code to its style; unknown/empty → na. */
export function judgmentStyle(j) {
  return JUDGMENT_STYLE[j] || JUDGMENT_STYLE.na;
}

/** Short legend rows for the UI (low/some/high/na). */
export const JUDGMENT_LEGEND = ['low', 'some', 'high', 'na'].map(k => ({ key: k, ...JUDGMENT_STYLE[k] }));
