/**
 * extractionOrder.js
 * Pure ordering helpers for the Data Extraction study list (prompt15 Task 3).
 *
 * The project's `studies` array order IS the persisted "manual / custom" order.
 * orderStudies() derives a VIEW for the non-manual sorts without mutating the
 * input array, so manual order is never lost. Every comparator falls back to the
 * original array index, so the result is stable and robust to missing fields
 * (no year, no author, no timestamps).
 */

export const DEFAULT_EXTRACTION_SORT = 'manual';

export const EXTRACTION_SORTS = [
  { key: 'manual',          label: 'Custom order' },
  // prompt32 Task 9 — group the extraction list by OUTCOME NAME (then timepoint),
  // so multiple-outcome reviews are organised by the actual outcome rather than by
  // the primary/secondary "data nature" metadata.
  { key: 'outcome_az',      label: 'Outcome (A–Z)' },
  { key: 'title_az',        label: 'Title (A–Z)' },
  { key: 'year_asc',        label: 'Year (oldest first)' },
  { key: 'year_desc',       label: 'Year (newest first)' },
  { key: 'author_az',       label: 'Author (A–Z)' },
  { key: 'recent_added',    label: 'Recently added' },
  { key: 'recent_modified', label: 'Recently modified' },
];

const str = v => (v === null || v === undefined ? '' : String(v)).trim();
const lc  = v => str(v).toLowerCase();

const yearNum = s => {
  const n = parseInt(str(s && s.year), 10);
  return Number.isFinite(n) ? n : null;
};
const tstamp = v => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

/**
 * orderStudies(studies, sortKey)
 * @param {Array}  studies  the project.studies array (not mutated)
 * @param {string} sortKey  one of EXTRACTION_SORTS[].key
 * @returns {Array} a NEW array in the requested order (study objects by reference,
 *                  so ids and extraction data stay attached).
 */
export function orderStudies(studies, sortKey = DEFAULT_EXTRACTION_SORT) {
  const arr = Array.isArray(studies) ? studies.slice() : [];
  if (!sortKey || sortKey === 'manual') return arr;

  const idx = new Map(arr.map((s, i) => [s, i]));
  const fwd = (a, b) => idx.get(a) - idx.get(b);      // original order
  const rev = (a, b) => idx.get(b) - idx.get(a);      // newest-by-insertion first

  const yearCmp = dir => (a, b) => {
    const ya = yearNum(a), yb = yearNum(b);
    if (ya === null && yb === null) return fwd(a, b);
    if (ya === null) return 1;                          // missing → end
    if (yb === null) return -1;
    return (dir === 'asc' ? ya - yb : yb - ya) || fwd(a, b);
  };

  const recentCmp = field => (a, b) => {
    const ta = tstamp(a && a[field]), tb = tstamp(b && b[field]);
    if (ta === null && tb === null) return rev(a, b);  // no timestamps → insertion order, newest first
    return (tb === null ? -Infinity : tb) - (ta === null ? -Infinity : ta) || rev(a, b);
  };

  const comparators = {
    // Group by outcome NAME, then timepoint, then original order — the user-facing
    // organising axis for multi-outcome reviews (prompt32 Task 9).
    outcome_az:      (a, b) => lc(a.outcome).localeCompare(lc(b.outcome)) || lc(a.timepoint).localeCompare(lc(b.timepoint)) || fwd(a, b),
    title_az:        (a, b) => lc(a.title || a.author).localeCompare(lc(b.title || b.author)) || fwd(a, b),
    author_az:       (a, b) => lc(a.author || a.authors).localeCompare(lc(b.author || b.authors)) || fwd(a, b),
    year_asc:        yearCmp('asc'),
    year_desc:       yearCmp('desc'),
    recent_added:    recentCmp('addedAt'),
    recent_modified: recentCmp('updatedAt'),
  };

  const cmp = comparators[sortKey];
  return cmp ? arr.sort(cmp) : arr;
}

export default { EXTRACTION_SORTS, DEFAULT_EXTRACTION_SORT, orderStudies };
