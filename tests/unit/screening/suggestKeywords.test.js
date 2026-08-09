/**
 * suggestKeywords.test.js — 107.md §2. Context-aware keyword SUGGESTIONS: negation,
 * generic-term blocking, specificity, dedup and cross-polarity conflicts.
 * Pure functions; no DOM, no React, no DB.
 */
import { describe, it, expect } from 'vitest';
import {
  suggestCriteriaKeywords, dropNegatedClauses, MAX_SUGGESTIONS_PER_SIDE,
} from '../../../src/research-engine/screening/suggestKeywords.js';

const has = (list, term) => list.some(t => t.toLowerCase() === term.toLowerCase());

describe('dropNegatedClauses', () => {
  it('drops the clause a negation cue governs', () => {
    expect(dropNegatedClauses('Exclude studies without confirmed epilepsy').trim())
      .toBe('Exclude studies');
    expect(dropNegatedClauses('Patients with no prior surgery').trim()).toBe('Patients with');
    expect(dropNegatedClauses('Trials lacking a control arm').trim()).toBe('Trials');
  });

  it('keeps a leading exclusion verb (it is the section directive, not a negation)', () => {
    expect(dropNegatedClauses('Excluding pregnant women').trim()).toBe('Excluding pregnant women');
    expect(dropNegatedClauses('Exclude animal studies').trim()).toBe('Exclude animal studies');
  });

  it('only removes up to the clause boundary', () => {
    expect(dropNegatedClauses('Adults with epilepsy, excluding pregnant women').trim())
      .toBe('Adults with epilepsy,');
    expect(dropNegatedClauses('Studies without a control arm, reporting mortality').trim())
      .toBe('Studies , reporting mortality');
  });

  it('leaves criteria with no negation untouched', () => {
    expect(dropNegatedClauses('Adults with drug-resistant epilepsy'))
      .toBe('Adults with drug-resistant epilepsy');
  });
});

describe('suggestCriteriaKeywords — negated criteria', () => {
  it('107.md regression fixture: "without confirmed epilepsy" yields NO exclusion keyword', () => {
    const out = suggestCriteriaKeywords({
      incl: 'Adults with epilepsy',
      excl: 'Exclude studies without confirmed epilepsy',
    });
    // The word is not itself an exclusion concept…
    expect(has(out.exclude, 'epilepsy')).toBe(false);
    expect(out.exclude).toEqual([]);
    // …but it IS a legitimate inclusion concept, so it stays on exactly one side.
    expect(has(out.include, 'epilepsy')).toBe(true);
    expect(out.conflicts).toEqual([]);
  });

  it('a negated fragment contributes nothing even when the concept is well known', () => {
    const out = suggestCriteriaKeywords({ incl: '', excl: 'Patients without type 2 diabetes' });
    expect(out.exclude).toEqual([]);
  });

  it('negation inside an inclusion criterion also suppresses the fragment', () => {
    const out = suggestCriteriaKeywords({ incl: 'Adults with epilepsy, excluding pregnant women' });
    expect(has(out.include, 'epilepsy')).toBe(true);
    expect(has(out.include, 'pregnant')).toBe(false);
  });
});

describe('suggestCriteriaKeywords — generic terms', () => {
  it('never suggests a bare generic noun on its own', () => {
    const out = suggestCriteriaKeywords({
      incl: 'Include studies of patients with a disease\nAny population\nAny treatment outcome',
      excl: 'Exclude studies',
    });
    for (const junk of ['disease', 'patients', 'studies', 'population', 'treatment', 'outcome', 'adults', 'children']) {
      expect(has(out.include, junk)).toBe(false);
      expect(has(out.exclude, junk)).toBe(false);
    }
  });

  it('keeps a multi-word phrase that merely CONTAINS a generic word', () => {
    const out = suggestCriteriaKeywords({ incl: 'Randomized controlled trials', excl: 'Animal studies' });
    expect(has(out.include, 'randomized controlled trials')).toBe(true);
    expect(has(out.exclude, 'animal studies')).toBe(true);
  });
});

describe('suggestCriteriaKeywords — specificity + dedup', () => {
  it('prefers the qualified phrase over the bare concept', () => {
    const out = suggestCriteriaKeywords({
      incl: 'Adults with drug-resistant epilepsy\nPatients with epilepsy',
    });
    expect(has(out.include, 'drug-resistant epilepsy')).toBe(true);
    expect(has(out.include, 'epilepsy')).toBe(false);
  });

  it('does not split a hyphenated qualifier off its concept', () => {
    const out = suggestCriteriaKeywords({ incl: 'Adults with drug-resistant epilepsy' });
    expect(has(out.include, 'drug-resistant')).toBe(false);
    expect(out.include[0]).toBe('drug-resistant epilepsy');
  });

  it('dedupes repeated suggestions on the normalized key', () => {
    const out = suggestCriteriaKeywords({
      incl: 'Adults with Drug-Resistant Epilepsy\n• drug-resistant   epilepsy\n• DRUG-RESISTANT EPILEPSY',
    });
    const keys = out.include.map(t => t.toLowerCase().replace(/\s+/g, ' '));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter(k => k === 'drug-resistant epilepsy')).toHaveLength(1);
  });

  it('stays small and high-confidence (cap per side)', () => {
    const many = Array.from({ length: 40 }, (_, i) => `• condition number ${i} disorder${i}`).join('\n');
    const out = suggestCriteriaKeywords({ incl: many });
    expect(out.include.length).toBeLessThanOrEqual(MAX_SUGGESTIONS_PER_SIDE);
  });
});

