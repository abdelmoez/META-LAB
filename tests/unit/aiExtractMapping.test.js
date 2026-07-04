/**
 * aiExtractMapping.test.js — unit tests for the PURE mapping layer of the
 * server-proxied LLM extraction path (server/services/aiExtractClient.js).
 * No network: covers mapExtractedToStudyPatch (the HR-scale fix, enum
 * whitelists, garbage handling, string coercion) and the secret-free
 * aiExtractInfo config snapshot. The live model call is deliberately untested.
 */
import { describe, it, expect } from 'vitest';
import { mapExtractedToStudyPatch, aiExtractInfo, buildInstruction } from '../../server/services/aiExtractClient.js';
import { mkStudy } from '../../src/research-engine/project-model/defaults.js';

// ── HR-scale fix (root cause (c)) ─────────────────────────────────────────────
describe('mapExtractedToStudyPatch — ratio measures (HR-scale fix)', () => {
  it('raw HR 0.75 [0.60, 0.94] is log-transformed exactly like CONVERSIONS ratio_log', () => {
    const { patch, conversions, warnings } = mapExtractedToStudyPatch({
      ratioMeasure: 'HR', ratioEst: 0.75, ratioLo: 0.6, ratioHi: 0.94,
      author: 'Smith', year: 2020,
    });
    expect(patch.esType).toBe('HR');
    expect(Number(patch.es)).toBeCloseTo(Math.log(0.75), 4);
    expect(Number(patch.lo)).toBeCloseTo(Math.log(0.6), 4);
    expect(Number(patch.hi)).toBeCloseTo(Math.log(0.94), 4);
    expect(patch.converted).toBe(true);
    expect(patch.needsReview).toBe(true);

    // Audit record present, in the mkStudy conversions[] shape
    expect(conversions).toHaveLength(1);
    const rec = conversions[0];
    expect(rec.type).toBe('ratio_log');
    expect(rec.target).toBe('es');
    expect(rec.original).toEqual({ measure: 'HR', est: 0.75, lo: 0.6, hi: 0.94 });
    expect(typeof rec.method).toBe('string');
    expect(typeof rec.at).toBe('string');
    expect(warnings).toEqual([]);
  });

  it('raw ratio point estimates are NEVER written to es', () => {
    const { patch } = mapExtractedToStudyPatch({ ratioMeasure: 'OR', ratioEst: '2', ratioLo: '1.5', ratioHi: '3' });
    expect(patch.es).not.toBe('2');
    expect(Number(patch.es)).toBeCloseTo(Math.log(2), 4);
    expect(patch.esType).toBe('OR');
  });

  it('accepts ratio values supplied as numeric strings (RR)', () => {
    const { patch, conversions } = mapExtractedToStudyPatch({ ratioMeasure: 'rr', ratioEst: '1.30', ratioLo: '1.10', ratioHi: '1.54' });
    expect(patch.esType).toBe('RR');
    expect(Number(patch.es)).toBeCloseTo(Math.log(1.3), 4);
    expect(conversions).toHaveLength(1);
  });

  it('invalid ratio CI (lower > upper) never reaches typed fields', () => {
    const { patch, conversions, warnings } = mapExtractedToStudyPatch({ ratioMeasure: 'HR', ratioEst: 0.8, ratioLo: 0.9, ratioHi: 0.7 });
    expect(patch.es).toBeUndefined();
    expect(patch.lo).toBeUndefined();
    expect(patch.hi).toBeUndefined();
    expect(conversions).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('non-positive ratio estimate is rejected honestly', () => {
    const { patch, warnings } = mapExtractedToStudyPatch({ ratioMeasure: 'OR', ratioEst: -1, ratioLo: 0.5, ratioHi: 2 });
    expect(patch.es).toBeUndefined();
    expect(warnings.some(w => /could not be log-transformed/.test(w))).toBe(true);
  });

  it('IRR (no ES_TYPES key) goes to notes only — never to typed fields', () => {
    const { patch, conversions, warnings } = mapExtractedToStudyPatch({ ratioMeasure: 'IRR', ratioEst: 2.1, ratioLo: 1.4, ratioHi: 3.2 });
    expect(patch.es).toBeUndefined();
    expect(patch.esType).toBeUndefined();
    expect(conversions).toEqual([]);
    expect(patch.notes).toMatch(/IRR/);
    expect(warnings.some(w => /IRR/.test(w))).toBe(true);
  });
});

// ── esType whitelist (root cause (d)) ────────────────────────────────────────
describe('mapExtractedToStudyPatch — esType whitelist', () => {
  it('DIAG is dropped to notes (not a supported effect measure)', () => {
    const { patch, warnings } = mapExtractedToStudyPatch({ esType: 'DIAG', tp: '10', fp: '3' });
    expect(patch.esType).toBeUndefined();
    expect(patch.notes).toMatch(/DIAG/);
    expect(warnings.some(w => /DIAG/.test(w))).toBe(true);
  });

  it('valid esType passes through (case-normalised)', () => {
    expect(mapExtractedToStudyPatch({ esType: 'smd' }).patch.esType).toBe('SMD');
    expect(mapExtractedToStudyPatch({ esType: 'PROP' }).patch.esType).toBe('PROP');
  });

  it('unknown esType garbage never enters the patch', () => {
    const { patch } = mapExtractedToStudyPatch({ esType: 'BANANA' });
    expect(patch.esType).toBeUndefined();
  });
});

// ── adjusted / source enum coercion ──────────────────────────────────────────
describe('mapExtractedToStudyPatch — adjusted/source enums', () => {
  it('valid adjusted values pass through', () => {
    expect(mapExtractedToStudyPatch({ adjusted: 'propensity' }).patch.adjusted).toBe('propensity');
    expect(mapExtractedToStudyPatch({ adjusted: 'IPTW' }).patch.adjusted).toBe('iptw');
  });

  it('invalid adjusted coerces to "unadjusted" with a warning', () => {
    const { patch, warnings } = mapExtractedToStudyPatch({ adjusted: 'fully-adjusted-model-3' });
    expect(patch.adjusted).toBe('unadjusted');
    expect(warnings.some(w => /adjusted/.test(w))).toBe(true);
  });

  it('valid source passes through; invalid source coerces to ""', () => {
    expect(mapExtractedToStudyPatch({ source: 'table' }).patch.source).toBe('table');
    const { patch, warnings } = mapExtractedToStudyPatch({ source: 'somewhere in the paper' });
    expect(patch.source).toBe('');
    expect(warnings.some(w => /source/.test(w))).toBe(true);
  });
});

// ── garbage / object handling (root cause (d)) ───────────────────────────────
describe('mapExtractedToStudyPatch — garbage never becomes "[object Object]"', () => {
  it('objects and arrays in typed fields are dropped with warnings', () => {
    const { patch, warnings } = mapExtractedToStudyPatch({
      author: { name: 'Smith' },
      meanExp: { value: 12 },
      sdExp: [1, 2],
      nExp: true,
      year: '2021',
    });
    expect(patch.author).toBeUndefined();
    expect(patch.meanExp).toBeUndefined();
    expect(patch.sdExp).toBeUndefined();
    expect(patch.nExp).toBeUndefined();
    expect(patch.year).toBe('2021');
    expect(JSON.stringify(patch)).not.toContain('[object Object]');
    expect(warnings.length).toBeGreaterThanOrEqual(4);
  });

  it('non-numeric text in a numeric field is dropped to notes', () => {
    const { patch, warnings } = mapExtractedToStudyPatch({ n: 'about 120 patients' });
    expect(patch.n).toBeUndefined();
    expect(patch.notes).toMatch(/about 120 patients/);
    expect(warnings.some(w => /not numeric/.test(w))).toBe(true);
  });

  it('non-object model output maps to an empty patch with a warning', () => {
    const asArray = mapExtractedToStudyPatch([1, 2, 3]);
    expect(asArray.patch).toEqual({});
    expect(asArray.warnings.length).toBe(1);
    const asNull = mapExtractedToStudyPatch(null);
    expect(asNull.patch).toEqual({});
  });
});

// ── continuous + dichotomous passthrough as strings ──────────────────────────
describe('mapExtractedToStudyPatch — numeric passthrough', () => {
  it('continuous arm data passes through, coerced to strings', () => {
    const { patch } = mapExtractedToStudyPatch({
      meanExp: 12.5, sdExp: '3.1', nExp: 40, meanCtrl: 11.9, sdCtrl: '2.8', nCtrl: 38, n: 78,
    });
    expect(patch.meanExp).toBe('12.5');
    expect(patch.sdExp).toBe('3.1');
    expect(patch.nExp).toBe('40');
    expect(patch.meanCtrl).toBe('11.9');
    expect(patch.sdCtrl).toBe('2.8');
    expect(patch.nCtrl).toBe('38');
    expect(patch.n).toBe('78');
    for (const k of ['meanExp', 'sdExp', 'nExp', 'meanCtrl', 'sdCtrl', 'nCtrl', 'n']) {
      expect(typeof patch[k]).toBe('string');
    }
  });

  it('dichotomous 2x2 counts pass through as strings', () => {
    const { patch } = mapExtractedToStudyPatch({ a: 12, b: 30, c: 8, d: 34 });
    expect(patch.a).toBe('12');
    expect(patch.b).toBe('30');
    expect(patch.c).toBe('8');
    expect(patch.d).toBe('34');
  });

  it('empty strings ("" = not stated) are skipped, not stored', () => {
    const { patch } = mapExtractedToStudyPatch({ author: '', meanExp: '', a: '' });
    expect(patch.author).toBeUndefined();
    expect(patch.meanExp).toBeUndefined();
    expect(patch.a).toBeUndefined();
  });
});

// ── whitelist invariant ───────────────────────────────────────────────────────
describe('mapExtractedToStudyPatch — mkStudy whitelist', () => {
  it('every patch key exists on mkStudy()', () => {
    const allowed = new Set(Object.keys(mkStudy()));
    const { patch } = mapExtractedToStudyPatch({
      author: 'Lee', year: 2019, country: 'KR', design: 'cohort', n: 200,
      outcome: 'mortality', timepoint: '12 months', esType: 'HR',
      adjusted: 'multivariable', source: 'text', notes: 'from Table 2',
      ratioMeasure: 'HR', ratioEst: 0.75, ratioLo: 0.6, ratioHi: 0.94,
      bogusField: 'should never appear', es: '999', // model-side es is NOT part of the contract
    });
    for (const k of Object.keys(patch)) expect(allowed.has(k)).toBe(true);
    expect(patch.bogusField).toBeUndefined();
    // `es` only ever comes from the audited ratio_log transform, never verbatim
    expect(patch.es).not.toBe('999');
    expect(Number(patch.es)).toBeCloseTo(Math.log(0.75), 4);
  });
});

// ── aiExtractInfo — secret-free config snapshot ───────────────────────────────
describe('aiExtractInfo', () => {
  it('reports configured:false and the default model with an empty env', () => {
    expect(aiExtractInfo({})).toEqual({ configured: false, model: 'claude-sonnet-5' });
  });

  it('reports configured:true and honours AI_EXTRACT_MODEL — without leaking the key', () => {
    const info = aiExtractInfo({ ANTHROPIC_API_KEY: 'sk-ant-secret', AI_EXTRACT_MODEL: 'custom-model' });
    expect(info).toEqual({ configured: true, model: 'custom-model' });
    expect(Object.keys(info).sort()).toEqual(['configured', 'model']);
    expect(JSON.stringify(info)).not.toContain('sk-ant-secret');
  });
});

// ── buildInstruction — contract sanity (no network) ───────────────────────────
describe('buildInstruction', () => {
  it('demands raw ratio fields and forbids markdown/preamble', () => {
    const s = buildInstruction();
    expect(s).toMatch(/ratioMeasure/);
    expect(s).toMatch(/ratioEst/);
    expect(s).toMatch(/NEVER log-transform/);
    expect(s).toMatch(/No markdown/i);
  });

  it('embeds the focus note when provided', () => {
    expect(buildInstruction('90-day mortality')).toContain('90-day mortality');
  });
});
