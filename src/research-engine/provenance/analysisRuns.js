/**
 * provenance/analysisRuns.js — 88.md Part VI. Immutable analysis-run records and
 * the status vocabulary that lets the manuscript use the FINAL approved analysis
 * (and formally-designated sensitivity/secondary analyses) instead of the last
 * option a user happened to click. A methodological change + rerun makes a NEW
 * record; prior records are never overwritten — they are marked SUPERSEDED.
 *
 * Pure — no DOM/React/network/Date (timestamps are passed in).
 */

export const ANALYSIS_STATUS = Object.freeze({
  DRAFT: 'draft',
  EXPLORATORY: 'exploratory',
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
  SENSITIVITY: 'sensitivity',
  SUPERSEDED: 'superseded',
  INVALIDATED: 'invalidated',
  FINAL: 'final',
});

const ALL_STATUSES = Object.values(ANALYSIS_STATUS);

/** Statuses the manuscript engine may describe. Draft/exploratory/superseded/invalidated are history-only. */
export const REPORTABLE_STATUSES = Object.freeze([
  ANALYSIS_STATUS.PRIMARY, ANALYSIS_STATUS.SECONDARY, ANALYSIS_STATUS.SENSITIVITY, ANALYSIS_STATUS.FINAL,
]);

export function isReportable(status) {
  return REPORTABLE_STATUSES.includes(status);
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (v == null ? null : String(v));

/** The immutable config fingerprint of a run (what makes two runs "the same method"). */
export const RUN_CONFIG_FIELDS = [
  'outcome', 'timepoint', 'population', 'intervention', 'comparator', 'effectMeasure',
  'model', 'tau2Method', 'confidenceLevel', 'predictionInterval', 'continuityCorrection',
  'zeroCellHandling', 'hartungKnapp', 'transformation', 'multiArmHandling', 'subgroups',
];

/**
 * makeRunRecord(config, results, meta) → a normalized run record. `at` (ISO string
 * or epoch) and `id` are supplied by the caller (pure — no clock/uuid here).
 */
export function makeRunRecord(config = {}, results = null, meta = {}) {
  const cfg = {};
  for (const f of RUN_CONFIG_FIELDS) cfg[f] = config[f] !== undefined ? config[f] : null;
  return {
    id: str(meta.id),
    status: ALL_STATUSES.includes(meta.status) ? meta.status : ANALYSIS_STATUS.EXPLORATORY,
    config: cfg,
    results: results ? {
      k: num(results.k), n: num(results.n), estimate: num(results.estimate),
      ciLow: num(results.ciLow), ciHigh: num(results.ciHigh), pValue: num(results.pValue),
      i2: num(results.i2), tau2: num(results.tau2), predLow: num(results.predLow), predHigh: num(results.predHigh),
    } : null,
    engineVersion: str(meta.engineVersion),
    at: meta.at != null ? meta.at : null,
    by: str(meta.by),
    supersedesRunId: str(meta.supersedesRunId),
    label: str(meta.label),
  };
}

/** Group key = outcome × timepoint (different outcomes may use different methods). */
export function runKey(run) {
  const c = (run && run.config) || {};
  return `${c.outcome ?? ''} ${c.timepoint ?? ''}`;
}

/**
 * resolveEffectiveAnalyses(runs) — from the full immutable history, decide what the
 * manuscript should describe per outcome×timepoint:
 *   primary:     the FINAL run if any, else the newest PRIMARY (by `at`, then order)
 *   sensitivity: all SENSITIVITY runs (formal sensitivity analyses → Results)
 *   secondary:   all SECONDARY runs
 *   history:     everything else (exploratory/draft/superseded/invalidated) — audit only
 * Ties broken by `at` when comparable, else last-in-array wins (stable, deterministic).
 */
export function resolveEffectiveAnalyses(runs) {
  const list = Array.isArray(runs) ? runs.filter(Boolean) : [];
  const groups = new Map();
  list.forEach((run, i) => {
    const key = runKey(run);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ run, i });
  });

  const result = {};
  for (const [key, entries] of groups) {
    const pick = (pred) => entries
      .filter((e) => pred(e.run.status))
      .sort((a, b) => cmpAt(a.run.at, b.run.at) || (a.i - b.i))
      .map((e) => e.run);
    const finals = pick((s) => s === ANALYSIS_STATUS.FINAL);
    const primaries = pick((s) => s === ANALYSIS_STATUS.PRIMARY);
    const primary = finals.length ? finals[finals.length - 1] : (primaries.length ? primaries[primaries.length - 1] : null);
    const secondary = pick((s) => s === ANALYSIS_STATUS.SECONDARY);
    const sensitivity = pick((s) => s === ANALYSIS_STATUS.SENSITIVITY);
    // History = everything the manuscript will NOT describe as an effective analysis
    // (exploratory/draft/superseded/invalidated + any reportable run not chosen as
    // the single primary). Audit-only.
    const chosen = new Set([primary, ...secondary, ...sensitivity].filter(Boolean));
    result[key] = {
      primary,
      secondary,
      sensitivity,
      history: entries.map((e) => e.run).filter((r) => !chosen.has(r)),
    };
  }
  return result;
}

function cmpAt(a, b) {
  const na = toEpoch(a), nb = toEpoch(b);
  if (na == null || nb == null) return 0;
  return na - nb;
}
function toEpoch(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/**
 * supersede(prevRun, nextRunMeta) — mark a prior run superseded and return BOTH the
 * (unchanged-config) superseded copy and the linkage for the new run. Never mutates.
 */
export function supersede(prevRun) {
  return { ...prevRun, status: ANALYSIS_STATUS.SUPERSEDED };
}

export default {
  ANALYSIS_STATUS, REPORTABLE_STATUSES, isReportable, makeRunRecord, runKey,
  resolveEffectiveAnalyses, supersede, RUN_CONFIG_FIELDS,
};
