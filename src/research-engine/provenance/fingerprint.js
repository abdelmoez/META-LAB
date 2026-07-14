/**
 * provenance/fingerprint.js — 88.md Part II. Blob-derivable "scientific slices":
 * the pieces of Project.data that carry methodological / result meaning. Each slice
 * has a pure accessor tolerant of missing/legacy shapes, so the generic emitter
 * (emit.js) can diff a project blob before→after WITHOUT the manuscript-generation
 * opts bundle (reviewers/pubBias/templateId live outside the blob).
 *
 * These are the SAME conceptual slices as the manuscript engine's DEPENDENCY_KEYS,
 * but derived from the blob alone so the SERVER can capture events cheaply on every
 * save. Pure — no DOM/React/network/Date.
 */

import { fnv1a } from './diff.js';

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);

/** Per-study numeric/format fields that, when changed, alter the effect estimate. */
const STUDY_VALUE_FIELDS = [
  'es', 'lo', 'hi', 'a', 'b', 'c', 'd', 'events', 'total',
  'nExp', 'meanExp', 'sdExp', 'nCtrl', 'meanCtrl', 'sdCtrl',
  'median', 'q1', 'q3', 'medianExp', 'q1Exp', 'q3Exp', 'medianCtrl', 'q1Ctrl', 'q3Ctrl',
  'reportedFormat',
];

/** Extract the value-bearing slice of one study row (for EXTRACTED_VALUE_CHANGED). */
export function studyValues(study) {
  const s = obj(study);
  const out = {};
  for (const f of STUDY_VALUE_FIELDS) if (s[f] !== undefined) out[f] = s[f];
  return out;
}

/** Roster identity of one study (outcome/timepoint/esType + inclusion flag). */
export function studyRoster(study) {
  const s = obj(study);
  return {
    id: s.id,
    outcome: s.outcome ?? null,
    timepoint: s.timepoint ?? null,
    esType: s.esType ?? null,
    // inclusion in the ANALYSIS: excluded rows carry excludeFromAnalysis / excluded.
    included: s.excludeFromAnalysis ? false : (s.excluded ? false : true),
  };
}

/**
 * SCIENTIFIC_SLICES — sliceKey → { get(project), label }. `get` returns a JSON-safe
 * value; the generic emitter fingerprints/diffs these. Study-level slices are handled
 * separately by emit.js (they need per-row granularity), so they are NOT here.
 */
export const SCIENTIFIC_SLICES = Object.freeze({
  searchMode:      { label: 'Search mode', get: (p) => obj(p.search).searchMode ?? null },
  searchStrategy:  { label: 'Search strategy', get: (p) => ({ string: obj(p.search).string ?? null, notes: obj(p.search).notes ?? null }) },
  searchDate:      { label: 'Search date', get: (p) => obj(p.search).date ?? null },
  picoQuestion:    { label: 'Review question', get: (p) => { const q = obj(p.pico); return { question: q.question ?? null, P: q.P ?? null, I: q.I ?? null, C: q.C ?? null, O: q.O ?? null }; } },
  picoCriteria:    { label: 'Eligibility criteria', get: (p) => { const q = obj(p.pico); return { incl: q.incl ?? null, excl: q.excl ?? null, studyDesign: q.studyDesign ?? null, timeframe: q.timeframe ?? null, timeframeMode: q.timeframeMode ?? null, tfStart: q.tfStart ?? null, tfEnd: q.tfEnd ?? null }; } },
  picoRegistration:{ label: 'Protocol registration', get: (p) => ({ prosperoId: obj(p.pico).prosperoId ?? null }) },
  analysisModel:   { label: 'Synthesis model', get: (p) => obj(p.analysisSettings).model ?? null },
  analysisTau2:    { label: 'Heterogeneity estimator', get: (p) => obj(p.analysisSettings).tau2Method ?? null },
  effectMeasure:   { label: 'Effect measure', get: (p) => obj(p.analysisSettings).effectMeasure ?? obj(p.analysisSettings).measure ?? null },
  continuityCorrection: { label: 'Continuity correction', get: (p) => obj(p.analysisSettings).continuityCorrection ?? null },
  confidenceLevel: { label: 'Confidence level', get: (p) => obj(p.analysisSettings).confidenceLevel ?? null },
  robMethod:       { label: 'Risk-of-bias tool', get: (p) => p.robMethod ?? null },
});

export const SLICE_KEYS = Object.keys(SCIENTIFIC_SLICES);

/** Per-slice fingerprint of the whole blob's scientific state. Pure. */
export function fingerprintState(project) {
  const p = obj(project);
  const out = {};
  for (const key of SLICE_KEYS) out[key] = fnv1a(SCIENTIFIC_SLICES[key].get(p));
  // Study aggregate fingerprints (roster + values) for coarse change detection.
  const studies = arr(p.studies);
  out.__roster = fnv1a(studies.map(studyRoster));
  out.__values = fnv1a(studies.map((s) => ({ id: obj(s).id, v: studyValues(s) })));
  return out;
}

/** Per-database search config, tolerant of both {db:count} and {db:{...}} shapes. */
export function searchDatabases(project) {
  return obj(obj(project.search).dbs);
}

/** Optional per-database method map (db → 'manual'|'automated'). Forward-compatible. */
export function searchDbMethods(project) {
  return obj(obj(project.search).dbMethods);
}

export default {
  SCIENTIFIC_SLICES, SLICE_KEYS, fingerprintState, studyValues, studyRoster,
  searchDatabases, searchDbMethods, STUDY_VALUE_FIELDS,
};
