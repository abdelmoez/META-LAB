/**
 * extraction/engine/articleList.js — 76.md §6 (Article list).
 *
 * PURE builders + query engine for the extraction article-list entry view. Given the
 * blob `studies[]`, `buildArticleSummary` derives the per-row display model (status,
 * progress, validation counts, sync state, assignment, last-edited); `filterSortArticles`
 * applies the list's search / filters / sort. No IO — the server enriches each summary
 * with PDF-availability (a DB fact) before/after calling these.
 */

import { articleStatusOf, progressOf, validationSummary, STATUS_META } from './articleStatus.js';
import { syncStatusOf, SYNC_STATUS_META } from './syncState.js';

/**
 * buildArticleSummary(study, extra) — the article-list row model for one study.
 * `extra` carries facts the pure layer can't know: { pdfAvailable, tablesDetected }.
 * @returns {object}
 */
export function buildArticleSummary(study = {}, extra = {}) {
  const meta = study.extractionMeta || {};
  const status = articleStatusOf(study);
  const progress = progressOf(study);
  const { errors, warnings } = validationSummary(study);
  const sync = syncStatusOf(study);
  const title = study.title || study.author || '(untitled study)';
  return {
    id: study.id,
    title,
    author: study.author || '',
    year: study.year || '',
    journal: study.journal || '',
    doi: study.doi || '',
    pmid: study.pmid || '',
    outcome: study.outcome || '',
    status,
    statusLabel: (STATUS_META[status] || {}).label || status,
    progressPct: progress.pct,
    filledFields: progress.filledFields,
    totalFields: progress.totalFields,
    validationErrors: errors,
    validationWarnings: warnings,
    syncStatus: sync,
    syncLabel: (SYNC_STATUS_META[sync] || {}).label || sync,
    pdfAvailable: !!extra.pdfAvailable,
    tablesDetected: extra.tablesDetected != null ? extra.tablesDetected : null,
    assignedTo: Array.isArray(meta.assignedTo) ? meta.assignedTo : [],
    completedAt: meta.completedAt || '',
    completedBy: meta.completedByName || meta.completedBy || '',
    locked: !!meta.locked,
    lastEditedAt: study.updatedAt || meta.updatedAt || study.extractedAt || study.addedAt || '',
    lastEditor: study.extractedBy || meta.lastEditor || '',
  };
}

const STR = (v) => String(v == null ? '' : v).toLowerCase();

/** Sort keys the article list offers (76.md §6 "Sorting"). */
export const ARTICLE_SORTS = Object.freeze([
  { key: 'recent', label: 'Recently edited' },
  { key: 'title', label: 'Title (A–Z)' },
  { key: 'author', label: 'Author (A–Z)' },
  { key: 'year', label: 'Year (newest)' },
  { key: 'progress', label: 'Progress (high→low)' },
  { key: 'status', label: 'Status' },
  { key: 'issues', label: 'Validation issues (most first)' },
]);

const STATUS_ORDER = {
  validation_required: 0, in_progress: 1, ready_for_review: 2,
  not_started: 3, complete: 4, locked: 5,
};

function compareBy(sort) {
  switch (sort) {
    case 'title': return (a, b) => STR(a.title).localeCompare(STR(b.title));
    case 'author': return (a, b) => STR(a.author).localeCompare(STR(b.author));
    case 'year': return (a, b) => (+b.year || 0) - (+a.year || 0);
    case 'progress': return (a, b) => b.progressPct - a.progressPct;
    case 'status': return (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    case 'issues': return (a, b) => b.validationErrors - a.validationErrors || b.validationWarnings - a.validationWarnings;
    case 'recent':
    default: return (a, b) => STR(b.lastEditedAt).localeCompare(STR(a.lastEditedAt));
  }
}

/**
 * filterSortArticles(summaries, query) — apply search + filters + sort.
 * query: {
 *   search?, status?, sync?, reviewer?, progress?('none'|'partial'|'done'),
 *   pdf?('yes'|'no'), issues?('errors'|'warnings'|'clean'), sort?
 * }
 * @returns {object[]} filtered + sorted summaries (new array; input untouched)
 */
export function filterSortArticles(summaries = [], query = {}) {
  const q = STR(query.search).trim();
  let out = summaries.filter((s) => {
    if (q) {
      const hay = `${STR(s.title)} ${STR(s.author)} ${STR(s.year)} ${STR(s.journal)} ${STR(s.doi)} ${STR(s.pmid)} ${STR(s.outcome)}`;
      if (!hay.includes(q)) return false;
    }
    if (query.status && s.status !== query.status) return false;
    if (query.sync && s.syncStatus !== query.sync) return false;
    if (query.reviewer && !(s.assignedTo || []).some((a) => STR(a.id) === STR(query.reviewer) || STR(a.name) === STR(query.reviewer))) return false;
    if (query.pdf === 'yes' && !s.pdfAvailable) return false;
    if (query.pdf === 'no' && s.pdfAvailable) return false;
    if (query.progress === 'none' && s.progressPct !== 0) return false;
    if (query.progress === 'partial' && !(s.progressPct > 0 && s.progressPct < 100)) return false;
    if (query.progress === 'done' && s.progressPct !== 100) return false;
    if (query.issues === 'errors' && s.validationErrors === 0) return false;
    if (query.issues === 'warnings' && s.validationWarnings === 0) return false;
    if (query.issues === 'clean' && (s.validationErrors > 0 || s.validationWarnings > 0)) return false;
    return true;
  });
  out = out.sort(compareBy(query.sort || 'recent'));
  return out;
}

/**
 * articleListStats(summaries) — headline counts for the list header (§6 progress).
 * @returns {{ total:number, complete:number, inProgress:number, notStarted:number,
 *             needsValidation:number, readyForAnalysis:number, avgProgress:number }}
 */
export function articleListStats(summaries = []) {
  const total = summaries.length;
  let complete = 0, inProgress = 0, notStarted = 0, needsValidation = 0, readyForAnalysis = 0, pctSum = 0;
  for (const s of summaries) {
    if (s.status === 'complete' || s.status === 'locked') complete++;
    else if (s.status === 'not_started') notStarted++;
    else inProgress++;
    if (s.status === 'validation_required') needsValidation++;
    if (s.syncStatus === 'ready' || s.syncStatus === 'synced' || s.syncStatus === 'updated_since_sync') readyForAnalysis++;
    pctSum += s.progressPct;
  }
  return {
    total, complete, inProgress, notStarted, needsValidation, readyForAnalysis,
    avgProgress: total ? Math.round(pctSum / total) : 0,
  };
}
