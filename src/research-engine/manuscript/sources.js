/**
 * manuscript/sources.js — 73.md Part 8. Grounding/provenance layer for the
 * generated manuscript sections. For every section this computes:
 *   sources     [{key, label}]  — the engines/data the section ACTUALLY read
 *   missing     [{field, hint}] — data that would enrich the section (never blocks)
 *   inputsHash  FNV-1a hex (sourceHash.js) of the EXACT inputs the section read
 *
 * The inputsHash powers per-section OUTDATED detection: the UI stores the hash on
 * the section at generation time (model.js — additive optional fields) and later
 * compares it against computeSectionInputsHashes(project, opts). A changed hash
 * means the section was generated from different data; an unchanged hash means
 * regenerating would be a no-op. Hashes deliberately exclude volatile opts
 * (generatedAt, software) so a timestamp can never fake staleness.
 *
 * Pure — no DOM/React/network. Deterministic for identical (project, opts).
 */

import { hashOf } from './sourceHash.js';
import { computePrismaCounts } from './prismaCounts.js';
import { getOutcomePairs, filterStudiesForOutcome } from '../import-export/journalSubmission.js';
import { resolveAnalysis } from './analysisDescribe.js';
import { SECTION_IDS } from './model.js';
// 84.md — per-section dependency fingerprint stamped into sectionMeta. dependencies.js
// must NOT import this file (one-way dependency direction — see dependencies.js header).
import { computeDependencyState, sectionDepState } from './dependencies.js';

const clean = (s) => String(s == null ? '' : s).trim();

/** Canonical source registry — keys are stable API for the UI badges. */
export const SOURCE_LABELS = {
  pico: 'PICO & eligibility criteria',
  search: 'Search strategy',
  screening: 'Screening decisions',
  prisma: 'PRISMA flow counts',
  studies: 'Included studies',
  analysis: 'Meta-analysis results',
  rob: 'Risk-of-bias assessments',
  grade: 'GRADE certainty ratings',
  pubBias: 'Publication-bias tests',
  template: 'Journal template',
};

const src = (key) => ({ key, label: SOURCE_LABELS[key] || key });

/**
 * Per-section input snapshots + sources + missing. Internal shape:
 * { [sectionId]: { inputs, sources, missing } }.
 *
 * @param {object} project  Project.data blob
 * @param {object} [opts]   the generateDraft opts (screening, searchMethodsText,
 *                          analysis, pubBias, reviewers, templateId, prismaCounts…)
 */
