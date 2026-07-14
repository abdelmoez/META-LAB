/**
 * 88.md — pure research-provenance engine tests. Covers taxonomy integrity, diff
 * sanitization, the generic before→after emitter (incl. the core search-mode and
 * analysis-model examples), deterministic significance/manuscript-relevance
 * classification, immutable analysis-run resolution, and derived scientific state.
 */
import { describe, it, expect } from 'vitest';
import {
  EVENT_TYPES, EVENT_TYPE_IDS, eventTypeMeta, isValidEventType, SIGNIFICANCE, CATEGORIES, ORIGINS,
} from '../../../src/research-engine/provenance/taxonomy.js';
import { fnv1a, stableStringify, sanitizeValue, isNoop, structuredDiff } from '../../../src/research-engine/provenance/diff.js';
import { diffProjectEvents } from '../../../src/research-engine/provenance/emit.js';
import { classifyEvent, manuscriptSectionsForKeys, diffIsEmpty } from '../../../src/research-engine/provenance/classify.js';
import {
  ANALYSIS_STATUS, makeRunRecord, resolveEffectiveAnalyses, isReportable,
} from '../../../src/research-engine/provenance/analysisRuns.js';
import { deriveScientificState } from '../../../src/research-engine/provenance/derivedState.js';
import { fingerprintState } from '../../../src/research-engine/provenance/fingerprint.js';

describe('taxonomy', () => {
  it('every event type has a valid category + numeric significance 0..6', () => {
    for (const id of EVENT_TYPE_IDS) {
      const m = EVENT_TYPES[id];
      expect(CATEGORIES).toContain(m.category);
      expect(m.significance).toBeGreaterThanOrEqual(0);
      expect(m.significance).toBeLessThanOrEqual(6);
      if (m.origin) expect(ORIGINS).toContain(m.origin);
    }
  });
  it('unknown type falls back to a safe admin meta', () => {
    expect(isValidEventType('NOPE')).toBe(false);
    expect(eventTypeMeta('NOPE').significance).toBe(SIGNIFICANCE.ADMINISTRATIVE);
  });
  it('critical/result-changing types are tagged for review or reason', () => {
    expect(EVENT_TYPES.ELIGIBILITY_CRITERIA_CHANGED.significance).toBe(SIGNIFICANCE.CRITICAL);
    expect(EVENT_TYPES.META_ANALYSIS_MODEL_CHANGED.significance).toBe(SIGNIFICANCE.RESULT_CHANGING);
    expect(EVENT_TYPES.CHART_APPEARANCE_CHANGED.significance).toBe(SIGNIFICANCE.COSMETIC);
  });
});

describe('diff', () => {
  it('fnv1a is stable + order-independent for objects', () => {
    expect(fnv1a({ a: 1, b: 2 })).toBe(fnv1a({ b: 2, a: 1 }));
    expect(fnv1a('x')).not.toBe(fnv1a('y'));
  });
  it('sanitizeValue redacts sensitive keys and truncates long strings', () => {
    const s = sanitizeValue({ token: 'abc', password: 'p', keep: 'ok' });
    expect(s.token).toBe('[redacted]');
    expect(s.password).toBe('[redacted]');
    expect(s.keep).toBe('ok');
    const long = 'x'.repeat(5000);
    const st = sanitizeValue(long);
    expect(st.__truncated).toBe(true);
    expect(st.__size).toBe(5000);
  });
  it('sanitizeValue caps large arrays with a head sample', () => {
    const big = sanitizeValue(Array.from({ length: 200 }, (_, i) => i));
    expect(big.__array).toBe(true);
    expect(big.__size).toBe(200);
    expect(big.head.length).toBe(5);
  });
  it('stableStringify keeps shared (acyclic) refs — only true cycles are [circular]', () => {
    const shared = { x: 1, y: 2 };
    // A DAG (same ref in two sibling slots) must serialize fully, not collapse to [circular].
    expect(stableStringify({ a: shared, b: shared })).toBe(stableStringify({ a: { x: 1, y: 2 }, b: { x: 1, y: 2 } }));
    expect(stableStringify({ a: shared, b: shared })).not.toContain('[circular]');
    // A genuine cycle is still guarded.
    const cyc = { z: 1 }; cyc.self = cyc;
    expect(stableStringify(cyc)).toContain('[circular]');
    // Two DAG-shaped states that differ must still hash differently (not both masked).
    expect(fnv1a({ a: shared, b: shared })).not.toBe(fnv1a({ a: { x: 9 }, b: { x: 9 } }));
  });
  it('isNoop + structuredDiff detect real vs no change', () => {
    expect(isNoop({ a: 1 }, { a: 1 })).toBe(true);
    const d = structuredDiff({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 });
    expect(d.kind).toBe('object');
    expect(d.changed.b).toEqual({ prev: 2, next: 3 });
    expect(d.added).toContain('c');
  });
});

