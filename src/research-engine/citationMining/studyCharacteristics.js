/**
 * studyCharacteristics.js — P15 Bibliomine. Build histograms of the included-study
 * corpus for the "study visualizations" charts. Mirrors the field getters used by
 * manuscript/tables.js (sampleSize, design, country, year, rob-by-study-id) so the
 * charts and the manuscript tables never drift. Pure and deterministic; every
 * chart has an explicit "Unknown"/"Not reported"/"Not assessed" bucket.
 */

import { normalizeCountryCode, countryNameForCode } from '../../shared/countries.js';

const clean = (s) => String(s == null ? '' : s).trim();
const num = (x) => (x === '' || x == null || isNaN(+x) ? null : +x);

/** Sample size from whatever raw fields exist — verbatim mirror of tables.js `sampleSize`. */
function sampleSize(s) {
  const n = num(s.n);
  if (n) return n;
  const exp = num(s.nExp) || (num(s.a) || 0) + (num(s.b) || 0) || num(s.events);
  const ctrl = num(s.nCtrl) || (num(s.c) || 0) + (num(s.d) || 0);
  const total = num(s.total);
  const sum = (exp || 0) + (ctrl || 0);
  return sum || total || null;
}

/** Coarse study-type classification derived from the free-text design (order matters). */
function classifyStudyType(s) {
  const d = (clean(s.studyType) || clean(s.design)).toLowerCase();
  if (!d) return 'Not reported';
  if (/meta-?analysis|systematic review/.test(d)) return 'Systematic review/Meta-analysis';
  if (/rct|random/.test(d)) return 'Randomized trial';
  if (/case[\s-]?control/.test(d)) return 'Case-control';
  if (/cross[\s-]?section/.test(d)) return 'Cross-sectional';
  if (/cohort|prospective|retrospective|longitudinal/.test(d)) return 'Cohort';
  if (/case (series|report)/.test(d)) return 'Case series/report';
  if (/quasi|non-?random|controlled/.test(d)) return 'Non-randomized trial';
  return 'Other';
}

/** Region label = normalized country name; unresolved free text kept; blank → Not reported. */
function regionLabel(s) {
  const raw = clean(s.country);
  if (!raw) return 'Not reported';
  const code = normalizeCountryCode(raw);
  return code ? countryNameForCode(code) : raw;
}

/** Count distinct values of a categorical getter; sorted count desc, then label asc. */
function categorical(studies, getLabel, missingLabel) {
  const counts = new Map();
  for (const s of studies) {
    const label = clean(getLabel(s)) || missingLabel;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Year histogram — aligned numeric bins (default width 5); missing → Unknown (last). */
function yearHistogram(studies, width) {
  const w = width && width > 0 ? width : 5;
  const buckets = new Map();
  let unknown = 0;
  for (const s of studies) {
    const y = num(s.year);
    if (y == null || y < 1000) { unknown++; continue; }
    const start = Math.floor(y / w) * w;
    buckets.set(start, (buckets.get(start) || 0) + 1);
  }
  const out = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, count]) => ({ bucket: start, count, label: `${start}–${start + w - 1}` }));
  if (unknown) out.push({ bucket: null, count: unknown, label: 'Unknown' });
  return out;
}

// Common epidemiology sample-size bands.
const SS_BINS = [
  [0, 49, '<50'],
  [50, 99, '50–99'],
  [100, 249, '100–249'],
  [250, 499, '250–499'],
  [500, 999, '500–999'],
  [1000, Infinity, '≥1000'],
];

/** Sample-size histogram over fixed bands; only non-empty bins; missing → Not reported (last). */
function sampleSizeHistogram(studies) {
  const counts = SS_BINS.map(() => 0);
  let unknown = 0;
  for (const s of studies) {
    const n = sampleSize(s);
    if (n == null || n <= 0) { unknown++; continue; }
    const idx = SS_BINS.findIndex(([lo, hi]) => n >= lo && n <= hi);
    if (idx >= 0) counts[idx]++; else unknown++;
  }
  const out = SS_BINS
    .map(([lo, , label], i) => ({ bucket: lo, count: counts[i], label }))
    .filter((b) => b.count > 0);
  if (unknown) out.push({ bucket: null, count: unknown, label: 'Not reported' });
  return out;
}

/**
 * buildCharacteristicHistograms — histograms across the study corpus.
 *
 * @param {Array<object>} studies — study blobs (design, country, year, n/nExp/nCtrl, id, …).
 * @param {object} [opts] — { robByStudyId?: Record<id,'Low'|'Some concerns'|'High'>, yearBinWidth? }
 * @returns {{
 *   studyType:  Array<{ label, count }>,
 *   year:       Array<{ bucket, count, label }>,
 *   sampleSize: Array<{ bucket, count, label }>,
 *   region:     Array<{ label, count }>,
 *   design:     Array<{ label, count }>,
 *   rob:        Array<{ label, count }>
 * }}
 */
export function buildCharacteristicHistograms(studies = [], opts = {}) {
  const list = Array.isArray(studies) ? studies : [];
  const robBy = opts.robByStudyId || {};
  return {
    studyType: categorical(list, classifyStudyType, 'Not reported'),
    year: yearHistogram(list, opts.yearBinWidth),
    sampleSize: sampleSizeHistogram(list),
    region: categorical(list, regionLabel, 'Not reported'),
    design: categorical(list, (s) => clean(s.design), 'Not reported'),
    rob: categorical(list, (s) => clean(robBy[s && s.id]), 'Not assessed'),
  };
}

export default { buildCharacteristicHistograms };
