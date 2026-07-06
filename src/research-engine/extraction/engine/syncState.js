/**
 * extraction/engine/syncState.js — 76.md §20/§21 (analysis sync + change propagation).
 *
 * In PecanRev the analysis engine reads the blob `studies[]` LIVE, so extraction data
 * is never "out of sync" in the storage sense. What 76.md asks for is a visible,
 * per-article SYNC STATE: is this article's data ready for analysis, has it been
 * marked included, and — crucially — has it CHANGED since the reviewer last confirmed
 * it was analysis-ready ("updated since sync", §21)?
 *
 * We reuse the manuscript OUTDATED pattern: hash the analysis-relevant inputs of a
 * study at the moment it is confirmed/synced (stored in extractionMeta.syncHash), and
 * compare that stored hash to the LIVE hash on read. Drift ⇒ updated_since_sync.
 *
 * PURE + deterministic: a stable stringify + a small non-cryptographic hash (djb2).
 * No Date.now/Math.random. Safe for server, client and tests.
 */

/** Fields whose change should invalidate a prior sync (the analysis inputs). */
export const SYNC_INPUT_FIELDS = Object.freeze([
  'esType', 'outcome', 'timepoint', 'adjusted',
  'n', 'nExp', 'nCtrl', 'meanExp', 'sdExp', 'meanCtrl', 'sdCtrl',
  'a', 'b', 'c', 'd', 'events', 'total', 'tp', 'fp', 'fn', 'tn',
  'es', 'lo', 'hi',
]);

/** The sync statuses surfaced in the article list (76.md §20). */
export const SYNC_STATUSES = Object.freeze([
  'not_ready', 'ready', 'synced', 'updated_since_sync', 'excluded',
]);

export const SYNC_STATUS_META = Object.freeze({
  not_ready:          { label: 'Not ready',        tone: 'neutral' },
  ready:              { label: 'Ready for analysis', tone: 'info' },
  synced:             { label: 'In analysis',       tone: 'success' },
  updated_since_sync: { label: 'Updated since sync', tone: 'warn' },
  excluded:           { label: 'Excluded',          tone: 'neutral' },
});

/** djb2 — tiny stable string hash, hex string. Deterministic, dependency-free. */
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/**
 * computeSyncHash(study) — stable hash over the analysis-input fields. Whitespace is
 * trimmed and empty values normalized so cosmetic edits do not churn the hash.
 * @returns {string}
 */
export function computeSyncHash(study = {}) {
  const parts = SYNC_INPUT_FIELDS.map((k) => {
    const v = study[k];
    return `${k}=${v == null ? '' : String(v).trim()}`;
  });
  return djb2(parts.join('|'));
}

/** analysisReady(study) — a study can be POOLED only with an effect size AND its CI:
 *  the meta-analysis derives the weight from se=(hi−lo)/(2·1.96), so es without lo/hi
 *  cannot be weighted (checkPoolability filters on all three). Requiring es+lo+hi here
 *  keeps the "Ready for analysis" sync badge/count honest (76.md review, low finding). */
export function analysisReady(study = {}) {
  const ok = (v) => v !== '' && v !== null && v !== undefined && !Number.isNaN(+v);
  return ok(study.es) && ok(study.lo) && ok(study.hi);
}

/**
 * syncStatusOf(study) — the article's analysis-sync state from its live values + the
 * stored extractionMeta.{syncHash,syncedAt,includedInAnalysis}.
 *
 *  - excluded            : reviewer set includedInAnalysis === false.
 *  - not_ready           : no usable effect size yet.
 *  - synced              : synced before AND the live hash matches the stored one.
 *  - updated_since_sync  : synced before BUT the inputs changed since (§21).
 *  - ready               : analysis-ready but never marked synced.
 * @returns {string} one of SYNC_STATUSES
 */
export function syncStatusOf(study = {}) {
  const meta = study.extractionMeta || {};
  if (meta.includedInAnalysis === false) return 'excluded';
  if (!analysisReady(study)) return 'not_ready';
  if (meta.syncHash) {
    return meta.syncHash === computeSyncHash(study) ? 'synced' : 'updated_since_sync';
  }
  return 'ready';
}

/**
 * markSynced(study, opts) — return a NEW study stamping the current inputs hash +
 * synced timestamp, so later edits are detected as drift. Pure.
 * @param {object} study
 * @param {{ at?:string, by?:string }} opts
 * @returns {object} new study
 */
export function markSynced(study, opts = {}) {
  if (!study) return study;
  const meta = study.extractionMeta || {};
  return {
    ...study,
    extractionMeta: {
      ...meta,
      syncHash: computeSyncHash(study),
      syncedAt: opts.at || meta.syncedAt || '',
      syncedBy: opts.by || meta.syncedBy || '',
      includedInAnalysis: meta.includedInAnalysis === false ? false : true,
    },
  };
}

/** setInclusion(study, included) — pure toggle of analysis inclusion (§20). */
export function setInclusion(study, included) {
  if (!study) return study;
  const meta = study.extractionMeta || {};
  return { ...study, extractionMeta: { ...meta, includedInAnalysis: !!included } };
}
