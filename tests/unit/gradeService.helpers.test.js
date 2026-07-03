/**
 * gradeService.helpers.test.js — unit tests for the PURE helpers of the P12 GRADE
 * service (no DB, no live server, no engine). These cover the parts of the service
 * that assemble the meta summary, scope RoB to an outcome, normalise a reviewer's
 * domain payload, read engine metadata defensively, and serialise the Summary-of-
 * Findings table to CSV/HTML. The DB/engine-bound service functions are exercised by
 * tests/integration/grade.integration.test.js against a live server.
 */
import { describe, it, expect } from 'vitest';
import {
  metaSummaryForOutcome, robForOutcome, normalizeDomainsInput,
  domainIdsFromEngine, ratingSetFromEngine, sofToCsv, sofToHtml,
} from '../../server/services/gradeService.js';

describe('metaSummaryForOutcome', () => {
  const studies = [
    { esType: 'OR', es: '-0.3', lo: '-0.6', hi: '-0.02', n: '120' },
    { esType: 'OR', es: '-0.1', lo: '-0.4', hi: '0.2', n: '90' },
    { esType: 'OR', es: '-0.5', lo: '-0.9', hi: '-0.1', n: '150' },
  ];
  it('pools ≥2 studies, back-transforms a ratio measure, and totals participants', () => {
    const m = metaSummaryForOutcome(studies, 'random');
    expect(m.pooled).toBe(true);
    expect(m.k).toBe(3);
    expect(m.esType).toBe('OR');
    expect(m.kind).toBe('ratio');
    // estimate = exp(pooled log-OR) → a positive ratio around exp(-0.3)≈0.74
    expect(m.estimate).toBeGreaterThan(0);
    expect(m.estimate).toBeLessThan(1);
    expect(m.ciLow).toBeLessThan(m.ciHigh);
    expect(m.nParticipants).toBe(360);
    expect(typeof m.I2).toBe('number');
  });
  it('returns pooled:false (never throws) for < 2 studies', () => {
    const m = metaSummaryForOutcome([studies[0]], 'random');
    expect(m.pooled).toBe(false);
    expect(m.k).toBe(1);
    expect(m.estimate).toBeNull();
    expect(m.nParticipants).toBe(120);
  });
});

describe('robForOutcome', () => {
  const rob = [
    { id: 'a1', status: 'complete', overall: 'low', resultLabel: 'Mortality at 6 months' },
    { id: 'a2', status: 'complete', overall: 'high', resultLabel: 'Quality of life' },
  ];
  it('scopes to assessments whose label references the outcome', () => {
    const r = robForOutcome(rob, { outcome: 'Mortality', key: 'Mortality|||6mo', label: 'Mortality @ 6mo' });
    expect(r.scoped).toBe(true);
    expect(r.list.map((a) => a.id)).toEqual(['a1']);
  });
  it('falls back to the project-level set when nothing references the outcome', () => {
    const r = robForOutcome(rob, { outcome: 'Readmission', key: 'Readmission|||', label: 'Readmission' });
    expect(r.scoped).toBe(false);
    expect(r.list).toHaveLength(2);
  });
});

describe('normalizeDomainsInput', () => {
  const ids = ['rob', 'inconsistency', 'indirectness', 'imprecision', 'publicationBias'];
  const ratings = new Set(['not_serious', 'serious', 'very_serious']);
  it('accepts bare-string and object forms, marks every provided domain source:manual', () => {
    const out = normalizeDomainsInput({ rob: 'serious', inconsistency: { rating: 'not_serious', note: 'low I²' } }, ids, ratings);
    expect(out.rob).toEqual({ rating: 'serious', source: 'manual', note: '' });
    expect(out.inconsistency.rating).toBe('not_serious');
    expect(out.inconsistency.source).toBe('manual');
    expect(out.inconsistency.note).toBe('low I²');
  });
  it('drops unknown domain ids and invalid ratings', () => {
    const out = normalizeDomainsInput({ bogus: 'serious', rob: 'catastrophic' }, ids, ratings);
    expect(out).toEqual({});
  });
});

describe('engine metadata readers (defensive)', () => {
  it('domainIdsFromEngine handles array-of-object, object, and missing shapes', () => {
    expect(domainIdsFromEngine({ GRADE_DOMAINS: [{ id: 'rob' }, { id: 'imprecision' }] })).toEqual(['rob', 'imprecision']);
    expect(domainIdsFromEngine({ GRADE_DOMAINS: { rob: {}, inconsistency: {} } })).toEqual(['rob', 'inconsistency']);
    expect(domainIdsFromEngine({})).toContain('publicationBias');
  });
  it('ratingSetFromEngine extracts values from array and object registries', () => {
    const a = ratingSetFromEngine({ GRADE_RATINGS: ['serious', 'not_serious'] });
    expect(a.has('serious')).toBe(true);
    const b = ratingSetFromEngine({ GRADE_RATINGS: { S: 'serious', N: { value: 'not_serious' } } });
    expect(b.has('serious')).toBe(true);
    expect(b.has('not_serious')).toBe(true);
    expect(ratingSetFromEngine({}).size).toBe(0); // lenient when the engine defines none
  });
});

describe('SoF serialisers', () => {
  const table = {
    title: 'Summary of findings',
    columns: [{ key: 'outcome', label: 'Outcome' }, { key: 'certainty', label: 'Certainty (GRADE)' }],
    rows: [{ outcome: 'Mortality @ 6mo', certainty: 'Moderate' }],
    note: 'Verify against the Analysis tab.',
  };
  const footnotes = [{ marker: '1', outcome: 'Mortality @ 6mo', text: 'Downgraded for risk of bias.' }];
  it('sofToCsv emits a BOM, header, data, and a footnotes block', () => {
    const csv = sofToCsv(table, footnotes);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    expect(csv).toContain('Outcome,Certainty (GRADE)');
    expect(csv).toContain('Mortality @ 6mo,Moderate');
    expect(csv).toContain('Footnotes');
    expect(csv).toContain('Downgraded for risk of bias.');
  });
  it('sofToHtml emits an escaped table + footnotes list', () => {
    const html = sofToHtml(table, footnotes, { title: 'Summary of findings' });
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Certainty (GRADE)</th>');
    expect(html).toContain('Moderate');
    expect(html).toContain('Downgraded for risk of bias.');
  });
});
