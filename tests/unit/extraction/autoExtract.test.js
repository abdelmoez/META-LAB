/**
 * autoExtract.test.js — RoadMap/1.md Method 1 orchestrator.
 * Deterministic; ids pinned via an injected counter so drafts are stable.
 */
import { describe, it, expect } from 'vitest';
import { autoExtract } from '../../../src/research-engine/extraction/autoExtract.js';
import { protocolOutcomes } from '../../../src/research-engine/extraction/protocolOutcomes.js';

function pinnedIds() {
  let n = 0;
  return () => `id${++n}`;
}

const project = {
  prospero: {
    fields: {
      primary_outcomes: 'All-cause mortality at 12 months',
      secondary_outcomes: 'Myocardial infarction; HbA1c change',
    },
  },
};

describe('autoExtract', () => {
  it('returns nothing for empty text', () => {
    const r = autoExtract({ pages: [], abstract: '', protocol: protocolOutcomes(project), idFn: pinnedIds() });
    expect(r.drafts).toEqual([]);
    expect(r.alsoReported).toEqual([]);
    expect(r.log.join(' ')).toMatch(/nothing to auto-extract/i);
  });

  it('drafts a ratio+CI effect for a protocol outcome mentioned in the same sentence', () => {
    const protocol = protocolOutcomes(project);
    const abstract =
      'In this trial, all-cause mortality was lower with treatment (HR 0.75, 95% CI 0.60 to 0.94). ' +
      'Baseline characteristics were balanced.';
    const r = autoExtract({ protocol, abstract, at: '2026-07-03T00:00:00.000Z', idFn: pinnedIds() });
    expect(r.drafts.length).toBe(1);
    const d = r.drafts[0];
    expect(d.scope.level).toBe('primary');
    expect(d.esType).toBe('HR');
    // es/lo/hi stored on the log (analysis) scale.
    expect(Number(d.values.es)).toBeCloseTo(Math.log(0.75), 6);
    expect(Number(d.values.lo)).toBeCloseTo(Math.log(0.60), 6);
    expect(Number(d.values.hi)).toBeCloseTo(Math.log(0.94), 6);
    expect(d.provenance.method).toBe('auto');
    expect(d.provenance.excerpt).toMatch(/all-cause mortality/i);
    expect(d.needsReview).toBe(true);
    expect(d.conversions.length).toBe(1);
    expect(d.conversions[0].type).toBe('ratio_log');
  });

  it('parks an effect for an outcome NOT in the protocol as "also reported"', () => {
    const protocol = protocolOutcomes(project);
    const abstract = 'Quality of life improved markedly (OR 1.80, 95% CI 1.20 to 2.70).';
    const r = autoExtract({ protocol, abstract, idFn: pinnedIds() });
    expect(r.drafts.length).toBe(0);
    expect(r.alsoReported.length).toBe(1);
    expect(r.alsoReported[0].scope.level).toBe('other');
  });

  it('captures a dichotomous 2×2 when two events/total pairs share a sentence with an outcome', () => {
    const protocol = protocolOutcomes(project);
    const abstract = 'Myocardial infarction occurred in 12/150 versus 25/148 patients.';
    const r = autoExtract({ protocol, abstract, idFn: pinnedIds() });
    expect(r.drafts.length).toBe(1);
    const d = r.drafts[0];
    expect(d.values.a).toBe('12');
    expect(d.values.b).toBe('138');
    expect(d.values.c).toBe('25');
    expect(d.values.d).toBe('123');
    expect(d.scope.level).toBe('secondary');
  });

  it('does not emit a draft for an outcome mention with no paired statistic', () => {
    const protocol = protocolOutcomes(project);
    const abstract = 'All-cause mortality was the primary endpoint of the study.';
    const r = autoExtract({ protocol, abstract, idFn: pinnedIds() });
    expect(r.drafts.length).toBe(0);
  });

  it('tags provenance page from the pages array and is deterministic across runs', () => {
    const protocol = protocolOutcomes(project);
    const pages = [{ page: 4, text: 'All-cause mortality: HR 0.80 (95% CI 0.65 to 0.98).' }];
    const a = autoExtract({ protocol, pages, idFn: pinnedIds() });
    const b = autoExtract({ protocol, pages, idFn: pinnedIds() });
    expect(a.drafts[0].provenance.page).toBe(4);
    expect(a.drafts).toEqual(b.drafts);
  });
});
