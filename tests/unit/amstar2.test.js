/**
 * amstar2.test.js — 115.md W1-A. AMSTAR 2 structure pins + the official
 * overall-confidence rule matrix.
 *
 * The rule matrix is the point of this file: AMSTAR 2's confidence rating turns
 * on CRITICAL flaws first, and getting that backwards silently mis-rates every
 * umbrella review. Text and per-item response options are pinned against the
 * official checklist (amstar.ca/docs/AMSTAR-2.pdf).
 */
import { describe, it, expect } from 'vitest';
import {
  AMSTAR2,
  AMSTAR_RESPONSES,
  CRITICAL_ITEMS,
  PARTIAL_YES_ITEMS,
  META_ANALYSIS_ITEMS,
  AMSTAR_CONFIDENCE_VALUES,
  countFlaws,
  rateConfidence,
  judgeDomain,
  judgeOverall,
} from '../../src/research-engine/rob/instruments/amstar2.js';
import { getInstrument, proposeDomain, proposeOverall, completeness } from '../../src/research-engine/rob/index.js';

const items = AMSTAR2.domains[0].questions;
const item = (id) => items.find((q) => q.id === id);

/** A fully answered checklist — the only state AMSTAR 2 may be rated from. */
const allYes = () => Object.fromEntries(items.map((q) => [q.id, 'Y']));