describe('suggestCriteriaKeywords — conflicting polarity', () => {
  it('107.md regression fixture (conflict variant): epilepsy on BOTH sides activates NEITHER', () => {
    const out = suggestCriteriaKeywords({
      incl: 'Adults with epilepsy',
      excl: 'Studies with epilepsy',
    });
    expect(has(out.include, 'epilepsy')).toBe(false);
    expect(has(out.exclude, 'epilepsy')).toBe(false);
    expect(out.conflicts).toHaveLength(1);
    expect(out.conflicts[0].term.toLowerCase()).toBe('epilepsy');
    expect(out.conflicts[0].reason).toMatch(/both inclusion and exclusion/i);
  });

  // 107.md rec — conflicts used to be intersected over the SYNONYM-EXPANDED lists,
  // and SYNONYM_FAMILIES groups members that are not clinically interchangeable
  // (bariatric surgery / sleeve gastrectomy / gastric bypass). A synonym-only
  // collision therefore deleted the concept the reviewer literally wrote and offered
  // a phrase from neither criterion under "Appears in both …".
  it('107.md rec regression fixture: a shared synonym family is NOT a conflict', () => {
    const out = suggestCriteriaKeywords({
      incl: 'Adults undergoing bariatric surgery',
      excl: 'Revision after sleeve gastrectomy',
    });
    expect(out.conflicts).toEqual([]);
    expect(has(out.include, 'bariatric surgery')).toBe(true);   // the verbatim criterion survives
    expect(has(out.exclude, 'sleeve gastrectomy')).toBe(true);
    // 'metabolic surgery' appears in NEITHER criterion — it must never be presented
    // as an arbitration card, and it must not be offered on both sides at once.
    expect(has(out.include, 'metabolic surgery')).toBe(false);
    expect(has(out.exclude, 'metabolic surgery')).toBe(false);
    expect(has(out.exclude, 'bariatric surgery')).toBe(false);  // only a synonym here
  });

  it('the sibling fixture behaves the same way (sleeve gastrectomy vs gastric bypass)', () => {
    const out = suggestCriteriaKeywords({
      incl: 'Adults undergoing sleeve gastrectomy',
      excl: 'Prior gastric bypass',
    });
    expect(out.conflicts).toEqual([]);
    expect(has(out.include, 'sleeve gastrectomy')).toBe(true);
    expect(has(out.exclude, 'gastric bypass')).toBe(true);
  });

  it('every reported conflict is a concept actually written on BOTH sides', () => {
    const cases = [
      { incl: 'Adults undergoing bariatric surgery', excl: 'Revision after sleeve gastrectomy' },
      { incl: 'Adults with epilepsy', excl: 'Studies with epilepsy' },
      { incl: 'Adults with type 2 diabetes', excl: 'Gestational diabetes' },
      { incl: 'Randomized controlled trials', excl: 'Animal studies' },
    ];
    for (const snap of cases) {
      const out = suggestCriteriaKeywords(snap);
      for (const { term } of out.conflicts) {
        const k = term.toLowerCase();
        expect(snap.incl.toLowerCase(), JSON.stringify(snap)).toContain(k);
        expect(snap.excl.toLowerCase(), JSON.stringify(snap)).toContain(k);
      }
    }
  });

  it('only the ambiguous concept is withheld — the rest of each side survives', () => {
    const out = suggestCriteriaKeywords({
      incl: 'Adults with epilepsy\nRandomized controlled trials',
      excl: 'Studies with epilepsy\nCase reports',
    });
    expect(has(out.include, 'randomized controlled trials')).toBe(true);
    expect(has(out.exclude, 'case reports')).toBe(true);
    expect(out.conflicts.map(c => c.term.toLowerCase())).toContain('epilepsy');
  });
});

describe('suggestCriteriaKeywords — input tolerance', () => {
  it('accepts a JSON string snapshot and tolerates junk', () => {
    expect(suggestCriteriaKeywords(JSON.stringify({ incl: 'cohort study' })).include)
      .toContain('cohort study');
    for (const junk of ['not json', null, undefined, {}, 7, []]) {
      expect(suggestCriteriaKeywords(junk)).toEqual({ include: [], exclude: [], conflicts: [] });
    }
  });

  it('reads ONLY incl/excl, never the rest of the PICO', () => {
    const out = suggestCriteriaKeywords({ P: 'elderly population', I: 'aspirin', incl: 'cohort study' });
    expect(has(out.include, 'aspirin')).toBe(false);
    expect(has(out.include, 'cohort study')).toBe(true);
  });
});