describe('emit — generic before→after', () => {
  it('CORE EXAMPLE: project search mode automated → manual emits SEARCH_MODE_CHANGED', () => {
    const before = { search: { searchMode: 'automated', dbs: { PubMed: 1 } } };
    const after = { search: { searchMode: 'manual', dbs: { PubMed: 1 } } };
    const evs = diffProjectEvents(before, after);
    const e = evs.find((x) => x.eventType === 'SEARCH_MODE_CHANGED');
    expect(e).toBeTruthy();
    expect(e.prevValue).toBe('automated');
    expect(e.newValue).toBe('manual');
  });
  it('per-database method change emits DATABASE_SEARCH_METHOD_CHANGED (mixed methods)', () => {
    const before = { search: { dbs: { PubMed: 1, Embase: 1 }, dbMethods: { PubMed: 'automated', Embase: 'automated' } } };
    const after = { search: { dbs: { PubMed: 1, Embase: 1 }, dbMethods: { PubMed: 'automated', Embase: 'manual' } } };
    const evs = diffProjectEvents(before, after);
    const e = evs.find((x) => x.eventType === 'DATABASE_SEARCH_METHOD_CHANGED');
    expect(e.entityId).toBe('Embase');
    expect(e.newValue).toBe('manual');
  });
  it('database add / remove', () => {
    const evs = diffProjectEvents({ search: { dbs: { PubMed: 1 } } }, { search: { dbs: { PubMed: 1, Scopus: 1 } } });
    expect(evs.some((e) => e.eventType === 'DATABASE_ADDED' && e.entityId === 'Scopus')).toBe(true);
    const evs2 = diffProjectEvents({ search: { dbs: { PubMed: 1, Scopus: 1 } } }, { search: { dbs: { PubMed: 1 } } });
    expect(evs2.some((e) => e.eventType === 'DATABASE_REMOVED' && e.entityId === 'Scopus')).toBe(true);
  });
  it('CORE EXAMPLE: fixed → random model emits META_ANALYSIS_MODEL_CHANGED', () => {
    const evs = diffProjectEvents({ analysisSettings: { model: 'fixed' } }, { analysisSettings: { model: 'random' } });
    const e = evs.find((x) => x.eventType === 'META_ANALYSIS_MODEL_CHANGED');
    expect(e.prevValue).toBe('fixed');
    expect(e.newValue).toBe('random');
  });
  it('estimator + effect-measure changes', () => {
    const evs = diffProjectEvents(
      { analysisSettings: { tau2Method: 'DL', effectMeasure: 'RR' } },
      { analysisSettings: { tau2Method: 'REML', effectMeasure: 'OR' } });
    expect(evs.some((e) => e.eventType === 'HETEROGENEITY_ESTIMATOR_CHANGED')).toBe(true);
    expect(evs.some((e) => e.eventType === 'EFFECT_MEASURE_CHANGED')).toBe(true);
  });
  it('study exclusion + extracted value change', () => {
    const before = { studies: [{ id: 's1', outcome: 'mortality', es: 1.2 }, { id: 's2', outcome: 'mortality', es: 0.9 }] };
    const after = { studies: [{ id: 's1', outcome: 'mortality', es: 1.5 }, { id: 's2', outcome: 'mortality', es: 0.9, excludeFromAnalysis: true }] };
    const evs = diffProjectEvents(before, after);
    expect(evs.some((e) => e.eventType === 'EXTRACTED_VALUE_CHANGED' && e.entityId === 's1')).toBe(true);
    expect(evs.some((e) => e.eventType === 'STUDY_EXCLUDED_FROM_ANALYSIS' && e.entityId === 's2')).toBe(true);
  });
  it('eligibility criteria change is captured', () => {
    const evs = diffProjectEvents({ pico: { incl: 'RCTs' } }, { pico: { incl: 'RCTs and cohorts' } });
    expect(evs.some((e) => e.eventType === 'ELIGIBILITY_CRITERIA_CHANGED')).toBe(true);
  });
  it('no scientific change → no events (a cosmetic-only save)', () => {
    const p = { name: 'x', search: { dbs: { PubMed: 1 } }, analysisSettings: { model: 'random' } };
    expect(diffProjectEvents(p, { ...p, chartColor: '#fff' }).length).toBe(0);
  });
  it('bulk study changes collapse into a summary (event aggregation)', () => {
    const mk = (n, mut) => ({ studies: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, outcome: 'o', es: mut ? i + 1 : i })) });
    const evs = diffProjectEvents(mk(40, false), mk(40, true));
    const valueEvs = evs.filter((e) => e.eventType === 'EXTRACTED_VALUE_CHANGED');
    expect(valueEvs.length).toBe(1);
    expect(valueEvs[0].metadata.bulk).toBe(true);
    expect(valueEvs[0].metadata.count).toBe(40);
  });
});