describe('AMSTAR 2 structure', () => {
  it('has sixteen items, numbered 1-16', () => {
    expect(items).toHaveLength(16);
    expect(items.map((q) => q.id)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16']);
  });

  it('marks exactly the seven official critical domains', () => {
    expect(CRITICAL_ITEMS).toEqual(['2', '4', '7', '9', '11', '13', '15']);
    expect(items.filter((q) => q.critical).map((q) => q.id)).toEqual(['2', '4', '7', '9', '11', '13', '15']);
    expect(item('9').criticalDomainLabel).toBe('Risk of bias from individual studies being included in the review');
  });

  it('pins item text verbatim, including the printed punctuation quirks', () => {
    expect(item('1').text).toBe('Did the research questions and inclusion criteria for the review include the components of PICO?');
    expect(item('7').text).toBe('Did the review authors provide a list of excluded studies and justify the exclusions?');
    // Item 11 has no comma after "performed"; item 12 does. Both as printed.
    expect(item('11').text).toBe('If meta-analysis was performed did the review authors use appropriate methods for statistical combination of results?');
    expect(item('12').text.startsWith('If meta-analysis was performed, ')).toBe(true);
    // Item 13 prints a space in "interpreting/ discussing".
    expect(item('13').text).toContain('interpreting/ discussing');
  });

  it('offers Partial Yes on exactly items 2, 4, 7, 8, 9 — NOT the critical set', () => {
    expect(PARTIAL_YES_ITEMS).toEqual(['2', '4', '7', '8', '9']);
    const withPartial = items.filter((q) => q.responses.includes('PARTIAL_YES')).map((q) => q.id);
    expect(withPartial).toEqual(['2', '4', '7', '8', '9']);
    expect(withPartial).not.toEqual(CRITICAL_ITEMS);
    // Item 8 offers Partial Yes and is not critical; item 13 is critical and does not.
    expect(item('8').critical).toBe(false);
    expect(item('13').responses).toEqual(['Y', 'N']);
  });

  it('offers "No meta-analysis conducted" on exactly items 11, 12, 15', () => {
    expect(META_ANALYSIS_ITEMS).toEqual(['11', '12', '15']);
    expect(items.filter((q) => q.responses.includes('NMA')).map((q) => q.id)).toEqual(['11', '12', '15']);
  });

  it('carries the official RCT/NRSI response blocks for items 9 and 11', () => {
    expect(item('9').blocks.map((b) => b.id)).toEqual(['rct', 'nrsi']);
    expect(item('9').blocks[0].responses).toEqual(['Y', 'PARTIAL_YES', 'N', 'ONLY_NRSI']);
    expect(item('9').blocks[1].responses).toEqual(['Y', 'PARTIAL_YES', 'N', 'ONLY_RCT']);
    expect(item('11').blocks.map((b) => b.label)).toEqual(['RCTs', 'For NRSI']);
    // No printed option is lost: the item's own set is the union of both blocks.
    for (const b of item('9').blocks) for (const r of b.responses) expect(item('9').responses).toContain(r);
    expect(items.filter((q) => q.blocks).map((q) => q.id)).toEqual(['9', '11']);
  });

  it('produces a confidence rating, never a score', () => {
    expect(AMSTAR2.scoringAllowed).toBe(false);
    expect(AMSTAR2.scoring).toBeUndefined();
    expect(AMSTAR2.maxStars).toBeUndefined();
    expect(AMSTAR_CONFIDENCE_VALUES).toEqual(['high', 'moderate', 'low', 'critically-low']);
    expect(AMSTAR_RESPONSES).toEqual(['Y', 'PARTIAL_YES', 'N', 'NMA', 'ONLY_NRSI', 'ONLY_RCT']);
  });
});

describe('AMSTAR 2 overall confidence rule (Box 2)', () => {
  const rate = (criticalFlaws, nonCriticalWeaknesses) => rateConfidence({ criticalFlaws, nonCriticalWeaknesses }).judgment;

  it('0 critical flaws → High with 0 or 1 non-critical weakness', () => {
    expect(rate(0, 0)).toBe('high');
    expect(rate(0, 1)).toBe('high');
  });

  it('0 critical flaws → Moderate with more than one non-critical weakness', () => {
    expect(rate(0, 2)).toBe('moderate');
    expect(rate(0, 9)).toBe('moderate');
  });

  it('exactly 1 critical flaw → Low, whatever the non-critical count', () => {
    expect(rate(1, 0)).toBe('low');
    expect(rate(1, 1)).toBe('low');
    expect(rate(1, 8)).toBe('low');
  });

  it('more than 1 critical flaw → Critically low, whatever the non-critical count', () => {
    expect(rate(2, 0)).toBe('critically-low');
    expect(rate(7, 9)).toBe('critically-low');
  });

  it('critical flaws dominate: one critical flaw outranks any number of non-critical ones', () => {
    expect(rate(0, 6)).toBe('moderate');
    expect(rate(1, 0)).toBe('low');
  });

  it('gives a reason that quotes the official definition', () => {
    expect(rateConfidence({ criticalFlaws: 2, nonCriticalWeaknesses: 0 }).reasons.join(' '))
      .toMatch(/should not be relied on to provide an accurate and comprehensive summary/);
    expect(rateConfidence({ criticalFlaws: 0, nonCriticalWeaknesses: 0 }).reasons.join(' '))
      .toMatch(/accurate and comprehensive summary/);
  });
});

describe('AMSTAR 2 flaw counting', () => {
  it('counts a "No" on a critical item as a critical flaw and elsewhere as a weakness', () => {
    const f = countFlaws({ 2: 'N', 4: 'N', 3: 'N', 10: 'N' });
    expect(f.criticalFlaws).toBe(2);
    expect(f.criticalFlawItems).toEqual(['2', '4']);
    expect(f.nonCriticalWeaknesses).toBe(2);
    expect(f.nonCriticalWeaknessItems).toEqual(['3', '10']);
  });

  it('never counts a not-applicable response as a weakness', () => {
    const f = countFlaws({ 11: 'NMA', 12: 'NMA', 15: 'NMA', 9: 'ONLY_RCT' });
    expect(f.criticalFlaws).toBe(0);
    expect(f.nonCriticalWeaknesses).toBe(0);
  });

  it('does not count Partial Yes as a weakness by default, and does when asked', () => {
    expect(countFlaws({ 2: 'PARTIAL_YES', 8: 'PARTIAL_YES' }).criticalFlaws).toBe(0);
    expect(countFlaws({ 2: 'PARTIAL_YES', 8: 'PARTIAL_YES' }).nonCriticalWeaknesses).toBe(0);
    const strict = countFlaws({ 2: 'PARTIAL_YES', 8: 'PARTIAL_YES' }, { partialYesIsWeakness: true });
    expect(strict.criticalFlaws).toBe(1);
    expect(strict.nonCriticalWeaknesses).toBe(1);
  });

  it('honours a re-designated critical set (the paper allows it with justification)', () => {
    const f = countFlaws({ 5: 'N' }, { criticalItems: ['5'] });
    expect(f.criticalFlaws).toBe(1);
    expect(f.nonCriticalWeaknesses).toBe(0);
  });

  it('reports unanswered items without counting them either way', () => {
    const f = countFlaws({ 1: 'Y' });
    expect(f.criticalFlaws).toBe(0);
    expect(f.nonCriticalWeaknesses).toBe(0);
    expect(f.unanswered).toHaveLength(15);
  });
});

describe('AMSTAR 2 judgeOverall', () => {
  it('rates from a raw answers map', () => {
    const answers = {};
    for (const q of items) answers[q.id] = 'Y';
    answers['4'] = 'N';   // one critical flaw
    answers['3'] = 'N';   // one non-critical weakness
    const r = judgeOverall(answers);
    expect(r.judgment).toBe('low');
    expect(r.criticalFlaws).toBe(1);
    expect(r.nonCriticalWeaknesses).toBe(1);
  });

  it('rates from the engine per-domain proposal map', () => {
    const answers = allYes();
    answers['2'] = 'N';
    answers['7'] = 'N';
    const proposal = judgeDomain('items', answers);
    expect(proposal.flaws.criticalFlaws).toBe(2);
    expect(judgeOverall({ items: proposal }).judgment).toBe('critically-low');
  });

  it('returns an empty, reviewer-judged result when nothing is answered', () => {
    const r = judgeOverall({});
    expect(r.judgment).toBe('');
    expect(r.reviewerJudged).toBe(true);
  });

  // ── The BLANK-FORM bug ────────────────────────────────────────────────────
  // `judgeDomain` always attaches a `flaws` object, so `resolveCounts` always
  // found counts and rateConfidence({0,0}) proposed HIGH — the tool's BEST rating
  // — for an umbrella review nobody had appraised. Box 2 counts weaknesses across
  // the WHOLE checklist, so nothing may be rated until every item is answered:
  // an unanswered item is "not looked at", never "no weakness found".
  describe('an incomplete checklist gets NO rating', () => {
    it('proposes nothing for a blank form, through the domain proposal', () => {
      const r = judgeOverall({ items: judgeDomain('items', {}) });
      expect(r.judgment).toBe('');
      expect(r.reviewerJudged).toBe(true);
      expect(r.unanswered).toHaveLength(16);
      expect(r.reasons.join(' ')).toMatch(/16 of the 16 AMSTAR 2 items are still unanswered/);
    });

    it('proposes nothing for a PARTLY answered form, however clean the answers', () => {
      const partial = { 1: 'Y', 2: 'Y', 3: 'Y' };
      expect(judgeOverall(partial).judgment).toBe('');
      expect(judgeOverall({ items: judgeDomain('items', partial) }).judgment).toBe('');
      // …and it still reports what it found so far, so a UI can show progress.
      const r = judgeOverall(partial);
      expect(r.criticalFlaws).toBe(0);
      expect(r.unanswered).toHaveLength(13);
    });

    it('rates only once ALL sixteen items are answered', () => {
      const answers = allYes();
      expect(judgeOverall(answers).judgment).toBe('high');
      // One item taken away is enough to withdraw the rating again.
      delete answers['16'];
      expect(judgeOverall(answers).judgment).toBe('');
    });

    it('counts a not-applicable response as ANSWERED (it is a printed option)', () => {
      const answers = allYes();
      answers['11'] = 'NMA';
      answers['12'] = 'NMA';
      answers['15'] = 'NMA';
      const r = judgeOverall(answers);
      expect(r.judgment).toBe('high');
      expect(r.criticalFlaws).toBe(0);
    });

    it('still takes a BARE counts object at face value (rateConfidence\'s contract)', () => {
      // A caller who has tallied the checklist themselves is stating the counts;
      // there is no `unanswered` list to be load-bearing.
      expect(judgeOverall({ criticalFlaws: 0, nonCriticalWeaknesses: 0 }).judgment).toBe('high');
      expect(rateConfidence({ criticalFlaws: 0, nonCriticalWeaknesses: 0 }).judgment).toBe('high');
    });
  });

  it('makes no per-item or per-domain judgement of its own', () => {
    const r = judgeDomain('items', { 1: 'Y' });
    expect(r.judgment).toBe('');
    expect(r.reviewerJudged).toBe(true);
    expect(() => judgeDomain('nope', {})).toThrow(/Unknown AMSTAR 2 domain/);
  });
});

describe('AMSTAR 2 through the generic engine', () => {
  it('is registered and dispatches to the confidence rule', () => {
    const inst = getInstrument('AMSTAR-2');
    expect(inst.id).toBe('AMSTAR-2');
    const answers = allYes();
    Object.assign(answers, { 2: 'N', 4: 'N', 7: 'N' });
    const proposals = { items: proposeDomain(inst, 'items', answers) };
    expect(proposeOverall(inst, proposals).judgment).toBe('critically-low');
  });

  it('the engine round-trip proposes nothing while items are unanswered', () => {
    const inst = getInstrument('AMSTAR-2');
    const proposals = { items: proposeDomain(inst, 'items', { 2: 'N', 4: 'N', 7: 'N' }) };
    expect(proposeOverall(inst, proposals).judgment).toBe('');
  });

  it('completeness requires all sixteen items', () => {
    const c = completeness(getInstrument('AMSTAR-2'), { answersByDomain: { items: { 1: 'Y', 2: 'PARTIAL_YES' } } });
    expect(c.perDomain.items.required).toBe(16);
    expect(c.perDomain.items.answered).toBe(2);
  });
});
