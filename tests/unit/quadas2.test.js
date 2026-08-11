/**
 * quadas2.test.js — 115.md W1-A. QUADAS-2 structure pins + the two-axis contract.
 *
 * The structure pins exist because the item text is the instrument: if a
 * signalling question drifts, the tool is no longer QUADAS-2. Text below is
 * pinned against the official Bristol template (quadas2.pdf).
 */
import { describe, it, expect } from 'vitest';
import {
  QUADAS2,
  judgeDomain,
  judgeApplicability,
  judgeOverall,
} from '../../src/research-engine/rob/instruments/quadas2.js';
import {
  getInstrument, proposeDomain, proposeOverall, completeness,
  applicabilityDomainId, hasApplicabilityAxis,
} from '../../src/research-engine/rob/index.js';

const domain = (id) => QUADAS2.domains.find((d) => d.id === id);
const signalling = (id) => domain(id).questions.filter((q) => q.kind === 'signaling');

describe('QUADAS-2 structure', () => {
  it('has four domains in the official order', () => {
    expect(QUADAS2.domains.map((d) => d.id)).toEqual(['D1', 'D2', 'D3', 'D4']);
    expect(QUADAS2.domains.map((d) => d.name)).toEqual([
      'Patient Selection', 'Index Test(s)', 'Reference Standard', 'Flow and Timing',
    ]);
  });

  it('has exactly eleven signalling questions, 3 + 2 + 2 + 4', () => {
    expect(['D1', 'D2', 'D3', 'D4'].map((id) => signalling(id).length)).toEqual([3, 2, 2, 4]);
    const all = QUADAS2.domains.flatMap((d) => d.questions.filter((q) => q.kind === 'signaling'));
    expect(all).toHaveLength(11);
    expect(all.map((q) => q.id)).toEqual(['1.1', '1.2', '1.3', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '4.3', '4.4']);
  });

  it('pins the signalling question text verbatim', () => {
    const text = (d, q) => domain(d).questions.find((x) => x.id === q).text;
    expect(text('D1', '1.1')).toBe('Was a consecutive or random sample of patients enrolled?');
    expect(text('D1', '1.2')).toBe('Was a case-control design avoided?');
    expect(text('D1', '1.3')).toBe('Did the study avoid inappropriate exclusions?');
    expect(text('D2', '2.2')).toBe('If a threshold was used, was it pre-specified?');
    expect(text('D3', '3.1')).toBe('Is the reference standard likely to correctly classify the target condition?');
    expect(text('D4', '4.4')).toBe('Were all patients included in the analysis?');
  });

  it('answers signalling questions Yes / No / Unclear only', () => {
    expect(QUADAS2.responseOptions.map((o) => o.value)).toEqual(['Y', 'N', 'U']);
    for (const q of signalling('D1')) expect(q.responses).toEqual(['Y', 'N', 'U']);
  });

  it('pins the four risk-of-bias summary questions verbatim', () => {
    expect(domain('D1').judgment.prompt).toBe('Could the selection of patients have introduced bias?');
    expect(domain('D2').judgment.prompt).toBe('Could the conduct or interpretation of the index test have introduced bias?');
    expect(domain('D3').judgment.prompt).toBe('Could the reference standard, its conduct, or its interpretation have introduced bias?');
    expect(domain('D4').judgment.prompt).toBe('Could the patient flow have introduced bias?');
  });
});

