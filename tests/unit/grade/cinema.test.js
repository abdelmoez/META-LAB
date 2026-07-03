import { describe, it, expect } from 'vitest';
import { CINEMA_DOMAINS, cinemaDomain, mapNmaWarningToDomain } from '../../../src/research-engine/grade/cinema.js';

describe('cinema — CINEMA_DOMAINS catalogue', () => {
  it('lists the six CINeMA domains, each mapped to an engine domain', () => {
    expect(CINEMA_DOMAINS).toHaveLength(6);
    const cin = CINEMA_DOMAINS.map((d) => d.cinema);
    expect(cin).toEqual([
      'Within-study bias', 'Reporting bias', 'Indirectness', 'Imprecision', 'Heterogeneity', 'Incoherence',
    ]);
    expect(CINEMA_DOMAINS.every((d) => typeof d.engineDomain === 'string' && d.engineDomain.length > 0)).toBe(true);
  });

  it('reuses the pairwise GRADE domains where they coincide', () => {
    expect(cinemaDomain('within_study_bias').engineDomain).toBe('rob');
    expect(cinemaDomain('reporting_bias').engineDomain).toBe('publicationBias');
    expect(cinemaDomain('heterogeneity').engineDomain).toBe('inconsistency');
    expect(cinemaDomain('incoherence').engineDomain).toBe('incoherence'); // NMA-specific
  });

  it('cinemaDomain can also be looked up by the engine key', () => {
    expect(cinemaDomain('rob').cinema).toBe('Within-study bias');
    expect(cinemaDomain('inconsistency').cinema).toBe('Heterogeneity');
    expect(cinemaDomain('nope')).toBe(null);
  });
});

describe('cinema — mapNmaWarningToDomain', () => {
  it('maps the NMA warning taxonomy to engine domains', () => {
    expect(mapNmaWarningToDomain('incoherence')).toBe('incoherence');
    expect(mapNmaWarningToDomain('heterogeneity')).toBe('inconsistency');
    expect(mapNmaWarningToDomain('indirectness')).toBe('indirectness');
    expect(mapNmaWarningToDomain('imprecision')).toBe('imprecision');
    expect(mapNmaWarningToDomain('reporting')).toBe('publicationBias');
    expect(mapNmaWarningToDomain('bias')).toBe('rob');
  });

  it('informational and unknown / null kinds map to null', () => {
    expect(mapNmaWarningToDomain('info')).toBe(null);
    expect(mapNmaWarningToDomain('mystery')).toBe(null);
    expect(mapNmaWarningToDomain(null)).toBe(null);
    expect(mapNmaWarningToDomain(undefined)).toBe(null);
  });
});