export function computeSectionInputs(project, opts = {}) {
  const p = project || {};
  const pico = p.pico || {};
  const search = p.search || {};
  const studies = Array.isArray(p.studies) ? p.studies : [];
  const analysisCfg = resolveAnalysis(p, opts);
  const pc = opts.prismaCounts || computePrismaCounts(p, opts);
  const pairs = getOutcomePairs(studies);
  const pooledPairs = pairs.filter((pair) => filterStudiesForOutcome(studies, pair).length >= 2);
  const maxK = pooledPairs.reduce((m, pair) => Math.max(m, filterStudiesForOutcome(studies, pair).length), 0);

  // Slim, stable projections (only fields the narration reads).
  const esStudies = studies.map((s) => ({
    id: s.id, outcome: s.outcome, timepoint: s.timepoint, esType: s.esType,
    es: s.es, lo: s.lo, hi: s.hi,
  }));
  const robSlice = studies.map((s) => ({ id: s.id, rob: s.rob || null }));
  const picoSlice = {
    question: pico.question, P: pico.P, I: pico.I, C: pico.C, O: pico.O,
    incl: pico.incl, excl: pico.excl, studyDesign: pico.studyDesign,
    timeframe: pico.timeframe, timeframeMode: pico.timeframeMode,
    tfStart: pico.tfStart, tfEnd: pico.tfEnd, prosperoId: pico.prosperoId,
  };
  const searchSlice = { dbs: search.dbs || {}, date: search.date, string: search.string, notes: search.notes };
  const screeningWf = {
    reviewers: opts.reviewers != null ? opts.reviewers : null,
    blind: opts.blind != null ? !!opts.blind : null,
    conflictResolution: opts.conflictResolution || null,
  };
  const gradePresent = !!(p.grade && Object.keys(p.grade).length);
  const anyPico = ['question', 'P', 'I', 'C', 'O'].some((k) => clean(pico[k]));
  const anySearch = Object.keys(search.dbs || {}).some((k) => search.dbs[k]) || clean(search.date);
  const anyRob = studies.some((s) => s && s.rob && Object.keys(s.rob).length) || !!(opts.robAssessments && Object.keys(opts.robAssessments).length);
  const anyPooled = pooledPairs.length > 0;
  const hasScreening = !!(opts.screening && Object.keys(opts.screening).length);
  const hasSearchText = !!clean(opts.searchMethodsText);
  const hasPubBias = !!(opts.pubBias && Object.keys(opts.pubBias).length);

  const missingIf = (cond, field, hint) => (cond ? [{ field, hint }] : []);

  const out = {};

  out.title = {
    inputs: { name: p.name || '', I: pico.I || '', P: pico.P || '' },
    sources: (clean(pico.I) || clean(pico.P)) ? [src('pico')] : [],
    missing: missingIf(!clean(p.name), 'project.name', 'A project name becomes the working title.'),
  };

  out.abstract = {
    inputs: {
      pico: { question: pico.question, P: pico.P, I: pico.I, C: pico.C, O: pico.O },
      search: searchSlice, prisma: pc.counts, esStudies, analysis: analysisCfg,
      templateId: opts.templateId || '', screening: opts.screening || null,
    },
    sources: [
      anyPico && src('pico'), anySearch && src('search'),
      hasScreening && src('screening'), pc.hasAny && src('prisma'),
      anyPooled && src('analysis'), opts.templateId ? src('template') : null,
    ].filter(Boolean),
    missing: [
      ...missingIf(!clean(pico.question), 'pico.question', 'The review question drives the Background/Objectives.'),
      ...missingIf(!anySearch, 'search', 'Select databases and a search date for the Methods sentence.'),
      ...missingIf(!anyPooled, 'analysis', 'A pooled analysis (≥2 studies per outcome) fills the Results sentence.'),
    ],
  };

  out.introduction = {
    inputs: { pico: picoSlice },
    sources: anyPico ? [src('pico')] : [],
    missing: missingIf(!clean(pico.question), 'pico.question', 'State the review question in the PICO tab.'),
  };

  out.methods = {
    inputs: {
      pico: picoSlice, search: searchSlice, prisma: pc.counts,
      screeningWorkflow: screeningWf, screening: opts.screening || null,
      analysis: analysisCfg, robMethod: p.robMethod || '', grade: gradePresent,
      searchMethodsText: clean(opts.searchMethodsText) || '',
      outcomes: pairs.map((x) => x.label),
    },
    sources: [
      anyPico && src('pico'), (anySearch || hasSearchText) && src('search'),
      (hasScreening || screeningWf.reviewers != null) && src('screening'),
      pc.hasAny && src('prisma'), anyPooled && src('analysis'),
      (clean(p.robMethod) || anyRob) && src('rob'), gradePresent && src('grade'),
    ].filter(Boolean),
    missing: [
      ...missingIf(!clean(pico.incl), 'pico.incl', 'Inclusion criteria render as an eligibility bullet list.'),
      ...missingIf(!clean(pico.excl), 'pico.excl', 'Exclusion criteria render as an eligibility bullet list.'),
      ...missingIf(!hasSearchText, 'searchMethodsText', 'Connect the search-builder methods text for a database-specific search paragraph.'),
      ...missingIf(screeningWf.reviewers == null, 'reviewers', 'Reviewer count/workflow makes the study-selection paragraph specific.'),
      ...missingIf(!clean(pico.prosperoId), 'pico.prosperoId', 'A PROSPERO ID completes the registration statement.'),
    ],
  };

  out.results = {
    inputs: {
      prisma: pc.counts, screening: opts.screening || null, esStudies,
      analysis: analysisCfg, rob: robSlice, pubBias: opts.pubBias || null,
    },
    sources: [
      pc.hasAny && src('prisma'), hasScreening && src('screening'),
      studies.length && src('studies'), anyPooled && src('analysis'),
      anyRob && src('rob'), (hasPubBias || (anyPooled && maxK >= 10)) && src('pubBias'),
    ].filter(Boolean),
    missing: [
      ...missingIf(!hasScreening && !pc.hasAny, 'screening', 'Screening summary counts complete the PRISMA flow narrative.'),
      ...missingIf(!anyRob, 'rob', 'Risk-of-bias assessments fill the Risk of bias paragraph.'),
      ...missingIf(maxK >= 10 && !hasPubBias, 'pubBias', 'Precomputed publication-bias results (Egger/trim-and-fill) enrich the synthesis narrative.'),
    ],
  };

  out.discussion = {
    inputs: { esStudies, analysis: analysisCfg, grade: gradePresent },
    sources: [studies.length && src('studies'), anyPooled && src('analysis'), gradePresent && src('grade')].filter(Boolean),
    missing: missingIf(!gradePresent, 'grade', 'GRADE certainty ratings strengthen the summary of evidence.'),
  };

  out.limitations = {
    inputs: { esStudies, analysis: analysisCfg, rob: robSlice },
    sources: [studies.length && src('studies'), anyPooled && src('analysis'), anyRob && src('rob')].filter(Boolean),
    missing: [],
  };

  out.conclusion = {
    inputs: { esStudies, analysis: analysisCfg },
    sources: [studies.length && src('studies'), anyPooled && src('analysis')].filter(Boolean),
    missing: [],
  };

  return out;
}

/**
 * Per-section provenance for generateDraft's additive `sectionMeta` return:
 * { [sectionId]: { sources:[{key,label}], missing:[{field,hint}], inputsHash } }.
 * Pure, deterministic.
 */
export function computeSectionMeta(project, opts = {}) {
  const all = computeSectionInputs(project, opts);
  // 84.md — compute the full dependency fingerprint ONCE, then slice per section so
  // an accepted/generated section can stamp its depState for later diffDeps.
  const depState = computeDependencyState(project, opts);
  const out = {};
  for (const id of SECTION_IDS) {
    const e = all[id];
    if (!e) continue;
    out[id] = {
      sources: e.sources, missing: e.missing, inputsHash: hashOf(e.inputs),
      depState: sectionDepState(id, depState),
    };
  }
  return out;
}

/**
 * { [sectionId]: inputsHash } — lets the UI evaluate per-section staleness
 * (stored section.inputsHash !== fresh hash → OUTDATED badge) WITHOUT
 * regenerating any text. Pure.
 */
export function computeSectionInputsHashes(project, opts = {}) {
  const all = computeSectionInputs(project, opts);
  const out = {};
  for (const id of SECTION_IDS) if (all[id]) out[id] = hashOf(all[id].inputs);
  return out;
}

export default { SOURCE_LABELS, computeSectionInputs, computeSectionMeta, computeSectionInputsHashes };