describe('QUADAS-2 risk of bias vs applicability — the split is structural', () => {
  it('the first three domains carry an applicability axis and the fourth does not', () => {
    expect(QUADAS2.domains.filter((d) => d.applicability).map((d) => d.id)).toEqual(['D1', 'D2', 'D3']);
    expect(domain('D4').applicability).toBeUndefined();
    expect(hasApplicabilityAxis(QUADAS2)).toBe(true);
  });

  it('pins the three applicability concern questions verbatim', () => {
    expect(domain('D1').applicability.prompt).toBe('Is there concern that the included patients do not match the review question?');
    expect(domain('D2').applicability.prompt).toBe('Is there concern that the index test, its conduct, or interpretation differ from the review question?');
    expect(domain('D3').applicability.prompt).toBe('Is there concern that the target condition as defined by the reference standard does not match the review question?');
  });

  it('the two axes use different judgement vocabularies and neither is a score', () => {
    expect(domain('D1').judgment.levels.map((l) => l.value)).toEqual(['low', 'high', 'unclear']);
    expect(domain('D1').applicability.levels.map((l) => l.value)).toEqual(['low', 'high', 'unclear']);
    expect(domain('D1').judgment.levels[0].label).toBe('Low risk of bias');
    expect(domain('D1').applicability.levels[0].label).toBe('Low concern regarding applicability');
    expect(QUADAS2.scoringAllowed).toBe(false);
  });

  it('the axes are INDEPENDENT: low risk of bias with high applicability concern is representable', () => {
    const rob = judgeDomain('D1', { '1.1': 'Y', '1.2': 'Y', '1.3': 'Y' });
    const app = judgeApplicability('D1', 'high');
    expect(rob.judgment).toBe('low');
    expect(app.judgment).toBe('high');
    // …and the reverse.
    const rob2 = judgeDomain('D3', { '3.1': 'Y', '3.2': 'U' });
    const app2 = judgeApplicability('D3', 'low');
    expect(rob2.judgment).toBe('unclear');
    expect(app2.judgment).toBe('low');
  });

  it('applicability is never computed from the signalling answers', () => {
    expect(domain('D1').applicability.computed).toBe(false);
    const unset = judgeApplicability('D2');
    expect(unset.judgment).toBe('');
    expect(unset.reviewerJudged).toBe(true);
  });

  it('the applicability axis persists to its own domain key', () => {
    expect(applicabilityDomainId('D1')).toBe('D1-APP');
    expect(applicabilityDomainId('D1')).not.toBe('D1');
  });

  it('D4 has no applicability section to judge', () => {
    expect(() => judgeApplicability('D4', 'low')).toThrow(/no applicability section/);
  });
});

describe('QUADAS-2 domain judgement rule', () => {
  it('all signalling questions Yes → Low risk of bias', () => {
    const r = judgeDomain('D4', { '4.1': 'Y', '4.2': 'Y', '4.3': 'Y', '4.4': 'Y' });
    expect(r.judgment).toBe('low');
    expect(r.computed).toBe(true);
  });

  it('an Unclear answer with no No → Unclear risk of bias', () => {
    const r = judgeDomain('D2', { '2.1': 'Y', '2.2': 'U' });
    expect(r.judgment).toBe('unclear');
    expect(r.reasons.join(' ')).toMatch(/insufficient/i);
  });

  it('a No FLAGS the potential for bias but never auto-proposes High', () => {
    const r = judgeDomain('D1', { '1.1': 'Y', '1.2': 'N', '1.3': 'Y' });
    expect(r.judgment).toBe('');
    expect(r.reviewerJudged).toBe(true);
    expect(r.flaggedQuestions).toEqual(['1.2']);
    expect(r.reasons.join(' ')).toMatch(/flags the potential for bias/);
  });

  it('an unanswered domain proposes nothing', () => {
    const r = judgeDomain('D1', { '1.1': 'Y' });
    expect(r.judgment).toBe('');
    expect(r.reviewerJudged).toBe(true);
  });

  it('rejects an unknown domain', () => {
    expect(() => judgeDomain('D9', {})).toThrow(/Unknown QUADAS-2 domain/);
  });
});

describe('QUADAS-2 has no overall judgement', () => {
  it('the definition says so declaratively', () => {
    expect(QUADAS2.overall).toBeNull();
  });

  it('judgeOverall returns an explicitly-undefined result, never a fabricated one', () => {
    const r = judgeOverall({ D1: 'low', D2: 'low', D3: 'low', D4: 'low' });
    expect(r.judgment).toBe('');
    expect(r.overallDefined).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/no overall judgement/i);
  });

  it('exposes no score rule of any kind', () => {
    expect(QUADAS2.scoring).toBeUndefined();
    expect(QUADAS2.maxStars).toBeUndefined();
    expect(QUADAS2.scoringAllowed).toBe(false);
  });
});

describe('QUADAS-2 through the generic engine', () => {
  it('is registered and dispatches', () => {
    const inst = getInstrument('QUADAS-2');
    expect(inst.id).toBe('QUADAS-2');
    expect(proposeDomain(inst, 'D3', { '3.1': 'Y', '3.2': 'Y' }).judgment).toBe('low');
    expect(proposeOverall(inst, {}).overallDefined).toBe(false);
  });

  it('completeness counts the eleven signalling questions and ignores the applicability prompts', () => {
    const inst = getInstrument('QUADAS-2');
    const c = completeness(inst, { answersByDomain: {} });
    expect(c.overall.required).toBe(11);
    expect(c.perDomain.D1.required).toBe(3);
    expect(c.perDomain.D1.missing).toEqual(['1.1', '1.2', '1.3']);
  });

  it('is JSON-serialisable (no functions leak into the definition)', () => {
    const round = JSON.parse(JSON.stringify(QUADAS2));
    expect(round.domains).toHaveLength(4);
    expect(round.overall).toBeNull();
    expect(round.domains[0].applicability.prompt).toContain('do not match the review question');
  });
});
