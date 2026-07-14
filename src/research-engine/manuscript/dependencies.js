/**
 * manuscript/dependencies.js — 84.md Part 2/12. The explicit project→manuscript
 * dependency graph. Each dependency KEY fingerprints exactly one slice of project
 * state (via the same FNV-1a hashOf used for section inputs); a section declares
 * which keys it depends on, so a change to search.date can mark Methods+Abstract
 * outdated while leaving Introduction untouched.
 *
 * This is the coarse, project-stage-level companion to sources.computeSectionInputs
 * (which fingerprints a section's whole input bundle in one hash). The per-key
 * graph is what lets the Update-review panel say WHICH project facts changed and
 * how severe the change is (critical > methods > numerical > wording).
 *
 * Pure — no DOM/React/network/Date. IMPORTANT: must NOT import sources.js
 * (sources.js imports this — the dependency direction is one-way to avoid a cycle).
 */

import { hashOf } from './sourceHash.js';
import { computePrismaCounts } from './prismaCounts.js';
import { resolveAnalysis } from './analysisDescribe.js';
import { collectEngineVersions } from './versions.js';

/** Frozen registry: key → { label, category }. Category drives severity + colour. */
export const DEPENDENCY_KEYS = Object.freeze({
  'pico.question': { label: 'Review question (PICO)', category: 'methods' },
  'pico.criteria': { label: 'Eligibility criteria', category: 'methods' },
  'pico.registration': { label: 'Protocol registration', category: 'methods' },
  'search.databases': { label: 'Databases searched', category: 'critical' },
  'search.date': { label: 'Search date', category: 'critical' },
  'search.strategy': { label: 'Search strategy', category: 'methods' },
  'prisma.counts': { label: 'PRISMA flow counts', category: 'critical' },
  'screening.workflow': { label: 'Screening workflow', category: 'methods' },
  'studies.roster': { label: 'Included-study roster', category: 'critical' },
  'studies.values': { label: 'Extracted study values', category: 'numerical' },
  'extraction.conversions': { label: 'Statistical conversions', category: 'methods' },
  'analysis.model': { label: 'Synthesis model', category: 'critical' },
  'analysis.tau2': { label: 'Heterogeneity estimator', category: 'methods' },
  'rob.method': { label: 'Risk-of-bias tool', category: 'methods' },
  'rob.judgments': { label: 'Risk-of-bias judgments', category: 'numerical' },
  'grade.certainty': { label: 'GRADE certainty', category: 'numerical' },
  'pubBias.results': { label: 'Publication-bias results', category: 'numerical' },
  'engine.versions': { label: 'Analysis engine versions', category: 'methods' },
  'template.style': { label: 'Journal template & style', category: 'wording' },
});

export const DEPENDENCY_KEY_IDS = Object.keys(DEPENDENCY_KEYS);

/** Section → dependency keys (84.md Part 2). Order is stable for reason display. */
export const SECTION_DEPENDENCIES = Object.freeze({
  title: ['pico.question'],
  abstract: [
    'pico.question', 'search.databases', 'search.date', 'prisma.counts',
    'studies.roster', 'studies.values', 'analysis.model', 'analysis.tau2', 'template.style',
  ],
  introduction: ['pico.question', 'pico.criteria'],
  methods: [
    'pico.question', 'pico.criteria', 'pico.registration', 'search.databases',
    'search.date', 'search.strategy', 'prisma.counts', 'screening.workflow',
    'extraction.conversions', 'analysis.model', 'analysis.tau2', 'rob.method',
    'grade.certainty', 'engine.versions', 'template.style',
  ],
  results: [
    'prisma.counts', 'studies.roster', 'studies.values', 'analysis.model',
    'analysis.tau2', 'rob.judgments', 'pubBias.results', 'engine.versions',
  ],
  discussion: ['studies.roster', 'studies.values', 'analysis.model', 'grade.certainty'],
  limitations: ['studies.roster', 'rob.judgments', 'analysis.model'],
  conclusion: ['studies.roster', 'studies.values', 'analysis.model'],
});

const clean = (s) => String(s == null ? '' : s);

/**
 * Fingerprint every dependency key from the live project + generation opts.
 * @param {object} project Project.data blob
 * @param {object} [opts]  same opts bundle as generateDraft (searchMethodsText,
 *                         reviewers/blind/conflictResolution, analysis, pubBias,
 *                         robAssessments, gradeByOutcome, templateId, citationStyle…)
 * @returns {{ [key:string]: string }} key → FNV-1a hex
 */
