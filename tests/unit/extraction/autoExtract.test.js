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

  it('binds the outcome’s OWN effect, not a preceding covariate HR (recs #1)', () => {
    const protocol = protocolOutcomes(project);
    // A covariate HR precedes the outcome; the outcome’s HR follows it. The draft must
    // take the OUTCOME’s HR (0.80 → protective), never the covariate’s (1.50).
    const abstract = 'In models adjusted for diabetes (HR 1.50, 95% CI 1.20 to 1.90), all-cause mortality was lower with treatment (HR 0.80, 95% CI 0.70 to 0.91).';
    const r = autoExtract({ protocol, abstract, idFn: pinnedIds() });
    expect(r.drafts.length).toBe(1);
    const d = r.drafts[0];
    expect(Number(d.values.es)).toBeCloseTo(Math.log(0.80), 6);
    expect(d.confidence).toBe('low');               // multiple ratios → uncertain
    expect(d.notes).toMatch(/Multiple effect estimates/);
  });

  it('never crosses outcome↔effect in a two-outcome sentence (recs #1)', () => {
    const protocol = protocolOutcomes(project);
    const abstract = 'Myocardial infarction rose (HR 1.20, 95% CI 1.00 to 1.44), whereas all-cause mortality fell (HR 0.80, 95% CI 0.70 to 0.91).';
    const r = autoExtract({ protocol, abstract, idFn: pinnedIds() });
    // A sentence naming two protocol outcomes yields one draft (conservative coverage),
    // but whichever it emits must pair the RIGHT outcome with the RIGHT effect — the
    // covariate/other-outcome cross-attribution bug must not happen.
    expect(r.drafts.length).toBe(1);
    const d = r.drafts[0];
    const expected = /mortality/i.test(d.outcome) ? Math.log(0.80) : Math.log(1.20);
    expect(Number(d.values.es)).toBeCloseTo(expected, 6);
  });

  it('does NOT emit a 2×2 when more than two events/total pairs share a sentence (recs #2)', () => {
    const protocol = protocolOutcomes(project);
    // Sex counts (2 pairs) + MI counts (2 pairs) = 4 pairs → too ambiguous → skip.
    const abstract = 'Myocardial infarction: men were 120/200 and 118/200; events occurred in 45/200 versus 60/200.';
    const r = autoExtract({ protocol, abstract, idFn: pinnedIds() });
    expect(r.drafts.length).toBe(0);
  });

  it('keeps two distinct ratio drafts that share a point estimate (recs #3 dedupe)', () => {
    const protocol = protocolOutcomes(project);
    const pages = [
      { page: 1, text: 'All-cause mortality: unadjusted HR 0.80 (95% CI 0.60 to 0.99).' },
      { page: 2, text: 'All-cause mortality: adjusted HR 0.80 (95% CI 0.70 to 0.91).' },
    ];
    const r = autoExtract({ protocol, pages, idFn: pinnedIds() });
    // Same outcome + point estimate but DIFFERENT CIs → must not collapse to one.
    expect(r.drafts.length).toBe(2);
  });

  it('tags provenance page from the pages array and is deterministic across runs', () => {
    const protocol = protocolOutcomes(project);
    const pages = [{ page: 4, text: 'All-cause mortality: HR 0.80 (95% CI 0.65 to 0.98).' }];
    const a = autoExtract({ protocol, pages, idFn: pinnedIds() });
    const b = autoExtract({ protocol, pages, idFn: pinnedIds() });
    expect(a.drafts[0].provenance.page).toBe(4);
    expect(a.drafts).toEqual(b.drafts);
  });

  it('never silently drops OFF-protocol mean ± SD pairs — it parks them', () => {
    const protocol = protocolOutcomes(project); // mortality / MI / HbA1c only
    const abstract = 'Systolic blood pressure was 130 ± 10 in the treated arm and 145 ± 12 in controls.';
    const r = autoExtract({ protocol, abstract, at: '2026-07-04T00:00:00.000Z', idFn: pinnedIds() });
    expect(r.drafts.length).toBe(0);
    expect(r.alsoReported.length).toBe(1);           // parked, NOT lost (was 0/0 before)
    const p = r.alsoReported[0];
    expect(p.scope.level).toBe('other');
    expect(p.values.meanExp).toBe('130');
    expect(p.values.sdExp).toBe('10');
    expect(p.values.meanCtrl).toBe('145');
    expect(p.values.sdCtrl).toBe('12');
    expect(p.values.es).toBe('');                    // no n's → no computed effect (as designed)
  });

  it('auto-computes a log-OR effect + conversions entry on a 2×2 draft', () => {
    const protocol = protocolOutcomes(project);
    const abstract = 'Myocardial infarction occurred in 12/150 versus 25/148 patients.';
    const r = autoExtract({ protocol, abstract, at: '2026-07-04T00:00:00.000Z', idFn: pinnedIds() });
    expect(r.drafts.length).toBe(1);
    const d = r.drafts[0];
    expect(d.esType).toBe('OR');
    // log OR for a=12,b=138,c=25,d=123
    const lnOR = Math.log((12 * 123) / (138 * 25));
    expect(Number(d.values.es)).toBeCloseTo(lnOR, 6);
    expect(d.values.a).toBe('12');
    expect(d.values.d).toBe('123');
    const conv = d.conversions.find((c) => c.type === 'es_from_2x2');
    expect(conv).toBeTruthy();
    expect(conv.inputs).toMatchObject({ a: 12, b: 138, c: 25, d: 123 });
    expect(Number(conv.result.es)).toBeCloseTo(lnOR, 6);
    expect(d.needsReview).toBe(true);
  });

  it('passes the canonical outcome NAME through scope.canonicalName', () => {
    const protocol = protocolOutcomes(project);
    const abstract = 'All-cause mortality was lower with treatment (HR 0.75, 95% CI 0.60 to 0.94).';
    const r = autoExtract({ protocol, abstract, idFn: pinnedIds() });
    expect(r.drafts.length).toBe(1);
    expect(r.drafts[0].scope.canonicalName).toBe('all-cause mortality 12 month');
    expect(r.drafts[0].scope.canonical).toBe(true);
  });

  it('populates detectedOutcomes even when the protocol has NO outcomes', () => {
    const emptyProtocol = { source: 'none', outcomes: [] };
    const abstract = 'Systolic blood pressure was 130 ± 10 versus 145 ± 12. Quality of life improved (OR 1.80, 95% CI 1.20 to 2.70).';
    const r = autoExtract({ protocol: emptyProtocol, abstract, idFn: pinnedIds() });
    expect(r.drafts.length).toBe(0);
    expect(r.detectedOutcomes.length).toBeGreaterThanOrEqual(2);
    const labels = r.detectedOutcomes.map((d) => d.label.toLowerCase());
    expect(labels.some((l) => l.includes('blood pressure'))).toBe(true);
    expect(labels.some((l) => l.includes('quality of life'))).toBe(true);
    for (const d of r.detectedOutcomes) {
      expect(typeof d.excerpt).toBe('string');
      expect(typeof d.statPreview).toBe('string');
      expect(DETECT_OK.has(d.kind)).toBe(true);
    }
    // deterministic
    const r2 = autoExtract({ protocol: emptyProtocol, abstract, idFn: pinnedIds() });
    expect(r2.detectedOutcomes).toEqual(r.detectedOutcomes);
  });

  it('lowers confidence + flags review when TWO protocol outcomes share one sentence', () => {
    const protocol = protocolOutcomes(project);
    // One effect estimate, but BOTH mortality and MI are named → attribution ambiguous.
    const abstract = 'All-cause mortality and myocardial infarction were both reduced (HR 0.80, 95% CI 0.70 to 0.91).';
    const r = autoExtract({ protocol, abstract, idFn: pinnedIds() });
    expect(r.drafts.length).toBe(1);
    const d = r.drafts[0];
    expect(d.confidence).toBe('low');
    expect(d.needsReview).toBe(true);
    expect(d.notes).toMatch(/Multiple outcomes named/i);
  });
});

// Statistic kinds that may appear in a detectedOutcomes descriptor.
const DETECT_OK = new Set(['ratioCI', 'eventsTotal', 'meanSd', 'percent', 'ci']);
