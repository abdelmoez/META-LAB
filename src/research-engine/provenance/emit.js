/**
 * provenance/emit.js — 88.md Part V + AC-25. The generic, deterministic emitter:
 * diff a project blob before→after and produce typed event DRAFTS for every
 * scientifically-meaningful change, so no methodological change can slip through
 * unlogged even when a mutation site was not hand-instrumented.
 *
 * Drafts are partial events: { eventType, entityType?, entityId?, prevValue,
 * newValue, diff, relatedStudy?, relatedOutcome?, origin?, metadata? }. classify.js
 * fills significance / manuscriptSections / resultImpact; the server stamps actor,
 * timestamps, projectRev. Bulk changes (>MAX_GRANULAR studies) collapse into one
 * summary draft (88.md "Event Aggregation") instead of thousands of rows.
 *
 * Pure — no DOM/React/network/Date.
 */

import { isNoop, structuredDiff, sanitizeValue } from './diff.js';
import { SCIENTIFIC_SLICES, SLICE_KEYS, studyValues, studyRoster, searchDatabases, searchDbMethods } from './fingerprint.js';

const MAX_GRANULAR = 20;
const arr = (v) => (Array.isArray(v) ? v : []);

/** sliceKey → eventType for the flat scalar/shallow slices. */
const SLICE_EVENT = Object.freeze({
  searchMode: 'SEARCH_MODE_CHANGED',
  searchStrategy: 'SEARCH_STRATEGY_UPDATED',
  searchDate: 'SEARCH_DATE_CHANGED',
  picoQuestion: 'RESEARCH_QUESTION_CHANGED',
  picoCriteria: 'ELIGIBILITY_CRITERIA_CHANGED',
  picoRegistration: 'PROTOCOL_UPDATED',
  analysisModel: 'META_ANALYSIS_MODEL_CHANGED',
  analysisTau2: 'HETEROGENEITY_ESTIMATOR_CHANGED',
  effectMeasure: 'EFFECT_MEASURE_CHANGED',
  continuityCorrection: 'CONTINUITY_CORRECTION_CHANGED',
  confidenceLevel: 'CONFIDENCE_LEVEL_CHANGED',
  robMethod: 'RISK_OF_BIAS_TOOL_CHANGED',
});

const isEmpty = (v) => v == null || v === '' || (typeof v === 'object' && Object.values(v).every((x) => x == null || x === ''));

/** Flat-slice detectors: one event per changed slice. */
function detectSlices(before, after) {
  const out = [];
  for (const key of SLICE_KEYS) {
    const prev = SCIENTIFIC_SLICES[key].get(before);
    const next = SCIENTIFIC_SLICES[key].get(after);
    if (isNoop(prev, next)) continue;
    let eventType = SLICE_EVENT[key];
    if (key === 'picoRegistration') eventType = isEmpty(prev) ? 'PROTOCOL_REGISTERED' : 'PROTOCOL_UPDATED';
    out.push({
      eventType,
      entityType: 'project',
      prevValue: sanitizeValue(prev),
      newValue: sanitizeValue(next),
      diff: structuredDiff(prev, next),
    });
  }
  return out;
}

/** Databases added/removed (keys of search.dbs) + per-database method changes. */
function detectDatabases(before, after) {
  const out = [];
  const pDbs = searchDatabases(before);
  const nDbs = searchDatabases(after);
  const pKeys = new Set(Object.keys(pDbs).filter((k) => pDbs[k]));
  const nKeys = new Set(Object.keys(nDbs).filter((k) => nDbs[k]));
  for (const db of nKeys) if (!pKeys.has(db)) out.push({ eventType: 'DATABASE_ADDED', entityType: 'database', entityId: db, prevValue: null, newValue: db, diff: { kind: 'scalar', prev: null, next: db } });
  for (const db of pKeys) if (!nKeys.has(db)) out.push({ eventType: 'DATABASE_REMOVED', entityType: 'database', entityId: db, prevValue: db, newValue: null, diff: { kind: 'scalar', prev: db, next: null } });

  const pM = searchDbMethods(before);
  const nM = searchDbMethods(after);
  for (const db of new Set([...Object.keys(pM), ...Object.keys(nM)])) {
    if (isNoop(pM[db] ?? null, nM[db] ?? null)) continue;
    out.push({
      eventType: 'DATABASE_SEARCH_METHOD_CHANGED', entityType: 'database', entityId: db,
      prevValue: pM[db] ?? null, newValue: nM[db] ?? null,
      diff: { kind: 'scalar', prev: pM[db] ?? null, next: nM[db] ?? null },
    });
  }
  return out;
}

