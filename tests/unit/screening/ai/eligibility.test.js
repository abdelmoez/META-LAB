/**
 * eligibility.test.js — criteria-based eligibility screening (P10).
 *
 * Covers the deterministic assessment engine (evaluateEligibility), the hybrid
 * scalar (eligibilityScoreFromAssessment), leakage-free validation metrics
 * (computeEligibilityValidation), and the load-bearing invariant that an ABSENT
 * eligibility signal renormalizes away in hybridScore byte-for-byte (so runs
 * without eligibility data score identically to the pre-eligibility engine).
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateEligibility, eligibilityScoreFromAssessment, computeEligibilityValidation,
  splitSentences, ENGINE_VERSION, DEFAULT_ELIGIBILITY_CONFIG,
} from '../../../../src/research-engine/screening/ai/eligibility.js';
import { hybridScore } from '../../../../src/research-engine/screening/ai/hybrid.js';
import { DEFAULT_AI_CONFIG, resolveConfig, resolveEngineConfig, ENGINE_CONFIG_VERSIONS } from '../../../../src/research-engine/screening/ai/config.js';
import * as barrel from '../../../../src/research-engine/screening/ai/index.js';

// ── Reusable criteria ────────────────────────────────────────────────────────
const POP = { id: 1, key: 'population', category: 'Population', question: 'adults with type 2 diabetes', kind: 'include', required: true };
const DESIGN = { id: 2, key: 'design', category: 'Design', question: 'randomized controlled trial', kind: 'include', required: true };
const ANIMAL = { id: 3, key: 'animal', category: 'Design', kind: 'exclude', terms: ['animal', 'in vitro', 'mouse', 'murine'] };

describe('splitSentences', () => {
  it('splits on sentence punctuation + line breaks, returning verbatim substrings', () => {
    const text = 'A trial in adults. It reported mortality.\nSecond block here.';
    const sents = splitSentences(text);
    expect(sents).toEqual(['A trial in adults.', 'It reported mortality.', 'Second block here.']);
    for (const s of sents) expect(text.includes(s)).toBe(true);
  });
  it('is empty-safe', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences(null)).toEqual([]);
    expect(splitSentences(undefined)).toEqual([]);
  });
});

describe('evaluateEligibility — clear INCLUDE', () => {
  const out = evaluateEligibility({
    record: {
      title: 'A randomized controlled trial in adults with type 2 diabetes',
      abstract: 'This randomized controlled trial enrolled adults with type 2 diabetes and reported all-cause mortality.',
    },
    criteria: [POP, DESIGN, ANIMAL],
  });

  it('suggests include with high confidence and no blockers', () => {
    expect(out.suggestedDecision).toBe('include');
    expect(out.decisionConfidence).toBeGreaterThanOrEqual(DEFAULT_ELIGIBILITY_CONFIG.includeConfidence);
    expect(out.blockers).toEqual([]);
    expect(out.engineVersion).toBe(ENGINE_VERSION);
  });

  it('every include criterion answers yes; the exclude answers no', () => {
    const pop = out.answers.find(a => a.key === 'population');
    const animal = out.answers.find(a => a.key === 'animal');
    expect(pop.answer).toBe('yes');
    expect(pop.strength).toBe(1);
    expect(pop.confidence).toBeGreaterThanOrEqual(DEFAULT_ELIGIBILITY_CONFIG.includeConfidence);
    expect(animal.answer).toBe('no');
  });

  it('evidenceQuote is a VERBATIM substring of the record and sourceField is set', () => {
    const pop = out.answers.find(a => a.key === 'population');
    expect(pop.evidenceQuote).toBeTruthy();
    expect(['title', 'abstract', 'fullText']).toContain(pop.sourceField);
    const field = pop.sourceField;
    const rec = {
      title: 'A randomized controlled trial in adults with type 2 diabetes',
      abstract: 'This randomized controlled trial enrolled adults with type 2 diabetes and reported all-cause mortality.',
    };
    expect(rec[field].includes(pop.evidenceQuote)).toBe(true);
  });
});

describe('evaluateEligibility — clear EXCLUDE (negative-condition detection)', () => {
  const out = evaluateEligibility({
    record: {
      title: 'Effect of a drug in a mouse model',
      abstract: 'We performed an in vitro study using murine cells and a mouse model.',
    },
    criteria: [POP, ANIMAL],
  });

  it('a met exclusion forces exclude with a grounded blocker', () => {
    expect(out.suggestedDecision).toBe('exclude');
    const animal = out.answers.find(a => a.key === 'animal');
    expect(animal.answer).toBe('yes');
    expect(animal.confidence).toBeGreaterThanOrEqual(DEFAULT_ELIGIBILITY_CONFIG.excludeConfidence);
    expect(out.blockers.some(b => b.includes('animal'))).toBe(true);
    expect(out.decisionConfidence).toBe(animal.confidence);
  });

  it('the exclusion evidence quote is verbatim from the record', () => {
    const animal = out.answers.find(a => a.key === 'animal');
    const rec = {
      title: 'Effect of a drug in a mouse model',
      abstract: 'We performed an in vitro study using murine cells and a mouse model.',
    };
    expect(animal.evidenceQuote).toBeTruthy();
    expect(rec[animal.sourceField].includes(animal.evidenceQuote)).toBe(true);
  });
});

describe('evaluateEligibility — UNCLEAR / no evidence', () => {
  it('no matching text on a required include → unclear, null quote, source none', () => {
    const out = evaluateEligibility({
      record: { title: 'A study of widgets', abstract: 'Unrelated text about manufacturing widgets and gears.' },
      criteria: [POP],
    });
    expect(out.suggestedDecision).toBe('unclear');
    const pop = out.answers[0];
    expect(pop.evidenceQuote).toBeNull();
    expect(pop.sourceField).toBe('none');
    expect(pop.strength).toBe(0);
    expect(out.blockers.length).toBeGreaterThan(0);
  });

  it('a partial concept match lands in the unclear band with a low confidence', () => {
    // "adults with type 2 diabetes and hypertension" → 3 concept groups; matching 1
    // of 3 (strength 0.333) is inside [0.15, 0.6] → unclear.
    const out = evaluateEligibility({
      record: { abstract: 'A study of adults only.' },
      criteria: [{ id: 5, key: 'multi', question: 'adults with type 2 diabetes and hypertension', kind: 'include', required: true }],
    });
    const a = out.answers[0];
    expect(a.answer).toBe('unclear');
    expect(a.confidence).toBeLessThan(DEFAULT_ELIGIBILITY_CONFIG.includeConfidence);
  });

  it('a criterion yielding no matchable concept is unclear, not a crash', () => {
    const out = evaluateEligibility({
      record: { abstract: 'anything' },
      criteria: [{ id: 6, key: 'empty', question: 'the of a', kind: 'include', required: true }],
    });
    expect(out.answers[0].answer).toBe('unclear');
    expect(out.answers[0].strength).toBeNull();
  });
});

describe('evaluateEligibility — confidence monotonicity (present regime)', () => {
  it('matching MORE of a criterion\'s concepts yields a higher (or equal) confidence', () => {
    const crit = [{ id: 1, key: 'p', question: 'adults with type 2 diabetes and hypertension', kind: 'include', required: true }];
    const two = evaluateEligibility({ record: { abstract: 'Study of adults with type 2 diabetes.' }, criteria: crit }).answers[0];
    const three = evaluateEligibility({ record: { abstract: 'Study of adults with type 2 diabetes and hypertension.' }, criteria: crit }).answers[0];
    expect(two.answer).toBe('yes');
    expect(three.answer).toBe('yes');
    expect(three.strength).toBeGreaterThan(two.strength);
    expect(three.confidence).toBeGreaterThan(two.confidence);
  });
});

describe('evaluateEligibility — polarity inverts the yes/no label', () => {
  const crit = [{ id: 9, key: 'nonhuman', question: 'human participants', kind: 'include', required: true, polarity: 'negative' }];
  it('negative polarity: concept PRESENT ⇒ answer no', () => {
    const out = evaluateEligibility({ record: { abstract: 'This study enrolled human participants with diabetes.' }, criteria: crit });
    expect(out.answers[0].answer).toBe('no');
  });
  it('negative polarity: concept ABSENT ⇒ answer yes', () => {
    const out = evaluateEligibility({ record: { abstract: 'A study of gears and widgets, no living subjects.' }, criteria: crit });
    expect(out.answers[0].answer).toBe('yes');
  });
});

describe('evaluateEligibility — degenerate inputs', () => {
  it('no criteria → unclear with an insufficient-criteria blocker', () => {
    const out = evaluateEligibility({ record: { title: 'x' }, criteria: [] });
    expect(out.suggestedDecision).toBe('unclear');
    expect(out.answers).toEqual([]);
    expect(out.blockers.length).toBeGreaterThan(0);
    expect(out.engineVersion).toBe(ENGINE_VERSION);
  });
  it('empty args do not throw', () => {
    expect(() => evaluateEligibility({})).not.toThrow();
    expect(() => evaluateEligibility()).not.toThrow();
  });
  it('is fully deterministic', () => {
    const args = { record: { title: 'RCT in adults with type 2 diabetes', abstract: 'randomized controlled trial' }, criteria: [POP, DESIGN, ANIMAL] };
    const a = evaluateEligibility(args);
    const b = evaluateEligibility(args);
    expect(a).toEqual(b);
  });
});

describe('eligibilityScoreFromAssessment', () => {
  it('returns null when there are no criteria', () => {
    expect(eligibilityScoreFromAssessment([])).toBeNull();
    expect(eligibilityScoreFromAssessment({ answers: [] })).toBeNull();
    expect(eligibilityScoreFromAssessment(null)).toBeNull();
  });
  it('accepts either the assessment object or its answers array', () => {
    const a = evaluateEligibility({ record: { abstract: 'randomized controlled trial in adults with type 2 diabetes' }, criteria: [POP, DESIGN] });
    expect(eligibilityScoreFromAssessment(a)).toBe(eligibilityScoreFromAssessment(a.answers));
  });
  it('a satisfied-include assessment scores well above a met-exclusion assessment', () => {
    const inc = evaluateEligibility({ record: { title: 'RCT in adults with type 2 diabetes', abstract: 'randomized controlled trial adults with type 2 diabetes' }, criteria: [POP, DESIGN, ANIMAL] });
    const exc = evaluateEligibility({ record: { title: 'drug in a mouse model', abstract: 'in vitro study using murine cells' }, criteria: [POP, ANIMAL] });
    const sInc = eligibilityScoreFromAssessment(inc);
    const sExc = eligibilityScoreFromAssessment(exc);
    expect(sInc).toBeGreaterThan(0.5);
    expect(sExc).toBeLessThan(0.5);
    expect(sInc).toBeGreaterThan(sExc);
  });
  it('is bounded to [0,1]', () => {
    const a = evaluateEligibility({ record: { abstract: 'x' }, criteria: [POP, DESIGN, ANIMAL] });
    const s = eligibilityScoreFromAssessment(a);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe('computeEligibilityValidation — metrics on a known labelled set', () => {
  const critV = [{ id: 1, key: 'p', question: 'adults with type 2 diabetes', kind: 'include', required: true }];
  const mk = (txt) => evaluateEligibility({ record: { abstract: txt }, criteria: critV });
  const assessments = [
    mk('adults with type 2 diabetes reported here'),   // predict include — human include (TP)
    mk('adults with type 2 diabetes cohort study'),    // predict include — human include (TP)
    mk('type 2 diabetes in adults, trial'),            // predict include — human include (TP)
    mk('unrelated widget manufacturing'),              // predict exclude — human exclude (TN)
    mk('gears and cogs study'),                         // predict exclude — human exclude (TN)
    mk('adults with type 2 diabetes surprise'),        // predict include — human exclude (FP)
  ];
  const humanDecisions = ['include', 'include', 'include', 'exclude', 'exclude', 'exclude'];
  const v = computeEligibilityValidation({ assessments, humanDecisions });

  it('produces the expected confusion matrix', () => {
    expect(v.n).toBe(6);
    expect(v.confusionMatrix).toEqual({ tp: 3, fp: 1, tn: 2, fn: 0 });
    expect(v.falsePositives).toBe(1);
    expect(v.falseNegatives).toBe(0);
  });
  it('derives recall / precision / specificity / accuracy from that matrix', () => {
    expect(v.recall).toBeCloseTo(1, 6);           // 3/(3+0)
    expect(v.precision).toBeCloseTo(0.75, 6);     // 3/(3+1)
    expect(v.specificity).toBeCloseTo(2 / 3, 6);  // 2/(2+1)
    expect(v.accuracy).toBeCloseTo(5 / 6, 6);     // (3+2)/6
  });
  it('reports thresholdSensitivity across a grid and a per-criterion breakdown', () => {
    expect(v.thresholdSensitivity.length).toBe(9);
    for (const row of v.thresholdSensitivity) {
      expect(row).toHaveProperty('threshold');
      expect(row).toHaveProperty('recall');
      expect(row).toHaveProperty('precision');
    }
    expect(v.perCriterion.length).toBe(1);
    expect(v.perCriterion[0].key).toBe('p');
    expect(v.perCriterion[0].agreement).toBeCloseTo(5 / 6, 6);
  });
  it('ignores unsettled human labels (only include/exclude count)', () => {
    const withMaybe = computeEligibilityValidation({
      assessments: [...assessments, mk('adults with type 2 diabetes maybe')],
      humanDecisions: [...humanDecisions, 'maybe'],
    });
    expect(withMaybe.n).toBe(6); // the 'maybe' row is dropped
  });
});

describe('computeEligibilityValidation — degenerate inputs', () => {
  it('empty input returns NaN-safe nulls, never throws', () => {
    const v = computeEligibilityValidation({ assessments: [], humanDecisions: [] });
    expect(v.n).toBe(0);
    expect(v.recall).toBeNull();
    expect(v.precision).toBeNull();
    expect(v.confusionMatrix).toEqual({ tp: 0, fp: 0, tn: 0, fn: 0 });
    expect(v.thresholdSensitivity).toEqual([]);
    expect(v.perCriterion).toEqual([]);
    expect(v.auc).toBeNull();
  });
  it('no-arg call does not throw', () => {
    expect(() => computeEligibilityValidation()).not.toThrow();
  });
});

// ── The load-bearing invariant: eligibility ABSENT ⇒ identical to pre-change ──
describe('hybridScore — eligibility renormalization invariance', () => {
  const base = {
    classifier: { available: true, proba: 0.7 },
    coldStart: 0.6,
    semanticIncluded: 0.55,
    semanticExcluded: 0.45,
    keyword: 0.4,
    citation: null,
  };
  const hcfg = DEFAULT_AI_CONFIG.hybrid;

  it('eligibility:null is byte-identical to eligibility absent (score + weights)', () => {
    const withNull = hybridScore({ ...base, eligibility: null }, hcfg);
    const absent = hybridScore({ ...base }, hcfg);
    expect(withNull.score).toBe(absent.score);
    expect(withNull.weights).toEqual(absent.weights);
    expect(withNull.subScores.eligibility).toBeNull();
    // eligibility must NOT appear among the active, renormalized weights.
    expect(withNull.weights.eligibility).toBeUndefined();
  });

  it('a present eligibility signal participates and re-normalizes weights to sum 1', () => {
    const without = hybridScore({ ...base, eligibility: null }, hcfg);
    const withHigh = hybridScore({ ...base, eligibility: 0.95 }, hcfg);
    expect(withHigh.score).not.toBe(without.score);
    expect(withHigh.score).toBeGreaterThan(without.score); // high eligibility pulls the fused score up
    expect(withHigh.weights.eligibility).toBeGreaterThan(0);
    const sum = Object.values(withHigh.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe('config — eligibility block + registry additions', () => {
  it('DEFAULT_AI_CONFIG carries the eligibility block and hybrid weight', () => {
    expect(DEFAULT_AI_CONFIG.eligibility).toBeTruthy();
    expect(DEFAULT_AI_CONFIG.eligibility.unclearBand).toEqual([0.15, 0.6]);
    expect(DEFAULT_AI_CONFIG.hybrid.weights.eligibility).toBe(0.10);
    expect(DEFAULT_ELIGIBILITY_CONFIG).toBe(DEFAULT_AI_CONFIG.eligibility);
  });
  it('resolveConfig({}) still exposes prior keys unchanged plus eligibility', () => {
    const cfg = resolveConfig({});
    expect(cfg.hybrid.weights.classifier).toBe(0.55); // existing value untouched
    expect(cfg.hybrid.weights.citation).toBe(0.10);   // existing value untouched
    expect(cfg.eligibility.includeConfidence).toBe(0.65);
  });
  it('v1/v2 registry entries are preserved; v3 adds the eligibility-enabled config', () => {
    expect(ENGINE_CONFIG_VERSIONS['v1-hybrid-legacy']).toBeTruthy();
    expect(ENGINE_CONFIG_VERSIONS['v2-lexical-tuned']).toBeTruthy();
    expect(ENGINE_CONFIG_VERSIONS['v3-eligibility-lexical']).toBeTruthy();
    const v1 = resolveEngineConfig('v1-hybrid-legacy');
    expect(v1.classifier.momentum).toBeUndefined(); // legacy still untouched
    const v3 = resolveEngineConfig('v3-eligibility-lexical');
    expect(v3.classifier.momentum).toBe(0.9);        // inherits the tuned classifier
    expect(v3.hybrid.weights.eligibility).toBe(0.10);
    expect(v3.engineConfigVersion).toBe('v3-eligibility-lexical');
  });
});

describe('barrel — public eligibility surface is re-exported', () => {
  it('exposes the P10 symbols for server import', () => {
    expect(typeof barrel.evaluateEligibility).toBe('function');
    expect(typeof barrel.eligibilityScoreFromAssessment).toBe('function');
    expect(typeof barrel.computeEligibilityValidation).toBe('function');
    expect(barrel.ELIGIBILITY_ENGINE_VERSION).toBe(ENGINE_VERSION);
    expect(barrel.DEFAULT_ELIGIBILITY_CONFIG).toBe(DEFAULT_ELIGIBILITY_CONFIG);
  });
});
