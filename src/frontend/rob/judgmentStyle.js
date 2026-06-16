/**
 * judgmentStyle.js — the RoB judgement visual language (rob.md §6.2).
 *
 * Color-blind-safe + REDUNDANT encoding: every judgement is shown as colour +
 * icon + text label, NEVER colour alone. Colours use Okabe–Ito-derived hex so
 * they are safe in SVG export (absolute hex, no CSS vars) and meet AA contrast.
 *   low  = teal/green  · circleCheck
 *   some = amber       · alertTriangle
 *   high = red         · alertOctagon
 *   na   = neutral gray· minus
 */
import { OKABE_ITO } from '../theme/tokens.js';

export const JUDGMENT_STYLE = {
  low:  { label: 'Low',           short: 'Low',  icon: 'circleCheck',   hex: OKABE_ITO.bluishGreen, fg: '#0b6b50', bg: '#e6f4ef' },
  some: { label: 'Some concerns', short: 'Some', icon: 'alertTriangle', hex: OKABE_ITO.orange,      fg: '#8a5a00', bg: '#fdf3e0' },
  high: { label: 'High',          short: 'High', icon: 'alertOctagon',  hex: OKABE_ITO.vermillion,  fg: '#a8370a', bg: '#fce9e0' },
  na:   { label: 'Not assessed',  short: '—',    icon: 'minus',         hex: '#9aa0a6',             fg: '#5f6368', bg: '#f1f3f4' },
};

/** Resolve a judgement code to its style; unknown/empty → na. */
export function judgmentStyle(j) {
  return JUDGMENT_STYLE[j] || JUDGMENT_STYLE.na;
}

/** Short legend rows for the UI (low/some/high/na). */
export const JUDGMENT_LEGEND = ['low', 'some', 'high', 'na'].map(k => ({ key: k, ...JUDGMENT_STYLE[k] }));
