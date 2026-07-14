/**
 * provenance/derivedState.js — 88.md Part II "Derived Scientific Project State".
 * The manuscript engine must NOT read a chronological list of raw events; it reads
 * a structured, effective final state. This module consolidates the current project
 * blob + immutable analysis runs + the event ledger into one scientific state, with
 * final-vs-superseded resolution and a per-area "last change" provenance annotation.
 *
 * Pure — no DOM/React/network/Date.
 */

import { searchDatabases, searchDbMethods } from './fingerprint.js';
import { resolveEffectiveAnalyses } from './analysisRuns.js';
import { SIGNIFICANCE } from './taxonomy.js';

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
const clean = (v) => (v == null ? null : v);

/** Search state: per-database method (88.md Part VII — mixed automated/manual). */
function deriveSearch(p) {
  const search = obj(p.search);
  const dbs = searchDatabases(p);
  const methods = searchDbMethods(p);
  const projectMode = search.searchMode === 'manual' || search.searchMode === 'automated' ? search.searchMode : null;
  const databases = Object.keys(dbs).filter((k) => dbs[k]).map((name) => ({
    name,
    // per-database method overrides the project default; else the project mode.
    method: methods[name] || projectMode || 'unspecified',
  }));
  const modes = new Set(databases.map((d) => d.method).filter((m) => m && m !== 'unspecified'));
  return {
    mode: projectMode,
    mixedMethods: modes.size > 1,
    databases,
    date: clean(search.date),
    strategy: clean(search.string),
    citationMining: !!(obj(p.citationMining).enabled || p.citationMiningRun),
    livingReview: !!obj(p.living).enabled,
  };
}

function deriveScreening(p, opts) {
  const sc = obj(p.screening);
  const reviewers = opts.reviewers != null ? opts.reviewers : (sc.reviewers != null ? sc.reviewers : null);
  return {
    reviewers,
    independent: reviewers != null ? reviewers >= 2 : null,
    blind: opts.blind != null ? !!opts.blind : (sc.blind != null ? !!sc.blind : null),
    conflictResolution: opts.conflictResolution || sc.conflictResolution || null,
  };
}

function deriveExtraction(p) {
  const studies = arr(p.studies);
  const outcomes = Array.from(new Set(studies.map((s) => obj(s).outcome).filter(Boolean)));
  const anyConversion = studies.some((s) => arr(obj(s).conversions).length > 0);
  return {
    studyCount: studies.length,
    outcomes,
    conversionsUsed: anyConversion,
    included: studies.filter((s) => !obj(s).excludeFromAnalysis && !obj(s).excluded).length,
  };
}

function deriveRob(p) {
  const studies = arr(p.studies);
  return {
    tool: clean(p.robMethod),
    assessedCount: studies.filter((s) => obj(s).rob != null).length,
  };
}

function deriveAnalysis(p) {
  const settings = obj(p.analysisSettings);
  const runs = arr(p.analysisRuns);
  const model = settings.model === 'fixed' ? 'fixed' : (settings.model === 'random' ? 'random' : null);
  const base = {
    model,
    tau2Method: clean(settings.tau2Method),
    effectMeasure: clean(settings.effectMeasure ?? settings.measure),
    confidenceLevel: clean(settings.confidenceLevel),
  };
  if (!runs.length) {
    // No immutable run history yet — the current settings ARE the effective analysis.
    return { ...base, hasRunHistory: false, effective: null };
  }
  return { ...base, hasRunHistory: true, effective: resolveEffectiveAnalyses(runs) };
}

/** Reporting state: PRISMA counts if a precomputed block is present in the blob. */
function deriveReporting(p) {
  const prisma = obj(p.prisma || obj(p.screening).prisma);
  return {
    prisma: Object.keys(prisma).length ? prisma : null,
    manuscriptSectionsDrafted: arr(p.manuscripts).length || (obj(obj(p.manuscript).drafts) ? Object.keys(obj(obj(p.manuscript).drafts)).length : 0),
  };
}

/**
 * Per-area provenance: the most recent (and superseded) events touching each stage,
 * plus flagged potential deviations. Events are the ledger rows (already classified).
 */
function deriveProvenance(events) {
  const list = arr(events);
  const byStage = {};
  const deviations = [];
  for (const e of list) {
    if (!e) continue;
    const stage = e.stage || e.projectStage || 'admin';
    if (!byStage[stage] || (e.id || 0) > (byStage[stage].id || 0)) {
      byStage[stage] = { id: e.id, eventType: e.eventType, at: e.serverTs || e.at, significance: e.significance };
    }
    if (e.significance >= SIGNIFICANCE.CRITICAL || e.eventType === 'PROTOCOL_DEVIATION_FLAGGED') {
      deviations.push({ id: e.id, eventType: e.eventType, entityId: e.entityId, reason: e.reason || null, at: e.serverTs || e.at });
    }
  }
  return { lastChangeByStage: byStage, potentialDeviations: deviations };
}

/**
 * deriveScientificState(project, events, opts) — the single structured state the
 * manuscript engine and History summaries should read. Pure.
 */
export function deriveScientificState(project, events = [], opts = {}) {
  const p = obj(project);
  return {
    search: deriveSearch(p),
    screening: deriveScreening(p, opts),
    extraction: deriveExtraction(p),
    riskOfBias: deriveRob(p),
    analysis: deriveAnalysis(p),
    reporting: deriveReporting(p),
    provenance: deriveProvenance(events),
  };
}

export default { deriveScientificState };
