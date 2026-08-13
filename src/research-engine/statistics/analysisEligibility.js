/**
 * statistics/analysisEligibility.js — 116.md §47/§50 (explain WHY analysis is
 * unavailable).
 *
 * When an outcome cannot be pooled, the Analysis tab used to show a single generic
 * line ("No studies with an effect size yet — add them in Data Extraction") that
 * could directly contradict the extraction tab — the §41 regression's most visible
 * symptom. This module turns the row set of one outcome pair (or a whole project)
 * into ITEMIZED, human-readable reasons:
 *
 *   "3 studies are missing total sample size."
 *   "1 study has events greater than total."
 *   "At least 2 eligible studies are required for pooling."
 *
 * PURE — no React, no IO. Eligibility is judged through the SAME
 * `poolableStudyView` runMeta pools (116.md §41), so a row this module calls
 * eligible is exactly a row the meta-analysis would weight, and vice versa.
 * Rendering lives in the Analysis tab (AnalysisEligibilityNotice); the reason
 * strings are pinned here so every surface words them identically.
 */

import { poolableStudyView } from './monolithStats.js';
import { isExcludedFromAnalysis } from './studyFilter.js';
import { PROPORTION_FIELD_LABEL } from './proportionCompatibility.js';

/** Stable reason codes, in the order reasons are reported. */
export const ELIGIBILITY_REASONS = Object.freeze([
  'eventsExceedTotal', // events > total (invalid)
  'zeroTotal',         // total entered as 0 (or negative)
  'negativeCounts',    // negative events
  'missingTotal',      // events present, total missing
  'missingEvents',     // total present, events missing
  'missingCI',         // effect size present but no usable 95% CI (proportion-without-N path)
  'noEffect',          // nothing derivable and no effect size entered
  'excluded',          // reviewer excluded/archived the row
  'needAtLeastTwo',    // fewer than 2 eligible studies
]);

const isNum = (v) => v !== '' && v !== null && v !== undefined && !isNaN(+v);
const isBlank = (v) => v === '' || v === null || v === undefined;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The §50 message for one reason code + count. Exported so tests pin the wording. */
export function eligibilityMessage(code, count) {
  const studies = plural(count, 'study', 'studies');
  const isAre = count === 1 ? 'is' : 'are';
  const hasHave = count === 1 ? 'has' : 'have';
  switch (code) {
    case 'eventsExceedTotal': return `${studies} ${hasHave} events greater than total.`;
    case 'zeroTotal': return `${studies} ${hasHave} a total sample size of 0.`;
    case 'negativeCounts': return `${studies} ${hasHave} negative counts.`;
    case 'missingTotal': return `${studies} ${isAre} missing total sample size.`;
    case 'missingEvents': return `${studies} ${isAre} missing an event count.`;
    case 'missingCI': return `${studies} ${hasHave} an effect size but no usable 95% confidence interval.`;
    case 'noEffect': return `${studies} ${hasHave} no effect size or raw data entered yet.`;
    case 'excluded': return `${studies} ${isAre} excluded from analysis by reviewer choice.`;
    case 'needAtLeastTwo': return 'At least 2 eligible studies are required for pooling.';
    default: return '';
  }
}

/**
 * Classify ONE non-eligible row. Returns a reason code, most specific first, so a
 * row never contributes to two counts. `null` for an eligible row.
 */
export function rowIneligibilityReason(row) {
  if (!row) return null;
  if (isExcludedFromAnalysis(row)) return 'excluded';
  const v = poolableStudyView(row);
  const poolable = v.es !== '' && v.lo !== '' && v.hi !== ''
    && !isNaN(+v.es) && !isNaN(+v.lo) && !isNaN(+v.hi);
  if (poolable) return null;

  if (String(row.esType || '') === 'PROP') {
    const ev = row.events, tot = row.total;
    // Invalid raw data first — these are the §47 hard cases the reviewer must fix.
    // total = 0 outranks events > total: with a zero denominator, the denominator is
    // the actionable problem, not the (necessarily larger) numerator.
    if (isNum(tot) && +tot <= 0) return 'zeroTotal';
    if (isNum(ev) && isNum(tot) && +ev > +tot) return 'eventsExceedTotal';
    if (isNum(ev) && +ev < 0) return 'negativeCounts';
    if (isNum(ev) && isBlank(tot)) return 'missingTotal';
    if (isBlank(ev) && isNum(tot)) return 'missingEvents';
    // A reported proportion/effect without a CI (and without raw counts to derive one).
    if (isNum(row.es)) return 'missingCI';
    return 'noEffect';
  }
  if (isNum(row.es)) return 'missingCI';
  return 'noEffect';
}

/**
 * pairEligibility(rows) — the itemized §50 verdict for one outcome pair (or any row
 * set). `rows` should be ALL rows scoped to the pair — NOT pre-filtered by effect
 * size, or the very rows the reasons must explain would be invisible.
 *
 * @returns {{ total:number, eligible:number, ok:boolean,
 *             reasons:Array<{code:string,count:number,message:string}> }}
 */
export function pairEligibility(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const counts = new Map();
  let eligible = 0;
  for (const row of list) {
    const code = rowIneligibilityReason(row);
    if (code === null) { eligible += 1; continue; }
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  const reasons = [];
  for (const code of ELIGIBILITY_REASONS) {
    if (code === 'needAtLeastTwo') continue; // appended below, once, when it applies
    const n = counts.get(code);
    if (n) reasons.push({ code, count: n, message: eligibilityMessage(code, n) });
  }
  const ok = eligible >= 2;
  if (!ok) reasons.push({ code: 'needAtLeastTwo', count: eligible, message: eligibilityMessage('needAtLeastTwo', eligible) });
  return { total: list.length, eligible, ok, reasons };
}

/**
 * blockedByCompatibilityReasons(check) — the §50 line(s) for a pair the 107.md/116.md
 * pooling gate blocks ("4 studies use an incompatible denominator population.").
 * Takes the `checkProportionCompatibility` result; returns [] when nothing blocks.
 */
export function blockedByCompatibilityReasons(check) {
  const issues = (check && Array.isArray(check.issues)) ? check.issues : [];
  return issues.map((i) => {
    const label = (PROPORTION_FIELD_LABEL[i.field] || i.fieldLabel || i.field || 'classification');
    const n = i.totalAffected || 0;
    return {
      code: 'blockedByCategoryMix',
      count: n,
      message: `${plural(n, 'study uses', 'studies use')} an incompatible ${String(label).toLowerCase()}.`,
    };
  });
}

export default {
  pairEligibility, rowIneligibilityReason, eligibilityMessage,
  blockedByCompatibilityReasons, ELIGIBILITY_REASONS,
};
