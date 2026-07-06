import { describe, it, expect } from 'vitest';
import {
  articleStatusOf, progressOf, expectedFieldsFor, hasAnyValue, validationSummary,
  ARTICLE_STATUSES, STATUS_META,
} from '../../../../src/research-engine/extraction/engine/articleStatus.js';
import { mkStudy } from '../../../../src/research-engine/project-model/defaults.js';

describe('articleStatus.expectedFieldsFor', () => {
  it('picks the 2x2 group for OR/RR', () => {
    expect(expectedFieldsFor({ esType: 'OR' })).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd']));
    expect(expectedFieldsFor({ esType: 'RR' })).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd']));
  });
  it('picks the continuous group for SMD/MD', () => {
    const f = expectedFieldsFor({ esType: 'MD' });
    expect(f).toEqual(expect.arrayContaining(['nExp', 'meanExp', 'sdExp', 'nCtrl', 'meanCtrl', 'sdCtrl']));
  });
  it('picks the proportion group for PROP', () => {
    expect(expectedFieldsFor({ esType: 'PROP' })).toEqual(expect.arrayContaining(['events', 'total']));
  });
  it('falls back to generic es/lo/hi when no measure is set', () => {
    expect(expectedFieldsFor({})).toEqual(expect.arrayContaining(['es', 'lo', 'hi']));
  });
});

describe('articleStatus.progressOf', () => {
  it('is 0% on a blank study', () => {
    const p = progressOf(mkStudy());
    expect(p.pct).toBe(0);
    expect(p.filledFields).toBe(0);
  });
  it('counts filled expected fields', () => {
    const s = { ...mkStudy(), author: 'Smith', year: '2020', outcome: 'Mortality', esType: 'OR', timepoint: '12w', a: '5', b: '95', c: '10', d: '90' };
    const p = progressOf(s);
    expect(p.filledFields).toBe(p.totalFields); // all 9 expected fields present
    expect(p.pct).toBe(100);
  });
  it('is partial when only identity is filled', () => {
    const s = { ...mkStudy(), author: 'Smith', year: '2020', esType: 'OR' };
    const p = progressOf(s);
    expect(p.pct).toBeGreaterThan(0);
    expect(p.pct).toBeLessThan(100);
  });
});

describe('articleStatus.hasAnyValue', () => {
  it('false for a blank study', () => expect(hasAnyValue(mkStudy())).toBe(false));
  it('true once any raw or effect value is present', () => {
    expect(hasAnyValue({ ...mkStudy(), es: '0.5' })).toBe(true);
    expect(hasAnyValue({ ...mkStudy(), a: '5' })).toBe(true);
  });
});

describe('articleStatus.articleStatusOf precedence', () => {
  it('not_started on a blank study', () => {
    expect(articleStatusOf(mkStudy())).toBe('not_started');
  });
  it('in_progress once an outcome or value exists', () => {
    expect(articleStatusOf({ ...mkStudy(), outcome: 'Mortality' })).toBe('in_progress');
  });
  it('validation_required when a blocking error exists (events>total)', () => {
    const s = { ...mkStudy(), esType: 'PROP', events: '50', total: '10', outcome: 'X' };
    expect(articleStatusOf(s)).toBe('validation_required');
  });
  it('ready_for_review when flagged and no blocking errors', () => {
    const s = { ...mkStudy(), outcome: 'X', es: '0.5', extractionMeta: { readyForReview: true } };
    expect(articleStatusOf(s)).toBe('ready_for_review');
  });
  it('complete when completedAt is stamped', () => {
    const s = { ...mkStudy(), outcome: 'X', es: '0.5', extractionMeta: { completedAt: '2026-01-01T00:00:00Z' } };
    expect(articleStatusOf(s)).toBe('complete');
  });
  it('locked wins over complete', () => {
    const s = { ...mkStudy(), extractionMeta: { completedAt: '2026-01-01T00:00:00Z', locked: true } };
    expect(articleStatusOf(s)).toBe('locked');
  });
  it('validation_required is NOT masked by a ready flag', () => {
    const s = { ...mkStudy(), esType: 'PROP', events: '50', total: '10', extractionMeta: { readyForReview: true } };
    expect(articleStatusOf(s)).toBe('validation_required');
  });
});

describe('articleStatus.validationSummary', () => {
  it('separates errors from warnings', () => {
    const s = { ...mkStudy(), esType: 'PROP', events: '50', total: '10' };
    const v = validationSummary(s);
    expect(v.errors).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(v.issues)).toBe(true);
  });
  it('every status has UI meta', () => {
    for (const st of ARTICLE_STATUSES) expect(STATUS_META[st]).toBeTruthy();
  });
});