export function computeDependencyState(project, opts = {}) {
  const p = project || {};
  const pico = p.pico || {};
  const search = p.search || {};
  const studies = Array.isArray(p.studies) ? p.studies : [];
  const analysis = resolveAnalysis(p, opts);

  const rosterSlice = studies.map((s) => ({
    id: s.id, outcome: s.outcome, timepoint: s.timepoint, esType: s.esType,
  }));
  const valuesSlice = studies.map((s) => ({
    id: s.id, es: s.es, lo: s.lo, hi: s.hi,
    a: s.a, b: s.b, c: s.c, d: s.d, events: s.events, total: s.total,
    nExp: s.nExp, meanExp: s.meanExp, sdExp: s.sdExp,
    nCtrl: s.nCtrl, meanCtrl: s.meanCtrl, sdCtrl: s.sdCtrl,
    reportedFormat: s.reportedFormat,
  }));
  const conversionsSlice = studies.map((s) => ({
    id: s.id,
    conversions: (Array.isArray(s.conversions) ? s.conversions : [])
      .map((c) => ({ type: c && c.type, method: c && c.method, formatId: c && c.formatId })),
  }));
  const robSlice = studies.map((s) => ({ id: s.id, rob: s.rob || null }));

  const values = {
    'pico.question': { question: pico.question, P: pico.P, I: pico.I, C: pico.C, O: pico.O },
    'pico.criteria': {
      incl: pico.incl, excl: pico.excl, studyDesign: pico.studyDesign,
      timeframe: pico.timeframe, timeframeMode: pico.timeframeMode,
      tfStart: pico.tfStart, tfEnd: pico.tfEnd,
    },
    'pico.registration': { prosperoId: pico.prosperoId },
    'search.databases': search.dbs || {},
    'search.date': search.date,
    'search.strategy': { string: search.string, searchMethodsText: clean(opts.searchMethodsText) },
    'prisma.counts': computePrismaCounts(p, opts).counts,
    'screening.workflow': {
      reviewers: opts.reviewers != null ? opts.reviewers : null,
      blind: opts.blind != null ? !!opts.blind : null,
      conflictResolution: opts.conflictResolution || null,
    },
    'studies.roster': rosterSlice,
    'studies.values': valuesSlice,
    'extraction.conversions': conversionsSlice,
    'analysis.model': analysis.model,
    'analysis.tau2': analysis.tau2Method,
    'rob.method': p.robMethod || null,
    'rob.judgments': { rob: robSlice, assessments: opts.robAssessments || null },
    'grade.certainty': { grade: p.grade || null, byOutcome: opts.gradeByOutcome || null },
    'pubBias.results': opts.pubBias || null,
    'engine.versions': collectEngineVersions(),
    'template.style': { templateId: opts.templateId, citationStyle: opts.citationStyle },
  };

  const out = {};
  for (const key of DEPENDENCY_KEY_IDS) out[key] = hashOf(values[key]);
  return out;
}

/** Subset a full dependency state to just the keys a section depends on. Pure. */
export function sectionDepState(sectionId, depState) {
  const keys = SECTION_DEPENDENCIES[sectionId] || [];
  const src = depState || {};
  const out = {};
  for (const k of keys) if (k in src) out[k] = src[k];
  return out;
}

/**
 * Which of a section's dependency keys changed between the stored fingerprint and
 * a fresh one. An empty/absent stored depState → [] (status UNKNOWN, never fake
 * reasons); a key missing from stored counts as changed only when it is present
 * in fresh AND stored has at least one key. Pure.
 */
export function diffDeps(storedDepState, freshDepState, sectionId) {
  const stored = storedDepState || {};
  const fresh = freshDepState || {};
  const keys = SECTION_DEPENDENCIES[sectionId] || [];
  if (!Object.keys(stored).length) return [];
  const changed = [];
  for (const k of keys) {
    if (!(k in fresh)) continue;
    if (!(k in stored)) { changed.push(k); continue; }
    if (stored[k] !== fresh[k]) changed.push(k);
  }
  return changed;
}

/** Decorate dependency keys with their label + category for the UI. Pure. */
export function explainKeys(keys) {
  return (Array.isArray(keys) ? keys : []).map((key) => ({
    key,
    label: (DEPENDENCY_KEYS[key] && DEPENDENCY_KEYS[key].label) || key,
    category: (DEPENDENCY_KEYS[key] && DEPENDENCY_KEYS[key].category) || 'methods',
  }));
}

export default {
  DEPENDENCY_KEYS,
  DEPENDENCY_KEY_IDS,
  SECTION_DEPENDENCIES,
  computeDependencyState,
  sectionDepState,
  diffDeps,
  explainKeys,
};