describe('classify — deterministic significance + manuscript relevance', () => {
  it('reverse-maps dependency keys to sections', () => {
    const secs = manuscriptSectionsForKeys(['analysis.model']);
    expect(secs).toContain('methods');
    expect(secs).toContain('results');
    expect(secs).toContain('abstract');
  });
  it('model change → result-changing, refreshes Methods+Results, requires review', () => {
    const c = classifyEvent({ eventType: 'META_ANALYSIS_MODEL_CHANGED', diff: { kind: 'scalar', prev: 'fixed', next: 'random' } });
    expect(c.significance).toBe(SIGNIFICANCE.RESULT_CHANGING);
    expect(c.manuscriptSections).toContain('methods');
    expect(c.requiresManuscriptRefresh).toBe(true);
    expect(c.requiresReview).toBe(true);
  });
  it('cosmetic chart change → no manuscript refresh, no review', () => {
    const c = classifyEvent({ eventType: 'CHART_APPEARANCE_CHANGED', diff: { kind: 'scalar', prev: 'blue', next: 'red' } });
    expect(c.significance).toBe(SIGNIFICANCE.COSMETIC);
    expect(c.manuscriptSections).toEqual([]);
    expect(c.requiresManuscriptRefresh).toBe(false);
  });
  it('a no-op diff collapses to operational L0 (reverted selection)', () => {
    const c = classifyEvent({ eventType: 'META_ANALYSIS_MODEL_CHANGED', diff: { kind: 'scalar', prev: 'random', next: 'random' } });
    expect(c.significance).toBe(SIGNIFICANCE.OPERATIONAL);
    expect(c.requiresManuscriptRefresh).toBe(false);
    expect(diffIsEmpty({ kind: 'scalar', prev: 'a', next: 'a' })).toBe(true);
  });
  it('typo correction (no dependency keys) is logged but not manuscript-worthy', () => {
    const c = classifyEvent({ eventType: 'STUDY_LABEL_CORRECTED', diff: { kind: 'scalar', prev: 'Smith 2010', next: 'Smith 2011' } });
    expect(c.significance).toBe(SIGNIFICANCE.DATA_CORRECTION);
    expect(c.manuscriptSections).toEqual([]);
    expect(c.requiresManuscriptRefresh).toBe(false);
  });
  it('numericChange=changed upgrades resultImpact and forces review', () => {
    const c = classifyEvent({ eventType: 'EXTRACTED_VALUE_CHANGED', diff: { kind: 'object', changed: { es: { prev: 1, next: 2 } }, added: [], removed: [] } }, { numericChange: 'changed' });
    expect(c.resultImpact).toBe('changed');
    expect(c.requiresReview).toBe(true);
    expect(c.requiresRecalc).toBe(true);
  });
  it('eligibility change is critical and requires review', () => {
    const c = classifyEvent({ eventType: 'ELIGIBILITY_CRITERIA_CHANGED', diff: { kind: 'scalar', prev: 'a', next: 'b' } });
    expect(c.significance).toBe(SIGNIFICANCE.CRITICAL);
    expect(c.requiresReview).toBe(true);
    expect(c.manuscriptSections).toContain('methods');
  });
});

