/**
 * research-engine/statistics/poolableRow.js — 116.md §41/§46 (r2).
 *
 * THE eligibility rule for "does this extraction row carry, or derive, an effect
 * estimate?" — split out of monolithStats so that light, server-safe consumers can
 * ask the question without importing the meta-analysis engine.
 *
 * Why this exists: 116.md made raw proportion rows (events/total, no stored es)
 * poolable by deriving es/lo/hi at the analysis boundary (`poolableStudyView`).
 * `projectProgress.js` counts poolable studies for the workflow rail and is
 * deliberately kept off the statistics engine (it runs inline on every project GET),
 * so it cannot call `poolableStudyView`. Duplicating the condition there would have
 * let the rail disagree with Analysis — the exact class of cross-surface
 * contradiction 116.md §46 exists to remove. Both sides now import THIS predicate:
 * `poolableStudyView` uses it as its guard before computing the numbers with
 * `calcES`, and the progress model uses it to count.
 *
 * PURE + dependency-free on purpose: no statistics, no constants, no I/O.
 *
 * Parity note: the numeric tests below mirror the pre-existing checks verbatim
 * (`es!=="" && es!==null && es!==undefined && !isNaN(+es)` and calcES's own
 * `tot<1 || ev<0 || ev>tot` rejection), including their quirks, so no row changes
 * classification as a side effect of the extraction.
 */

const present = (v) => v !== '' && v !== null && v !== undefined;

/** A reviewer-entered / backfilled numeric effect size on the stored row. */
export function hasStoredEffect(s) {
  return !!s && present(s.es) && !isNaN(+s.es);
}

/** Stored effect size AND both confidence bounds — the classic poolable row. */
export function hasStoredInterval(s) {
  return hasStoredEffect(s) && present(s.lo) && !isNaN(+s.lo) && present(s.hi) && !isNaN(+s.hi);
}

/**
 * 116.md §41 — a proportion row with usable raw data and no stored effect size, i.e.
 * one `poolableStudyView` will derive es/lo/hi for. The bounds mirror calcES('PROP'):
 * total ≥ 1, events ≥ 0, events ≤ total (0-event and all-event rows are fine — they
 * take the 0.5 continuity correction).
 */
export function derivesPropEffect(s) {
  if (!s || hasStoredEffect(s)) return false;
  if (s.esType !== 'PROP') return false;
  if (!present(s.events) || !present(s.total)) return false;
  const ev = +s.events, tot = +s.total;
  if (isNaN(ev) || isNaN(tot)) return false;
  return tot >= 1 && ev >= 0 && ev <= tot;
}

/** Does this row carry or derive an effect estimate? (mirrors `hasUsableEffect`) */
export function rowHasEffect(s) {
  return hasStoredEffect(s) || derivesPropEffect(s);
}

/** Does this row carry or derive a full estimate WITH an interval, i.e. can it enter
 *  a pooled result? Derivation always yields both bounds, so it implies poolability. */
export function rowIsPoolable(s) {
  return derivesPropEffect(s) || hasStoredInterval(s);
}