/** Study roster (inclusion) + extracted-value changes, with bulk aggregation. */
function detectStudies(before, after) {
  const out = [];
  const pStudies = arr(before && before.studies);
  const nStudies = arr(after && after.studies);
  const pById = new Map(pStudies.map((s) => [s && s.id, s]));
  const nById = new Map(nStudies.map((s) => [s && s.id, s]));

  const rosterEvents = [];
  const valueEvents = [];

  // Added / removed / inclusion-flipped studies.
  for (const [id, ns] of nById) {
    if (id == null) continue;
    const ps = pById.get(id);
    const nr = studyRoster(ns);
    if (!ps) {
      rosterEvents.push({ eventType: 'STUDY_INCLUDED', entityType: 'study', entityId: id, relatedOutcome: nr.outcome, prevValue: null, newValue: nr, diff: { kind: 'scalar', prev: null, next: 'included' } });
      continue;
    }
    const pr = studyRoster(ps);
    if (pr.included !== nr.included) {
      const excluded = nr.included === false;
      rosterEvents.push({
        eventType: excluded ? 'STUDY_EXCLUDED_FROM_ANALYSIS' : 'STUDY_INCLUDED_IN_ANALYSIS',
        entityType: 'study', entityId: id, relatedOutcome: nr.outcome,
        prevValue: pr.included ? 'included' : 'excluded', newValue: nr.included ? 'included' : 'excluded',
        diff: { kind: 'scalar', prev: pr.included ? 'included' : 'excluded', next: nr.included ? 'included' : 'excluded' },
      });
    }
    // Extracted-value change on an existing study.
    const pv = studyValues(ps);
    const nv = studyValues(ns);
    if (!isNoop(pv, nv)) {
      valueEvents.push({
        eventType: 'EXTRACTED_VALUE_CHANGED', entityType: 'study', entityId: id, relatedOutcome: nr.outcome,
        prevValue: sanitizeValue(pv), newValue: sanitizeValue(nv), diff: structuredDiff(pv, nv),
      });
    }
  }
  for (const [id, ps] of pById) {
    if (id == null || nById.has(id)) continue;
    const pr = studyRoster(ps);
    rosterEvents.push({ eventType: 'STUDY_EXCLUDED', entityType: 'study', entityId: id, relatedOutcome: pr.outcome, prevValue: pr, newValue: null, diff: { kind: 'scalar', prev: 'included', next: 'removed' } });
  }

  out.push(...collapse(rosterEvents, 'roster'));
  out.push(...collapse(valueEvents, 'values'));
  return out;
}

/** Keep events granular up to MAX_GRANULAR; beyond that emit one bulk summary. */
function collapse(events, kind) {
  if (events.length <= MAX_GRANULAR) return events;
  const byType = {};
  for (const e of events) byType[e.eventType] = (byType[e.eventType] || 0) + 1;
  const sampleIds = events.slice(0, 5).map((e) => e.entityId).filter((x) => x != null);
  const eventType = kind === 'values' ? 'EXTRACTED_VALUE_CHANGED'
    : (byType.STUDY_EXCLUDED || byType.STUDY_EXCLUDED_FROM_ANALYSIS ? 'STUDY_EXCLUDED_FROM_ANALYSIS' : 'STUDY_INCLUDED_IN_ANALYSIS');
  return [{
    eventType, entityType: 'study_batch', entityId: null,
    prevValue: null, newValue: null,
    diff: { kind: 'bulk', byType, total: events.length },
    metadata: { bulk: true, count: events.length, byType, sampleIds },
  }];
}

/**
 * diffProjectEvents(before, after, ctx) → event drafts for every scientific change.
 * ctx (optional) may carry { origin, reason, correlationId, actorUserId, sessionId,
 * eventTypeOverride } that the server merges onto every draft. Pure.
 */
export function diffProjectEvents(before, after, ctx = {}) {
  const b = before || {};
  const a = after || {};
  const drafts = [
    ...detectSlices(b, a),
    ...detectDatabases(b, a),
    ...detectStudies(b, a),
  ];
  if (!drafts.length) return [];
  const extra = {};
  if (ctx.origin) extra.origin = ctx.origin;
  if (ctx.reason) extra.reason = ctx.reason;
  if (ctx.correlationId) extra.correlationId = ctx.correlationId;
  return drafts.map((d) => ({ ...d, ...extra }));
}

export default { diffProjectEvents };