describe('analysisRuns — final vs exploratory vs superseded', () => {
  it('resolves the FINAL run as primary over earlier exploratory runs', () => {
    const runs = [
      makeRunRecord({ outcome: 'mortality', model: 'fixed' }, null, { id: 'r1', status: ANALYSIS_STATUS.EXPLORATORY, at: '2026-01-01' }),
      makeRunRecord({ outcome: 'mortality', model: 'random' }, null, { id: 'r2', status: ANALYSIS_STATUS.FINAL, at: '2026-02-01' }),
      makeRunRecord({ outcome: 'mortality', model: 'fixed' }, null, { id: 'r3', status: ANALYSIS_STATUS.SENSITIVITY, at: '2026-02-02' }),
    ];
    const eff = resolveEffectiveAnalyses(runs);
    const key = 'mortality ';
    expect(eff[key].primary.id).toBe('r2');
    expect(eff[key].sensitivity.map((r) => r.id)).toEqual(['r3']);
    expect(eff[key].history.map((r) => r.id)).toContain('r1');
  });
  it('picks the NEWEST-timestamped primary even when a null-`at` run is interleaved (total order)', () => {
    const runs = [
      makeRunRecord({ outcome: 'm', model: 'random' }, null, { id: 'A', status: ANALYSIS_STATUS.PRIMARY, at: '2026-05-01' }),
      makeRunRecord({ outcome: 'm', model: 'fixed' }, null, { id: 'B', status: ANALYSIS_STATUS.PRIMARY, at: null }),
      makeRunRecord({ outcome: 'm', model: 'random' }, null, { id: 'C', status: ANALYSIS_STATUS.PRIMARY, at: '2026-03-01' }),
    ];
    // Non-transitive comparator regression: must be the newest REAL timestamp (A=May), never C (March).
    expect(resolveEffectiveAnalyses(runs)['m '].primary.id).toBe('A');
  });
  it('exploratory-only history has no reportable primary', () => {
    const runs = [makeRunRecord({ outcome: 'x' }, null, { id: 'r1', status: ANALYSIS_STATUS.EXPLORATORY })];
    expect(resolveEffectiveAnalyses(runs)['x '].primary).toBe(null);
    expect(isReportable(ANALYSIS_STATUS.EXPLORATORY)).toBe(false);
    expect(isReportable(ANALYSIS_STATUS.FINAL)).toBe(true);
  });
});

describe('derivedState', () => {
  it('reports mixed-method search from per-database methods', () => {
    const p = { search: { searchMode: 'automated', dbs: { PubMed: 1, Embase: 1 }, dbMethods: { Embase: 'manual' } } };
    const st = deriveScientificState(p, []);
    expect(st.search.mixedMethods).toBe(true);
    expect(st.search.databases.find((d) => d.name === 'Embase').method).toBe('manual');
    expect(st.search.databases.find((d) => d.name === 'PubMed').method).toBe('automated');
  });
  it('flags potential deviations from critical events', () => {
    const events = [{ id: 5, eventType: 'ELIGIBILITY_CRITERIA_CHANGED', significance: 6, stage: 'eligibility', reason: 'scope refined' }];
    const st = deriveScientificState({ studies: [] }, events);
    expect(st.provenance.potentialDeviations.length).toBe(1);
    expect(st.provenance.lastChangeByStage.eligibility.eventType).toBe('ELIGIBILITY_CRITERIA_CHANGED');
  });
  it('fingerprintState changes when a scientific slice changes, stable otherwise', () => {
    const a = fingerprintState({ analysisSettings: { model: 'random' } });
    const b = fingerprintState({ analysisSettings: { model: 'random' } });
    const c = fingerprintState({ analysisSettings: { model: 'fixed' } });
    expect(a.analysisModel).toBe(b.analysisModel);
    expect(a.analysisModel).not.toBe(c.analysisModel);
  });
});
